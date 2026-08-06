#!/usr/bin/env node
/**
 * The 10 §9.4 first-meaningful-render budget, measured under §9.4's own reference
 * hardware (F14).
 *
 * §9.4 heads its table *"Measured in CI (Lighthouse + Playwright timers) on reference
 * hardware (desktop = mid-2023 laptop 4× throttle; mobile = Moto G-class Android)"*, and
 * the shell row's enforcement column says **Lighthouse CI**. Nothing measured it. This
 * runs Lighthouse over the built release tree and gates the result.
 *
 * ## What is measured, and why it is FCP
 *
 * §9.4 budgets *"First meaningful render (shell)"*. Lighthouse's own
 * `first-meaningful-paint` audit is retained in the config for backwards compatibility and
 * **produces no `numericValue`** in 12.8.2 — measured, not assumed (V-174) — so binding to
 * it would be binding to `undefined`, which is the FE-P1 trap in its purest form: a gate
 * that measured nothing and reported a comfortable number. **First Contentful Paint** is
 * the metric that answers *"has the shell put anything on screen"*, and it is the one the
 * row is about: 10 §3.2 lists what renders before a chain connection exists, and this
 * document's `<div id="app">` is empty until the entry chunk executes, so FCP **is** the
 * shell appearing rather than a proxy for it.
 *
 * Largest Contentful Paint is measured alongside and reported, but not gated — §9.4
 * publishes one shell threshold pair per form factor, and inventing a second budget for a
 * second metric would be this repository writing a number the document does not.
 *
 * ## Reference hardware, verified rather than assumed (R-2, V-174)
 *
 * Both profiles come from Lighthouse's own published presets, read out of
 * `lighthouse/core/config/constants.js` at run time rather than copied here — a copied
 * preset is another number with two homes, which is the defect §9.4's own gates were
 * rebuilt to remove.
 *
 * * **mobile** — Lighthouse's default preset *is* §9.4's reference device: Moto G Power
 *   (2022) screen emulation (412 × 823, DPR 1.75), its matching user agent, Slow 4G, and
 *   `cpuSlowdownMultiplier: 4`. Taken unmodified.
 * * **desktop** — Lighthouse's desktop preset supplies the 1350 × 940 viewport and
 *   `desktopDense4G` network, but its own `cpuSlowdownMultiplier` is **1**, not 4
 *   (verified against the installed 12.8.2, V-174). §9.4 asks for a mid-2023 laptop at
 *   **4× throttle**, so the multiplier is overridden to 4 and the override is asserted
 *   back out of the report — see the anti-vacuity notes below.
 *
 * *"Lighthouse's own preset is the reference device"* is a claim about a dependency, so
 * it is **checked at run time, not asserted**: `assertReferenceHardware` requires the
 * mobile preset's user agent to still name the device §9.4 names and requires both
 * presets to carry a CPU slowdown above 1. Upstream has moved this preset before (Moto G4
 * to Moto G Power), and a preset that quietly became a different phone would leave this
 * file reporting "Moto G-class" while measuring something else.
 *
 * `throttlingMethod` stays Lighthouse's default `simulate` (Lantern). That is the
 * reproducibility choice: Lantern is an analytical model over the observed trace and
 * network records, so it does not inherit the scheduling noise a `devtools`-throttled run
 * on a shared CI runner would. Measured locally over four 3-run passes the whole spread
 * was under 10 ms on both profiles — desktop 401–408 ms, mobile 1,803–1,809 ms.
 *
 * ## Why a median against the p95 column
 *
 * §9.4 publishes p50 and p95 for each form factor. A single run gated on p50 is a
 * coin-flip on a shared runner; a warning-only gate is a budget nobody enforces. So the
 * **median of N runs** is compared against the **p95** column as a hard failure and
 * against the **p50** column as a loud non-fatal warning — the same two-threshold
 * treatment `check-bundle-budget.ts` gives §9.4's initial-JS row, and for the same
 * reason: the document states two numbers and collapsing them to one either blocks work
 * the document permits or lets the target rot into decoration.
 *
 * ## Fails closed, and cannot pass without having measured
 *
 * Every one of these exits non-zero rather than reporting a comfortable number: no
 * `dist/`, no Chrome, a Lighthouse `runtimeError`, an FCP audit with no numeric value, a
 * run whose network records do not include the entry chunk `index.html` names (so a
 * blank-page or 404 measurement cannot pass), and — the one a future dependency bump
 * would otherwise slip through — a report whose echoed `configSettings` do not carry the
 * throttling and screen emulation this file requested. A Lighthouse that quietly stopped
 * honouring `cpuSlowdownMultiplier` would still produce fast, green numbers; they would
 * simply no longer be numbers about §9.4's reference hardware.
 *
 * `--witness` is the anti-vacuity leg: one desktop run against a threshold no render can
 * satisfy, which MUST be refused. It costs a single run rather than a full pass, and it
 * proves the two things a green run cannot — that the comparison still fires, and that
 * the value it fires on is a measurement rather than a default. A gate that stopped
 * comparing would look exactly like a client that got fast.
 */

