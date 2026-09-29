# Ironfang Render for GitHub Actions

Formerly `renderwolf-action`: workflows that still say
`ironfang-ltd/renderwolf-action@v1` keep working, because GitHub redirects
the old name.

v2 follows Ironfang's move from credits to metered usage: the `credits`
output is replaced by `meter` and `quantity`, and a failed render reports the
API's error code, with the product, meter and allowance renewal when billing
refused it. Inputs are unchanged.

Capture screenshots and PDFs of pages from a workflow. Point it at a deploy
preview and keep the images as build artefacts, print a table of what was
captured into the job summary, or generate images as part of a release.

No dependencies: one file, Node 20, `fetch`. Nothing is bundled and there is no
`node_modules` to keep in step with the source.

```yaml
- uses: ironfang-ltd/render-action@v2
  with:
    api-key: ${{ secrets.IRONFANG_API_KEY }}
    urls: https://example.com/
```

Get a key from the [Ironfang portal](https://portal.ironfang.com). Renders
are billed to your organisation's Ironfang billing account: each kind of render
counts against a meter with a monthly free allowance, and paid usage beyond it
is switched on in Billing in the portal.

## Auditing a deploy preview

The case this was written for. Capture every page you care about at the
viewport you care about, keep them as an artefact, and read the job summary to
see what changed size or stopped rendering.

```yaml
name: Visual audit
on: pull_request

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - id: shots
        uses: ironfang-ltd/render-action@v2
        with:
          api-key: ${{ secrets.IRONFANG_API_KEY }}
          urls: |
            ${{ steps.deploy.outputs.preview-url }}/
            ${{ steps.deploy.outputs.preview-url }}/pricing
            ${{ steps.deploy.outputs.preview-url }}/docs
          width: 1440
          full-page: true
          format: webp
          output-dir: audit

      - uses: actions/upload-artifact@v4
        with:
          name: visual-audit
          path: audit/

      - run: echo "${{ steps.shots.outputs.count }} pages, ${{ steps.shots.outputs.quantity }} counted on ${{ steps.shots.outputs.meter }}"
```

Add `device: mobile` in a matrix to audit both viewports, or `dark-mode: true`
to catch a dark theme that only breaks in CI.

## Inputs

| Input | Default | What it does |
|---|---|---|
| `api-key` | - | **Required.** Pass it from a secret, never inline. |
| `urls` | - | URLs to render, one per line. |
| `html` | - | Raw HTML to render, instead of a URL. |
| `kind` | `screenshot` | `screenshot`, `pdf`, or `image` for a saved template. |
| `template` | - | Template id, for `kind: image`. |
| `vars` | - | JSON object of template variables, for `kind: image`. |
| `output-dir` | `renderwolf` | Where to write. Created if missing. (The folder keeps its old name within v1, so existing workflows that read it keep working.) |
| `file-name` | from the URL | Name without an extension. Numbered when there is more than one. |
| `format` | `png` | `png`, `jpeg` or `webp`. Ignored for PDFs. |
| `width` / `height` | API defaults | Viewport size in pixels. |
| `full-page` | `false` | Capture the whole scrollable page. |
| `selector` | - | Capture one element, e.g. `#hero`. |
| `device` | - | `desktop`, `tablet` or `mobile`. |
| `dark-mode` | `false` | Render as a visitor who prefers dark. |
| `quality` | API default | 1-100, for `jpeg` and `webp`. |
| `delay-ms` | - | Extra wait after the page settles. |
| `fail-on-error` | `true` | Set `false` to capture what you can and carry on. |
| `summary` | `true` | Write a table of what was captured to the job summary. |
| `base-url` | production | Only to point at something other than production. |

## Outputs

| Output | What it is |
|---|---|
| `files` | JSON array of the files written, in the order the URLs were given. |
| `count` | How many files were written. |
| `meter` | The billing meter the renders counted against: `render.screenshot`, `render.pdf` or `render.image`. Empty when nothing was rendered. |
| `quantity` | The total the step counted on that meter, one per render. Cache hits count zero. |

## Notes

Renders run one at a time. The API rate-limits per account and per target host,
and a job firing forty at once would spend its budget finding that out.

An identical request made again within ten minutes may be served from cache,
which counts nothing. After that it is a new render.

A failed render is reported on one line with the HTTP status, the API's error
code (for example `free_allowance_exhausted` or `target_rate_limited`) and its
message. When billing refused the render, the line also names the product, the
meter and when the free allowance renews, and `billing_temporarily_unavailable`
says how many seconds to wait before retrying. Billing refusals are resolved in
Billing in the portal, or when the month rolls over; nothing was rendered or
counted.

Full API reference: <https://ironfang.com/render/docs>
