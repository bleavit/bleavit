// Identity pins, release self-check, verification panel (INV-FE-8/11). F10.
export * from './identity.js';
export * from './self-check.js';
export * from './panel.js';
export * from './checkpoint-age.js';
// The F11 producer's document, read into the identity above (12 §1.1). Its own file
// because the join is where producer and consumer silently disagreed once already.
export * from './release-document.js';
// 12 §1.2's other half: the base TXID is observed from `location`, never pinned, because
// it addresses a manifest containing the document that would have to name it.
export * from './base-txid.js';
