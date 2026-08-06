/**
 * The nth element of a result array, or a throw naming how many there really were.
 *
 * `noUncheckedIndexedAccess` is on, and the alternative to this is `!`, which suppresses
 * exactly the symptom these suites exist to catch. A plan that produced fewer chunks than
 * expected, or a fold that produced no candle at all, would otherwise fail as "cannot read
 * property 'toBlock' of undefined" at a line that reads like the assertion — so the report
 * names the property rather than the shortfall, and the shortfall is the finding.
 *
 * Uses `.at()` so a negative index means what it means everywhere else: `nth(chunks, -1)`
 * is the last chunk.
 */
export function nth<T>(items: readonly T[], index: number, what = 'element'): T {
  const item = items.at(index);
  if (item === undefined) {
    throw new Error(`expected a ${what} at index ${index}; the array holds ${items.length}`);
  }
  return item;
}
