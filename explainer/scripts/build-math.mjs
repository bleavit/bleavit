/**
 * Typeset the app's formulas, at build time.
 *
 * KaTeX runs here, in Node, and the app ships the rendered markup — so the
 * 272 kB renderer never reaches a browser. That is the whole reason to do it
 * this way: every formula in this app is fixed prose written by an author, not
 * an expression a user types, so there is nothing to render at runtime.
 *
 * The stylesheet is emitted trimmed as well. KaTeX's own CSS declares twenty
 * `@font-face` families; these formulas use a handful, and shipping declarations
 * for faces no glyph references would make the build emit a megabyte of woff2
 * that nothing ever loads.
 *
 * Output (both checked in, both generated — do not hand-edit):
 *   src/ui/__generated__/math.ts        the rendered HTML, keyed
 *   src/ui/__generated__/katex.css      the trimmed stylesheet
 *
 * Run with `npm run math`. `npm run verify` does not regenerate; the check that
 * the committed output matches its source is `npm run math -- --check`.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import katex from 'katex';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const outDir = join(root, 'src', 'ui', '__generated__');

/**
 * The incident multiplier's tiers are frozen in the protocol core, and the
 * welfare rail already parses that same string so the printed ladder cannot
 * drift from the constant. Typesetting it must not reintroduce the drift the
 * parsing was there to prevent, so the LaTeX is built from the constant too.
 */
function incidentLatex() {
  const src = readFileSync(join(root, 'src', 'protocol', 'welfare.ts'), 'utf8');
  const m = /formula:\s*'([^']+)'/.exec(src);
  if (m === null) throw new Error('welfare.ts no longer carries an INCIDENT_MULTIPLIER formula');
  const tiers = [...m[1].matchAll(/S(\d)\s*=\s*([\d.]+)/g)].map(
    ([, tier, points]) => `S_${tier} = ${points}`,
  );
  if (tiers.length === 0) throw new Error(`could not read severity tiers from: ${m[1]}`);
  const sep = String.raw`,\quad `;
  return String.raw`I = \max\!\left(0,\ 1 - \sum_{\text{incidents}} \text{severity}\right)
    \qquad ${tiers.join(sep)}`;
}

/**
 * Every formula the app displays.
 *
 * `display: true` is KaTeX's display mode — centred, full-height operators, its
 * own line. Inline entries are the ones that sit inside a sentence.
 */
