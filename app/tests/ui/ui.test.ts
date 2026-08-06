/**
 * `@bleavit/ui` — the INV-FE-9 render layer (F7).
 *
 * Rendered with `react-dom/server`'s `renderToStaticMarkup`, which needs no DOM and no
 * browser. That is not a compromise here: every property under test is about **what the
 * markup says**, and a headless renderer is the shortest path from a component to its
 * output. What it cannot test — that the badge is legible, that the layout does not hide
 * it — is not something any automated suite in this repository claims to cover.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement as h } from 'react';
import type { ComponentType, ReactElement } from 'react';
import type { HexString, Verified, VerificationStatus } from '@bleavit/shared-types';

/**
 * `createElement`, widened to accept a child the `ReactNode` type refuses.
 *
 * `AboveTheFold` is a plain object and `ReactNode` does not accept one — that is the
 * *compile* half of 11 §11.2 constraint 3, and it is proven by the negative-compilation
 * corpus, not here. This file proves the **runtime** half: that React itself throws, which
 * is what catches a fact handed down three components and rendered inside a collapsed region
 * by a caller that never saw both ends. Proving that requires handing React the very value
 * the type refuses, so the widening is declared once, named for what it is, and used only
 * where a refusal is the assertion. Note it is a single assertion, never `as unknown as`,
 * which app-code rule 2 bans outright.
 */
const hRejected = h as (type: unknown, props?: unknown, ...children: unknown[]) => ReactElement;
import {
  AlwaysVisible,
  Amount,
  AskedVsEncoded,
  Button,
  Count,
  Datum,
  DeferredMeaningChangingFactError,
  Disclosure,
  Identifier,
  MEANING_CHANGING_FACTS,
  Phrase,
  ProvenanceBadge,
  Ratio,
  WidenedLimitError,
  aboveTheFold,
  abbreviateIdentifier,
  badgeCopyFor,
  formatBaseUnits,
  formatCount,
  formatPpm,
} from '@bleavit/ui';
import { externalProposal } from '@bleavit/shared-types';

/** The chain identity every verified fixture in this file is read against (F18).
 *  A named constant rather than a literal per site: the point of the field is that two
 *  reads agree on it, and copies of a hex string agree until one is edited. */
const TEST_CHAIN = `0x${'ce'.repeat(32)}` as HexString;


const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');

// `Verified<T>`, not `Finalized<T>`: these render, and 10 §2.1 requires a *typed status* on
// anything displayed — the brand is the transaction path's requirement and is unavailable
// here by design. Annotating the return is what keeps `kind` a discriminant rather than
// widening it to `string`, which would silently make every badge assertion below vacuous.
const finalized = <T,>(value: T, blockNumber = 1_000_000): Verified<T> => ({
  value,
  status: { kind: 'verified-finalized', chain: TEST_CHAIN, blockHash: '0xabc', blockNumber },
});
const provider = <T,>(value: T): Verified<T> => ({
  value,
  status: { kind: 'provider', providerId: 'snapshots.example', sampled: false },
});

// ---------------------------------------------------------------- formatting

test('base units render at full width, with a plain comma and no locale', () => {
  assert.equal(formatBaseUnits(1_234_567_890n, 6), '1,234.567890');
  assert.equal(formatBaseUnits(1_000_000n, 6), '1.000000');
  assert.equal(formatBaseUnits(1n, 6), '0.000001');
  assert.equal(formatBaseUnits(-1_500_000n, 6), '-1.500000');
  assert.equal(formatBaseUnits(0n, 6), '0.000000');
  // Zero decimals is a count, not money — no separator appears.
  assert.equal(formatBaseUnits(1_000n, 0), '1,000');
});

test('a residual dust balance survives formatting', () => {
  // The reason every decimal is rendered: a trimming formatter shows this as `0` and the
  // user concludes the position is closed.
  assert.equal(formatBaseUnits(1n, 6), '0.000001');
  assert.notEqual(formatBaseUnits(1n, 6), formatBaseUnits(0n, 6));
});

test('formatBaseUnits refuses a nonsense width rather than guessing', () => {
  assert.throws(() => formatBaseUnits(1n, -1), RangeError);
  assert.throws(() => formatBaseUnits(1n, 1.5), RangeError);
  assert.throws(() => formatBaseUnits(1n, 39), RangeError);
});

test('counts are grouped and never abbreviated', () => {
  assert.equal(formatCount(1_234_567), '1,234,567');
  assert.equal(formatCount(999n), '999');
  assert.equal(formatCount(-1_000), '-1,000');
});

