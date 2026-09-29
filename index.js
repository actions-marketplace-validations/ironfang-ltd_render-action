// Ironfang Render for GitHub Actions.
//
// No dependencies, deliberately. A JavaScript action has to ship whatever it
// imports - either node_modules committed to the repository or a bundler step
// and a build artefact to keep in sync - and the whole of what @actions/core
// does here is read environment variables and append to two files. Node 20
// brings fetch. So the action is one file, and what you read is what runs.

const fs = require('node:fs');
const path = require('node:path');

/* ----------------------------- actions plumbing --------------------------- */

// The runner sets INPUT_API-KEY, dash and all: its rule is spaces to
// underscores and uppercase, and nothing else. The underscored spelling is
// accepted too, because that is the one a person can type at a shell when they
// want to run this locally.
const input = (name) => {
    const key = `INPUT_${name.replace(/ /g, '_').toUpperCase()}`;
    return (process.env[key] ?? process.env[key.replace(/-/g, '_')] ?? '').trim();
};
/**
 * boolInput takes its default from here as well as from action.yml, because
 * the manifest's defaults are applied by the runner and nothing else. An
 * unset fail-on-error must not mean "carry on regardless" - a flag whose job
 * is to report failure has to fail closed.
 */
const boolInput = (name, fallback = false) => {
    const raw = input(name).toLowerCase();
    if (raw === '') return fallback;
    return ['true', '1', 'yes'].includes(raw);
};
const intInput = (name) => {
    const raw = input(name);
    if (raw === '') return undefined;
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error(`${name} must be a number, got "${raw}"`);
    return n;
};

const info = (msg) => process.stdout.write(`${msg}\n`);

// A workflow command is one line, so anything in the message that would end
// it early has to be escaped. An API error is the likeliest source of a
// newline, and it would otherwise truncate the very message worth reading.
const escapeCommand = (msg) =>
    String(msg).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

const error = (msg) => process.stdout.write(`::error::${escapeCommand(msg)}\n`);

// The runner masks anything that came from a secret, but not a key someone
// pasted into `with:`. Masking it ourselves costs one line and means the
// wrong way of passing it is merely wrong rather than public.
const mask = (secret) => process.stdout.write(`::add-mask::${escapeCommand(secret)}\n`);

// Outputs and the job summary are files the runner gives us, not stdout
// commands - the ::set-output form was removed. Both are absent when someone
// runs this locally, which is exactly when you want it to still work.
function appendFile(envVar, text) {
    const file = process.env[envVar];
    if (file) fs.appendFileSync(file, text);
}

