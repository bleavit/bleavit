/**
 * The `FE-HANDOFF-*` family, re-exported from its one home — 10 §13.3.
 *
 * It was declared here first, which was defensible while the parser was the only emitter
 * and stopped being defensible the moment `receipts` needed `FE-HANDOFF-013`: unable to
 * import the inbound parser across the §10.1 firewall, it wrote its own union and its own
 * sentence for the same code. The family now lives in `@bleavit/handoff-envelope`, which
 * every format can reach and which depends on nothing — the same reasoning that put
 * `ChainBinding` there.
 *
 * The re-export is deliberate rather than a compatibility shim. 10 §13.3's codes *are*
 * mostly the inbound admission checks, so a reader looking for them here is not lost, and
 * the parser's own modules import them from this file exactly as before. What changed is
 * that there is now one table, one copy per code, and one place a recovery can be wrong in.
 *
 * The two positional anchors that make the code assignment sound are worth keeping next
 * to the parser that emits them: `FE-HANDOFF-004` is named by app-code rule 11 as the
 * foreign-field refusal and `FE-HANDOFF-013` by 10 §13.1 as export-from-unverified-state,
 * and those sit at positions 4 and 13 of §13.3's own list of classes.
 */

export {
  RETIRED_CODES,
  REFUSAL_CODES,
  refuse,
  HandoffRefusalError,
  type HandoffRefusal,
  type HandoffRefusalCode,
} from '@bleavit/handoff-envelope';
