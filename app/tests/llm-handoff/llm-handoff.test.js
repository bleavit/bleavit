/**
 * Handoff transports and the vendor list — 10 §13.4; D-21; INV-FE-12/13.
 *
 * The suite that matters is **never truncated**. A truncated capsule is valid JSON up to
 * the cut, carries a `schema` string, and looks like a document — so a tool answers about
 * the half it received and the user acts on an analysis of amputated data. Nothing
 * downstream detects it, because the only check is the digest and nobody re-imports a
 * capsule they pasted into an assistant.
 *
 * So the tests below try to *obtain* a truncated URL, rather than checking that one is not
 * produced on the happy path.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  TOOL_VENDORS,
  TRANSPORTS,
  TransportError,
  capsuleFileName,
  chooseTransport,
  disclosure,
  vendorById,
} from '@bleavit/llm-handoff';

const ALL = { file: true, clipboard: true, share: true };
const NONE = { file: false, clipboard: false, share: false };

/** A vendor fixture. The shipped list is empty, so every vendor test supplies its own. */
const VENDOR = { id: 'example', label: 'Example Tool', origin: 'https://example.test/new', maxUrlChars: 300 };

/* ------------------------------------------------------------------ the shipped list */

test('the vendor list ships empty — naming a vendor is a D-21 decision, not a default', () => {
  assert.deepEqual(TOOL_VENDORS, []);
});

test('with no vendor seated, file and clipboard are the whole outbound surface', () => {
  // The same conclusion FE-P11 reached from the other direction.
  assert.equal(chooseTransport('{"a":1}', ALL, 'anything').kind, 'unavailable');
  assert.equal(chooseTransport('{"a":1}', ALL).kind, 'file');
});

test('an unknown vendor id is refused and never rendered back', () => {
  const choice = chooseTransport('{"a":1}', ALL, '<script>alert(1)</script>');
  assert.equal(choice.kind, 'unavailable');
  assert.equal(choice.reason.includes('<script>'), false, 'the supplied id was echoed into user copy');
});

test('disclosure takes an id and returns undefined for an unknown one', () => {
  // 10 §13.4: no format carries a tool label, "because a label reading 'Bleavit Official
  // Assistant' inside the confirm flow would be a phishing primitive". Falling back to the
  // id would put attacker-chosen text on screen through the back door.
  assert.equal(disclosure('Bleavit Official Assistant'), undefined);
  assert.equal(vendorById('nope'), undefined);
});

/* --------------------------------------------------------------- never truncated */

test('a capsule too long for the vendor URL falls back — it is not shortened', () => {
  const long = `{"pad":"${'x'.repeat(500)}"}`;
  const choice = chooseTransport(long, ALL, VENDOR.id, [VENDOR]);
  assert.notEqual(choice.kind, 'vendor-url');
});

test('there is no exported path that turns a capsule into a URL string', async () => {
  // The shape a caller would need in order to cut one down. `chooseTransport` returns a
  // union whose URL variant is built only when the whole thing fits.
  const exported = await import('@bleavit/llm-handoff');
  for (const [name, value] of Object.entries(exported)) {
    if (typeof value !== 'function') continue;
    assert.equal(
      /url/i.test(name) && name !== 'chooseTransport',
      false,
      `${name} looks like a URL builder; truncation must be unreachable, not merely avoided`,
    );
  }
});

test('the length is measured on the encoded URL, not on the capsule', () => {
  // Percent-encoding is not a rounding error: every `"` becomes `%22`, so a capsule of JSON
  // punctuation triples. This is the case a capsule-length check waves through — under the
  // limit as written, over it as sent. Both halves are asserted rather than assumed, because
  // the first version of this fixture was simply too short and proved nothing.
  const punctuation = '"'.repeat(100);
  assert.ok(punctuation.length < VENDOR.maxUrlChars, 'the capsule must be UNDER the limit');
  assert.ok(
    `${VENDOR.origin}?q=${encodeURIComponent(punctuation)}`.length > VENDOR.maxUrlChars,
    'the encoded URL must be OVER it, or this test proves nothing',
  );
  const choice = chooseTransport(punctuation, ALL, VENDOR.id, [VENDOR]);
  assert.notEqual(choice.kind, 'vendor-url');
});

