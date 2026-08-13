/**
 * Test-only access to the pure gate evaluator.
 *
 * Production code must obtain a gate outcome from the two-argument `refreshAndGate` boundary.
 * This subpath exists only so structural machine and signer tests can exercise a successful
 * window before the closed metadata-derived evaluator is implemented. The package root omits it,
 * and dependency-cruiser forbids `@bleavit/transaction-builder/testing` from `src/` or any
 * production package.
 */

export {
  gateEvaluatedForTesting as gateForTest,
  txTransitionEdges,
} from './machine.js';
