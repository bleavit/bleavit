// expect-error: TS2353 — 11 §11.2: finalized decision statistics are not a trading preview
// MUST FAIL: the `pre-decision` arm of `ProposalView` has no field for statistics, so a
// caller holding a proposal that is still in Trade/Extended has nowhere to put a projected
// uplift. Verified rather than assumed: TypeScript narrows a discriminated union by its
// discriminant *before* excess-property checking, so a property belonging to the other
// member is rejected rather than tolerated.
import type { DecisionStats, ProposalView, ProposalSummary } from '@bleavit/features-tx';

declare const summary: ProposalSummary;
declare const stats: DecisionStats;
export const view: ProposalView = {
  stage: 'pre-decision',
  summary,
  reason: 'trading',
  decisionStats: stats,
};
