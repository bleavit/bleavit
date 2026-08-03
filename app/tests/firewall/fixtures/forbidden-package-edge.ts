// MUST FAIL: `@bleavit/providers` is not a declared dependency of this package, so
// under pnpm's isolated node_modules it does not resolve. This is the 10 §10.1
// firewall as a module-resolution failure, not a lint opinion.
//
// Both forms are here deliberately. The side-effect form is the one TypeScript
// ignores unless `noUncheckedSideEffectImports` is set — which is exactly the hole
// this corpus found, and why that flag is in tsconfig.base.json.
import '@bleavit/providers';
import { anything } from '@bleavit/providers';
export const x = anything;
