// WITNESS MODULE — this file is SUPPOSED to violate a rule.
//
// Same idea as the TLA+ witness configs in `models/`: a checker that can no longer
// detect anything still reports success, so the suite must contain something it is
// required to catch. `signing -> providers` is a CI-fatal edge in 10 §10.1; if
// `pnpm run depcruise:witness` ever reports zero errors, the rule set has gone
// vacuous and every green production run above it means nothing.
import { anything } from '@bleavit/providers';
export const x = anything;
