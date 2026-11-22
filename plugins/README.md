# Official Bowerbird Plugins

Bowerbird's desktop UI is completely native (`mygo/ui` + Go). Plugins are
self-maintained packages that extend Bowerbird without coupling plugin logic
into the host application:

1. **Isolated WebView pages** (`preview.entry`, `ui.windows`, `ui.panels`) —
   for custom file previews, rich interactive tools, and controlled external
   HTTPS apps (`Transparent: true`, `bowerplugin://localhost/...`, `/_api/*`).
2. **moejs sandbox hooks** (`main` + `hooks`) — zero-build `.js`/`.ts` modules
   run in-process by the Go host for URL resolution (`resolveUrl`), declarative
   inspector sections (`inspect`), gallery actions (`actions` / `runAction`),
   and thumbnail generation (`thumbnail`).

## Plugin layout

```text
<plugin-id>/
├── plugin.json    # manifest: capabilities, permissions, entries/hooks
├── index.js       # optional: moejs hooks (.js or .ts, zero-build)
└── view.html / ui/ # optional: WebView pages (no inline <script> due to CSP)
```

## Security & Sandbox

- **JS Hooks (moejs)**: Every exported hook must be declared in `hooks`. Network
  (`host.fetch`), process (`host.spawn`), and external browser (`host.platformOpen`)
  are denied unless declared in `permissions`. Each invocation gets a fresh
  runtime with a 256 MB heap limit and 60s timeout.
- **WebView Pages (`bowerplugin://`)**: Loaded in an `Untrusted: true`,
  ephemeral session with strict CSP (`script-src 'self' 'wasm-unsafe-eval'`).
  Sensitive bridge endpoints (`/_api/asset`, `/_api/asset/raw`,
  `/_api/asset/save`, `/_api/network`) require declared `permissions` plus
  explicit user consent in Settings.

## Development & Distribution

The desktop app scans this repository's `plugins/` folder in development
automatically.

Run `pnpm run ci` (which runs `tsc --noEmit`, `node scripts/build-plugins.mjs`,
and `python3 scripts/package-plugins.py`) to build and package plugins into
`dist/plugins/`.
