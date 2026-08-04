// expect-error: TS2307 — the tx unit's package.json does not name the analysis unit, so the import cannot resolve (INV-FE-3)
// MUST FAIL: 10 §10.2 — the tx unit may not see the analysis unit.
import '@bleavit/features-analysis';
import { anything } from '@bleavit/features-analysis';
export const x = anything;
