/**
 * The probe's structural types, bound to PAPI's real ones — F4's last item.
 *
 * `packages/descriptors` names no PAPI type on purpose: it keeps the chain SDK out of a
 * package that must stay exercisable without one, and 10 §10.1 gives `chain-client` the
 * sole right to import `polkadot-api` anyway. `probe.ts` says what that costs:
 *
 * > What that leaves unproven is that these shapes still match PAPI's … There is no
 * > equivalent here yet, because nothing constructs a `TypedApi` until F6 wires
 * > `createClient`.
 *
 * **That premise was wrong, and it is why this sat open.** Assignability is a *compile-time*
 * relation: nothing has to be constructed, and no client has to exist. `TypedApi<typeof
 * bleavit>` is a type, `getStaticApis()`'s return type is a type, and `compat` is a property
 * of it. The whole binding is reachable without a chain, a node, or a running client — the
 * same way `light-client.ts` binds smoldot's shapes with `asTopologyClient`.
 *
 * The ruling `light-client.ts` already records stands unchanged and is the reason
 * `createClient` is still absent from the read layer: introducing it there *"would place
 * metadata compatibility underneath the read layer, where 10 §5.2's classifier cannot see
 * it — the app would fail to construct a client instead of booting into
 * `ReadOnlyIncompatible` and telling the user why."* This file needed none of that.
 *
 * ## Direction, and why only one of them is the useful one
 *
 * The probe **consumes** what PAPI produces, so the binding that matters is
 * `Real → Structural`: every value PAPI hands over must satisfy the shape the probe reads.
 * The reverse would be a claim the probe can *construct* a PAPI compat object, which it
 * neither does nor should.
 *
 * ## The subtlety this pins, which is easy to undo
 *
 * `CompatHelperLike.isCompatible` is declared with **method syntax**. PAPI declares its own
 * as a *property* with a function type over the `CompatibilityLevel` enum. Method syntax is
 * bivariant in its parameters, so `(from?: CompatibilityLevel) => boolean` is assignable to
 * `isCompatible(from?: number): boolean`; rewriting the probe's declaration as a property
 * would make `strictFunctionTypes` apply and the assignment would stop compiling. That is a
 * refactor somebody would make for consistency, and this file is what tells them not to.
 *
 * This module is types only and emits nothing at runtime. It is compiled by
 * `compat.test.js`, which requires it to succeed — a positive control, so a toolchain that
 * cannot compile anything reports failure rather than silent agreement.
 */

import type { TypedApi } from 'polkadot-api';
// The generated package calls itself `@polkadot-api/descriptors` — PAPI writes that name
// as a string literal, which is also why one workspace can hold exactly one descriptor
// package (V-107).
import type { bleavit } from '@polkadot-api/descriptors';
import type {
  AnyCompatHelper,
  CompatHelperLike,
  CompatSurface,
} from '@bleavit/descriptors';

/** `(await api.getStaticApis()).compat`, as PAPI really types it for this chain. */
export type RealCompat = Awaited<ReturnType<TypedApi<typeof bleavit>['getStaticApis']>>['compat'];

/**
 * The binding. If PAPI 2.x reshapes its compat surface, this stops compiling.
 *
 * A function rather than a `satisfies`, so the failure names both sides in the error.
 */
export function asCompatSurface(real: RealCompat): CompatSurface {
  return real;
}

/**
 * Every helper in a group, as one union.
 *
 * PAPI's compat groups are **mapped types keyed by the real pallet and member names**, not
 * index signatures, so `RealCompat['constants'][string][string]` does not typecheck at all
 * (`TS2537`). The union over every member is a stronger binding than naming one pallet: a
 * single member whose shape diverges breaks the assignment, and no member can be missed by
 * picking the wrong example.
 *
 * **Written as a mapped type, and the obvious spelling is a trap.**
 * `Group[keyof Group][keyof Group[keyof Group]]` looks equivalent and is not: the inner
 * `keyof` is taken across the *union* of pallet objects, which yields only the keys they
 * have in common — and pallets share no member names, so it is `never`. Indexing by `never`
 * gives `never`, **`never` is assignable to everything**, and the whole binding compiles
 * while comparing nothing at all.
 *
 * That version was written and shipped-in-progress here. It was caught by the witness in
 * `papi-shapes-witness.ts`, which is the entire reason a positive control needs a negative
 * one beside it: "it compiled" was equally consistent with "the shapes match" and with
 * "the type collapsed to `never`". The mapped form below computes `keyof Group[P]` **per
 * pallet**, then unions the results, which is the type that was meant.
 */
export type EveryMemberOf<Group> = { [P in keyof Group]: Group[P][keyof Group[P]] }[keyof Group];

/** The two helper shapes individually, so a break points at the group that moved. */
export function asCompatHelper(real: EveryMemberOf<RealCompat['constants']>): CompatHelperLike {
  return real;
}

export function asAnyCompatHelper(real: EveryMemberOf<RealCompat['query']>): AnyCompatHelper {
  return real;
}
