// MUST FAIL: 10 §10.2 — the tx unit may not see the analysis unit.
import '@bleavit/features-analysis';
import { anything } from '@bleavit/features-analysis';
export const x = anything;
