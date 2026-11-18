# Bowerbird Official Plugins

Official plugin source repository for [Bowerbird](https://github.com/bowerbird-lab/bowerbird).

## Branch Layout

- **`main`**: Plugin source code (`plugins/<id>/`), TypeScript/JS build & packaging scripts, and CI workflow.
- **`repo`** *(orphan branch)*: Auto-generated compiled build artifacts (`index.min.json`, `registry.json`, `repo/<id>/...`). Do not edit manually.
- **GitHub Releases (`plugins-latest`)**: Packaged `.zip` release bundles for each plugin.

## Authoring Plugins

- **TypeScript plugins**: Set `"main": "index.js"` in `plugin.json` and author `index.ts` (or `index.mts` with `"main": "index.mjs"`). `pnpm run build` compiles TS entries with `esbuild` and packages only the compiled output.
- **Single-file JS / MJS plugins**: Author `index.js` or `index.mjs` directly (matching `"main"` in `plugin.json`). `tsc --noEmit` still type-checks them via `allowJs` + `checkJs` against `@bowerbird/plugin-sdk`.
- **Native preview plugins**: Declare `"native": "..."` in `plugin.json` without a `"main"` script.

## Local Build

```bash
pnpm install
pnpm run ci
```

Outputs are generated under `.build/plugins/` (compiled) and `dist/plugins/` (packaged).
