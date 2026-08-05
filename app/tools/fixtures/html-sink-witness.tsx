/**
 * Witness for `check-no-html-sinks` — every sink fires here, and the controls do not.
 *
 * Never built by `tsc -b` and never shipped. It exists because a gate proven only by a green
 * run is not proven: this file uses each forbidden form once, and the controls below are the
 * near-misses that a looser pattern would fire on.
 */

declare const el: HTMLElement;
declare const text: string;

export function sinkInnerHtml() {
  // expect-sink: innerHTML
  el.innerHTML = text;
}

export function sinkOuterHtml() {
  // expect-sink: outerHTML
  el.outerHTML = text;
}

export function sinkInsertAdjacent() {
  // expect-sink: insertAdjacentHTML
  el.insertAdjacentHTML('beforeend', text);
}

export function sinkDangerouslyProp() {
  // expect-sink: dangerouslySetInnerHTML
  return <div dangerouslySetInnerHTML={{ __html: text }} />;
}

export function sinkDangerouslyObject() {
  // expect-sink: dangerouslySetInnerHTML
  const props = { dangerouslySetInnerHTML: { __html: text } };
  return props;
}

export function sinkEval() {
  // expect-sink: eval
  return eval(text);
}

export function sinkNewFunction() {
  // expect-sink: new Function
  return new Function(text);
}

// ---------------------------------------------------------------------------
// Negative controls. A finding on any of these is a false positive and fails the
// witness — these are the near-misses a substring or "ends in HTML" pattern hits.
// ---------------------------------------------------------------------------

export function controlSimilarNames() {
  const escapeHtml = (s: string) => s;
  const parseHtml = (s: string) => s;
  const htmlLang = 'en';
  return [escapeHtml(text), parseHtml(text), htmlLang];
}

export function controlTextContentIsFine() {
  el.textContent = text;
}

export function controlStringMentioningASink() {
  // A string body is not a property access on the AST, so this is invisible to the rule —
  // which is exactly why the scan is not a grep.
  return 'set innerHTML carefully; never use dangerouslySetInnerHTML here';
}

export function controlEvaluateIsNotEval() {
  const evaluate = (s: string) => s.length;
  return evaluate(text);
}

export function controlFunctionAsAType(): Function | undefined {
  // `Function` in type position, and a call to something else entirely.
  return undefined;
}
