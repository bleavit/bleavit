// expect-error: TS2322 — 11 §11.2 constraint 3: a meaning-changing fact is not a renderable child
// MUST FAIL: `AboveTheFold` is deliberately an object rather than a `ReactNode`, so it
// cannot be passed as the children of a `Disclosure` — the type refuses before the runtime
// check in `AlwaysVisible` ever runs. The two are complements: this catches the direct
// form at compile time, and the context check catches the indirect form at render.
import type { AboveTheFold, ReactNode } from '@bleavit/ui';

declare const netPayout: AboveTheFold;
export const deferred: ReactNode = netPayout;
