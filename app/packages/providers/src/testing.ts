/**
 * Test-only surface for `providers` — the sampling rate, and the chain reader's contract.
 *
 * Two unlike things live here for one reason: neither belongs in a production bundle. The first
 * **must not ship**, for the reason below. The second, `checkBlockMovementRead`, simply has no
 * production use — it is the executable contract every `BlockMovementRead` must satisfy, so that
 * F23's chain reader inherits a test rather than a comment (10 §8.4; `block-movement-contract.ts`
 * states what it constrains and why the obligation had to arrive before its implementer). A
 * contract harness in the bundle is dead weight, and this quarantine and its dependency-cruiser
 * rule already exist.
 *
 * 10 §8.4 states *"1-in-16-page row re-verification"* normatively, and 14 TH-49's residual-risk
 * argument — *"sampling (~1 row per 16 pages) quantitatively verifies almost nothing at depth"* —
 * is computed from that number. A production entry point taking the rate as an argument is
 * therefore a control a caller can switch off by passing a number: at `pagesPerRow = 1e6` every
 * import forms one stratum, one row is compared, and every round still reports `clean`. Nothing
 * fails, and the sampler is off.
 *
 * The loosened form has to exist — the stratification logic is untestable at a single rate — so
 * it lives here instead, reachable only by a deliberate subpath import that
 * `no-loosened-sampling-rate-in-production` forbids production code from making. Same shape as
 * `@bleavit/local-index/testing` and `@bleavit/signing/testing`, and for the same reason: the
 * thing that must not ship is separated from the thing that must, and the separation is enforced
 * rather than intended.
 */

export { runSamplingRoundAtRate, selectSampleAtRate } from './sampling.js';
export { MAX_CONTRACT_SWEEP, checkBlockMovementRead } from './block-movement-contract.js';
export type { BlockMovementViolation, ReachableWindow } from './block-movement-contract.js';
