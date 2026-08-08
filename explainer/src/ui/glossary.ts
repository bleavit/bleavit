/**
 * Every word this app cannot avoid, defined once.
 *
 * The `Term` component has existed since the first build and was used exactly
 * zero times, which is the most expensive kind of dead code: the affordance for
 * explaining a word was there, and every scene went on assuming the word
 * instead. This module is the other half of it — the definitions themselves,
 * kept in one place so that a term cannot acquire two meanings in two scenes.
 * That is the "one thing, one name" rule applied to the *reader's* vocabulary
 * rather than to the protocol's.
 *
 * Rules for writing an entry, all of them learned from the ones that read badly
 * first:
 *
 *  1. **Define the thing, do not locate it.** "A collator is a computer that
 *     packages this chain's transactions into blocks" tells a reader what it is.
 *     "A collator is a node in the collator set" tells them nothing they can use.
 *  2. **No term may use another term undefined.** If a definition needs a second
 *     piece of jargon, either define that inline or pick different words. A
 *     glossary that chains is a glossary nobody finishes reading.
 *  3. **One or two sentences.** A definition that needs a paragraph is a scene.
 *  4. **Say the consequence where there is one.** "Its validators re-run every
 *     block Bleavit produces" is what makes "relay chain" matter; the rest is
 *     taxonomy.
 *
 * The definitions are deliberately *not* citations. A citation says where a fact
 * comes from; these say what a word means to somebody who has not read the
 * specification, which is a different job and the one this app is for.
 */

export interface GlossaryEntry {
  /** The word as it appears in prose. Lower case unless it is a proper noun. */
  readonly word: string;
  /** One or two plain sentences. No protocol nouns that are not themselves defined. */
  readonly definition: string;
}

/**
 * Keyed by the word itself, lower-cased, so a scene writes `<Jargon word="collator" />`
 * and cannot invent a private definition by accident.
 */
