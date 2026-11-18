# Bowerbird Official Plugins

Official plugin source repository for [Bowerbird](https://github.com/bowerbird-lab/bowerbird).

## Branch Layout

- **`main`**: Plugin source code (`plugins/<id>/`), packaging script (`scripts/package-plugins.py`), and CI workflow.
- **`repo`** *(orphan branch)*: Auto-generated build artifacts (`index.min.json`, `registry.json`, `repo/<id>/...`). Do not edit manually.
- **GitHub Releases (`plugins-latest`)**: Packaged `.zip` release bundles for each plugin.

## Local Build

```bash
python3 scripts/package-plugins.py
```

Outputs are generated under `dist/plugins/`.