const FORMULAS = {
  // --- The welfare score, doc 05 ------------------------------------------
  'welfare.W': {
    display: true,
    tex: String.raw`W \;=\; g(S)\cdot g(C)\cdot \operatorname{GeoComposite}(P, A)`,
  },
  'welfare.s': {
    display: true,
    tex: String.raw`s \;=\; \sqrt{\,W_{e+1}\cdot W_{e+2}\,}`,
  },
  'welfare.s-named': {
    display: true,
    tex: String.raw`s \;=\; \operatorname{GeoMean}\!\left(W_{e+1},\, W_{e+2}\right)
      \;=\; \sqrt{\,W_{e+1}\cdot W_{e+2}\,}`,
  },
  'welfare.gate': {
    display: true,
    tex: String.raw`g\!\left(x;\,\theta^-,\theta^+\right) \;=\;
      \begin{cases}
        0 & x < \theta^-\\[2pt]
        3t^2 - 2t^3 & \theta^- \le x < \theta^+\\[2pt]
        1 & x \ge \theta^+
      \end{cases}`,
  },
  'welfare.t': {
    display: true,
    tex: String.raw`t \;=\; \frac{x - \theta^-}{\theta^+ - \theta^-}`,
  },
  'welfare.incident': { display: true, tex: incidentLatex() },
  'welfare.S': { display: false, tex: String.raw`S = \min\!\left(U,\, D_{\text{eff}}\right)` },
  'welfare.composite': {
    display: true,
    tex: String.raw`\operatorname{GeoComposite}(P, A) \;=\;
      \max(P,\varepsilon)^{0.60}\cdot \max(A,\varepsilon)^{0.40}`,
  },

  // --- The market maker, doc 04 -------------------------------------------
  'market.cost': {
    display: true,
    tex: String.raw`C\!\left(q_L, q_S\right) \;=\; b\,\ln\!\left(e^{q_L/b} + e^{q_S/b}\right)`,
  },
  'market.price': {
    display: true,
    tex: String.raw`p_L \;=\; \frac{1}{1 + e^{-\left(q_L - q_S\right)/b}}`,
  },
  'market.maker-loss': { display: false, tex: String.raw`b\ln 2` },
  'market.slew': { display: false, tex: String.raw`\left(1 \pm \kappa\right)^{k}` },
  'market.cash-change': {
    display: false,
    tex: String.raw`b\ln\!\left(\frac{1-p}{1-p'}\right)`,
  },
  'market.payout': { display: false, tex: String.raw`\Delta\cdot p'` },
  'market.hurdle': {
    display: true,
    tex: String.raw`r_{\text{eff}} \;=\; \max\!\left(
      \operatorname{TWAP}_{\text{REJECT}},\;
      \operatorname{TWAP}_{\text{Baseline}} - \sigma\right)`,
  },

  // --- Bonded disputes, doc 07 --------------------------------------------
  'oracle.total-bond': {
    display: false,
    tex: String.raw`\left(2^{\,r} - 1\right)\times \texttt{orc.bond\_bps}`,
  },
  'oracle.total-bond-max': {
    display: false,
    tex: String.raw`\left(2^{\,R_{\max}} - 1\right)\times \texttt{orc.bond\_bps}`,
  },
};

const rendered = {};
for (const [key, { tex, display }] of Object.entries(FORMULAS)) {
  rendered[key] = katex.renderToString(tex, {
    displayMode: display,
    output: 'htmlAndMathml',
    throwOnError: true,
    strict: 'error',
    trust: false,
  });
}

// --- Trim the stylesheet to the faces the output actually references --------
const katexCss = readFileSync(
  join(root, 'node_modules', 'katex', 'dist', 'katex.min.css'),
  'utf8',
);
const usedFamilies = new Set();
for (const html of Object.values(rendered)) {
  for (const m of html.matchAll(/class="[^"]*\b(mord|mop|mbin|mrel|mopen|mclose|mpunct)?[^"]*"/g)) {
    void m;
  }
  // The class names KaTeX puts on spans map 1:1 onto its font families.
  for (const m of html.matchAll(
    /\b(mathnormal|mathit|mathrm|mathbf|mathsf|mathtt|amsrm|mathcal|mathscr|mathfrak|mathbb|boldsymbol)\b/g,
  )) {
    usedFamilies.add(m[1]);
  }
  for (const m of html.matchAll(/\b(delimsizing|size[1-4]|op-symbol|large-op)\b/g)) {
    usedFamilies.add(m[1]);
  }
}

/**
 * Drop `@font-face` blocks for families nothing references.
 *
 * The mapping from KaTeX's span classes to its font families is not one-to-one,
 * so the rule is deliberately conservative: `KaTeX_Main`, `KaTeX_Math` and
 * `KaTeX_Size1..4` are always kept because the base layout uses them, and the
 * decorative families are kept only when a class that needs them appears.
 */
const ALWAYS = ['KaTeX_Main', 'KaTeX_Math', 'KaTeX_Size1', 'KaTeX_Size2', 'KaTeX_Size3', 'KaTeX_Size4'];
const FAMILY_FOR = {
  mathsf: 'KaTeX_SansSerif',
  mathtt: 'KaTeX_Typewriter',
  mathcal: 'KaTeX_Caligraphic',
  mathscr: 'KaTeX_Script',
  mathfrak: 'KaTeX_Fraktur',
  mathbb: 'KaTeX_AMS',
  amsrm: 'KaTeX_AMS',
};
const keep = new Set(ALWAYS);
for (const f of usedFamilies) if (FAMILY_FOR[f] !== undefined) keep.add(FAMILY_FOR[f]);

