#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { merkleizeMetadata } from '@polkadot-api/merkleize-metadata'

function fail(message: string): never {
  throw new Error(`usage: rfc78-hash.ts <metadata.scale> <token-symbol> <token-decimals>: ${message}`)
}

export function rfc78Hash(
  metadata: Uint8Array,
  tokenSymbol: string,
  tokenDecimals: number,
): string {
  if (!tokenSymbol) fail('token symbol is required')
  if (!Number.isSafeInteger(tokenDecimals) || tokenDecimals < 0 || tokenDecimals > 255) {
    fail('token decimals must fit in u8')
  }
  const digest = merkleizeMetadata(metadata, {
    decimals: tokenDecimals,
    tokenSymbol,
  }).digest()
  return `0x${Buffer.from(digest).toString('hex')}`
}

function main(): void {
  const [, , metadataPath, tokenSymbol, tokenDecimalsText, ...extra] = process.argv
  if (extra.length !== 0) fail('unexpected trailing arguments')
  if (!metadataPath) fail('metadata path is required')
  if (!tokenDecimalsText || !/^\d+$/.test(tokenDecimalsText)) {
    fail('token decimals must be an unsigned decimal integer')
  }
  process.stdout.write(
    `${rfc78Hash(readFileSync(metadataPath), tokenSymbol ?? '', Number(tokenDecimalsText))}\n`,
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
