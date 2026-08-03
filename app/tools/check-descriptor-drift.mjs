#!/usr/bin/env node
/**
 * The 02 §11 row-1 consumer: *descriptor regeneration + drift CI*.
 *
 * Regenerates the PAPI descriptor set from the committed chain feed into a scratch
 * directory and byte-compares it against the committed `packages/papi-descriptors/`.
 * Any difference — a stale commit, a hand-edit, a PAPI version bump, a metadata blob
 * that moved — is a failure.
 *
 * Why a full regenerate-and-compare rather than PAPI's own `generated.json` check:
 * `alreadyGenerated()` compares the CLI version, the whitelist and a Blake2-128 of each
 * *metadata input*. It never reads `dist/`. So it answers "were these descriptors
 * generated from this metadata by this CLI" and not "are these the bytes that generator
 * produces" — and the second question is the one a drift gate exists to ask. A
 * hand-edited descriptor passes PAPI's check and fails this one.
 *
 * `papi generate` is deterministic given (metadata, cliVersion, whitelist): verified by
 * regenerating into two unrelated directories and comparing every file hash. That is
 * what makes byte-comparison a legitimate gate rather than a flake.
 *
 * Usage: node tools/check-descriptor-drift.mjs [--update]
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = path.join(APP, ".papi", "polkadot-api.json");

/** Files PAPI writes that are inputs to the next run, not outputs to compare. */
const IGNORED = new Set([".gitignore"]);

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}

function hashTree(root) {
  const out = new Map();
  if (!fs.existsSync(root)) return out;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const rel = path.relative(root, full);
      if (IGNORED.has(path.basename(rel))) continue;
      out.set(rel, createHash("sha256").update(fs.readFileSync(full)).digest("hex"));
    }
  };
  walk(root);
  return out;
}

function main() {
  const update = process.argv.includes("--update");
  const config = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
  const committed = path.join(APP, config.descriptorPath);

  const entries = Object.entries(config.entries ?? {});
  if (entries.length === 0) {
    fail(`${path.relative(APP, CONFIG)} declares no entries — nothing would be generated, ` +
      `so this gate would pass by having nothing to check.`);
    return;
  }
  for (const [key, entry] of entries) {
    const metadata = path.join(APP, entry.metadata ?? "");
    if (!entry.metadata || !fs.existsSync(metadata)) {
      fail(`entry "${key}" names metadata ${entry.metadata} which does not exist`);
      return;
    }
  }

  // The scratch tree must live *inside* `app/`: PAPI type-checks the code it emits, and
  // that code imports `polkadot-api`, so Node's upward `node_modules` walk has to reach
  // `app/node_modules`. A `/tmp` scratch fails with TS2307 on every generated file.
  const scratch = fs.mkdtempSync(path.join(APP, ".papi", "drift-"));
  const scratchOut = path.join(scratch, "out");
  const scratchConfig = path.join(scratch, "polkadot-api.json");
  fs.writeFileSync(
    scratchConfig,
    // `descriptorPath` resolves against cwd, which stays `app/` so every other relative
    // path in the config keeps resolving exactly as it does in a real run.
    JSON.stringify({ ...config, descriptorPath: path.relative(APP, scratchOut) }, null, 2),
  );

  try {
    execFileSync(
      process.execPath,
      [path.join(APP, "node_modules", "polkadot-api", "bin", "cli.js"), "generate", "--config", scratchConfig],
      { cwd: APP, stdio: "pipe" },
    );
  } catch (error) {
    fail(`papi generate failed:\n${error.stdout ?? ""}${error.stderr ?? ""}`);
    return;
  }

  const fresh = hashTree(scratchOut);
  if (fresh.size === 0) {
    fail("regeneration produced no files — the comparison below would be vacuous");
    return;
  }

  if (update) {
    fs.rmSync(committed, { recursive: true, force: true });
    fs.cpSync(scratchOut, committed, { recursive: true });
    for (const name of IGNORED) fs.rmSync(path.join(committed, name), { force: true });
    console.log(`updated ${path.relative(APP, committed)} from ${fresh.size} regenerated files`);
    return;
  }

  const current = hashTree(committed);
  const names = [...new Set([...fresh.keys(), ...current.keys()])].sort();
  let drift = 0;
  for (const name of names) {
    const a = current.get(name);
    const b = fresh.get(name);
    if (a === b) continue;
    drift += 1;
    if (a === undefined) fail(`${name}: regenerated but not committed`);
    else if (b === undefined) fail(`${name}: committed but not regenerated (stale file)`);
    else fail(`${name}: committed ${a.slice(0, 16)} != regenerated ${b.slice(0, 16)}`);
  }

  if (drift > 0) {
    console.error(
      `\n${drift} descriptor file(s) drifted from the committed chain feed.\n` +
        `Regenerate with: pnpm -C app run descriptors:generate\n`,
    );
    return;
  }
  console.log(
    `OK ${fresh.size} descriptor files reproduce byte-for-byte from ` +
      entries.map(([k, e]) => `${k} (${e.metadata})`).join(", "),
  );
}

try {
  main();
} finally {
  // Bounded cleanup by construction: only ever our own `.papi/drift-*` scratch trees,
  // so a crashed earlier run cannot leave the app tree dirty for `git status` or for the
  // Stop guard, and this loop cannot outlive the directory it names.
  for (const entry of fs.readdirSync(path.join(APP, ".papi"))) {
    if (entry.startsWith("drift-")) {
      fs.rmSync(path.join(APP, ".papi", entry), { recursive: true, force: true });
    }
  }
}
