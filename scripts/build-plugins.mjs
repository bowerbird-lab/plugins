#!/usr/bin/env node
/**
 * Build Bowerbird plugins into .build/plugins.
 *
 * - TypeScript entries (.ts / .mts / .cts) are bundled with esbuild to .js / .mjs.
 * - Single-file JavaScript entries (.js / .mjs) are copied directly as-is.
 * - Non-TS assets (plugin.json, view.html, etc.) are copied into the output dir.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_DIR = path.join(ROOT, "plugins");
const BUILD_DIR = path.join(ROOT, ".build", "plugins");

const TS_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);
const JS_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);
const IGNORED_DIRS = new Set(["node_modules", "dist", ".build", ".git", "__pycache__"]);

function resolveEntrySource(pluginDir, declaredMain) {
  const exactPath = path.join(pluginDir, declaredMain);
  if (fs.existsSync(exactPath) && fs.statSync(exactPath).isFile()) {
    return exactPath;
  }
  const parsed = path.parse(declaredMain);
  if (JS_EXTENSIONS.has(parsed.ext)) {
    const tsExt = parsed.ext === ".mjs" ? ".mts" : parsed.ext === ".cjs" ? ".cts" : ".ts";
    const tsCandidate = path.join(pluginDir, parsed.dir, `${parsed.name}${tsExt}`);
    if (fs.existsSync(tsCandidate) && fs.statSync(tsCandidate).isFile()) {
      return tsCandidate;
    }
  }
  throw new Error(`Missing entry module ${declaredMain} (checked ${exactPath})`);
}

function compiledOutRelPath(declaredMain, sourcePath) {
  const sourceExt = path.extname(sourcePath);
  if (TS_EXTENSIONS.has(sourceExt)) {
    const outExt = sourceExt === ".mts" ? ".mjs" : sourceExt === ".cts" ? ".cjs" : ".js";
    const parsed = path.parse(declaredMain);
    return path.join(parsed.dir, `${parsed.name}${outExt}`);
  }
  return declaredMain;
}

function copyAssets(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith(".")) {
      continue;
    }
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyAssets(srcPath, destPath);
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (TS_EXTENSIONS.has(ext) || entry.name === "tsconfig.json" || entry.name.endsWith(".tsbuildinfo")) {
      continue;
    }
    fs.copyFileSync(srcPath, destPath);
  }
}

async function main() {
  if (fs.existsSync(BUILD_DIR)) {
    fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(BUILD_DIR, { recursive: true });

  const entries = fs.readdirSync(SOURCE_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));

  let builtCount = 0;
  for (const dirEntry of entries) {
    const pluginDir = path.join(SOURCE_DIR, dirEntry.name);
    const manifestPath = path.join(pluginDir, "plugin.json");
    if (!fs.existsSync(manifestPath)) {
      continue;
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const outDir = path.join(BUILD_DIR, dirEntry.name);
    copyAssets(pluginDir, outDir);

    if (manifest.main) {
      const entrySource = resolveEntrySource(pluginDir, manifest.main);
      const outRel = compiledOutRelPath(manifest.main, entrySource);
      const outPath = path.join(outDir, outRel);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });

      const ext = path.extname(entrySource).toLowerCase();
      if (TS_EXTENSIONS.has(ext)) {
        await build({
          entryPoints: [entrySource],
          outfile: outPath,
          bundle: true,
          format: "esm",
          platform: "neutral",
          target: "es2022",
          mainFields: ["module", "main"],
          legalComments: "none",
        });
        console.log(`Compiled TS plugin ${dirEntry.name}: ${path.relative(pluginDir, entrySource)} -> ${outRel}`);
      } else {
        fs.copyFileSync(entrySource, outPath);
        console.log(`Staged JS/MJS plugin ${dirEntry.name}: ${outRel}`);
      }

      if (manifest.main !== outRel) {
        manifest.main = outRel.split(path.sep).join("/");
        fs.writeFileSync(
          path.join(outDir, "plugin.json"),
          JSON.stringify(manifest, null, 2) + "\n",
          "utf8",
        );
      }
    } else {
      console.log(`Staged native plugin ${dirEntry.name}`);
    }
    builtCount += 1;
  }

  if (builtCount === 0) {
    throw new Error(`No plugins found under ${SOURCE_DIR}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