function setOutput(name, value) {
    const delimiter = `ghadelimiter_${name}`;
    appendFile('GITHUB_OUTPUT', `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}

/* -------------------------------- rendering ------------------------------- */

const EXTENSION = { png: 'png', jpeg: 'jpg', webp: 'webp' };
const REQUEST_TIMEOUT_MS = 180_000;

const usedNames = new Set();

/**
 * fileNameFor turns a URL into something that is legible in an artefact
 * listing and safe on every filesystem a runner might be using:
 * https://ironfang.com/render/docs -> ironfang-com-render-docs.png
 */
function fileNameFor(target, index, extension, total) {
    // An explicit name wins, and only gets a number when there is more than
    // one file to tell apart.
    const chosen = input('file-name');
    if (chosen) {
        const stem = chosen.replace(/\.[a-z0-9]+$/i, '');
        return total > 1 ? `${stem}-${index + 1}.${extension}` : `${stem}.${extension}`;
    }

    let stem = '';
    try {
        const url = new URL(target);
        stem = `${url.hostname}${url.pathname}`.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
    } catch {
        /* not a URL - html, or a template id; the fallback stem stands */
    }
    // https://example.com/a and https://example.com/a/ slugify the same, and
    // the second would silently overwrite the first in the artefact.
    let name = `${stem.slice(0, 120) || `render-${index + 1}`}.${extension}`;
    if (usedNames.has(name)) {
        name = `${stem.slice(0, 120) || 'render'}-${index + 1}.${extension}`;
    }
    usedNames.add(name);
    return name;
}

function requestFor(target, kind, format) {
    const common = {
        width: intInput('width'),
        height: intInput('height'),
        delay_ms: intInput('delay-ms'),
    };
    if (kind === 'pdf') {
        return {
            path: '/v1/pdf',
            body: { url: target || undefined, html: input('html') || undefined, print_background: true },
        };
    }
    if (kind === 'image') {
        const template = input('template');
        if (!template) throw new Error('kind=image needs a template id.');
        let vars = {};
        if (input('vars')) {
            try {
                vars = JSON.parse(input('vars'));
            } catch (err) {
                throw new Error(`vars must be a JSON object: ${err.message}`);
            }
        }
        return { path: `/v1/image/${encodeURIComponent(template)}`, body: { vars, format } };
    }
    const device = input('device');
    return {
        path: '/v1/screenshot',
        body: {
            url: target || undefined,
            html: input('html') || undefined,
            full_page: boolInput('full-page') || undefined,
            selector: input('selector') || undefined,
            device: device && device !== 'desktop' ? device : undefined,
            dark_mode: boolInput('dark-mode') || undefined,
            format,
            quality: intInput('quality'),
            ...common,
        },
    };
}

async function render({ baseUrl, apiKey, target, kind, format, outputDir, index, total }) {
    const { path: apiPath, body } = requestFor(target, kind, format);

    // Generous, but finite. Ironfang Render has its own timeouts; this one is for
    // the connection that never answers, which would otherwise hold the job
    // open until the job's own timeout hours later.
    const response = await fetch(baseUrl.replace(/\/$/, '') + apiPath, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) throw new Error(await describeFailure(response));

    const extension = kind === 'pdf' ? 'pdf' : (EXTENSION[format] ?? 'png');
    const fileName = fileNameFor(target, index, extension, total);
    const filePath = path.join(outputDir, fileName);
    fs.writeFileSync(filePath, Buffer.from(await response.arrayBuffer()));

    // What the render counted on the billing account: the meter and the
    // quantity committed there. A cache hit names its meter and counts 0.
    const quantity = Number(response.headers.get('x-ironfang-quantity'));
    return {
        target: target || (kind === 'image' ? input('template') : 'html'),
        path: filePath,
        bytes: fs.statSync(filePath).size,
        meter: response.headers.get('x-ironfang-meter') || null,
        quantity: Number.isInteger(quantity) && quantity >= 0 ? quantity : 0,
        cached: response.headers.get('x-ironfang-cache') === 'hit',
        renderMs: Number(response.headers.get('x-ironfang-render-ms')) || null,
    };
}

/**
 * describeFailure turns an error response into one line. The API writes its
 * messages for a person - "This month's free allowance is used up", "too many
 * renders of that site per minute" - so the message is passed through, after
 * the status and the code to branch on. A billing refusal also names the
 * product and meter it refused and when the free allowance renews, and
 * Retry-After says when trying again can succeed. The request id is what to
 * quote to support.
 */
async function describeFailure(response) {
    let parsed = null;
    try {
        parsed = JSON.parse(await response.text());
    } catch {
        /* not JSON; the status stands */
    }
    const e = parsed && typeof parsed.error === 'object' && parsed.error ? parsed.error : {};
    const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');
    const code = text(e.code);
    let line = `HTTP ${response.status}`;
    if (code) line += ` ${code}`;
    if (text(e.message)) line += `: ${text(e.message)}`;

    const context = [];
    if (text(e.product)) context.push(`product ${text(e.product)}`);
    if (text(e.meter)) context.push(`meter ${text(e.meter)}`);
    if (text(e.reset_at)) context.push(`free allowance renews ${text(e.reset_at)}`);
    const retry = (response.headers.get('retry-after') || '').trim();
    if (/^\d+$/.test(retry)) context.push(`retry after ${retry}s`);
    if (text(parsed?.request_id)) context.push(`request ${text(parsed.request_id)}`);
    if (context.length) line += ` (${context.join(', ')})`;
    return line;
}

/* --------------------------------- summary -------------------------------- */

function writeSummary(results, failures) {
    const rows = results.map(
        (r) =>
            `| \`${r.target}\` | \`${r.path}\` | ${(r.bytes / 1024).toFixed(0)} KB | ${
                r.cached ? 'cache' : `${r.renderMs ?? '?'} ms`
            } | ${r.meter ? `${r.quantity} on \`${r.meter}\`` : '-'} |`
    );
    const failed = failures.map((f) => `| \`${f.target}\` | ${f.message} |`);

    let md = `## Ironfang Render\n\n`;
    if (rows.length) {
        md += `| Source | File | Size | Time | Counted |\n|---|---|---|---|---|\n${rows.join('\n')}\n\n`;
    }
    if (failed.length) {
        md += `### Failed\n\n| Source | Why |\n|---|---|\n${failed.join('\n')}\n\n`;
    }
    appendFile('GITHUB_STEP_SUMMARY', md);
}

