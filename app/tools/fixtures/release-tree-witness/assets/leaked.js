// Witness for 10 §10.1's "no signer adapter marked test-only may appear in a release chunk".
// Never built, never served — `assertNoTestOnlySigner` is pointed at this directory so the
// gate is proven by a tree that violates it rather than by a tree that happens to pass.
export class MockSigner {
  sign() {
    throw new Error('a test double in a release chunk is the defect this fixture stands for');
  }
}
