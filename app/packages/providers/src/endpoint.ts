/**
 * One place that turns a provider endpoint into a URL — 10 §8.5.2, §8.5.3. F24.
 *
 * `probe.ts` and `indexer.ts` each built their own, with the same http(s) refusal written twice and
 * the same trailing-slash trim written twice. Two copies of a rule about **untrusted input** is one
 * copy too many, and the day this module was written both copies carried the same defect.
 *
 * ## The trim was a ReDoS, and it was reachable
 *
 * Both copies trimmed with `endpoint.replace(/\/+$/, '')`. That regular expression is polynomial:
 * on a string containing a long run of slashes that is **not** at the end, the engine tries the run
 * from each starting offset before failing. Measured on this workstation before the fix, with the
 * run followed by one ordinary character:
 *
 * | slashes | time |
 * |---|---|
 * | 20,000 | 181 ms |
 * | 40,000 | 730 ms |
 * | 80,000 | 3,139 ms |
 *
 * Four times the work for twice the input, which is the signature. CodeQL flagged both sites as
 * `js/polynomial-redos` at **high** severity, and the severity is right rather than theoretical:
 * 10 §8.1 makes the endpoint a value the *user pastes or accepts from a suggestion*, so it is
 * exactly the uncontrolled input the rule is about. A source that could not serve one usable row —
 * it never has to answer anything — could freeze the tab that merely tried to build its URL.
 *
 * The replacement scans backwards over code units and never backtracks, so it is linear and has no
 * pathological input. It is deliberately not a cleverer regular expression: the class of bug is
 * "someone reasoned about a regex engine's backtracking and got it wrong", and the way not to have
 * that bug again is to not depend on the reasoning.
 */

import type { ChainBinding } from '@bleavit/handoff-envelope';

/** `/` as a UTF-16 code unit. Compared numerically so the scan does not allocate per character. */
const SLASH = 0x2f;

/**
 * The endpoint with any trailing slashes removed, in linear time.
 *
 * `slice` on the computed length rather than a regular expression — see the module note.
 */
export function withoutTrailingSlashes(endpoint: string): string {
  let end = endpoint.length;
  while (end > 0 && endpoint.charCodeAt(end - 1) === SLASH) end -= 1;
  return endpoint.slice(0, end);
}

/**
 * Build `<endpoint>/<path>` for a provider route, or `null` if the endpoint may not be used.
 *
 * Refuses any scheme that is not HTTP(S). Not invented policy: §8.5.2's interface is HTTP, so a
 * `javascript:`, `data:` or `file:` endpoint is not an indexer this client failed to reach — it is
 * a string that would make a provider read a vector into whatever the injected transport does with
 * it. Refusing here means the refusal happens before any transport sees the value, at the one place
 * that knows what the URL is for.
 *
 * `path` is supplied by this package, never by a provider, so it is not escaped here.
 */
export function providerUrl(endpoint: string, path: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  // A query or a fragment on the BASE is refused rather than carried or dropped. §8.5.2's two
  // routes hang off a base URL and the interface defines neither, so there is no right answer for
  // where `?a=1` goes relative to `/chain` — and the two wrong answers are both bad. Dropping it
  // sends the request somewhere other than the string the user pasted; carrying it is what this
  // function did until an R-6 review on 2026-08-07, and it appended the route *inside* the query:
  //
  //     https://x.example/?a=1  ->  https://x.example/?a=1/chain
  //     https://x.example/#f    ->  https://x.example/#f/chain
  //
  // Neither reaches `/chain`. The first requests `/` and the operator sees a nonsense parameter;
  // the second never leaves the page. Refusing is fail-closed and, unlike either alternative, it
  // is visible: the caller reports the endpoint as unusable instead of quietly reading nothing.
  if (parsed.search !== '' || parsed.hash !== '') return null;
  // Built from the PARSED url, so the path is joined to a real pathname rather than concatenated
  // onto the raw string. `withoutTrailingSlashes` still governs the join — see the module note for
  // why that is a scan and not a regular expression.
  return `${parsed.origin}${withoutTrailingSlashes(parsed.pathname)}/${path}`;
}

/**
 * `§8.2's binding object`, parsed once — 10 §8.5.3's answer condition, and §8.5.2's `/chain` body.
 *
 * One parser because the two routes are one sentence: §8.5.3 says the probe **answers** when the
 * body *"parses as §8.2's `binding` object"*, and §8.5.2's `/chain` serves that same object. They
 * were two implementations until 2026-08-07, and they disagreed — the probe accepted any
 * `typeof === 'number'` for the two version fields while `readChain` required a u32. Measured: a
 * body with `specVersion: NaN` (or `1.5`, `-1`, `2**33`) **answered** the probe and was a **failed
 * read** to the range reader.
 *
 * That divergence is not cosmetic, because of where the two feed. An answering probe keeps the
 * source `Healthy`, so `canServeReads` is true; every `/range` then fails, and §8.5.2 deliberately
 * keeps read failures off §8.3's ladder. The source is permanently healthy and permanently
 * unusable, and no counter anywhere is counting — reachable without a single `503`, and the same
 * hole SQ-987 records from the liveness side.
 *
 * Returns the **whole** binding rather than the genesis hash alone, so a caller that needs the two
 * version fields reads them off a validated object instead of asserting them back out of the raw
 * record. Only `genesisHash` is ever compared (SQ-982 rules that the versions are displayed and
 * never refuse) — but a parser that returned one field would push the other two through a cast at
 * every call site, which is how a validated value stops being one. `null` when the body is not
 * §8.2's binding object.
 */
export function parseBinding(body: unknown): ChainBinding | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const genesisHash = record['genesisHash'];
  const specVersion = record['specVersion'];
  const contractVersion = record['contractVersion'];
  if (typeof genesisHash !== 'string' || genesisHash === '') return null;
  if (!isU32(specVersion) || !isU32(contractVersion)) return null;
  return { genesisHash, specVersion, contractVersion };
}

/** A `u32` as §8.2 writes one: an integer in range, never `NaN`, a float, or a negative. */
function isU32(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff;
}
