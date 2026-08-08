/**
 * The wrong-genesis terminal state — 10 §3.1 `WrongChain`; INV-FE-11. F27.
 *
 * 15 §2's verification column for INV-FE-11 names two obligations, *"e2e panel-vs-manifest
 * assertion; wrong-genesis terminal test"*, and this file is the second. It had none: the state
 * shipped with a screen, a handler and a production `.catch`, and nothing executed any of them.
 *
 * ## What is worth asserting here, and what is not
 *
 * The *decision* — that a genesis mismatch is terminal — is made in `chain-spec.ts` and proved
 * against a live chain by `zombienet/drills/14-client-boot.zndsl`, which corrupts one nibble of
 * the parachain pin and requires the refusal. Repeating that here would be a second statement of
 * the same fact in a weaker place.
 *
 * What only this layer can state is what happens **after** the refusal, and it is a sequence
 * rather than a value: the React root comes down, then the container is replaced, then the two
 * hashes are on screen. The order is the part that was wrong — `renderTerminalChainMismatch`
 * cleared a container a live root still owned, and React does not fail at the deletion. It fails
 * at its next render against that container, which is somewhere else entirely and in a state
 * whose entire purpose is that nothing else happens.
 *
 * The DOM here is a fake, and `TerminalHost` exists so that it can be one without a cast — this
 * workspace ships no DOM implementation, and `check:casts` bans `as unknown as` outright. The
 * claim that a real `Element` satisfies the same interface is checked by the compiler where it
 * matters, in `main.ts`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { WrongChainError } from '@bleavit/chain-client';
import {
  handleTerminalBootFailure,
  renderTerminalChainMismatch,
  startShell,
  terminalChainMismatch,
} from '@bleavit/application';
import type { HexString } from '@bleavit/shared-types';

const PINNED: HexString = `0x${'11'.repeat(32)}`;
const SYNCED: HexString = `0x${'22'.repeat(32)}`;

/** One node of the fake tree. Only what the terminal screen writes through. */
interface FakeElement {
  readonly tag: string;
  readonly attributes: Record<string, string>;
  readonly dataset: Record<string, string | undefined>;
  textContent: string | null;
  children: FakeElement[];
  setAttribute(name: string, value: string): void;
  append(...children: FakeElement[]): void;
}

/**
 * A container that records the order in which it was written to.
 *
 * The journal is shared with the unmount handle below, which is the whole point: an assertion
 * that both happened would pass on the defect, since the defect was never a missing call.
 */
function fakeHost(journal: string[]): FakeElement & {
  readonly ownerDocument: { createElement(tag: string): FakeElement };
  replaceChildren(): void;
} {
  const element = fakeElement('div');
  return Object.assign(element, {
    ownerDocument: { createElement: (tag: string): FakeElement => fakeElement(tag) },
    replaceChildren(): void {
      journal.push('replaceChildren');
      element.children = [];
    },
  });
}

function fakeElement(tag: string): FakeElement {
  const element: FakeElement = {
    tag,
    attributes: {},
    dataset: {},
    textContent: null,
    children: [],
    setAttribute(name: string, value: string): void {
      element.attributes[name] = value;
    },
    append(...children: FakeElement[]): void {
      element.children.push(...children);
    },
  };
  return element;
}

/** Every string the rendered tree carries, flattened. */
function textOf(element: FakeElement): string[] {
  const here = element.textContent === null ? [] : [element.textContent];
  return [...here, ...element.children.flatMap(textOf)];
}

test('the terminal state names FE-BOOT-003 and both hashes', () => {
  // The two hashes are the whole diagnosis: an operator comparing the release's pin against what
  // the client actually synced is the only person who can tell a misconfigured bootnode set from
  // a substituted chain spec.
  const state = terminalChainMismatch(new WrongChainError(PINNED, SYNCED));
  assert.equal(state.code, 'FE-BOOT-003');
  assert.equal(state.expected, PINNED);
  assert.equal(state.observed, SYNCED);
  assert.notEqual(state.expected, state.observed, 'the fixture compared a value with itself');
});

test('the tree is UNMOUNTED before the container is replaced', () => {
  // The order, not the pair. `replaceChildren()` under a live React root deletes DOM the root
  // still believes it owns, and React finds out at its next render against this container — so
  // an assertion that both calls happened would pass on exactly the defect this test exists for.
  const journal: string[] = [];
  const host = fakeHost(journal);
  renderTerminalChainMismatch(host, new WrongChainError(PINNED, SYNCED), () => {
    journal.push('unmount');
  });
  assert.deepEqual(journal, ['unmount', 'replaceChildren']);
});