import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';

import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';
import * as lighthouseConstants from 'lighthouse/core/config/constants.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..', '..');
const DIST = join(APP, 'dist');

/**
 * 10 §9.4, "First meaningful render (shell)", desktop p50. Milliseconds.
 *
 * These four constants are bound to §9.4's published cell by
 * `tools/ci/check-frontend-budgets.py`. They are not a second copy of the budget — they
 * are the copy that gate proves equal to the document, which is how every other §9.4
 * threshold in this repository is held (see `check-bundle-budget.ts`).
 */
const DESKTOP_TARGET_MS = 1_500;
/** 10 §9.4, desktop p95 — the hard failure threshold. */
const DESKTOP_HARD_FAIL_MS = 3_000;
/** 10 §9.4, mobile p50. */
const MOBILE_TARGET_MS = 3_000;
/** 10 §9.4, mobile p95 — the hard failure threshold. */
const MOBILE_HARD_FAIL_MS = 6_000;

/**
 * 10 §9.4's reference desktop, from the sentence heading its table: *"desktop = mid-2023
 * laptop 4× throttle"*. Bound to that prose by `tools/ci/check-frontend-budgets.py`, for
 * the same reason as the four thresholds above — it is a published figure, so it may not
 * have a second home here that can drift away from it.
 */
const DESKTOP_CPU_SLOWDOWN = 4;

/**
 * The substring §9.4's reference mobile device must still be named by, from the same
 * sentence: *"mobile = Moto G-class Android"*. Also bound to that prose, and checked
 * against Lighthouse's preset at run time rather than trusted.
 */
const MOBILE_REFERENCE_DEVICE = 'Moto G';

/**
 * Runs per form factor. Odd, so the median is an observation rather than an average of
 * two — an average can sit between two runs at a value neither run produced, which is the
 * wrong thing to compare against a percentile.
 */
const RUNS_PER_PROFILE = 3;

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
};

/**
 * An environment or integrity refusal.
 *
 * Distinct from `BudgetError` because `--witness` must require the *budget* comparison to
 * fire and must not be satisfied by a Chrome that failed to start.
 */
class GateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GateError';
  }
}

/**
 * Refuse, by **throwing** rather than by exiting.
 *
 * `process.exit()` inside a `try` skips its `finally`, so an exiting `fail()` left the
 * launched Chrome running and the loopback server bound on every failure path — measured,
 * not theorised (F14: eight mutation runs left eight browsers behind). A gate whose
 * failure mode is leaking a browser gets run less often, which costs more than the
 * failure it reported.
 */
function fail(message: string): never {
  throw new GateError(message);
}

/**
 * A budget refusal, thrown so `--witness` can require one. Every other failure in this
 * file is an environment or integrity problem and throws a `GateError` instead — a
 * witness that swallowed those would be proving the wrong thing.
 */
class BudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetError';
  }
}

/** `--witness`: one desktop run against a threshold no render can satisfy. */
const WITNESS = process.argv.includes('--witness');

/**
 * Serve `dist/` over loopback.
 *
 * A static file server rather than a dependency, because the release tree is exactly
 * static files on a gateway (12 §5) and anything richer would measure a server this app
 * never has. Loopback also keeps the page a **secure context**, so the 12 §5.2 service
 * worker registers exactly as it does in production rather than being silently absent
 * from the measurement.
 */