test('ppm renders as an exact percentage on integers', () => {
  assert.equal(formatPpm(2_500), '0.2500 %');
  assert.equal(formatPpm(1_000_000), '100.0000 %');
  assert.equal(formatPpm(1), '0.0001 %');
});

test('an identifier is abbreviated at both ends, never as a bare prefix', () => {
  const address = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
  const short = abbreviateIdentifier(address);
  assert.ok(short.startsWith('5Grwva'), short);
  assert.ok(short.endsWith('GKutQY'), short);
  // A ground-out collision on the first eight characters must not produce the same string.
  const collided = `5Grwva${'X'.repeat(36)}ZZZZZZ`;
  assert.notEqual(abbreviateIdentifier(collided), short);
});

// ---------------------------------------------------------------- the badge

test('every status renders a badge, and the copy comes from the status', () => {
  const statuses: readonly VerificationStatus[] = [
    { kind: 'verified-finalized', chain: TEST_CHAIN, blockHash: '0x1', blockNumber: 7 },
    { kind: 'verified-best', chain: TEST_CHAIN, blockHash: '0x1', blockNumber: 7 },
    { kind: 'derived-local', coverage: { ranges: [], holes: [{ fromBlock: 1, toBlock: 2 }] } },
    { kind: 'provider', providerId: 'p', sampled: true },
    { kind: 'stale-cache', asOfBlock: 3, ageMs: 10 },
    { kind: 'external-proposal' },
  ];
  for (const status of statuses) {
    const html = renderToStaticMarkup(h(ProvenanceBadge, { status }));
    assert.ok(html.includes(`data-status="${status.kind}"`), `${status.kind}: ${html}`);
    assert.ok(html.includes('aria-label='), `${status.kind} has no accessible name`);
    // Non-empty *text*, asserted by matching a text node rather than by stripping tags.
    // Stripping is sanitization's shape, and one pass of `<[^>]*>` genuinely does leave
    // `<script` behind in `<<script>script>` — nothing here is hostile, but a matching
    // assertion states the intent more directly anyway: some text node holds a visible
    // character. Excluding the brackets from the middle class is load-bearing, because
    // `\S` matches `<` and would happily pass `<span aria-label="x"></span>` — a badge
    // whose only words are in an attribute, which is exactly the suppression this forbids.
    assert.ok(
      />[^<>]*[^\s<>][^<>]*</.test(html),
      `${status.kind} rendered an empty badge`,
    );
  }
});

test('a derived-local badge names its SOURCES, not a count of gaps (10 §6.3, §2.3)', () => {
  // The major this closes. `derived-local` is the one status carrying coverage, and the badge
  // rendered `local index (2 gaps)` — a count. A count says how much is missing and nothing
  // about who supplied what is present, so a line assembled half from this device's light
  // client and half from an opt-in indexer rendered identically to one this device ingested
  // entirely. 10 §6.3 makes a range boundary "a rendered fact" and §2.3 gives provider-fed
  // history exactly one mitigation: "mandatory, non-suppressible provenance labelling".
  const mixed: VerificationStatus = {
    kind: 'derived-local',
    coverage: {
      ranges: [
        { fromBlock: 1, toBlock: 10, origin: 'self' },
        { fromBlock: 20, toBlock: 30, origin: 'indexer', providerId: 'acme' },
      ],
      holes: [{ fromBlock: 11, toBlock: 19 }],
    },
  };
  // **Asserted on the `mark`, not on the rendered HTML.** A mutation run caught this: the long
  // `title` also names the sources, so matching the whole markup passes while the short marker —
  // the only part a reader sees without hovering — is back to a bare gap count.
  const mark = badgeCopyFor(mixed).mark;
  assert.match(mark, /self/, 'the verified part of the line is not named in the visible marker');
  assert.match(mark, /indexer:acme/, 'the third-party source is invisible in the visible marker');
  // The gaps are still stated — §6.3 makes holes first-class too — but as the second clause
  // rather than the whole sentence.
  assert.match(mark, /1 gap/, 'holes stopped being first-class');
  const html = renderToStaticMarkup(h(ProvenanceBadge, { status: mixed }));
  assert.ok(html.includes(mark), 'the badge renders something other than the copy it derived');
  assert.match(html, /indexer:acme/);

  // A wholly self-ingested line must NOT read the same, or the label distinguishes nothing.
  const onlyMine: VerificationStatus = {
    kind: 'derived-local',
    coverage: { ranges: [{ fromBlock: 1, toBlock: 30, origin: 'self' }], holes: [] },
  };
  assert.doesNotMatch(renderToStaticMarkup(h(ProvenanceBadge, { status: onlyMine })), /indexer/);
  assert.doesNotMatch(badgeCopyFor(onlyMine).mark, /indexer/);
  assert.notEqual(badgeCopyFor(mixed).mark, badgeCopyFor(onlyMine).mark);
});