test('the terminal screen renders with no unmount handle at all', () => {
  // `boot` can reject before it mounts anything, and then there is genuinely no tree to take
  // down. That path must still produce the screen rather than throwing on an absent handle.
  const journal: string[] = [];
  const host = fakeHost(journal);
  renderTerminalChainMismatch(host, new WrongChainError(PINNED, SYNCED));
  assert.deepEqual(journal, ['replaceChildren']);
  assert.equal(host.children.length, 1, 'nothing was rendered');
});

test('an unmount that THROWS still leaves the user the screen', () => {
  // There is no state left to protect and no later render to corrupt. Losing the one screen
  // that explains why the session stopped, because a teardown misbehaved, is the worse failure.
  const journal: string[] = [];
  const host = fakeHost(journal);
  renderTerminalChainMismatch(host, new WrongChainError(PINNED, SYNCED), () => {
    journal.push('unmount');
    throw new Error('the root was already unmounted');
  });
  assert.deepEqual(journal, ['unmount', 'replaceChildren']);
  assert.equal(host.children.length, 1, 'a throwing unmount cost the user the terminal screen');
});

test('the rendered screen carries the code, the role and both hashes', () => {
  const host = fakeHost([]);
  renderTerminalChainMismatch(host, new WrongChainError(PINNED, SYNCED));

  const section = host.children[0];
  assert.ok(section !== undefined, 'no section was appended');
  assert.equal(section.attributes['role'], 'alert', 'the terminal state is not announced');
  assert.equal(section.dataset['code'], 'FE-BOOT-003');

  const text = textOf(section).join('\n');
  assert.match(text, new RegExp(PINNED), 'the pinned genesis is not on screen');
  assert.match(text, new RegExp(SYNCED), 'the synced genesis is not on screen');
  assert.match(text, /not the Bleavit chain/);
});

/**
 * Anything a person could act on: a control tag, an interactive ARIA role, or an event
 * handler set as an attribute.
 *
 * The first version of this listed four tag names and checked them against a tree the
 * implementation builds only from `section`, `h1` and `p`. It could not fail without an
 * unrelated rewrite, and it passed on a clickable `div`, on a `section` carrying
 * `role="button"`, and on an `onclick` that reloads the page — every plausible way this
 * screen would actually grow an escape hatch. A test that cannot fail is the defect class
 * this milestone exists to find, so it is not one this file gets to contain.
 */
const INTERACTIVE_TAGS = new Set(['button', 'a', 'form', 'input', 'select', 'textarea', 'dialog']);
const INTERACTIVE_ROLES = new Set(['button', 'link', 'menuitem', 'tab', 'checkbox', 'switch']);

function escapeHatches(element: FakeElement): string[] {
  const found: string[] = [];
  if (INTERACTIVE_TAGS.has(element.tag)) found.push(`<${element.tag}>`);
  for (const [name, value] of Object.entries(element.attributes)) {
    if (name === 'role' && INTERACTIVE_ROLES.has(value)) found.push(`role="${value}"`);
    if (name.startsWith('on')) found.push(`${name}=`);
    if (name === 'href' || name === 'tabindex') found.push(`${name}=`);
  }
  return [...found, ...element.children.flatMap(escapeHatches)];
}

test('the screen offers no way to continue — §3.1 gives this state no outgoing edge', () => {
  // `WrongChain --> [*]`, and §4.1 restates it as "no override". A chain that is not Bleavit
  // answers every read consistently, so a retry or a dismiss would put another chain's figures
  // under these labels. Asserted on the rendered tree, because that is where a control would be.
  const host = fakeHost([]);
  renderTerminalChainMismatch(host, new WrongChainError(PINNED, SYNCED));
  assert.deepEqual(host.children.flatMap(escapeHatches), []);
});

test('the escape-hatch check fires — the witness for the case above', () => {
  // Without this, the assertion above is a function returning an empty array for reasons
  // nobody has checked. Three shapes, because each defeats a different lazy version of the
  // check: a tag list, a role-blind tag list, and one that never looks at attributes.
  const host = fakeHost([]);
  const clickable = host.ownerDocument.createElement('div');
  clickable.setAttribute('role', 'button');
  const handler = host.ownerDocument.createElement('div');
  handler.setAttribute('onclick', 'location.reload()');
  const link = host.ownerDocument.createElement('a');
  link.setAttribute('href', '#retry');
  host.append(clickable, handler, link);

  assert.deepEqual(host.children.flatMap(escapeHatches).sort(), [
    '<a>',
    'href=',
    'onclick=',
    'role="button"',
  ]);
});