function serveDist(): Promise<{ server: Server; origin: string }> {
  const server = createServer((request, response) => {
    const requested = new URL(request.url ?? '/', 'http://localhost');
    let relative = decodeURIComponent(requested.pathname);
    if (relative.endsWith('/')) relative += 'index.html';
    // Normalise, then strip any leading parent traversal: the tree is served read-only
    // and a request must not be able to reach outside it.
    const safe = normalize(relative).replace(/^(\.\.[/\\])+/, '');
    const file = join(DIST, safe);
    if (!file.startsWith(DIST) || !existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('not found');
      return;
    }
    response.writeHead(200, {
      'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
      // The release tree is content-addressed (12 §5.2), but this server is not the
      // gateway and a cached response between runs would make run 2 and run 3 measure
      // something run 1 did not.
      'cache-control': 'no-store',
    });
    response.end(readFileSync(file));
  });
  return new Promise((settle) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      settle({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

interface Profile {
  readonly label: string;
  readonly targetMs: number;
  readonly hardFailMs: number;
  readonly settings: Record<string, unknown>;
}

/**
 * Lighthouse's presets must still *be* the hardware §9.4 names.
 *
 * Reading the presets rather than transcribing them removes one failure — a copied number
 * drifting from upstream — and introduces its opposite: upstream moving the preset out
 * from under a document that names a device. Lighthouse has done exactly that before
 * (Moto G4 to Moto G Power). So the claim is verified per run, and an unrecognised preset
 * fails rather than being measured under the old label.
 */
function assertReferenceHardware(): void {
  const { screenEmulationMetrics, userAgents, throttling } = lighthouseConstants;
  if (!userAgents.mobile.toLowerCase().includes(MOBILE_REFERENCE_DEVICE.toLowerCase())) {
    fail(
      `Lighthouse's default mobile preset no longer emulates a ${MOBILE_REFERENCE_DEVICE}-class ` +
        `device — its user agent is now "${userAgents.mobile}". 10 §9.4 states its reference ` +
        'mobile hardware, and this gate claims the preset *is* that device. Re-derive the ' +
        'mobile budget against whatever upstream now ships, or pin the device here; do not ' +
        'keep reporting the old label over a new phone.',
    );
  }
  if (!screenEmulationMetrics.mobile.mobile || screenEmulationMetrics.desktop.mobile) {
    fail(
      "Lighthouse's screen-emulation presets no longer separate mobile from desktop " +
        `(mobile.mobile=${screenEmulationMetrics.mobile.mobile}, ` +
        `desktop.mobile=${screenEmulationMetrics.desktop.mobile}). §9.4 budgets two form ` +
        'factors and this gate would be running the same one twice.',
    );
  }
  // The desktop preset's own multiplier is 1 and this file overrides it, so the desktop
  // arm is covered by that override plus the per-run echo. The mobile arm is taken
  // unmodified, so its throttle is upstream's to change: an unthrottled run would echo
  // back exactly what was requested and pass, while measuring a phone nobody owns.
  if (throttling.mobileSlow4G.cpuSlowdownMultiplier <= 1) {
    fail(
      "Lighthouse's mobile preset now applies a CPU slowdown of " +
        `${throttling.mobileSlow4G.cpuSlowdownMultiplier}×. An unthrottled run is not a ` +
        `measurement of a ${MOBILE_REFERENCE_DEVICE}-class device whatever the user agent says, ` +
        'and the per-run echo cannot see this because it compares the run against this same ' +
        'preset.',
    );
  }
}

/**
 * The two §9.4 reference profiles, built from Lighthouse's own presets.
 *
 * Read from `lighthouse/core/config/constants.js` rather than transcribed. A transcribed
 * preset is a second home for a number that already has one, and it would keep reporting
 * "Moto G-class" long after the upstream preset moved.
 */
function profiles(): readonly Profile[] {
  assertReferenceHardware();
  const { screenEmulationMetrics, userAgents, throttling } = lighthouseConstants;
  return [
    {
      label: 'desktop',
      targetMs: DESKTOP_TARGET_MS,
      hardFailMs: DESKTOP_HARD_FAIL_MS,
      settings: {
        formFactor: 'desktop',
        screenEmulation: screenEmulationMetrics.desktop,
        emulatedUserAgent: userAgents.desktop,
        // §9.4's "mid-2023 laptop 4× throttle". The preset's own multiplier is 1; the
        // override is asserted back out of the report below, because a settings key a
        // future Lighthouse ignored would leave this reading "desktop preset" while
        // measuring an unthrottled machine.
        throttling: { ...throttling.desktopDense4G, cpuSlowdownMultiplier: DESKTOP_CPU_SLOWDOWN },
      },
    },
    {
      label: 'mobile',
      targetMs: MOBILE_TARGET_MS,
      hardFailMs: MOBILE_HARD_FAIL_MS,
      settings: {
        // Lighthouse's default preset already *is* §9.4's "Moto G-class Android":
        // Moto G Power (2022) emulation, its user agent, Slow 4G and 4× CPU. Taken
        // unmodified — an override here would be this file inventing a device.
        formFactor: 'mobile',
        screenEmulation: screenEmulationMetrics.mobile,
        emulatedUserAgent: userAgents.mobile,
        throttling: throttling.mobileSlow4G,
      },
    },
  ];
}

/** The `src` of the entry module `index.html` names, so a run can be proven to have loaded it. */
function entryChunk(): string {
  const html = join(DIST, 'index.html');
  if (!existsSync(html)) {
    fail(
      `${html} is missing; the build emitted no entry document, so there is no shell to render. ` +
        'Run `pnpm run release:build` first.',
    );
  }
  const match = /<script[^>]*type="module"[^>]*src="([^"]+)"/.exec(readFileSync(html, 'utf8'));
  if (match?.[1] === undefined) {
    fail(
      'dist/index.html declares no `<script type="module">` entry. Either the build changed ' +
        'shape — update this gate — or nothing is loaded, and a page that loads nothing paints ' +
        'instantly and passes every budget.',
    );
  }
  return match[1].replace(/^\.\//, '');
}

/** The median of an odd-length sample. */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted[(sorted.length - 1) / 2];
  if (middle === undefined) fail('no runs were recorded; the measurement produced nothing');
  return middle;
}

function numericAudit(
  audits: Record<string, { numericValue?: number } | undefined>,
  id: string,
  profile: string,
): number {
  const value = audits[id]?.numericValue;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    fail(
      `Lighthouse produced no numeric \`${id}\` for the ${profile} profile (got ` +
        `${JSON.stringify(value)}). An absent metric is an unmeasured render, never a fast one — ` +
        'this is how `first-meaningful-paint` would have passed while computing nothing.',
    );
  }
  return value;
}

async function main(): Promise<void> {
  if (!existsSync(DIST)) {
    fail(
      `no ${DIST} — run \`pnpm run release:build\` first. This gate measures the emitted tree, ` +
        'so an absent one is an unmeasured release, never a passing one.',
    );
  }
  const entry = entryChunk();

  const { server, origin } = await serveDist();
  const url = `${origin}/index.html`;

  let chrome: chromeLauncher.LaunchedChrome | undefined;
  try {
    try {
      // `--no-sandbox` because Ubuntu 24.04 confines unprivileged user namespaces and
      // the GitHub runner is already an isolated VM; `--disable-dev-shm-usage` because
      // a small `/dev/shm` in a container makes Chrome crash mid-trace, which would
      // present as flake rather than as the environment problem it is.
      const chromeFlags = [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
      ];
      // `chromePath` is omitted rather than set to `undefined`: under
      // `exactOptionalPropertyTypes` those are different things, and an explicit
      // `undefined` would be a path this file supplied rather than a search the launcher
      // performs over the runner's installed browsers.
      const chromePath = process.env['CHROME_PATH'];
      chrome = await chromeLauncher.launch(
        chromePath === undefined ? { chromeFlags } : { chromeFlags, chromePath },
      );
    } catch (error) {
      fail(
        `could not start Chrome: ${error instanceof Error ? error.message : String(error)}. ` +
          'This gate does not degrade to skipping — 10 §9.4 names Lighthouse as the enforcement ' +
          'for the shell render row, and a skipped measurement is an unenforced budget. Set ' +
          'CHROME_PATH, or install a Chrome the launcher can find.',
      );
    }

    // The witness needs exactly one refusal, so it runs one profile once. A full pass
    // would prove nothing more and would double the cost of the leg whose whole point is
    // that it is cheap enough to run every time.
    const selected = WITNESS ? profiles().slice(0, 1) : profiles();
    const runsPerProfile = WITNESS ? 1 : RUNS_PER_PROFILE;
    let refusals = 0;

    for (const profile of selected) {
      const samples: number[] = [];
      const lcpSamples: number[] = [];

      for (let run = 0; run < runsPerProfile; run += 1) {
        const result = await lighthouse(
          url,
          { port: chrome.port, output: 'json', logLevel: 'error' },
          {
            extends: 'lighthouse:default',
            settings: {
              ...profile.settings,
              onlyAudits: [
                'first-contentful-paint',
                'largest-contentful-paint',
                'network-requests',
              ],
            },
          },
        );
        if (result === undefined) {
          fail(`Lighthouse returned no result for the ${profile.label} profile, run ${run + 1}`);
        }
        const lhr = result.lhr;
        if (lhr.runtimeError !== undefined) {
          fail(
            `Lighthouse reported a runtime error on the ${profile.label} profile: ` +
              `${lhr.runtimeError.code} — ${lhr.runtimeError.message}`,
          );
        }

        // --- anti-vacuity: the run must have been on §9.4's reference hardware --------
        const used = lhr.configSettings;
        const requested = profile.settings['throttling'] as { cpuSlowdownMultiplier: number };
        if (used.throttling?.cpuSlowdownMultiplier !== requested.cpuSlowdownMultiplier) {
          fail(
            `the ${profile.label} run requested a CPU slowdown of ` +
              `${requested.cpuSlowdownMultiplier}× and Lighthouse reports ` +
              `${String(used.throttling?.cpuSlowdownMultiplier)}×. §9.4's budgets are stated for ` +
              'reference hardware, so an unthrottled run is not a fast result — it is a ' +
              'measurement of a different machine.',
          );
        }
        const emulation = profile.settings['screenEmulation'] as { width: number; mobile: boolean };
        if (
          used.screenEmulation?.width !== emulation.width ||
          used.screenEmulation?.mobile !== emulation.mobile ||
          used.screenEmulation?.disabled === true
        ) {
          fail(
            `the ${profile.label} run's screen emulation is not the one requested ` +
              `(${JSON.stringify(used.screenEmulation)}). §9.4 names the reference devices; a run ` +
              'at the host viewport is not a run on either of them.',
          );
        }

        // --- anti-vacuity: the run must have actually loaded the shell ---------------
        const requests = (lhr.audits['network-requests']?.details as
          | { items?: Array<{ url?: string; statusCode?: number }> }
          | undefined)?.items;
        if (requests === undefined || requests.length === 0) {
          fail(
            `the ${profile.label} run recorded no network requests. A page that fetched nothing ` +
              'paints instantly and passes every budget in this table.',
          );
        }
        const loadedEntry = requests.some(
          (item) => item.url?.endsWith(entry) === true && item.statusCode === 200,
        );
        if (!loadedEntry) {
          fail(
            `the ${profile.label} run never fetched the entry chunk \`${entry}\` with a 200. ` +
              'The shell was not measured, whatever number came back.',
          );
        }

        samples.push(numericAudit(lhr.audits, 'first-contentful-paint', profile.label));
        lcpSamples.push(numericAudit(lhr.audits, 'largest-contentful-paint', profile.label));
      }

      const fcp = median(samples);
      const lcp = median(lcpSamples);
      const ms = (n: number): string => `${(n / 1000).toFixed(2)} s`;
      // The witness compares the same measured median against a threshold nothing can
      // meet. A refusal therefore proves the comparison fires *on a real measurement* —
      // a gate that had stopped measuring would produce no number to refuse.
      const targetMs = WITNESS ? 1 : profile.targetMs;
      const hardFailMs = WITNESS ? 1 : profile.hardFailMs;
      console.log(
        `${profile.label}: FCP median ${ms(fcp)} over ${runsPerProfile} run(s) ` +
          `[${samples.map((s) => Math.round(s)).join(', ')} ms], LCP median ${ms(lcp)} ` +
          `(10 §9.4 target ${ms(profile.targetMs)}, hard fail ${ms(profile.hardFailMs)})`,
      );

      try {
        if (fcp > hardFailMs) {
          throw new BudgetError(
            `${profile.label} first meaningful render is ${ms(fcp)}, over 10 §9.4's ` +
              `${ms(hardFailMs)} p95 threshold by ${ms(fcp - hardFailMs)}. This is the wait ` +
              'before the client shows anything at all, on the hardware §9.4 names.',
          );
        }
      } catch (error) {
        if (!(error instanceof BudgetError)) throw error;
        if (!WITNESS) fail(error.message);
        refusals += 1;
        console.log(`witness fired: ${error.message.slice(0, 90)}…`);
      }
      if (!WITNESS && fcp > targetMs) {
        console.warn(
          `WARN ${profile.label} first meaningful render is ${ms(fcp)}, over 10 §9.4's ` +
            `${ms(targetMs)} p50 target by ${ms(fcp - targetMs)} and inside the ` +
            `${ms(profile.hardFailMs)} p95 threshold. The document permits this; it does not ` +
            'expect it to stay that way.',
        );
      }
    }

    if (WITNESS) {
      if (refusals === 0) {
        fail(
          'WITNESS DID NOT FIRE — the render budget accepted a measurement against a 1 ms ' +
            'threshold. A gate that can no longer refuse reports every release as inside budget, ' +
            'and no green run distinguishes that from a client that got fast.',
        );
      }
      console.log(`OK  ${refusals} witness case(s) fired; the render budget is live`);
      return;
    }
  } finally {
    if (chrome !== undefined) await chrome.kill();
    server.close();
  }

  console.log('OK  10 §9.4 first-meaningful-render, both reference profiles');
}

// Both refusal classes surface here rather than at the throw site, so every failure path
// passes through `main`'s `finally` and leaves no browser and no bound port behind.
try {
  await main();
} catch (error) {
  if (!(error instanceof GateError) && !(error instanceof BudgetError)) throw error;
  console.error(`FAIL ${error.message}`);
  process.exit(1);
}