test('a vendor that publishes no limit has no URL transport at all', () => {
  const unlimited = { ...VENDOR, maxUrlChars: undefined };
  const choice = chooseTransport('{"a":1}', ALL, unlimited.id, [unlimited]);
  assert.notEqual(choice.kind, 'vendor-url');
});

test('a capsule that fits does use the vendor URL, so the fallback is not vacuous', () => {
  const choice = chooseTransport('{"a":1}', ALL, VENDOR.id, [VENDOR]);
  assert.equal(choice.kind, 'vendor-url');
  assert.equal(choice.url.startsWith('https://example.test/new?q='), true);
  assert.equal(choice.vendor.label, 'Example Tool');
});

test('the emitted URL round-trips to the exact capsule — no loss anywhere in the path', () => {
  const capsule = '{"schema":"bleavit.receipt.v1","n":"9007199254740993"}';
  const choice = chooseTransport(capsule, ALL, VENDOR.id, [VENDOR]);
  assert.equal(choice.kind, 'vendor-url');
  assert.equal(decodeURIComponent(new URL(choice.url).searchParams.get('q')), capsule);
});

/* --------------------------------------------------- the fail-closed capability lattice */

test('share is never assumed — an unproven capability is absent (FE-P11, INV-FE-12)', () => {
  const shareOnly = { file: false, clipboard: false, share: true };
  assert.equal(chooseTransport('{"a":1}', shareOnly).kind, 'share');
  // ...but it is last, so a platform with file or clipboard never selects it.
  assert.equal(chooseTransport('{"a":1}', ALL).kind, 'file');
  assert.equal(chooseTransport('{"a":1}', { ...NONE, clipboard: true, share: true }).kind, 'clipboard');
});

test('no capability at all is a named refusal, never a silent no-op', () => {
  const choice = chooseTransport('{"a":1}', NONE);
  assert.equal(choice.kind, 'unavailable');
  assert.match(choice.reason, /INV-FE-12/);
});

test('a vendor fallback with no capability left says so rather than reporting success', () => {
  const long = `{"pad":"${'x'.repeat(500)}"}`;
  const choice = chooseTransport(long, NONE, VENDOR.id, [VENDOR]);
  assert.equal(choice.kind, 'unavailable');
  assert.match(choice.reason, /never shortened to fit/);
});

test('every declared transport is reachable, so the union is not decoration', () => {
  const reached = new Set([
    chooseTransport('{"a":1}', ALL).kind,
    chooseTransport('{"a":1}', { ...NONE, clipboard: true }).kind,
    chooseTransport('{"a":1}', { ...NONE, share: true }).kind,
    chooseTransport('{"a":1}', ALL, VENDOR.id, [VENDOR]).kind,
  ]);
  assert.deepEqual([...reached].sort(), [...TRANSPORTS].sort());
});

/* ------------------------------------------------------------------------ hygiene */

test('an empty capsule is refused rather than exported as a zero-byte file', () => {
  assert.throws(() => chooseTransport('', ALL), TransportError);
});

test('the file name comes from the schema and the height, never from a document field', () => {
  assert.equal(capsuleFileName('bleavit.receipt.v1', 1_234), 'bleavit-receipt-v1-1234.json');
  assert.throws(() => capsuleFileName('../../etc/passwd', 1), TransportError);
  assert.throws(() => capsuleFileName('bleavit.receipt.v1', -1), TransportError);
  assert.throws(() => capsuleFileName('bleavit.receipt.v1', 1.5), TransportError);
});

test('this package reaches no network primitive', async () => {
  // check:handoff-network is the real gate (a source scan; these are globals, so no
  // dependency rule can see them). This asserts the package is inside its scope, because a
  // scanner that covers less than it claims reports success forever.
  const { readFileSync } = await import('node:fs');
  const list = readFileSync(new URL('../../tools/handoff-packages.cjs', import.meta.url), 'utf8');
  assert.match(list, /llm-handoff/);
});
