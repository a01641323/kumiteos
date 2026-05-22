#!/usr/bin/env tsx
// Pre-compile step: stage the static web frontend + a version stamp
// next to the local server entry so `bun build --compile` (or `pkg`,
// or a plain tarball) ships them alongside the binary.
//
// Layout produced (paths relative to apps/local/):
//   embedded/
//     web/                          ← copy of apps/web/out
//     version.json                  ← { gitSha, tag, builtAt, target }
//
// CLI: `tsx build-bundle.ts [--target=<bun-target>]`. --target is just
// stamped into version.json; the binary build itself is run separately.

import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const WEB_OUT = path.resolve(HERE, "..", "web", "out");
const EMBED_ROOT = path.join(HERE, "embedded");
const EMBED_WEB = path.join(EMBED_ROOT, "web");

function arg(name: string): string | null {
  const m = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return m ? m.slice(name.length + 3) : null;
}

function gitSha(): string {
  try { return execSync("git rev-parse --short HEAD", { cwd: HERE }).toString().trim(); }
  catch { return "unknown"; }
}

function gitTag(): string {
  try { return execSync("git describe --tags --abbrev=0 2>/dev/null", { cwd: HERE }).toString().trim(); }
  catch { return "untagged"; }
}

function copyDir(src: string, dst: string): number {
  if (!fs.existsSync(src)) throw new Error(`web build missing at ${src} — run \`pnpm --filter @karate/web build\` first`);
  fs.mkdirSync(dst, { recursive: true });
  let n = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) n += copyDir(s, d);
    else if (entry.isFile()) { fs.copyFileSync(s, d); n++; }
  }
  return n;
}

function rmDir(p: string) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

const target = arg("target") ?? "any";
rmDir(EMBED_ROOT);
const count = copyDir(WEB_OUT, EMBED_WEB);
const meta = { gitSha: gitSha(), tag: gitTag(), builtAt: new Date().toISOString(), target, fileCount: count };
fs.writeFileSync(path.join(EMBED_ROOT, "version.json"), JSON.stringify(meta, null, 2));
console.log(`[build-bundle] embedded ${count} web files at ${EMBED_WEB}`);
console.log(`[build-bundle] version: ${meta.tag} (${meta.gitSha}) target=${target}`);