test('an unverified value cannot be rendered wearing a verified badge', () => {
  const html = renderToStaticMarkup(
    h(Amount, { datum: provider(1_000_000n), decimals: 6, symbol: 'USDC' }),
  );
  assert.ok(html.includes('data-status="provider"'), html);
  assert.ok(!html.includes('verified-finalized'), html);
  assert.ok(/unverified/i.test(html), html);
});

test('the badge is not suppressible — no component takes a prop that hides it', () => {
  // Asserted on the rendered output rather than by reading the props type, because the
  // failure would be a *new* prop somebody adds, which a type assertion written today
  // would not see.
  for (const component of [Datum, Amount, Count, Phrase, Identifier, Ratio]) {
    const props =
      component === Amount
        ? { datum: finalized(1n), decimals: 6, symbol: 'USDC' }
        : component === Datum
          ? { datum: finalized('x'), render: (value: string) => String(value) }
          : component === Identifier || component === Phrase
            ? { datum: finalized('abcdefghijklmnop') }
            : { datum: finalized(1) };
    // `h(component, props)` cannot be checked: the loop is deliberately heterogeneous —
    // six components with six prop shapes — and that heterogeneity is the test. Typing the
    // pair as a matched union would mean writing the mapping the loop exists to walk, so
    // the call is widened here and nowhere else, with the props above still fully checked
    // at each branch.
    const html = renderToStaticMarkup(
      h(component as ComponentType<Record<string, unknown>>, props as Record<string, unknown>),
    );
    assert.ok(html.includes('class="badge'), `${component.name} rendered without a badge`);
  }
});

// ------------------------------------------------- above the fold / disclosure

test('the five never-defer facts are exactly the ones doc 11 §11.2 names', () => {
  const doc = readFileSync(join(REPO, 'docs/architecture/11-frontend-workflows.md'), 'utf8');
  const paragraph = /What MUST NOT be deferred behind a step is[\s\S]*?grants no relief from any of them\./.exec(doc);
  assert.ok(paragraph, 'the constraint-3 paragraph moved — this binding must be re-pointed');
  // Bound on the SECTION CITATIONS rather than the prose: the wording is editorial and the
  // citations are the data. A sixth fact added to the spec arrives with a section and fails
  // here rather than quietly not existing in the code.
  const cited = [...paragraph[0].matchAll(/§(\d+\.\d+(?:\.\d+)?)/g)].map((m) => `§${m[1]}`);
  assert.deepEqual(
    [...new Set(cited)].sort(),
    [...new Set(Object.values(MEANING_CHANGING_FACTS))].sort(),
  );
});

test('an above-the-fold fact is not a ReactNode, so a Disclosure cannot take one', () => {
  const fold = aboveTheFold('sudo-era-banner', h('p', null, 'x'));
  // It is a plain object. React refuses to render one; the type system refuses to accept
  // one as `children`. This asserts the runtime half — the compile half is the corpus.
  assert.equal(typeof fold, 'object');
  assert.equal(fold.fact, 'sudo-era-banner');
  assert.throws(() => renderToStaticMarkup(hRejected('div', null, fold)));
});

test('AlwaysVisible throws when it renders inside a Disclosure', () => {
  const fold = aboveTheFold('charged-redemption-net-payout', h('p', null, 'net 9.97 USDC'));
  assert.throws(
    () =>
      renderToStaticMarkup(
        hRejected(Disclosure, { summary: 'details' }, h(AlwaysVisible, { fold })),
      ),
    (error) => {
      assert.ok(error instanceof DeferredMeaningChangingFactError, String(error));
      assert.equal(error.fact, 'charged-redemption-net-payout');
      assert.equal(error.section, '§11.5');
      return true;
    },
  );
});

test('the nesting check is on the region, not on whether it happens to be open', () => {
  const fold = aboveTheFold('imported-action-origin', h('p', null, 'from outside'));
  for (const open of [true, false]) {
    assert.throws(
      () =>
        renderToStaticMarkup(hRejected(Disclosure, { summary: 's', open }, h(AlwaysVisible, { fold }))),
      DeferredMeaningChangingFactError,
      `open=${open} should refuse just the same`,
    );
  }
});

