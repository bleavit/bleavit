/**
 * The terminal state for `FE-BOOT-003` — 10 §3.1; INV-FE-11. F27.
 *
 * §3.1's machine has exactly one arrow out of `WrongChain`, and it goes to `[*]`: *"mismatch
 * (FE-BOOT-003, terminal)"*, and §4.1 restates it as *"`WrongChain` on mismatch, no override"*.
 * INV-FE-11 makes the same statement from the invariant side — *"verifies the chain identity at
 * boot (genesis mismatch is terminal)"* — and 15 §2's verification column names a
 * **wrong-genesis terminal test** as the obligation.
 *
 * **Until F27 nothing implemented any of it, and the reason is worth keeping.** The class, the
 * throw and `chain-session.ts`'s `instanceof WrongChainError` branch all existed; what did not
 * exist was any path by which the error left `startLightClient`, because PAPI retries its chain
 * factory forever (SQ-1026). Fixing that turned an infinite retry into an **unhandled promise
 * rejection**: `main.ts` was `void boot(mount).then(connectAndClassify)` with no `.catch`, so a
 * wrong chain became a console error while the shell kept rendering — which is worse than the
 * retry it replaced, because the app looks fine.
 *
 * So the repair has two halves and this is the second. It is latent today only because
 * `releaseChainSpecs()` is `unpinned`, and *"latent"* is exactly the state that ships.
 *
 * ## Why this replaces the tree rather than adding a banner
 *
 * A banner is an override. §3.1 gives this state no outgoing edge for a reason `chain-spec.ts`
 * states plainly: *"a chain that is not Bleavit can answer every read consistently, so there is
 * nothing further to verify against"*. Every other surface — the dashboard, the verification
 * panel, the handoff export — would be describing a chain the client cannot identify, so
 * leaving them mounted beside a warning invites exactly the *"log it and carry on"* the boolean
 * return was refused for.
 *
 * The two hashes are shown because they are the whole diagnosis: an operator comparing the
 * release's pin against what the client actually synced is the only person who can tell a
 * misconfigured bootnode set from a substituted chain spec.
 */

import { WrongChainError } from '@bleavit/chain-client';

/** What the terminal screen says. Extracted so a test asserts the text, not the DOM. */
export interface TerminalChainMismatch {
  readonly code: 'FE-BOOT-003';
  readonly heading: string;
  readonly detail: string;
  readonly expected: string;
  readonly observed: string;
}

/**
 * The DOM this screen writes through, described structurally rather than imported.
 *
 * Same reason `topology.ts` describes smoldot structurally instead of importing it: what can be
 * got wrong here is an **order** — tear the React root down, *then* replace the children — and
 * an order is worth checking without a DOM implementation. This workspace carries none, and
 * `check:casts` bans outright the `as unknown as` that a fake `Element` would otherwise need,
 * so a wide parameter type would have left the ordering permanently untested.
 *
 * The claim that a real `Element` satisfies this is proved by the compiler at the site that
 * matters: `main.ts` passes `document.getElementById('app')`. Nothing here asserts it in prose.
 */
export interface TerminalHost {
  readonly ownerDocument: { createElement(tag: string): TerminalElement };
  replaceChildren(): void;
  append(child: unknown): void;
}

/** One element of the terminal screen. See {@link TerminalHost} for why this is structural. */
export interface TerminalElement {
  textContent: string | null;
  readonly dataset: Record<string, string | undefined>;
  setAttribute(name: string, value: string): void;
  append(...children: unknown[]): void;
}

export function terminalChainMismatch(error: WrongChainError): TerminalChainMismatch {
  return {
    code: 'FE-BOOT-003',
    heading: 'This is not the Bleavit chain',
    detail:
      'The light client synced a chain whose genesis does not match the one this release ' +
      'pins. Nothing further can be verified against it, so this session has stopped. This ' +
      'is not something to retry: a chain that is not Bleavit answers every read ' +
      'consistently, and continuing would show you another chain’s figures under these ' +
      'labels. Load a release that pins the chain you meant to reach.',
    expected: error.expected,
    observed: error.observed,
  };
}

/**
 * Replace the mounted tree with the terminal screen.
 *
 * Written against `Element` and plain DOM rather than the render layer, because it must work
 * when the render layer is part of what failed — and because it is called from `main.ts`,
 * whose whole rule is that it holds no logic.
 *
 * **`unmount` is not optional politeness.** `replaceChildren()` deletes the DOM a React root
 * still owns, and React finds out at its next render against this container rather than at the
 * deletion — so the failure surfaces somewhere else entirely, in a state whose whole purpose is
 * that nothing further happens. Tearing the root down first makes the replacement the last
 * thing that touches this element, which is what *terminal* has to mean in the DOM and not
 * only in the state machine. It is optional in the **type** because `boot` can reject before
 * it mounts anything, and then there is genuinely no tree to take down.
 */
export function renderTerminalChainMismatch(
  container: TerminalHost,
  error: WrongChainError,
  unmount?: () => void,
): void {
  const state = terminalChainMismatch(error);
  // Before `replaceChildren`, and guarded: an unmount that throws must not cost the user the
  // one screen that explains why the session stopped. React's own `unmount` already empties
  // the container, so the call below is what makes this correct for a container it never held.
  if (unmount !== undefined) {
    try {
      unmount();
    } catch {
      // Deliberately swallowed. There is no state left to protect and no later render to
      // corrupt — this is the last thing the client does.
    }
  }
  container.replaceChildren();

  const section = container.ownerDocument.createElement('section');
  section.setAttribute('role', 'alert');
  section.dataset['code'] = state.code;

  const heading = container.ownerDocument.createElement('h1');
  heading.textContent = state.heading;
  const detail = container.ownerDocument.createElement('p');
  detail.textContent = state.detail;
  const pinned = container.ownerDocument.createElement('p');
  pinned.textContent = `This release pins ${state.expected}`;
  const synced = container.ownerDocument.createElement('p');
  synced.textContent = `The light client synced ${state.observed}`;

  section.append(heading, detail, pinned, synced);
  container.append(section);
}

/**
 * The boot chain's terminal handler.
 *
 * Re-throws anything that is **not** a wrong chain, because this handler exists to give one
 * declared state a screen and not to become the place unrelated boot failures go quiet. 10
 * §3.2 already routes the others: `WorkerFailed`, `WasmFailed` and `StorageOpen` are
 * non-terminal states with their own renderable surfaces, and a `not-started` session is a
 * value rather than a throw.
 */
export function handleTerminalBootFailure(
  container: TerminalHost,
  error: unknown,
  unmount?: () => void,
): void {
  if (!(error instanceof WrongChainError)) throw error;
  renderTerminalChainMismatch(container, error, unmount);
}
