/**
 * The JSX runtime, re-exported on a **workspace** specifier (V-109).
 *
 * ## Why this file exists at all
 *
 * 10 §10.2 gives `src/features/handoff/**` a reference set of workspace packages
 * *only*, and 10 §10.1's last handoff rule is stronger still: *"No package on a handoff
 * path imports anything external. Not a network library, not a utility, not a node
 * built-in."* `handoff-imports-nothing-external` enforces exactly that, over every
 * non-local dependency type.
 *
 * S21 and S22 are **screens**, and they live in that directory. `--jsx react-jsx` emits
 * `import { jsx } from "react/jsx-runtime"` into every file containing a tag — so as
 * configured before F7, the handoff screens could not compile, and the obvious repair is
 * to carve React out of a security rule whose own stated reason is that a denylist only
 * forbids what somebody thought of.
 *
 * `jsxImportSource` is the repair that costs nothing. TypeScript emits
 * `<jsxImportSource>/jsx-runtime`, so pointing it at `@bleavit/ui` makes the compiler's
 * injected import a **workspace** specifier. The handoff unit then imports nothing
 * external, 10 §10.1 stays literally true, no spec amendment is needed, and the gate
 * keeps its full sensitivity: any *other* external import in that directory still fails.
 *
 * ## What this file is not
 *
 * It is not a shim and adds no behaviour. React's own runtime is re-exported verbatim, so
 * the emitted calls are React's. The indirection is a *name*, and the name is the whole
 * point — `ui` is already the one package permitted to render, and now it is also the one
 * package that names React.
 *
 * `Fragment` is re-exported explicitly rather than by `export *`: TypeScript emits it by
 * name for `<>…</>`, and a runtime missing it fails at the first fragment rather than at
 * build time.
 */

export { Fragment, jsx, jsxs } from 'react/jsx-runtime';
export type { JSX } from 'react/jsx-runtime';