test('AlwaysVisible renders outside a Disclosure, and offers nothing to dismiss it with', () => {
  const html = renderToStaticMarkup(
    h(AlwaysVisible, { fold: aboveTheFold('sudo-era-banner', h('p', null, 'sudo active')) }),
  );
  assert.ok(html.includes('data-fact="sudo-era-banner"'), html);
  assert.ok(html.includes('data-section="§11.10"'), html);
  assert.ok(!/<button/.test(html), `a dismiss control appeared: ${html}`);
});

test('a fact nested two components deep inside a disclosure is still caught', () => {
  // The indirect form — the one a type check on `children` cannot see, and the whole
  // reason the runtime half exists.
  const Wrapper = () =>
    h(AlwaysVisible, { fold: aboveTheFold('conviction-vote-lock', h('p', null, 'locked')) });
  const Outer = () => h('section', null, h(Wrapper));
  assert.throws(
    () => renderToStaticMarkup(hRejected(Disclosure, { summary: 's' }, h(Outer))),
    DeferredMeaningChangingFactError,
  );
});

// ------------------------------------------------------------ asked vs encoded

test('both sides of the asked/encoded pair carry external-proposal status', () => {
  const html = renderToStaticMarkup(
    h(AskedVsEncoded, {
      asked: externalProposal(10_000_000n),
      encoded: externalProposal(9_500_000n),
      decimals: 6,
      symbol: 'USDC',
      name: 'Most you will pay',
      direction: 'ceiling',
    }),
  );
  // Counted on the badge element, not on `data-status`: each `Datum` stamps that attribute
  // on its wrapper as well as on the badge, so a `data-status` count reads 4 and would pass
  // just as happily if one of the two badges were missing.
  const badges = html.match(/class="badge badge--external-proposal"/g) ?? [];
  assert.equal(badges.length, 2, `both sides must be badged: ${html}`);
  assert.ok(html.includes('data-narrowed="true"'), html);
  assert.ok(/tighter|lower/.test(html), html);
});

test('an unnarrowed pair says nothing about tightening', () => {
  const html = renderToStaticMarkup(
    h(AskedVsEncoded, {
      asked: externalProposal(9_500_000n),
      encoded: externalProposal(9_500_000n),
      decimals: 6,
      symbol: 'USDC',
      name: 'Most you will pay',
      direction: 'ceiling',
    }),
  );
  assert.ok(html.includes('data-narrowed="false"'), html);
  assert.ok(!/tighter/.test(html), html);
});

test('a widened limit throws rather than rendering — in both directions', () => {
  assert.throws(
    () =>
      renderToStaticMarkup(
        h(AskedVsEncoded, {
          asked: externalProposal(9_000_000n),
          encoded: externalProposal(9_500_000n), // a ceiling ABOVE what was asked
          decimals: 6,
          symbol: 'USDC',
          name: 'Most you will pay',
          direction: 'ceiling',
        }),
      ),
    WidenedLimitError,
  );
  assert.throws(
    () =>
      renderToStaticMarkup(
        h(AskedVsEncoded, {
          asked: externalProposal(9_000_000n),
          encoded: externalProposal(8_500_000n), // a floor BELOW what was asked
          decimals: 6,
          symbol: 'USDC',
          name: 'Least you will receive',
          direction: 'floor',
        }),
      ),
    WidenedLimitError,
  );
});

test('which side binds is computed from the direction, not taken as a claim', () => {
  // The same two numbers, read as a ceiling and as a floor. A `bindingSide` prop would let
  // a caller say the same thing about both; the direction decides, and one of the two is a
  // widening and therefore refused.
  const asked = externalProposal(9_000_000n);
  const encoded = externalProposal(8_000_000n);
  const shared = { asked, encoded, decimals: 6, symbol: 'USDC', name: 'Limit' };
  assert.doesNotThrow(() =>
    renderToStaticMarkup(h(AskedVsEncoded, { ...shared, direction: 'ceiling' })),
  );
  assert.throws(
    () => renderToStaticMarkup(h(AskedVsEncoded, { ...shared, direction: 'floor' })),
    WidenedLimitError,
  );
});

// ------------------------------------------------------------------- chrome

test('a disabled button without a reason is a defect, not a style', () => {
  assert.throws(
    () => renderToStaticMarkup(h(Button, { label: 'Sign', onClick: () => {}, disabled: true })),
    /disabled with no reason/,
  );
  const html = renderToStaticMarkup(
    h(Button, {
      label: 'Sign',
      onClick: () => {},
      disabled: true,
      disabledReason: 'A precondition failed at the refreshed block.',
    }),
  );
  assert.ok(html.includes('A precondition failed'), html);
});
