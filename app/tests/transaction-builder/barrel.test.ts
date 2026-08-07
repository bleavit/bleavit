/**
 * The `/testing` quarantine, asserted rather than commented — INV-FE-5, 10 §10.1. F9.
 *
 * `signing`'s barrel withholds `MockSigner` and its descriptor by having them in another file.
 * Three controls are named for that separation (the `exports` map, `no-mock-signer-outside-tests`
 * and `SignerRegistry.register`'s runtime refusal) and none of them sees a **re-export**: one line
 * in `signing/src/index.ts` puts a test-only signer in the production barrel, where the release
 * chunk scanner is the only thing left between it and a shipped build.
 *
 * It lives in this suite because `signing` has no suite of its own — `test:tx` is where its
 * boundary is exercised.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as barrel from '@bleavit/signing';
import * as testing from '@bleavit/signing/testing';

import { assertTestingSubpathIsQuarantined } from '../shared/testing-subpath.ts';

test('the mock signer is not reachable from the @bleavit/signing barrel', () => {
  assertTestingSubpathIsQuarantined(
    {
      packageName: '@bleavit/signing',
      barrel,
      testing,
      barrelMustExport: ['describeSigner', 'SignerRegistry'],
    },
    assert,
  );
});