/* ---------------------------------- main ---------------------------------- */

async function main() {
    const apiKey = input('api-key');
    if (!apiKey) throw new Error('api-key is required. Pass it from a secret.');
    mask(apiKey);

    // Read every numeric input once, up front. A mistyped width is a mistake
    // about the whole step, and reporting it per URL would say the same thing
    // forty times and still spend nothing useful finding out.
    ['width', 'height', 'quality', 'delay-ms'].forEach(intInput);

    const kind = (input('kind') || 'screenshot').toLowerCase();
    if (!['screenshot', 'pdf', 'image'].includes(kind)) {
        throw new Error(`kind must be screenshot, pdf or image, got "${kind}"`);
    }
    const format = (input('format') || 'png').toLowerCase();
    if (!EXTENSION[format]) throw new Error(`format must be png, jpeg or webp, got "${format}"`);

    const targets = input('urls')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    // One render with no URL is the html or template case; anything else needs
    // something to point at.
    if (!targets.length) {
        if (kind !== 'image' && !input('html')) {
            throw new Error('Give urls, or html to render instead.');
        }
        targets.push('');
    }

    const outputDir = input('output-dir') || 'renderwolf';
    fs.mkdirSync(outputDir, { recursive: true });

    const baseUrl = input('base-url') || 'https://api.ironfang.com/render';
    const results = [];
    const failures = [];

    // Serial on purpose. The API rate-limits per account and per target host,
    // and a matrix job firing forty renders at once would spend its budget
    // discovering that.
    for (const [index, target] of targets.entries()) {
        try {
            const result = await render({
                baseUrl, apiKey, target, kind, format, outputDir, index, total: targets.length,
            });
            results.push(result);
            info(
                `${result.path}  ${(result.bytes / 1024).toFixed(0)} KB  ` +
                    `${result.cached ? 'from cache' : `${result.renderMs} ms`}` +
                    (result.meter ? `  counted ${result.quantity} on ${result.meter}` : '')
            );
        } catch (err) {
            failures.push({ target: target || 'html', message: err.message });
            error(`${target || 'html'}: ${err.message}`);
        }
    }

    if (boolInput('summary', true)) writeSummary(results, failures);

    setOutput('files', JSON.stringify(results.map((r) => r.path)));
    setOutput('count', String(results.length));
    // A step renders one kind, so everything it counted is on one meter.
    setOutput('meter', results.find((r) => r.meter)?.meter ?? '');
    setOutput('quantity', String(results.reduce((total, r) => total + r.quantity, 0)));

    if (failures.length && boolInput('fail-on-error', true)) {
        throw new Error(`${failures.length} of ${targets.length} renders failed`);
    }
}

main().catch((err) => {
    error(err.message);
    process.exit(1);
});
