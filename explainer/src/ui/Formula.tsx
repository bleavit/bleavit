import { MATH, MATH_DISPLAY, MATH_TEX, type MathKey } from './__generated__/math';
import './__generated__/katex.css';
import './math.css';

/**
 * A typeset formula.
 *
 * Named `Formula` rather than `Math`, because `Math` is a JavaScript global:
 * importing a component under that name shadows it inside the whole module, and
 * every `Math.max` in the file stops compiling.
 *
 * The markup is produced by KaTeX **at build time** (`scripts/build-math.mjs`),
 * so the renderer itself — 272 kB of it — never reaches a browser. Every formula
 * in this app is fixed prose written by an author, not an expression a reader
 * types, so there is nothing left to render at runtime.
 *
 * `dangerouslySetInnerHTML` is doing exactly what its name warns about, and it
 * is safe here for a reason worth stating rather than assuming: the string comes
 * from a checked-in generated module, produced from a literal table in this
 * repository, by KaTeX with `trust: false` — which refuses `\href`, `\url` and
 * `\includegraphics`. No value from the simulation, the URL or storage can reach
 * it. If a formula ever needs to interpolate a runtime value, that value goes
 * beside the formula through `Value`, never inside it.
 *
 * KaTeX emits both HTML and MathML: the visual layer is `aria-hidden`, and the
 * MathML underneath is what a screen reader announces. The `title` carries the
 * source TeX, which is the most useful thing to see on hover and the only form
 * that survives a copy-paste into a paper.
 */
export function Formula({
  name,
  className,
}: {
  name: MathKey;
  className?: string;
}) {
  const display = MATH_DISPLAY[name];
  const classes = ['math', display ? 'math--display' : 'math--inline', className ?? '']
    .filter(Boolean)
    .join(' ');

  const Tag = display ? 'div' : 'span';
  return (
    <Tag
      className={classes}
      title={MATH_TEX[name]}
      dangerouslySetInnerHTML={{ __html: MATH[name] }}
    />
  );
}

export type { MathKey };
