/**
 * The application entry — F11's half of it.
 *
 * F11 owns the *document and the distribution pipeline*: the entry Vite builds, the CSP
 * the release emits, the service worker, the manifest. The shell that renders inside it —
 * `app/src/{components, routes, styles}` and the S1/S2 screens — is F7's, and this file is
 * deliberately the smallest thing that proves the pipeline end to end rather than a
 * placeholder UI that F7 would have to unpick.
 */

import { registerReleaseWorker, type WorkerStatus } from './release-worker.js';

function describe(status: WorkerStatus): string {
  switch (status.kind) {
    case 'active':
      return status.waitingUpdate
        ? 'release worker active; a newer release is waiting and will not take over until you say so'
        : 'release worker active';
    case 'unavailable':
      return `release worker unavailable — ${status.reason}`;
    case 'failed':
      return `release worker failed to register — ${status.reason}`;
  }
}

export async function boot(mount: HTMLElement): Promise<WorkerStatus> {
  const status = await registerReleaseWorker();
  // `textContent`, never `innerHTML`: `script-src 'self'` already refuses injected script,
  // but the habit is the control here — the shell F7 builds on top inherits it.
  mount.textContent = describe(status);
  return status;
}

const mount = document.getElementById('app');
if (mount) void boot(mount);
