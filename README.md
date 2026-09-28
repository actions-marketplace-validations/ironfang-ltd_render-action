# Ironfang Render for GitHub Actions

Formerly `renderwolf-action`: workflows that still say
`ironfang-ltd/renderwolf-action@v1` keep working, because GitHub redirects
the old name.

Capture screenshots and PDFs of pages from a workflow. Point it at a deploy
preview and keep the images as build artefacts, print a table of what was
captured into the job summary, or generate images as part of a release.

No dependencies: one file, Node 20, `fetch`. Nothing is bundled and there is no
`node_modules` to keep in step with the source.

```yaml
- uses: ironfang-ltd/render-action@v1
  with:
    api-key: ${{ secrets.IRONFANG_API_KEY }}
    urls: https://example.com/
```

Get a key from the [Ironfang portal](https://portal.ironfang.com). A free
account renders 250 credits a month with no card; free output carries a small
Ironfang Render badge, and any paid plan removes it.

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
        uses: ironfang-ltd/render-action@v1
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

      - run: echo "${{ steps.shots.outputs.count }} pages, ${{ steps.shots.outputs.credits }} credits"
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
| `credits` | Total credits the step spent. Cache hits are free and count as zero. |

## Notes

Renders run one at a time. The API rate-limits per account and per target host,
and a job firing forty at once would spend its budget finding that out.

Identical requests are served from cache and cost nothing, so re-running a
workflow on an unchanged page is free.

Full API reference: <https://ironfang.com/render/docs>
