/**
 * The local index's disclosure surface — 10 §6.3, §6.5, §9.2, §9.4; 15 §2 INV-FE-7/INV-FE-15. F25.
 *
 * ## What this suite is for
 *
 * `packages/local-index` writes a machine-readable record for every loss it can cause, and until
 * F25 nothing read one. Five consecutive review rounds of F8 found the same shape one layer down
 * each time, so the tests here are written against **that** failure rather than against the happy
 * path: a record that reaches no surface, and a state that renders as though it had been checked.
 *
 * ## Three kinds of evidence, and none of them is a restatement
 *
 * - **The package's own declarations**, parsed at test time. `REPORT_DISCLOSURES` must be total
 *   over `IndexBootReport`'s real fields, so the next field added to that interface cannot ship
 *   without a reader. A hand-written list here would agree with itself.
 * - **The architecture documents**, parsed at test time. Every sentence this client states must
 *   cite a section that exists; every empty copy slot must name a 10 §9.4 taxonomy code that
 *   really is in the taxonomy.
 * - **PLAN.md's spec-question table**, parsed at test time. Every empty slot must name rows that
 *   are still **open**. That is a mechanical expiry: the day SQ-604 is ruled this suite fails and
 *   the copy has to be written, rather than the placeholder quietly outliving its reason.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import 'fake-indexeddb/auto';

import {
  CoveredHistoryDisclosure,
  HISTORY_DISCLOSURES,
  IndexBootDisclosure,
  REPORT_DISCLOSURES,
  bootDisclosure,
  bootLocalIndex,
  cannotObserve,
  historyDisclosure,
  type DisclosureItem,
  type IndexBootState,
} from '@bleavit/features-analysis';
import {
  EMPTY_COVERAGE,
  addRange,
  covered,
  providerRange,
  type ChartDiscardRecord,
  type CoverageRange,
  type CoveredHistory,
  type IndexBootReport,
  type PendingRawEvictionRecord,
} from '@bleavit/local-index';
import { legacyIndexV1, selfRange } from '@bleavit/local-index/testing';
import { releaseParaChain } from '@bleavit/application';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '../..');
const REPO = resolve(HERE, '../../..');

const architecture = (doc: string): string =>
  readFileSync(join(REPO, 'docs/architecture', doc), 'utf8');

const appSource = (relative: string): string => readFileSync(join(APP, relative), 'utf8');

const first = <T,>(items: readonly T[], what: string): T => {
  const value = items[0];
  assert.ok(value !== undefined, `expected at least one ${what}`);
  return value;
};

/** Source with comments removed, so a field name inside a doc comment is not read as code. */
const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/** The property names of one exported `interface`, read out of the declaring module. */
function interfaceFields(source: string, name: string): readonly string[] {
  const stripped = withoutComments(source);
  const start = new RegExp(String.raw`export interface ${name}\s*(?:<[^>]*>)?\s*\{`).exec(stripped);
  assert.ok(start !== null, `${name} is not an exported interface here`);
  const open = start.index + start[0].length - 1;
  let depth = 0;
  let end = -1;
  for (let i = open; i < stripped.length; i += 1) {
    if (stripped[i] === '{') depth += 1;
    else if (stripped[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  assert.ok(end > open, `${name}'s declaration never closes`);
  const body = stripped.slice(open + 1, end);
  // Top-level members only: a nested object type would otherwise contribute its own fields.
  const members: string[] = [];
  let nesting = 0;
  let buffer = '';
  for (const char of body) {
    if (char === '{' || char === '(' || char === '<') nesting += 1;
    if (char === '}' || char === ')' || char === '>') nesting -= 1;
    if (char === ';' && nesting === 0) {
      const match = /(?:readonly\s+)?([A-Za-z_]\w*)\s*\??\s*:/.exec(buffer);
      if (match?.[1] !== undefined) members.push(match[1]);
      buffer = '';
      continue;
    }
    buffer += char;
  }
  return members;
}

// --------------------------------------------------------------- PLAN.md's question table

/** GFM cell splitting, as `tools/ci/check-spec-question-batches.py` does it: `\|` escapes. */
function splitCells(line: string): readonly string[] {
  const cells: string[] = [];
  let current = '';
  let escaped = false;
  for (const char of line) {
    if (escaped) {
      current += char;
      escaped = false;
    } else if (char === '\\') {
      current += char;
      escaped = true;
    } else if (char === '|') {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells.filter((cell, index) => !(cell === '' && (index === 0 || index === cells.length - 1)));
}

const PLAN = readFileSync(join(REPO, 'PLAN.md'), 'utf8');

/**
 * Whether PLAN.md still lists a spec question as open.
 *
 * The same rule the batch checker applies — the **status cell starts with** `open` — rather than
 * a search for the word anywhere in the row, because an open row's text legitimately discusses
 * what resolving it would mean.
 */
function questionIsOpen(id: string): boolean {
  for (const line of PLAN.split('\n')) {
    if (!line.startsWith(`| ${id} |`)) continue;
    const cells = splitCells(line);
    const status = cells[cells.length - 1] ?? '';
    return status.replace(/^[*_\s]+/, '').toLowerCase().startsWith('open');
  }
  assert.fail(`${id} is not a row of PLAN.md's spec-question table`);
}

// ------------------------------------------------------------------------------- fixtures

const GENESIS = `0x${'f2'.repeat(32)}`;
const OTHER = `0x${'a7'.repeat(32)}`;

const edgeAt = (toBlock: number, genesisHash = GENESIS) => ({
  kind: 'checked' as const,
  genesisHash,
  hash: `0x${toBlock.toString(16).padStart(64, '0')}`,
  specVersion: 3,
});

const unverifiable = (genesisHash = GENESIS) => ({
  kind: 'unverifiable' as const,
  genesisHash,
  why: 'imported from a snapshot file, which states no block hash at any block',
});

const self = (from: number, to: number): CoverageRange => selfRange(from, to, 1, edgeAt(to));
const fromIndexer = (from: number, to: number): CoverageRange =>
  providerRange('indexer', 'idx-1', from, to, 1, unverifiable());

const CHART_DISCARD: ChartDiscardRecord = {
  fromSchema: 1,
  toSchema: 3,
  tables: ['priceSamples', 'candles1h'],
  rows: 412,
  span: { kind: 'named', fromBlock: 1, toBlock: 900 },
  at: 1_700_000_000_000,
  detail: 'the chart tables were re-keyed and IndexedDB cannot change a key path in place',
};

const RAW_EVICTED: PendingRawEvictionRecord = {
  blocks: 7,
  bytes: 65_536,
  oldestBlock: 100,
  newestBlock: 180,
  at: 1_700_000_000_000,
  reason: 'the undecoded event share was over its budget',
};

const report = (overrides: Partial<IndexBootReport> = {}): IndexBootReport => ({
  coverage: EMPTY_COVERAGE,
  dropped: [],
  invalidated: [],
  unchecked: [],
  pendingDecoder: 0,
  pendingRawEvicted: undefined,
  chartDiscard: undefined,
  ...overrides,
});

const checked = (overrides: Partial<IndexBootReport> = {}): IndexBootState => ({
  kind: 'checked',
  report: report(overrides),
});

const renderBoot = (state: IndexBootState): string =>
  renderToStaticMarkup(h(IndexBootDisclosure, { state }));

const renderHistory = (history: CoveredHistory<unknown>): string =>
  renderToStaticMarkup(h(CoveredHistoryDisclosure, { history }));

/** Every item this client can produce, over a report and a history that contain everything. */
function everyItem(): readonly DisclosureItem[] {
  const coverage = addRange(addRange(EMPTY_COVERAGE, self(1, 100)), fromIndexer(200, 300));
  const boot = bootDisclosure(
    checked({
      coverage,
      dropped: [{ value: { fromBlock: 'x' }, reason: 'fromBlock is not a block number' }],
      invalidated: [
        {
          range: self(400, 500),
          verdict: { kind: 'invalid', reason: 'the chain reports a different hash at block 500' },
        },
      ],
      unchecked: [fromIndexer(200, 300)],
      pendingDecoder: 12,
      pendingRawEvicted: RAW_EVICTED,
      chartDiscard: CHART_DISCARD,
    }),
  );
  const history = historyDisclosure({
    covered: covered(coverage, { fromBlock: 100, toBlock: 250 }, []),
    downsampled: [
      {
        fromBlock: 1,
        toBlock: 50,
        resolution: 'candles1h',
        reason: 'raw samples for these blocks were folded into hourly candles',
        at: 1_700_000_000_000,
      },
    ],
    chartDiscard: CHART_DISCARD,
  });
  return [...boot, ...history];
}

// -------------------------------------------------- the reader exists, and it is complete

test('every field of IndexBootReport is bound to a disclosure, read off the interface itself', () => {
  // The exact defect F25 exists to close, made structural. `pendingRawEvicted` and `chartDiscard`
  // were each added to this interface in a review round and each was written to a surface that
  // did not read it, so the binding cannot be a list somebody remembers to extend.
  const fields = interfaceFields(
    appSource('packages/local-index/src/boot.ts'),
    'IndexBootReport',
  );
  assert.ok(fields.length >= 7, `IndexBootReport parsed to ${fields.length} fields`);
  assert.deepEqual([...fields].sort(), Object.keys(REPORT_DISCLOSURES).sort());
});

test('every field of CoveredHistory is bound to a disclosure, read off the interface itself', () => {
  const fields = interfaceFields(
    appSource('packages/local-index/src/store.ts'),
    'CoveredHistory',
  );
  assert.deepEqual([...fields].sort(), Object.keys(HISTORY_DISCLOSURES).sort());
});

test('a migration discard has one renderer, not one per path', () => {
  // 10 §9.4 requires fixed copy per code. Two renderers for one record is two sets of words that
  // agree on the day they are written, and SQ-821 is exactly the question of where the fact
  // belongs — so the two paths differ in *when* it is shown and in nothing else.
  assert.equal(REPORT_DISCLOSURES.chartDiscard, HISTORY_DISCLOSURES.chartDiscard);
  const fromBoot = bootDisclosure(checked({ chartDiscard: CHART_DISCARD })).filter(
    (item) => item.id === REPORT_DISCLOSURES.chartDiscard,
  );
  const fromRead = historyDisclosure({
    covered: covered(EMPTY_COVERAGE, { fromBlock: 1, toBlock: 9 }, []),
    downsampled: [],
    chartDiscard: CHART_DISCARD,
  }).filter((item) => item.id === HISTORY_DISCLOSURES.chartDiscard);
  assert.deepEqual(fromBoot, fromRead);
});

test('the migration discard has one renderer in the client, not one per surface', () => {
  // The assertion above is true, item-for-item, and weaker than it reads: **both sides of its
  // `deepEqual` are produced by `chartDiscardItem`**, so it can only fail if this one module grew
  // two. It is blind to every renderer outside it — and there was one. F23's `coverage-view.tsx`
  // rendered this record in its own package, exported from the same index, with its own sentence
  // about `FE-IDX-002` (whose copy F25 says may not be invented) and a two-state reading of a
  // three-state span. Nothing in this suite could see it, and nothing did until the two branches
  // were compiled together.
  //
  // So the claim is made a property of the source tree instead, the shape `check:covered-history`
  // rule A already uses: the record is reached through its container, and **named** in exactly one
  // module. A surface that wants to show it renders `CoveredHistoryDisclosure`.
  const OWNER = 'src/features/analysis/src/index-disclosure.ts';
  const TOKENS = ['chartDiscard', 'ChartDiscardRecord', 'ChartDiscardSpan'];
  const names = (file: string): readonly string[] => {
    const code = withoutComments(appSource(file));
    return TOKENS.filter((token) => code.includes(token));
  };

  // Anti-vacuity: the owner must still name the record, or the rule below is satisfied by a
  // rename and proves nothing.
  assert.deepEqual([...names(OWNER)].sort(), [...TOKENS].sort(), `${OWNER} no longer reads the record`);

  const modules = readdirSync(join(APP, 'src'), { recursive: true, encoding: 'utf8' })
    .filter((entry) => /\.tsx?$/.test(entry))
    .filter((entry) => !entry.split('/').includes('dist') && !entry.split('/').includes('node_modules'))
    .map((entry) => join('src', entry));
  assert.ok(modules.length > 20, `only ${modules.length} client modules were scanned`);
  assert.ok(modules.includes(OWNER), `the scan does not reach ${OWNER}`);

  const others = modules.filter((file) => file !== OWNER && names(file).length > 0);
  assert.deepEqual(
    others,
    [],
    `these modules read the migration-discard record directly rather than through ` +
      `CoveredHistoryDisclosure, so 10 §9.4's fixed copy has more than one implementation: ` +
      others.join(', '),
  );
});

// ------------------------------------------------------------- the copy rule, both halves

test('every sentence this client states cites a section that exists', () => {
  const cited = everyItem()
    .map((item) => item.copy)
    .filter((copy) => copy.kind === 'stated');
  assert.ok(cited.length >= 4, `only ${cited.length} stated sentences were produced`);
  const docs: Readonly<Record<string, string>> = {
    '10': '10-frontend-architecture.md',
    '11': '11-frontend-workflows.md',
    '15': '15-invariants-and-testing.md',
  };
  for (const copy of cited) {
    assert.ok(copy.text.length > 0, 'a stated sentence is empty');
    const match = /^(\d+) §([\d.]+)$/.exec(copy.cite);
    assert.ok(match !== null, `${copy.cite} is not a "<doc> §<section>" citation`);
    const doc = docs[match[1] ?? ''];
    assert.ok(doc !== undefined, `${copy.cite} names a document this suite does not read`);
    const text = architecture(doc);
    const heading = new RegExp(`^#{2,4} ${(match[2] ?? '').replace(/\./g, '\\.')}[ .]`, 'm');
    assert.match(text, heading, `${copy.cite} names a section ${doc} does not have`);
  }
});

test('every empty copy slot names a code that really is in 10 §9.4’s taxonomy', () => {
  // A slot may not wait on a code that does not exist: that would be an excuse rather than a
  // blocker, and nothing would ever fail when the ruling landed.
  const taxonomy = architecture('10-frontend-architecture.md');
  const awaiting = everyItem()
    .map((item) => item.copy)
    .filter((copy) => copy.kind === 'awaiting');
  assert.ok(awaiting.length >= 3, `only ${awaiting.length} awaiting slots were produced`);
  for (const copy of awaiting) {
    // §9.4 writes the family as a range (`FE-IDX-001..002`), so the check is that the code's
    // family and its number are both inside a declared range in the taxonomy paragraph.
    const family = /^([A-Z-]+)-(\d+)$/.exec(copy.code);
    assert.ok(family !== null, `${copy.code} is not a taxonomy-shaped code`);
    const range = new RegExp(
      `\`${(family[1] ?? '').replace(/-/g, '-')}-(\\d+)\\.\\.(\\d+)\``,
    ).exec(taxonomy);
    assert.ok(range !== null, `10 §9.4 declares no ${family[1]} range`);
    const number = Number(family[2]);
    assert.ok(
      number >= Number(range[1]) && number <= Number(range[2]),
      `${copy.code} is outside the ${family[1]}-${range[1]}..${range[2]} range §9.4 declares`,
    );
    assert.ok(copy.asks.length > 0, `${copy.code}'s slot does not say what has to be decided`);
  }
});

test('which slots are blocked is itself a claim, not an accident of what got written', () => {
  // Without this the battery has a hole: turning one `awaiting` slot into a confident sentence
  // leaves the others, so a count-based assertion still passes. The four blocked slots are named
  // here because *which* ones are waiting is exactly what F25 has to report, and a slot that
  // quietly acquired copy would otherwise ship invented wording under a green run.
  const expected: Readonly<Record<string, 'stated' | 'awaiting'>> = {
    coverage: 'stated',
    'ranges-dropped': 'awaiting',
    'ranges-invalidated': 'awaiting',
    'ranges-unchecked': 'stated',
    'events-pending-decoder': 'stated',
    'raw-blobs-evicted': 'awaiting',
    'chart-rows-discarded': 'awaiting',
    'history-holes': 'stated',
    'history-downsampled': 'stated',
  };
  const seen = new Map<string, string>();
  for (const item of everyItem()) seen.set(item.id, item.copy.kind);
  assert.deepEqual(
    Object.fromEntries([...seen.entries()].sort()),
    Object.fromEntries(Object.entries(expected).sort()),
  );
});

test('every empty copy slot waits on questions PLAN.md still lists as OPEN', () => {
  // The mechanical expiry. When SQ-604 or SQ-783 is ruled this fails, and the wording has to be
  // written rather than the placeholder outliving the reason it exists.
  const awaiting = everyItem()
    .map((item) => item.copy)
    .filter((copy) => copy.kind === 'awaiting');
  for (const copy of awaiting) {
    assert.ok(copy.questions.length > 0, `${copy.code}'s slot names no question to be ruled`);
    for (const id of copy.questions) {
      assert.ok(questionIsOpen(id), `${id} is no longer open, so ${copy.code}'s copy is now owed`);
    }
  }
});

test('nothing here invents FE-IDX-002’s wording — the record is rendered instead', () => {
  const html = renderBoot(checked({ chartDiscard: CHART_DISCARD }));
  // The record's own fields reach the screen: which tables, how many rows, and the span the
  // surviving coverage still claims.
  assert.ok(html.includes('412'), html);
  assert.ok(html.includes('1..900'), html);
  assert.ok(html.includes('priceSamples'), html);
  // And the slot says it is a slot, in the text a user reads rather than only in an attribute.
  assert.ok(html.includes('data-awaiting="FE-IDX-002"'), html);
  assert.ok(html.includes('SQ-604'), html);
  assert.ok(html.includes('SQ-820'), html);
});

test('the discard span’s three arms render as three different sentences', () => {
  // `ChartDiscardSpan` is three arms rather than two numbers because *the coverage row named no
  // blocks* and *the coverage row could not be read* are an ordinary client and a corruption
  // event. One rendering for both is wrong in one direction whichever it picks — announcing a
  // corruption that did not happen, or hiding one that did.
  const rendered = (span: ChartDiscardRecord['span']): string =>
    renderBoot(checked({ chartDiscard: { ...CHART_DISCARD, span } }));
  const named = rendered({ kind: 'named', fromBlock: 1, toBlock: 900 });
  const none = rendered({ kind: 'none' });
  const unreadable = rendered({ kind: 'unreadable' });
  assert.notEqual(none, unreadable);
  assert.notEqual(named, none);
  assert.ok(named.includes('1..900'), named);
});

// ------------------------------------------------ `unchecked` is the state that reads as a pass

test('a range in neither list is one that passed, so an unchecked range must be listed', () => {
  // 10 §6.3, last bullet: "a range that appears in neither the invalidated nor the unchecked set
  // is one that genuinely passed." So the two reports below must not render the same, and the
  // difference is exactly the range's span appearing.
  const passed = renderBoot(checked({ coverage: addRange(EMPTY_COVERAGE, fromIndexer(200, 300)) }));
  const notChecked = renderBoot(
    checked({
      coverage: addRange(EMPTY_COVERAGE, fromIndexer(200, 300)),
      unchecked: [fromIndexer(200, 300)],
    }),
  );
  assert.ok(!passed.includes('could not check'), passed);
  assert.ok(notChecked.includes('could not check'), notChecked);
  assert.notEqual(passed, notChecked);
});

test('the unchecked disclosure says *cannot say*, in doc 10 §6.3’s own words, and never *verified*', () => {
  const doc = architecture('10-frontend-architecture.md');
  // The phrase is the document's, taken from it rather than typed here.
  assert.ok(doc.includes('cannot say'), 'doc 10 no longer uses the phrase this copy is bound to');
  const items = bootDisclosure(checked({ unchecked: [fromIndexer(200, 300)] }));
  const item = first(
    items.filter((entry) => entry.id === REPORT_DISCLOSURES.unchecked),
    'unchecked disclosure',
  );
  assert.equal(item.copy.kind, 'stated');
  const text = item.copy.kind === 'stated' ? item.copy.text : '';
  assert.ok(text.toLowerCase().includes('cannot say'), text);
  // 10 §2.2 gives provider data no promotion path, so the one word this surface may never use
  // about a range nobody checked is the word a badge would use about one that was.
  assert.ok(!/\bverified\b|\bconfirmed\b/i.test(text), text);
  // Not `info`: an unchecked range is a statement about missing evidence, and the two other
  // severities are what distinguish it from the coverage summary beside it.
  assert.notEqual(item.severity, 'info');
});

test('an unverifiable edge renders the reason it carries, not a chain-unreachable claim', () => {
  // The two causes land in one list and `CoverageVerification` carries no discriminator, so the
  // fact each range does carry — the `unverifiable` arm's own `why` — is what distinguishes them
  // on screen. SQ-922 asks whether §6.3 obliges more than that.
  const html = renderBoot(checked({ unchecked: [fromIndexer(200, 300)] }));
  assert.ok(html.includes('states no block hash'), html);
  const chainSilent = renderBoot(checked({ unchecked: [self(1, 100)] }));
  assert.ok(chainSilent.includes('nothing could be read from the chain'), chainSilent);
});

// ------------------------------------------------------- every named record reaches a screen

test('each record F25 names reaches the rendered surface with its own fields', () => {
  const html = renderBoot(
    checked({
      dropped: [{ value: {}, reason: 'the stored entry names no block range' }],
      invalidated: [
        {
          range: self(400, 500),
          verdict: { kind: 'invalid', reason: 'bound to genesis 0xaa, this client is on 0xbb' },
        },
      ],
      unchecked: [fromIndexer(200, 300)],
      pendingDecoder: 12,
      pendingRawEvicted: RAW_EVICTED,
      chartDiscard: CHART_DISCARD,
    }),
  );
  for (const id of Object.values(REPORT_DISCLOSURES)) {
    assert.ok(html.includes(`data-disclosure="${id}"`), `${id} did not render: ${html}`);
  }
  assert.ok(html.includes('the stored entry names no block range'), html);
  assert.ok(html.includes('400..500'), html);
  assert.ok(html.includes('bound to genesis 0xaa'), html);
  assert.ok(html.includes('12 events pending decoder'), html);
  assert.ok(html.includes('100..180'), html);
  assert.ok(html.includes('the undecoded event share was over its budget'), html);
});

test('a history answer carries its holes, its folded blocks and any discard', () => {
  // 10 §6.3 on the read path: "charts render holes as visible gaps with an explainer, tables
  // state 'complete within [ranges]'". A gap in the middle of the question is the case that
  // renders as a complete series when nothing says otherwise.
  const coverage = addRange(addRange(EMPTY_COVERAGE, self(1, 100)), self(200, 300));
  const html = renderHistory({
    covered: covered(coverage, { fromBlock: 1, toBlock: 300 }, []),
    downsampled: [
      {
        fromBlock: 1,
        toBlock: 50,
        resolution: 'candles1h',
        reason: 'raw samples for these blocks were folded into hourly candles',
        at: 1_700_000_000_000,
      },
    ],
    chartDiscard: CHART_DISCARD,
  });
  assert.ok(html.includes('data-disclosure="history-holes"'), html);
  assert.ok(html.includes('101..199'), html);
  assert.ok(html.includes('data-disclosure="history-downsampled"'), html);
  assert.ok(html.includes('folded into hourly candles'), html);
  assert.ok(html.includes(`data-disclosure="${HISTORY_DISCLOSURES.chartDiscard}"`), html);
});

test('a complete history answer discloses nothing, and that is the one honest silence', () => {
  const coverage = addRange(EMPTY_COVERAGE, self(1, 300));
  assert.equal(
    renderHistory({
      covered: covered(coverage, { fromBlock: 1, toBlock: 300 }, []),
      downsampled: [],
      chartDiscard: undefined,
    }),
    '',
  );
});

// ------------------------------------------------------------- the boot path, end to end

test('a real v1 database upgrades, and the discard it records reaches the screen', async () => {
  // The whole chain F25 exists to close, with nothing stubbed: a version-1 database is opened,
  // the production `LocalIndex` upgrades it and records the discard inside the dropping
  // transaction, `bootLocalIndex` runs `checkIndexAtBoot` over it, and the rendered surface
  // names the tables and the span `meta.coverage` still claims.
  const genesis = `0x${'e5'.repeat(32)}`;
  const legacy = legacyIndexV1(genesis);
  await legacy.delete();
  await legacy.open();
  await legacy
    .table('priceSamples')
    .put({ bookId: 'book-1', at: 10, blockNumber: 5, price1e9: 1n, origin: 'self' });
  await legacy.table('meta').put({
    key: 'coverage',
    coverage: { ranges: [selfRange(1, 9, 1, edgeAt(9, genesis))], holes: [] },
  });
  legacy.close();

  const { state, db } = await bootLocalIndex({ kind: 'pinned', paraGenesisHash: genesis }, cannotObserve);
  assert.equal(state.kind, 'checked');
  assert.ok(db !== undefined, 'a checked boot returned no database handle');
  const html = renderBoot(state);
  assert.ok(html.includes('data-disclosure="chart-rows-discarded"'), html);
  assert.ok(html.includes('1..9'), html);
  assert.ok(html.includes('data-awaiting="FE-IDX-002"'), html);
  // The coverage survived the upgrade, which is precisely why the discard has to be announced:
  // the blocks are still claimed and the chart tiers over them are empty.
  assert.ok(html.includes('data-disclosure="coverage"'), html);
  db?.close();
  await db?.delete();
});

test('with no chain to ask, every range is unchecked and the surface says so', async () => {
  // `cannotObserve` is the honest observer for a client that never starts a light client, and
  // §6.3's asymmetry means the ranges are KEPT. What must not happen is their disappearing from
  // the report, which is the F9 finding that `runIngest` had dropped the same set.
  const genesis = `0x${'e6'.repeat(32)}`;
  const seed = legacyIndexV1(genesis);
  await seed.delete();
  seed.close();
  const { state, db } = await bootLocalIndex({ kind: 'pinned', paraGenesisHash: genesis }, cannotObserve);
  assert.equal(state.kind, 'checked');
  if (state.kind !== 'checked' || db === undefined) return;
  await db.meta.put({
    key: 'coverage',
    coverage: addRange(EMPTY_COVERAGE, selfRange(1, 9, 1, edgeAt(9, genesis))),
  });
  const second = await bootLocalIndex({ kind: 'pinned', paraGenesisHash: genesis }, cannotObserve);
  assert.equal(second.state.kind, 'checked');
  if (second.state.kind !== 'checked') return;
  assert.equal(second.state.report.unchecked.length, 1);
  assert.equal(second.state.report.invalidated.length, 0);
  assert.ok(renderBoot(second.state).includes('could not check'));
  db.close();
  await db.delete();
});

test('an index that cannot be opened becomes a state, never a thrown boot', async () => {
  // INV-FE-7 makes loss and corruption "a performance and convenience event only", and 10 §3.1
  // makes an IndexedDB open failure explicitly non-terminal. A boot path that threw would turn
  // the one event the invariant says the client must survive into a client that does not start.
  const { state, db } = await bootLocalIndex(
    { kind: 'pinned', paraGenesisHash: 'not-a-genesis-hash' },
    cannotObserve,
  );
  assert.equal(state.kind, 'unopenable');
  assert.equal(db, undefined);
  const html = renderBoot(state);
  assert.ok(html.includes('data-disclosure="index-unopenable"'), html);
  assert.ok(html.includes('No local history this session'), html);
});

test('an index nobody opened never renders as one that was checked', () => {
  // The defect one level up: *not run* must not read as *passed*. Every arm renders, and the
  // two that opened nothing say so in their own words rather than by rendering nothing.
  const notOpened = renderBoot({ kind: 'not-opened', reason: 'no chain is pinned by this release' });
  assert.ok(notOpened.includes('data-disclosure="index-not-opened"'), notOpened);
  assert.ok(notOpened.includes('no chain is pinned by this release'), notOpened);
  assert.ok(!notOpened.includes('data-disclosure="coverage"'), notOpened);
  assert.notEqual(notOpened, '');
});

// ------------------------------------------------------------------------- the wiring itself

test('this release pins no parachain, and the client says exactly that', () => {
  // Bound to the release's declared sources rather than asserted: the day a genesis is pinned,
  // this fails and the boot wiring has to start opening a real index.
  const sources: unknown = JSON.parse(
    readFileSync(join(APP, 'tools/release/sources/release-sources.json'), 'utf8'),
  );
  const pinned = (sources as { chainIdentity: { genesisHashes: { para: string | null } } })
    .chainIdentity.genesisHashes.para;
  assert.equal(pinned, null, 'a parachain genesis is pinned; releaseParaChain() must now return it');
  const chain = releaseParaChain();
  assert.equal(chain.kind, 'unpinned');
  assert.ok(chain.kind === 'unpinned' && chain.reason.length > 0);
});

test('an unpinned chain opens no database — there is no default identity to fall back to', async () => {
  // 10 §7 gives the index one database per chain identity, and a fallback would be a database
  // under an invented name: a client that later connected to a real chain would read those rows
  // as that chain's. So the absence has to end the boot path rather than be defaulted through.
  const { state, db } = await bootLocalIndex(releaseParaChain(), cannotObserve);
  assert.equal(state.kind, 'not-opened');
  assert.equal(db, undefined);
  assert.ok(renderBoot(state).includes('data-disclosure="index-not-opened"'));
});

test('the disclosure is rendered outside the outlet, so it is on every route', () => {
  // It has no 11 §11.2 inventory id (SQ-920), so it is not a screen and cannot be reached by a
  // route. What makes it reachable is its position in the shell — above the outlet, outside the
  // per-screen branch — and that is a claim about the composition root's shape.
  const boot = withoutComments(appSource('src/application/src/boot.tsx'));
  assert.ok(boot.includes('bootLocalIndex('), 'boot.tsx does not run the index boot check');
  assert.ok(boot.includes('releaseParaChain()'), 'boot.tsx invents a chain identity');
  const disclosure = boot.indexOf('<IndexBootDisclosure');
  const outlet = boot.indexOf('<Outlet');
  assert.ok(disclosure > 0, 'boot.tsx does not render the index disclosure');
  assert.ok(outlet > 0, 'boot.tsx no longer renders the outlet');
  assert.ok(disclosure < outlet, 'the disclosure renders inside or after the per-screen outlet');
  // Ordering alone is not the claim — *on every route* is. A conditional wrapper would keep the
  // element ahead of the outlet while making it reachable on some screens only, so the shape
  // asserted is the unconditional one: the shell's first child, immediately before the outlet.
  assert.match(
    boot,
    /<Shell[^>]*>\s*<IndexBootDisclosure state=\{[A-Za-z]+\} \/>\s*<Outlet/,
    'the disclosure is not the shell’s unconditional first child',
  );
});

test('nothing in this client starts a light client, which is what makes cannotObserve true', () => {
  // `cannotObserve` answers *cannot say* for every range. That is the truth only while no chain
  // connection exists; the day one is started this assertion fails and the observer has to be
  // replaced by a real edge read rather than silently keeping its answer.
  const callers = ['src/application/src/boot.tsx', 'src/features/analysis/src/index-boot.ts'];
  for (const file of callers) {
    assert.ok(
      !/\bstartLightClient\s*\(/.test(withoutComments(appSource(file))),
      `${file} starts a light client, so cannotObserve is no longer the honest observer`,
    );
  }
});

test('the local index is constructed in exactly one production module', () => {
  // F8's standing finding was that `app/src` constructed no `LocalIndex` at all. The opposite
  // failure is as bad: two construction sites are two databases and two coverage writers, which
  // §6.5's single-writer lock exists to prevent.
  const analysis = withoutComments(appSource('src/features/analysis/src/index-boot.ts'));
  assert.equal((analysis.match(/new LocalIndex\(/g) ?? []).length, 1);
  for (const file of ['src/application/src/boot.tsx', 'src/features/analysis/src/index.ts']) {
    assert.ok(!/new LocalIndex\(/.test(withoutComments(appSource(file))), file);
  }
});

test('a range from another chain is invalidated, and its reason reaches the screen', () => {
  // Not a fixture reason: `verifyRange` writes one sentence per check and the three are not
  // interchangeable, so the rendered detail has to be the range's own.
  const foreign = selfRange(1, 9, 1, edgeAt(9, OTHER));
  const html = renderBoot(
    checked({
      invalidated: [
        {
          range: foreign,
          verdict: {
            kind: 'invalid',
            reason: `range 1..9 is bound to genesis ${OTHER} but this client is on ${GENESIS}`,
          },
        },
      ],
    }),
  );
  assert.ok(html.includes(OTHER), html);
  assert.ok(html.includes('data-disclosure="ranges-invalidated"'), html);
});
