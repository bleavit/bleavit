/** Contract-v22 scalar aliases. BigInt is used where SCALE carries u64/u128. */
export type Balance = bigint;
export type BlockNumber = number;
export type QuestionId = bigint;
export type ClientId = number;
export type Hex = `0x${string}`;

/** A u64 fixed value on the contract's 1e9 grid. */
export type FixedU64 = bigint;

export interface SettlementTrust {
  attestors: number;
  quorum: number;
  bondTotal: Balance;
}

/** Exact public ReportView field set from integration-contract v22. */
export interface ReportView {
  questionId: QuestionId;
  clientId: ClientId;
  subId: Uint8Array;
  twapAccept1e9: FixedU64;
  twapReject1e9: FixedU64;
  observations: number;
  windowStart: BlockNumber;
  windowEnd: BlockNumber;
  bAccept: Balance;
  bReject: Balance;
  manipFloor: Balance;
  declaredStake: Balance;
  epsilon1e9: FixedU64;
  tolerance1e9: FixedU64;
  certified: boolean;
  settlementTrust: SettlementTrust;
  provenanceHash: Uint8Array;
}

export interface ClientRule {
  minAcceptImprovement1e9: FixedU64;
}

/** User-level question terms. The adapter derives b and the absolute window. */
export interface QuestionDraft {
  subId?: Uint8Array;
  declaredStake: Balance;
  epsilon1e9: FixedU64;
  tolerance1e9: FixedU64;
  window: BlockNumber;
  attestors: readonly Uint8Array[];
  rule: ClientRule;
}

/** Exact SCALE argument shape of QuestionService::register. */
export interface RegisterInput {
  subId?: Uint8Array;
  declaredStake: Balance;
  epsilon1e9: FixedU64;
  tolerance1e9: FixedU64;
  windowStart: BlockNumber;
  windowEnd: BlockNumber;
  b: Balance;
  rule: ClientRule;
  attestors: readonly Uint8Array[];
}

export interface FinalizedPin {
  blockHash: Hex;
  blockNumber: BlockNumber;
}

export interface Finalized<T> {
  value: T;
  status: {
    kind: "verified-finalized";
    blockHash: Hex;
    blockNumber: BlockNumber;
  };
}

/** Returned by a PAPI/smoldot adapter only after its storage proof is checked. */
export interface ProofBacked<T> {
  value: T | null;
  pin: FinalizedPin;
  proofVerified: true;
}

export interface PreparedRegistration {
  input: RegisterInput;
  /** The exact service fee/escrow envelope selected from finalized state. */
  withdrawal: Balance;
}

export interface PapiBridge<Signer, TxResult> {
  /** Must pin a finalized chainHead before reading or preparing a transaction. */
  finalizedPin(): Promise<FinalizedPin>;
  /** PAPI's smoldot-backed storage read must verify the trie proof first. */
  readHostedReport(questionId: QuestionId, at: Hex): Promise<ProofBacked<ReportView>>;
  /** Uses finalized constants and the shared reference arithmetic. */
  prepareRegistration(draft: QuestionDraft, at: Hex): Promise<PreparedRegistration>;
  /** These methods call generated PAPI tx builders, never hand-encoded bytes. */
  submitRegister(input: RegisterInput, signer: Signer, at: Hex): Promise<TxResult>;
  submitOpen(questionId: QuestionId, signer: Signer, at: Hex): Promise<TxResult>;
  submitSeal(questionId: QuestionId, signer: Signer, at: Hex): Promise<TxResult>;
}