test('a boot failure that is NOT a wrong chain is re-thrown', () => {
  // This handler gives one declared state a screen. 10 §3.2 routes the others — `WorkerFailed`,
  // `WasmFailed` and `StorageOpen` are non-terminal states with their own surfaces — so
  // swallowing them here would make this the place unrelated boot failures go quiet, which is
  // the failure mode the missing `.catch` had in the first place.
  const journal: string[] = [];
  const host = fakeHost(journal);
  const unrelated = new Error('the release worker could not be registered');
  assert.throws(() => handleTerminalBootFailure(host, unrelated), /release worker/);
  assert.deepEqual(journal, [], 'an unrelated failure tore the app down');
});

test('handleTerminalBootFailure forwards the unmount handle', () => {
  const journal: string[] = [];
  const host = fakeHost(journal);
  handleTerminalBootFailure(host, new WrongChainError(PINNED, SYNCED), () => {
    journal.push('unmount');
  });
  assert.deepEqual(journal, ['unmount', 'replaceChildren']);
});

/**
 * The plumbing, which is what actually broke.
 *
 * Every case above passes on the original defect — a `boot` that drops the handle and a caller
 * that forwards nothing — because none of them reaches the code that carries one to the other.
 * That code used to live in `main.ts`, which reads `document` at module scope and therefore
 * cannot be imported at all. `startShell` exists so this can be asserted rather than reasoned
 * about; its collaborators are injected, so no DOM and no light client are involved.
 */
test('a wrong chain from connect reaches the terminal screen WITH boot mount handle', async () => {
  const journal: string[] = [];
  const host = fakeHost(journal);
  const error = new WrongChainError(PINNED, SYNCED);
  const seen: {
    container?: unknown;
    error?: unknown;
    // `| undefined` spelled out: `exactOptionalPropertyTypes` is on, and *absent* and
    // *present and undefined* are different facts here — the second is what a boot that
    // never mounted forwards, and it is the case the test below asserts.
    unmount?: (() => void) | undefined;
  } = {};

  await startShell(host, {
    mount: async () => ({
      worker: { kind: 'unavailable' as const, reason: 'no service worker in this suite' },
      unmount: () => journal.push('unmount'),
    }),
    connect: () => Promise.reject(error),
    onFailure: (container, failure, unmount) => {
      seen.container = container;
      seen.error = failure;
      seen.unmount = unmount;
    },
  });

  assert.equal(seen.error, error, 'the terminal handler did not receive the wrong-chain error');
  assert.equal(seen.container, host, 'the terminal handler was given a different container');
  assert.ok(seen.unmount !== undefined, 'the mount handle was dropped between boot and the catch');
  seen.unmount();
  assert.deepEqual(journal, ['unmount'], 'the handle forwarded was not the one boot returned');
});

test('a mount that rejects reaches the handler with NO handle', async () => {
  // Nothing was mounted, so there is nothing to take down, and `undefined` is the honest
  // answer rather than a missing case. `boot` enforces this by unmounting on its own post-mount
  // failure — the property is structural there rather than asserted here.
  const host = fakeHost([]);
  const failure = new Error('IndexedDB refused to open');
  let handle: (() => void) | undefined | 'not called' = 'not called';

  await startShell(host, {
    mount: () => Promise.reject(failure),
    connect: () => Promise.resolve(),
    onFailure: (_container, _error, unmount) => {
      handle = unmount;
    },
  });

  assert.equal(handle, undefined, 'a handle was invented for a boot that never mounted');
});

test('startShell does not swallow what the handler re-throws', async () => {
  // `handleTerminalBootFailure` re-throws anything that is not a wrong chain, so that this
  // stays one declared state's screen rather than where boot failures go quiet. A `startShell`
  // that caught its own handler would undo exactly that.
  const host = fakeHost([]);
  await assert.rejects(
    startShell(host, {
      mount: async () => ({
        worker: { kind: 'unavailable' as const, reason: 'no service worker in this suite' },
        unmount: () => {},
      }),
      connect: () => Promise.reject(new Error('the release worker could not be registered')),
      onFailure: handleTerminalBootFailure,
    }),
    /release worker/,
  );
});
