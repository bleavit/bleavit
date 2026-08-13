import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { rfc78Hash } from '../../tools/release/rfc78-hash.ts'

const APP = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const METADATA = readFileSync(resolve(APP, 'fixtures/chain-feed/2/metadata.scale'))

test('RFC-78 digest is stable for the committed runtime metadata and VIT/12 identity', () => {
  assert.equal(
    rfc78Hash(METADATA, 'VIT', 12),
    '0xaa69617fd32bb32e9da59c100b8f1eb8a26617f41c96c5353c743a500625ba29',
  )
})

test('RFC-78 digest binds the token identity and rejects invalid decimals', () => {
  assert.notEqual(rfc78Hash(METADATA, 'VIT', 12), rfc78Hash(METADATA, 'VIT', 11))
  assert.notEqual(rfc78Hash(METADATA, 'VIT', 12), rfc78Hash(METADATA, 'DOT', 12))
  assert.throws(() => rfc78Hash(METADATA, 'VIT', -1), /must fit in u8/)
  assert.throws(() => rfc78Hash(METADATA, '', 12), /token symbol is required/)
})
