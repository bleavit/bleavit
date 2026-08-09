/**
 * The two transports behind `verify-release compare` — 12 §1.3 (F13).
 *
 * `compare.ts` never fetches. It takes a `GatewayGet` and this file supplies two of them:
 *
 * - `transcriptGateway`, which answers from a recorded transcript and **refuses an
 *   unrecorded URL**. This is the one the suite drives, so the fetch loop, the byte
 *   comparison, the divergence check and the verdict all execute per commit with no network.
 * - `liveGateway`, which is the single function in this milestone that no suite executes.
 *   It is four lines, it contains no decision, and it is named here so the honest sentence
 *   about `compare` is *"the live call is unexercised"* rather than *"compare does not exist"*.
 *
 * ## Refusing an unrecorded URL is the whole point
 *
 * `packages/mock-runtime` states the rule this file follows: a double that answers everything
 * turns a missing request into a passing test. A transcript that returned empty bytes for an
 * unknown URL would let a fetch loop with a broken template hash 200 identical empty bodies
 * and report a whole release of files as *changed* — or, with an empty signed map, as verified.
 *
 * ## The transcript is constructed, not recorded, and that is stated rather than implied
 *
 * Every other transcript corpus in this repository was recorded from a running system.
 * This one cannot be. 12 §1.2 carries an unresolved `[VERIFY]` against live gateway behaviour
 * (prototype gate FE-P7), and 12 §4.2 records that the naming platform moved from AO to
 * Solana, so the resolver and manifest behaviour must be re-asked rather than carried over.
 * Recording a session would mean asserting the answer to an open `[VERIFY]`, which R-2 forbids.
 *
 * What the fixture therefore is: a transcript whose URLs are produced by the *configured*
 * templates and whose bodies are bytes the fixture itself defines. That is enough to execute
 * every decision in `compare.ts`, and it deliberately claims nothing about what an ar.io
 * gateway answers. See `app/fixtures/gateway-transcript/README.md`.
 */

import { readFileSync } from 'node:fs';

import type { Gateway, GatewayGet, GatewayResponse } from './compare.ts';
import { gatewayIdentityProblems } from './compare.ts';

export const TRANSCRIPT_SCHEMA = 'bleavit.gateway-transcript.v1';

export class TranscriptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TranscriptError';
  }
}

/** An unrecorded URL. Its own error type, because it is a fixture gap and not a gateway fault. */
export class UnrecordedUrlError extends TranscriptError {
  constructor(url: string) {
    super(
      `the transcript records no response for ${url}. Refusing rather than answering, because ` +
        'a double that answers everything turns a missing request into a passing verdict.',
    );
    this.name = 'UnrecordedUrlError';
  }
}

export interface Transcript {
  readonly gateways: readonly Gateway[];
  readonly responses: ReadonlyMap<string, GatewayResponse>;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(source: Readonly<Record<string, unknown>>, key: string, where: string): string {
  const value = source[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new TranscriptError(`${where} has no ${key}`);
  }
  return value;
}

/**
 * Parse a transcript document.
 *
 * Every shape that would make the replay silently weaker is refused: no gateways, no
 * responses, a response with neither body or with both, and a duplicated URL. The last one
 * matters most — two entries for one URL means the replay depends on load order, which is
 * the conflict rule `packages/mock-runtime` had to add for the same reason.
 */
export function parseTranscript(document: unknown): Transcript {
  if (!isRecord(document) || document['schema'] !== TRANSCRIPT_SCHEMA) {
    throw new TranscriptError(`a gateway transcript declares schema ${TRANSCRIPT_SCHEMA}`);
  }
  const rawGateways = document['gateways'];
  if (!Array.isArray(rawGateways) || rawGateways.length === 0) {
    throw new TranscriptError('a gateway transcript names no gateways');
  }
  const gateways: Gateway[] = [];
  for (const [index, raw] of rawGateways.entries()) {
    const where = `gateways[${index}]`;
    if (!isRecord(raw)) throw new TranscriptError(`${where} is not an object`);
    gateways.push({
      name: readString(raw, 'name', where),
      rawUrl: readString(raw, 'rawUrl', where),
      txUrl: readString(raw, 'txUrl', where),
    });
  }
  // Two gateways under one name — or, which the name check alone never saw, two names over one
  // endpoint — make the divergence check compare a gateway with itself and report agreement,
  // which is the shape of every vacuous check in this repository. The rule is
  // `compare.ts`'s, shared with the `--gateways` configuration rather than restated, so a
  // fixture cannot be admissible where an operator's file is not.
  const problems = gatewayIdentityProblems(gateways, 'the transcript: ');
  if (problems.length > 0) throw new TranscriptError(problems.join('\n'));

  const rawResponses = document['responses'];
  if (!isRecord(rawResponses) || Object.keys(rawResponses).length === 0) {
    throw new TranscriptError('a gateway transcript records no responses');
  }
  const responses = new Map<string, GatewayResponse>();
  for (const [url, raw] of Object.entries(rawResponses)) {
    if (!isRecord(raw)) throw new TranscriptError(`responses[${url}] is not an object`);
    const status = raw['status'];
    if (typeof status !== 'number' || !Number.isInteger(status)) {
      throw new TranscriptError(`responses[${url}] has no integer status`);
    }
    const utf8 = raw['body_utf8'];
    const base64 = raw['body_base64'];
    if ((utf8 === undefined) === (base64 === undefined)) {
      throw new TranscriptError(
        `responses[${url}] must carry exactly one of body_utf8 or body_base64`,
      );
    }
    const body =
      typeof utf8 === 'string'
        ? new Uint8Array(Buffer.from(utf8, 'utf8'))
        : typeof base64 === 'string'
          ? new Uint8Array(Buffer.from(base64, 'base64'))
          : undefined;
    if (body === undefined) throw new TranscriptError(`responses[${url}] body is not a string`);
    responses.set(url, { status, body });
  }
  return { gateways, responses };
}

/** Read a transcript in place. The path is the caller's, so a suite can point at a fixture. */
export function readTranscript(path: string): Transcript {
  return parseTranscript(JSON.parse(readFileSync(path, 'utf8')));
}

/** A `GatewayGet` over a transcript. Refuses an unrecorded URL. */
export function transcriptGateway(transcript: Transcript): GatewayGet {
  return (url: string): Promise<GatewayResponse> => {
    const response = transcript.responses.get(url);
    if (response === undefined) return Promise.reject(new UnrecordedUrlError(url));
    return Promise.resolve(response);
  };
}

/**
 * The live call — the one half of `compare` that is genuinely external.
 *
 * It is deliberately the smallest function in this milestone and it makes no decision: it
 * turns a URL into a status and bytes and hands both to code a suite exercises. `fetch` is a
 * parameter rather than a global reference so a caller can supply a proxying or rate-limited
 * one, and so this module names no network primitive of its own.
 *
 * **Unexercised.** No suite in this repository runs it, because running it needs a gateway.
 * That is the honest scope of what remains, and it is one function wide.
 */
export function liveGateway(fetchImpl: typeof globalThis.fetch): GatewayGet {
  return async (url: string): Promise<GatewayResponse> => {
    const response = await fetchImpl(url, {
      headers: { 'Cache-Control': 'no-cache, no-store', Pragma: 'no-cache' },
    });
    return { status: response.status, body: new Uint8Array(await response.arrayBuffer()) };
  };
}
