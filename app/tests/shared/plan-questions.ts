/**
 * Read the canonical status enum from one `plan/questions/<ID>.md` item.
 *
 * Spec-question status moved out of PLAN.md's former table when the plan tree was split.
 * Tests that make an expiry depend on a question must read the item frontmatter directly:
 * the body is prose and can legitimately contain either status word.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type SpecQuestionStatus = 'open' | 'resolved';

export function specQuestionStatus(repo: string, id: string): SpecQuestionStatus | undefined {
  if (!/^SQ-\d+$/.test(id)) throw new Error(`invalid spec-question id: ${id}`);

  const path = join(repo, 'plan/questions', `${id}.md`);
  if (!existsSync(path)) return undefined;

  const source = readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
  if (!source.startsWith('---\n')) throw new Error(`${path}: missing opening frontmatter delimiter`);
  const end = source.indexOf('\n---\n', 4);
  if (end === -1) throw new Error(`${path}: missing closing frontmatter delimiter`);

  const statusFields = source
    .slice(4, end)
    .split('\n')
    .filter((line) => /^status\s*:/.test(line));
  if (statusFields.length !== 1) {
    throw new Error(`${path}: expected exactly one status field, found ${statusFields.length}`);
  }

  const match = /^status:\s*(open|resolved)\s*$/.exec(statusFields[0] ?? '');
  if (match?.[1] !== 'open' && match?.[1] !== 'resolved') {
    throw new Error(`${path}: status must be "open" or "resolved"`);
  }
  return match[1];
}
