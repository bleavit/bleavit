/**
 * Which chain this release's local index belongs to — 10 §7, §3.1. F25, moved here by F14.
 *
 * A leaf module holding one type, and the reason it is one is structural rather than tidy.
 * `index-boot.ts` opens the index for this identity and `index-quota.ts` scopes §4.4's writer
 * lock to it, so both need the type; when it lived in `index-boot.ts` the three modules formed a
 * cycle — boot → disclosure (for the boot state) → quota (for the retention outcome) → boot.
 * `tsc` accepts that, because every edge is type-only and erases; `depcruise`'s `no-circular`
 * does not, and it is right not to. A cycle among type-only edges is still a cycle the day one
 * of them stops being type-only, and that day arrives without a compile error to announce it.
 */

/**
 * What this release knows about the chain whose index is being opened.
 *
 * A union rather than `string | undefined`, because the absent case has to carry **why**: a
 * disclosure that says *no local history this session* with no reason is the silent state
 * 10 §3.1's `MemoryOnly` label and 11 E9's *"a stated reason — never a silent one"* both forbid.
 */
export type IndexChainIdentity =
  | { readonly kind: 'pinned'; readonly paraGenesisHash: string }
  | { readonly kind: 'unpinned'; readonly reason: string };
