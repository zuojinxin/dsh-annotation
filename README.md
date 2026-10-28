# dsh-annotation

Select text in a DSH conversation or a workspace file preview, annotate it, and press Enter — the annotation block rides along with your message, and the model answers each annotation by number.

**English** · [简体中文](./README.zh-CN.md)

[![DSH](https://img.shields.io/badge/DSH-up%20to%200.2.1--rc.3-4D6BFE)](https://github.com/deepseek-ai/deepseek-harness) [![License](https://img.shields.io/badge/License-MIT-green)](./LICENSE) [![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

## What it does

- **Annotate on selection** — select assistant text (or text in a workspace file preview), pick 批注 in the toolbar, write the note. Leaving it empty marks the passage without a comment.
- **Numbered markers** — the passage gets a highlight and a blue index number that stays anchored while you scroll and dodges collisions.
- **Collect across turns** — annotations pile up from any number of messages and turns, numbered from 1.
- **Pending tag** — a `N 条批注` tag next to the composer lists every pending annotation on hover and deletes them one by one.
- **Send with Enter** — the annotation block goes out together with whatever you typed. The model receives the full block.
- **Clean user bubble** — the block is stripped from the bubble before the browser paints, so your own message shows only your question plus the tag; a reload repairs history too.
- **Numbered reply** — the message carries a format instruction, and the model answers `Annotation 1: …` through `Annotation N: …`; each label in the reply becomes a hoverable chip showing the quoted passage and your note.
- **File annotations** — the same flow works in the sidebar file preview (Markdown, plain text, code). Quotes carry the file path, markers survive a reload, and the same passage in two different files stays two separate annotations.

## Flow

```
select text ──▶ toolbar 批注 ──▶ write or leave empty ──▶ highlight + index number
      ▲                                                          │
      └───────────── any number, across turns ◀──────────────────┘
                          │
                          ▼
             N 条批注 tag beside the composer (hover / delete)
                          │
                       Enter
                          ▼
   model receives: annotation block (index + quote + note) + your question
   your bubble:   only the question + the tag, no block text
   model reply:   Annotation 1: … Annotation 2: … (hoverable chips)
```

## Install

```bash
dsh plugin --profile desktop add 'github:zuojinxin/dsh-annotation'
```

Restart the DSH desktop app to load it.

## Notes

- Built for DeepSeek Harness 0.2.1-rc.3 (desktop). The plugin locates the host by CSS classes and DOM structure, so a host upgrade may need a matching update.
- PDF, images and HTML inside an iframe are out of scope; text in the file preview and in chat messages is in scope.
- While the toolbar is open on an assistant passage it takes over the host's own text-quote overlay, so there is only one entry point.
- UI strings and the annotation protocol follow the host `locale` (Chinese / English, switchable at runtime).
- Pending annotations live in browser `localStorage`; clearing site data or switching browsers drops them.
- Disabling the plugin removes every element and style it added.

## Development

```bash
npm test                  # jsdom unit tests
node --check client.js    # the browser bundle is hand-written, not built
node docs/render-demo.mjs # re-render the animation and screenshots (headless Edge + ffmpeg)
```

The browser-level checks (`test/overlay-browser.mjs`, `test/sidebar-browser.mjs`) need a Playwright installation: point `PLAYWRIGHT_MODULE` at an existing `playwright-core/index.mjs`.

## License

[MIT](./LICENSE).
