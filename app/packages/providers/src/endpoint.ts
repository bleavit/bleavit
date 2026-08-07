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
  return `${withoutTrailingSlashes(endpoint)}/${path}`;
}
