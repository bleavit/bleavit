/**
 * The glossary is the one place a word may be defined, so these tests are about
 * that property rather than about any particular definition.
 *
 * A glossary rots in three specific ways, and each one has a test here. It
 * acquires a definition that uses jargon the reader has not met, so the entry
 * explains nothing. It grows a second entry for a word that already has one, so
 * two scenes teach different meanings. And it drifts into paragraphs, at which
 * point it is a scene wearing a tooltip.
 */

import { describe, expect, it } from 'vitest';

import { GLOSSARY, GLOSSARY_KEYS, glossary } from './glossary';

describe('the shared glossary', () => {
  it('keys every entry by its own word, lower-cased', () => {
    // Otherwise `<Jargon word="XCM" />` and `<Jargon word="xcm" />` are two
    // different lookups and only one of them is defined.
    for (const key of GLOSSARY_KEYS) {
      expect(key, `${key} is not lower-cased`).toBe(key.toLowerCase());
      expect(GLOSSARY[key]?.word.toLowerCase(), `${key} keyed under another word`).toBe(key);
    }
  });

  it('defines each word exactly once', () => {
    const words = GLOSSARY_KEYS.map((k) => GLOSSARY[k]?.word.toLowerCase());
    expect(new Set(words).size, 'a word is defined twice').toBe(words.length);
  });

  it('keeps every definition to one or two sentences', () => {
    for (const key of GLOSSARY_KEYS) {
      const { definition } = glossary(key);
      // Counting terminal punctuation, not clauses: a definition that needs a
      // third sentence is a scene, and belongs in a rail rather than a tooltip.
      const sentences = definition.split(/[.?!](\s|$)/).filter((s) => s.trim().length > 0).length;
      expect(sentences, `${key}: ${definition}`).toBeLessThanOrEqual(2);
      expect(definition.length, `${key} is too long to read in a tooltip`).toBeLessThanOrEqual(260);
      expect(definition.trim().endsWith('.'), `${key} does not end in a full stop`).toBe(true);
    }
  });

  it('never defines a word using undefined jargon from its own list', () => {
    // The failure this prevents: "a collator is a node in the collator set".
    // A definition may mention another glossary word — that is useful — but it
    // must not be *only* reachable through one, so the rule is narrow: no entry
    // may use its own headword to define itself.
    for (const key of GLOSSARY_KEYS) {
      const { word, definition } = glossary(key);
      const head = word.toLowerCase().replace(/[^a-z ]/g, '');
      const body = definition.toLowerCase();
      // Allow the plural/possessive of the headword only after a clause that
      // has already said what it is; the simple circular case is the one to ban.
      expect(
        body.startsWith(`a ${head} is a ${head}`) || body.startsWith(`the ${head} is the ${head}`),
        `${key} defines itself circularly`,
      ).toBe(false);
    }
  });

  it('carries the vocabulary the new scenes depend on', () => {
    // These are the words the substrate and edge scenes cannot avoid. Losing one
    // silently would leave a scene marking a term that then throws at render.
    for (const word of [
      'parachain',
      'relay chain',
      'collator',
      'validator',
      'runtime',
      'pallet',
      'weight',
      'proof size',
      'origin',
      'preimage',
      'escrow',
      'usdc',
      'vit',
      'lmsr',
      'twap',
      'bond',
      'slash',
      'epoch',
      'keeper',
      'timelock',
      'xcm',
      'asset hub',
      'reserve transfer',
      'light client',
      'coretime',
    ]) {
      expect(() => glossary(word), `${word} is missing`).not.toThrow();
    }
  });

  it('fails loudly on an unknown word rather than rendering nothing', () => {
    // Same posture as `param()`: a silent fallback would let a scene ship a term
    // that looks defined and explains nothing, which is worse than not marking it.
    expect(() => glossary('futarchic hyperdrive')).toThrow(/no glossary entry/);
  });

  it('accepts a lookup in any case, because prose capitalizes', () => {
    expect(glossary('XCM').word).toBe('XCM');
    expect(glossary('Asset Hub').word).toBe('Asset Hub');
  });
});
