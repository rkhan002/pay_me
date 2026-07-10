#!/usr/bin/env node
// Regenerates the Deno edge-function copy of the rules engine from the single
// source of truth (packages/rules-engine/src) so the two can never silently
// drift. Run `npm run rules:sync` after any rules change; CI / the pre-commit
// hook run `npm run rules:check` (this script with --check), which fails if the
// committed copy doesn't match what this script would generate.
//
// Why a copy exists at all: the package is authored/tested under Node+Vitest,
// but Supabase Edge Functions run on Deno and their deploy bundler can't reach
// imports outside supabase/functions/. So we vendor a transformed copy beside
// them. The ONLY allowed differences are the mechanical transforms below.

import { readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "packages/rules-engine/src");
const DST = join(ROOT, "supabase/functions/_shared/rules-engine");

// Files that only make sense for the Node package (barrel export) and are not
// copied to the Deno side, which imports individual modules directly.
const SKIP = new Set(["index.ts"]);
// Files in DST that are hand-maintained and must never be deleted as "orphans".
const KEEP = new Set(["README.md"]);

const BANNER = (name) =>
  `// AUTO-GENERATED from packages/rules-engine/src/${name} — DO NOT EDIT.\n` +
  `// Edit the source there, then run: npm run rules:sync\n`;

// Node built-ins that have a Deno-global equivalent. Each entry removes the
// Node import line and rewrites the call sites. If a `node:` import appears
// that is NOT listed here, the script throws so a human wires up a shim rather
// than shipping a broken bundle.
const NODE_SHIMS = [
  {
    module: "node:crypto",
    importLine: /^import\s*\{\s*randomUUID\s*\}\s*from\s*["']node:crypto["'];?\r?\n/m,
    rewrites: [[/\brandomUUID\(/g, "crypto.randomUUID("]],
  },
];

function addTsExtensions(code) {
  // Deno requires explicit extensions on relative specifiers.
  return code.replace(/(\bfrom\s+["'])(\.\.?\/[^"']+?)(["'])/g, (m, pre, spec, post) =>
    /\.(ts|js|mjs|cjs|json)$/.test(spec) ? m : `${pre}${spec}.ts${post}`,
  );
}

function applyNodeShims(code, name) {
  for (const shim of NODE_SHIMS) {
    if (shim.importLine.test(code)) {
      code = code.replace(shim.importLine, "");
      for (const [re, to] of shim.rewrites) code = code.replace(re, to);
    }
  }
  const leftover = code.match(/\bfrom\s+["']node:[^"']+["']/);
  if (leftover) {
    throw new Error(
      `${name}: unmapped Node import ${leftover[0]}. Add a shim to NODE_SHIMS in scripts/sync-rules-engine.mjs.`,
    );
  }
  return code;
}

function transform(name, raw) {
  return BANNER(name) + applyNodeShims(addTsExtensions(raw), name);
}

const srcFiles = readdirSync(SRC).filter((f) => f.endsWith(".ts") && !SKIP.has(f));
const generated = new Map(
  srcFiles.map((f) => [f, transform(f, readFileSync(join(SRC, f), "utf8"))]),
);

// Orphans = .ts files in DST that no longer exist in SRC.
const orphans = readdirSync(DST).filter(
  (f) => f.endsWith(".ts") && !KEEP.has(f) && !generated.has(f),
);

const check = process.argv.includes("--check");
const drift = [];

for (const [name, content] of generated) {
  let current = null;
  try {
    current = readFileSync(join(DST, name), "utf8");
  } catch {}
  if (current !== content) {
    drift.push(current === null ? `missing: ${name}` : `stale:   ${name}`);
    if (!check) writeFileSync(join(DST, name), content);
  }
}
for (const name of orphans) {
  drift.push(`orphan:  ${name}`);
  if (!check) rmSync(join(DST, name));
}

if (check) {
  if (drift.length) {
    console.error(
      "rules-engine copy is OUT OF SYNC with packages/rules-engine/src:\n  " + drift.join("\n  "),
    );
    console.error("\nFix: npm run rules:sync   (then commit the regenerated files)");
    process.exit(1);
  }
  console.log("rules-engine copy is in sync ✓");
} else {
  console.log(
    drift.length ? `Synced ${drift.length} file(s):\n  ${drift.join("\n  ")}` : "Already in sync ✓",
  );
}
