/**
 * The two outbound domain-separation tags, bound to the shared envelope — 10 §13.1.
 *
 * `canonicalJson` and `digestPreimage` moved to `@bleavit/handoff-envelope` when the
 * inbound parser needed them: 10 §13.1 states the envelope conventions once, for all
 * three formats, and a second copy of the pre-image construction would be a second answer
 * to the one question that must have exactly one — *which bytes are hashed*. They are
 * re-exported here so this package's consumers keep a single import site, and because the
 * "nothing that could pass for authentication" scan over this package's exports must
 * still see them.
 *
 * The tags themselves stay with their formats. A tag is not a shared convention; it is
 * the name of one document type, and putting all three in the shared package would let a
 * format import a tag it has no business emitting.
 */

export { canonicalJson, digestPreimage } from '@bleavit/handoff-envelope';

export const CONTEXT_DOMAIN_TAG = 'bleavit.context.v1';
export const RECEIPT_DOMAIN_TAG = 'bleavit.receipt.v1';
