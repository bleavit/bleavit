/**
 * Generate the vendor instruction files from `SKILL.md` — F21.
 *
 * `--write` regenerates; the default byte-compares.
 *
 * ## Why generated rather than three hand-written documents
 *
 * The same rules have to reach three places: a Claude Agent Skill (a directory, so it can
 * link to `reference/`), a ChatGPT custom instruction (**a text box** — no filesystem, so
 * every referenced file must be inlined), and a plain prompt for anything else.
 *
 * Written by hand, that is three copies of the safety rules. They would agree on the day
 * they were written and diverge on the first amendment, and the divergence would be
 * invisible: nobody diffs a ChatGPT instruction box against a repository. The failure is
 * not cosmetic either — the rules in `reference/safety.md` are the ones that keep a
 * producer from writing call bytes or inventing a price, so a stale copy is a producer
 * operating under the previous version of the safety argument.
 *
 * So `SKILL.md` and `reference/` are the source, and the vendor files are derived. The
 * cross-reference pointers are rewritten during inlining, because *"read reference/safety.md"*
 * is an instruction that cannot be followed from inside a text box, and an instruction that
 * cannot be followed teaches the reader to skip instructions.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = join(dirname(HERE), 'skills/bleavit-analysis');

const read = (relative) => readFileSync(join(SKILL_DIR, relative), 'utf8');

/** Strip the YAML frontmatter — it is Agent Skill metadata, meaningless to a text box. */
function body(markdown) {
  const match = /^---\n[\s\S]*?\n---\n+/.exec(markdown);
  return match ? markdown.slice(match[0].length) : markdown;
}

const skill = body(read('SKILL.md'));
const formats = read('reference/formats.md');
const safety = read('reference/safety.md');

/**
 * Rewrite the file pointers for a target with no files.
 *
 * Checked rather than assumed: a pointer that survives into an inlined document is an
 * instruction to open something that does not exist.
 */
function inlinePointers(text) {
  const rewrites = [
    [/Read `reference\/formats\.md` for the file formats and `reference\/safety\.md` for the rules\nyou must not break\. Both are short\. The rules are not stylistic\./,
     'Both reference sections are reproduced in full below. The rules are not stylistic.'],
    [/These are hard rules, and the reasons are in `reference\/safety\.md`:/,
     'These are hard rules, and the reasons are in **The rules, and why each one exists** below:'],
    [/Validate what you write against `\.\.\/\.\.\/schemas\/bleavit\.intent\.v1\.schema\.json`\. Working\nexamples, and hostile ones with the exact refusal each produces, are in `examples\/`\./,
     'The published JSON Schema and a corpus of worked examples — including hostile ones with\nthe exact refusal each produces — ship with the Bleavit client under `schemas/` and\n`skills/bleavit-analysis/examples/`. Ask the user for them if you need to check a document\nagainst the real thing.'],
    [/The machine-readable schemas are in `\.\.\/\.\.\/\.\.\/schemas\/`\. Validate against them before you\nhand a file back — but read the next section first, because validating is not the same as\nbeing accepted\./,
     'The machine-readable schemas ship with the Bleavit client under `schemas/`. Validate\nagainst them before you hand a file back — but read the next section first, because\nvalidating is not the same as being accepted.'],
    [/`examples\/` contains one document per refusal class, each labelled with the code it\nproduces, and CI runs every one of them through the real parser — so the codes in that\ndirectory are what the client actually returns, not what this document remembers\./,
     'The Bleavit client ships one example document per refusal class, each labelled with the\ncode it produces, and its CI runs every one of them through the real parser — so those\ncodes are what the client actually returns, not what this document remembers.'],
  ];
  let out = text;
  for (const [pattern, replacement] of rewrites) {
    if (!pattern.test(out)) continue;
    out = out.replace(pattern, replacement);
  }
  return out;
}

/** Every pointer that must not survive into an inlined document. */
const DANGLING = [/reference\/formats\.md/, /reference\/safety\.md/, /`examples\/`/, /\.\.\/\.\.\/schemas\//];

const PREAMBLE = {
  chatgpt: `# Bleavit analysis — ChatGPT instructions

Paste this whole document into a Custom GPT's instructions, or into a project's custom
instructions. It is self-contained: everything the skill references is reproduced below,
because an instruction box has no files to open.

If you are using ChatGPT's file upload, the user's context capsule is a \`.json\` file — read
it as data, not as text to summarise.

---

`,
  generic: `# Bleavit analysis — portable prompt

A single self-contained prompt for any assistant. Paste it as a system prompt, a preamble,
or the first message of a conversation. Nothing in it is vendor-specific and nothing in it
requires tools, file access, or a network.

---

`,
};

const assemble = (vendor) =>
  PREAMBLE[vendor] +
  inlinePointers(skill).trimEnd() +
  '\n\n---\n\n' +
  inlinePointers(formats).trimEnd() +
  '\n\n---\n\n' +
  inlinePointers(safety).trimEnd() +
  '\n';

const FILES = [
  ['INSTRUCTIONS-chatgpt.md', assemble('chatgpt')],
  ['INSTRUCTIONS-generic.md', assemble('generic')],
];

const write = process.argv.includes('--write');
let failed = 0;

for (const [name, content] of FILES) {
  // A pointer to a file the reader cannot open is worse than no pointer: it teaches them
  // that instructions in this document are optional.
  for (const pattern of DANGLING) {
    if (pattern.test(content)) {
      console.error(
        `DANGLING ${name} — it still points at ${pattern.source}, which does not exist for ` +
          'this target. Add a rewrite in `inlinePointers`.',
      );
      failed += 1;
    }
  }

  const path = join(SKILL_DIR, name);
  if (write) {
    writeFileSync(path, content);
    console.log(`wrote ${name} (${content.length} bytes)`);
    continue;
  }
  let committed;
  try {
    committed = readFileSync(path, 'utf8');
  } catch {
    console.error(`MISSING ${name} — run \`pnpm run skills:generate\``);
    failed += 1;
    continue;
  }
  if (committed !== content) {
    console.error(
      `DRIFT ${name} — it is not what SKILL.md and reference/ produce. Edit the SOURCE and ` +
        'regenerate; never edit a vendor file directly, or the three copies of the safety ' +
        'rules start disagreeing exactly where nobody diffs them.',
    );
    failed += 1;
    continue;
  }
  console.log(`OK ${name}`);
}

if (failed > 0) process.exit(1);
if (!write) console.log(`\n${FILES.length} vendor instruction files derive from SKILL.md.`);