let dropped = 0;
const wanted = new Set();
const trimmedCss = katexCss
  .replace(/@font-face\{[^}]*\}/g, (block) => {
    const fam = /font-family:([^;}]+)/.exec(block);
    const name = fam === null ? '' : fam[1].replace(/["']/g, '').trim();
    if (![...keep].some((k) => name === k)) {
      dropped += 1;
      return '';
    }
    /* woff2 only. Every browser this app supports has had it for years, and the
       woff and ttf fallbacks in KaTeX's own CSS would triple the emitted bytes
       for formats nothing here will ever request. */
    return block.replace(/src:[^;}]+/, (src) => {
      const woff2 = /url\(fonts\/([\w-]+\.woff2)\)/.exec(src);
      if (woff2 === null) return src;
      wanted.add(woff2[1]);
      return `src:url(./fonts/${woff2[1]}) format("woff2")`;
    });
  });

/* Copy the faces the trimmed stylesheet still names, next to it.
   Rewriting the URLs is not enough on its own: KaTeX's CSS points at
   `fonts/…woff2` relative to its own location inside `node_modules`, which
   nothing in `src/` can resolve — the build reported ten unresolved references
   and shipped a stylesheet whose every glyph would 404 at runtime. */
mkdirSync(join(outDir, 'fonts'), { recursive: true });
let copied = 0;
for (const file of wanted) {
  const from = join(root, 'node_modules', 'katex', 'dist', 'fonts', file);
  const to = join(outDir, 'fonts', file);
  const bytes = readFileSync(from);
  if (!existsSync(to) || Buffer.compare(readFileSync(to), bytes) !== 0) {
    writeFileSync(to, bytes);
  }
  copied += 1;
}

// --- Emit ------------------------------------------------------------------

const banner = `/* GENERATED by scripts/build-math.mjs — do not edit.
   Source of truth: the FORMULAS table in that script. Run \`npm run math\`. */\n`;

const tsBody =
  banner +
  `\nexport type MathKey =\n` +
  Object.keys(rendered)
    .map((k) => `  | '${k}'`)
    .join('\n') +
  `;\n\nexport const MATH: Record<MathKey, string> = ${JSON.stringify(rendered, null, 2)};\n` +
  `\nexport const MATH_DISPLAY: Record<MathKey, boolean> = ${JSON.stringify(
    Object.fromEntries(Object.entries(FORMULAS).map(([k, v]) => [k, v.display])),
    null,
    2,
  )};\n` +
  `\n/** The plain-text reading of each formula, for the accessible name. */\n` +
  `export const MATH_TEX: Record<MathKey, string> = ${JSON.stringify(
    Object.fromEntries(
      Object.entries(FORMULAS).map(([k, v]) => [k, v.tex.replace(/\s+/g, ' ').trim()]),
    ),
    null,
    2,
  )};\n`;

const tsPath = join(outDir, 'math.ts');
const cssPath = join(outDir, 'katex.css');

const check = process.argv.includes('--check');
if (check) {
  const stale = [];
  for (const [p, want] of [
    [tsPath, tsBody],
    [cssPath, banner + trimmedCss],
  ]) {
    if (!existsSync(p) || readFileSync(p, 'utf8') !== want) stale.push(p);
  }
  if (stale.length > 0) {
    console.error('Generated math is stale. Run `npm run math`.\n  ' + stale.join('\n  '));
    process.exit(1);
  }
  console.log(`Generated math is current (${Object.keys(rendered).length} formulas).`);
} else {
  writeFileSync(tsPath, tsBody);
  writeFileSync(cssPath, banner + trimmedCss);
  console.log(
    `Typeset ${Object.keys(rendered).length} formulas; kept ${keep.size} font families ` +
      `(${copied} woff2 copied), dropped ${dropped} @font-face blocks.`,
  );
}
