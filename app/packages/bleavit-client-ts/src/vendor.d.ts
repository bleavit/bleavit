declare module "@noble/hashes/blake2b" {
  export function blake2b(data: Uint8Array, options: { dkLen: number }): Uint8Array;
}
