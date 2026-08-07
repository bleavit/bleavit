/**
 * The socket around {@link createIndexer} — 10 §8.5.2. F24.
 *
 * Separated from the handler for the reason every injected boundary in this repository is: the
 * handler is a pure function of the request target, so every route, refusal and paging decision is
 * exercised by a suite with no port, no listener and no timing. What is left here is the part that
 * cannot be tested without a socket, and it is deliberately small enough to read in one sitting.
 *
 * It is read-only in the strongest sense available: anything that is not a `GET` is refused before
 * the handler sees it, and no request body is ever read. INV-FE-15 asks for a *"minimal open
 * read-only interface anyone can operate"*, and an interface that quietly ignored a `POST` body
 * would be one whose read-only-ness is a property of the current implementation rather than of the
 * interface.
 */

import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

import type { IndexerHandler } from './indexer.ts';

/**
 * A page size to start from, named where it is visibly a starting point.
 *
 * 10 §8.5.2 fixes the paging protocol and says nothing about page size; there is no chain surface,
 * kernel constant or 13 §1 key behind this number, and {@link createIndexer} therefore takes it
 * with no default. What an operator should actually tune it against is their own answer time and
 * the client's round-trip count, both of which are properties of their index rather than of the
 * interface.
 */
export const SUGGESTED_BLOCKS_PER_PAGE = 1_000;

export interface ListenOptions {
  readonly port: number;
  readonly host: string;
}

/**
 * Start the server. Returns the `http.Server` so a caller owns its lifetime and its `close`.
 *
 * `port: 0` binds an ephemeral port, which is how a suite drives a real round trip without
 * choosing a number that some other process on the machine may hold.
 */
export function startIndexer(handle: IndexerHandler, options: ListenOptions): Server {
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    // Read-only, enforced rather than intended. `HEAD` is admitted because Node writes no body for
    // it, so it is the same answer with the body omitted by the protocol.
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { 'content-type': 'text/plain', allow: 'GET, HEAD' });
      response.end('this interface is read-only (10 §8.5.2)\n');
      return;
    }
    // `request.url` is the request target — path plus query — which is exactly what the handler
    // takes. It is absent only on a malformed request, which Node has already rejected.
    const served = handle(request.url ?? '/');
    response.writeHead(served.status, served.headers);
    response.end(served.body);
  });
  server.listen(options.port, options.host);
  return server;
}
