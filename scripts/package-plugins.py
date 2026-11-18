#!/usr/bin/env python3
"""Package zero-build native plugins and the marketplace registry."""

import argparse
import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
IGNORED = {"node_modules", "dist", ".git", "__pycache__"}


def package_plugins(source: Path, output: Path) -> None:
    manifests = []
    ids = set()
    # Validate all inputs before replacing the previous distribution.
    for path in sorted(source.glob("*/plugin.json")):
        manifest = json.loads(path.read_text(encoding="utf-8"))
        plugin_id = manifest.get("id", "")
        version = manifest.get("version", "")
        if not re.fullmatch(r"[A-Za-z0-9_-]+(?:[.-][A-Za-z0-9_-]+)*", plugin_id):
            raise ValueError(f"{path}: invalid plugin id")
        if plugin_id in ids:
            raise ValueError(f"{path}: duplicate plugin id {plugin_id}")
        if not re.fullmatch(r"\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?", version):
            raise ValueError(f"{path}: invalid plugin version")
        if not manifest.get("name"):
            raise ValueError(f"{path}: missing plugin name")
        main = manifest.get("main")
        native = manifest.get("native") or manifest.get("preview", {}).get("renderer")
        if not main and not native:
            raise ValueError(f"{path}: plugin must declare main or native")
        if main:
            entry = (path.parent / main).resolve()
            if not entry.is_relative_to(path.parent.resolve()) or not entry.is_file():
                raise ValueError(f"{path}: missing or unsafe entry module {main}")
            if not manifest.get("hooks"):
                raise ValueError(f"{path}: JavaScript plugin must declare hooks")
        ids.add(plugin_id)
        manifests.append((path, manifest))
    if not manifests:
        raise ValueError(f"No plugin.json files found under {source}")

    if output.exists():
        shutil.rmtree(output)
    releases = output / "releases"
    releases.mkdir(parents=True)
    index = []
    for path, manifest in manifests:
        plugin_id = manifest["id"]
        target = output / plugin_id
        shutil.copytree(
            path.parent, target,
            ignore=shutil.ignore_patterns(*IGNORED, ".*", "*.zip", "*.tsbuildinfo"),
        )
        # Keep the legacy manifest endpoint usable while native installers use
        # plugin.json. Both files describe the same zero-build plugin.
        (target / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
        )
        asset = f"{plugin_id}-v{manifest['version']}.zip"
        with ZipFile(releases / asset, "w", compression=ZIP_DEFLATED) as archive:
            for file in sorted(target.rglob("*")):
                if file.is_file():
                    archive.write(file, file.relative_to(target).as_posix())
        index.append({**manifest, "assetFileName": asset})
        print(f"Packaged {asset}")

    registry = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "plugins": index,
    }
    (output / "registry.json").write_text(
        json.dumps(registry, ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
    )
    (output / "index.min.json").write_text(
        json.dumps(registry, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=ROOT / "plugins")
    parser.add_argument("--output", type=Path, default=ROOT / "dist/plugins")
    args = parser.parse_args()
    source, output = args.source.resolve(), args.output.resolve()
    if source == output or source.is_relative_to(output) or output.is_relative_to(source):
        parser.error("source and output must not overlap")
    package_plugins(source, output)