export const GLOSSARY: Readonly<Record<string, GlossaryEntry>> = Object.freeze({
  // --- Polkadot and the substrate -----------------------------------------
  parachain: {
    word: 'parachain',
    definition:
      'A blockchain that does not secure itself. It rents that from Polkadot, whose validators re-run each of its blocks and decide whether it really happened.',
  },
  'relay chain': {
    word: 'relay chain',
    definition:
      'Polkadot itself — the chain Bleavit rents security from. Its validators check every block Bleavit produces, so Bleavit cannot rewrite its own history without their agreement.',
  },
  collator: {
    word: 'collator',
    definition:
      'A computer that gathers this chain’s transactions and packages them into the next block. Collators cannot change the rules or forge results; if they all stopped, the chain would simply stop producing blocks.',
  },
  validator: {
    word: 'validator',
    definition:
      'A computer on Polkadot that re-runs a block a collator produced, to check the answer. Validators do not hold Bleavit’s data, which is why a block has to carry proof of everything it read.',
  },
  runtime: {
    word: 'runtime',
    definition:
      'The chain’s own program — the code that decides what every transaction does. Bleavit stores its runtime inside itself, so upgrading the chain means replacing a value in its own storage.',
  },
  pallet: {
    word: 'pallet',
    definition:
      'One module of the chain’s program, owning a slice of its storage and a set of the actions people can take. Bleavit is assembled from several dozen of them, most of them ordinary Polkadot parts.',
  },
  extrinsic: {
    word: 'extrinsic',
    definition:
      'A single instruction submitted to the chain from outside — what most systems would call a transaction.',
  },
  aura: {
    word: 'Aura',
    definition:
      'A turn-taking rule for producing blocks. Time is cut into equal slots, the authors are put in a fixed order, and each slot belongs to exactly one of them, so nobody races anybody.',
  },
  session: {
    word: 'session',
    definition:
      'The stretch of time an authoring roster is fixed for. At its end the list is recalculated: candidates come in, idle ones drop out, and the rotation restarts.',
  },
  finalized: {
    word: 'finalized',
    definition:
      'Settled for good. A recent block can still be replaced if the network reorganises; a finalized one cannot, short of the network agreeing to break its own rules.',
  },
  attestor: {
    word: 'attestor',
    definition:
      'One of a small elected group who sign that a proposed code change really is the code that was audited. They post their own deposit and lose it if they sign for the wrong thing.',
  },
  teleport: {
    word: 'teleport',
    definition:
      'Moving a token between chains by destroying it on one and re-creating it on the other, with nothing locked behind it. Whether that is safe depends entirely on trusting the chain that destroyed it.',
  },
  weight: {
    word: 'weight',
    definition:
      'A measured price tag on an action, in two currencies at once: how long it takes to run, and how much evidence it produces. A block is full when either one runs out.',
  },
  'proof size': {
    word: 'proof size',
    definition:
      'The bytes of evidence a block must carry so Polkadot’s validators can re-run it without holding this chain’s data. It is usually what fills a block first — before computation ever does.',
  },
  origin: {
    word: 'origin',
    definition:
      'The authority stamped on an action, saying on whose say-so it is being taken. It is not the same as who signed it, and there is no master origin that can do everything.',
  },
  preimage: {
    word: 'preimage',
    definition:
      'The actual bytes of a proposed action, stored separately from the proposal itself. A proposal commits to a fingerprint of them early, so what finally runs must be exactly what was traded on.',
  },
  wasm: {
    word: 'Wasm',
    definition:
      'The portable format the chain’s program is compiled into. It is what makes a runtime a file that can be handed around, checked, and swapped in.',
  },

  // --- Money and markets ---------------------------------------------------
  escrow: {
    word: 'escrow',
    definition:
      'Money the chain holds on someone’s behalf, released only when a stated condition settles. Nothing can be paid out of it that was not paid into it.',
  },
  usdc: {
    word: 'USDC',
    definition:
      'A dollar-denominated token this chain trades in. It is not issued here — it is issued on a neighbouring chain, and what Bleavit holds is a claim on that.',
  },
  vit: {
    word: 'VIT',
    definition:
      'Bleavit’s own token. It is used for bonds and stakes — money someone must put at risk to take on a role — rather than for trading.',
  },
  lmsr: {
    word: 'LMSR',
    definition:
      'The rule this chain uses to price a market with no other trader on the far side. It always quotes a price, and its cost rises the further you push it — which is what makes the price behave like a forecast.',
  },
  twap: {
    word: 'TWAP',
    definition:
      'A time-weighted average price: the price averaged over a window rather than read at a moment. Averaging is what stops a single trade at the closing bell from deciding an outcome.',
  },
  'conditional market': {
    word: 'conditional market',
    definition:
      'A market on what will happen *if* a decision goes one way. Running one for each way lets you compare two futures instead of guessing at one.',
  },
  bond: {
    word: 'bond',
    definition:
      'Money locked up as a promise to behave. It is returned when the promise is kept, and taken when it is not — so it prices bad behaviour rather than forbidding it.',
  },
  slash: {
    word: 'slash',
    definition:
      'To take some or all of a bond, because the person who posted it was shown to be wrong or to have abandoned their claim.',
  },
  nav: {
    word: 'NAV',
    definition:
      'What the treasury is worth, after subtracting everything it already owes. Several parts of the system refuse to act when it falls below a stated floor.',
  },

  // --- The mechanism -------------------------------------------------------
  futarchy: {
    word: 'futarchy',
    definition:
      'Deciding by betting rather than voting: people trade on what each option would lead to, and the option the market prices higher is the one that happens.',
  },
  epoch: {
    word: 'epoch',
    definition:
      'The chain’s repeating cycle, twenty-one days long. Every deadline in the system is a fixed fraction of it, so the whole calendar moves together if its length is ever changed.',
  },
  cohort: {
    word: 'cohort',
    definition:
      'All the proposals that were decided in the same epoch, measured together afterwards. They are settled as a group because the thing being measured is a whole period, not a single choice.',
  },
  keeper: {
    word: 'keeper',
    definition:
      'Anyone at all who submits the routine calls that move the system forward — closing a window, settling a cohort. They are paid a small fee, and nothing about the system depends on any particular one of them.',
  },
  quorum: {
    word: 'quorum',
    definition:
      'The smallest number of separate parties who must agree before something counts.',
  },
  timelock: {
    word: 'timelock',
    definition:
      'A compulsory wait between a decision passing and the decision taking effect, so that anyone who objects has time to act.',
  },

  // --- Between chains ------------------------------------------------------
  xcm: {
    word: 'XCM',
    definition:
      'The language chains in the Polkadot network use to send each other instructions. A message is a short program, and the receiving chain decides how much of it it is willing to run.',
  },
  'asset hub': {
    word: 'Asset Hub',
    definition:
      'The neighbouring Polkadot chain where USDC actually lives. Bleavit’s dollars sit locked there, and Bleavit holds the claim on them.',
  },
  'reserve transfer': {
    word: 'reserve transfer',
    definition:
      'Moving a token between chains by locking it where it is issued and crediting a claim on the chain it arrives at. The coin never really leaves home.',
  },
  hrmp: {
    word: 'HRMP',
    definition:
      'A message channel between two parachains, which both sides must agree to open. Without one, the two chains cannot speak at all.',
  },
  'light client': {
    word: 'light client',
    definition:
      'A program small enough to run in a browser that checks the chain’s answers mathematically instead of trusting a server. A dishonest server can refuse to answer it, but cannot lie to it.',
  },
  coretime: {
    word: 'coretime',
    definition:
      'The block-production time a parachain buys from Polkadot. It is rent, and a chain that stops paying it stops producing blocks.',
  },
  'sovereign account': {
    word: 'sovereign account',
    definition:
      'The account one chain holds on another, standing for the chain itself rather than for any person on it.',
  },
});

/** Every defined word, for the tests that keep this file honest. */
export const GLOSSARY_KEYS: readonly string[] = Object.freeze(Object.keys(GLOSSARY));

/**
 * Look up a definition, throwing on an unknown word.
 *
 * Fails loudly for the same reason `param()` does: a silent fallback would let a
 * scene ship a term that looks defined and explains nothing, which is worse than
 * not marking it at all.
 */
export function glossary(word: string): GlossaryEntry {
  const entry = GLOSSARY[word.toLowerCase()];
  if (entry === undefined) {
    throw new Error(
      `no glossary entry for "${word}" — add one to src/ui/glossary.ts rather than defining it inline`,
    );
  }
  return entry;
}
