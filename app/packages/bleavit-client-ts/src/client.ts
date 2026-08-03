import { verifyReportProvenance } from "./provenance.js";
import type {
  Finalized,
  PapiBridge,
  PreparedRegistration,
  QuestionDraft,
  QuestionId,
  ReportView,
} from "./types.js";

export type ClientErrorCode =
  | "FE-PROV-001"
  | "FE-PROV-002"
  | "FE-TX-001"
  | "FE-TX-002";

export class BleavitClientError extends Error {
  public readonly code: ClientErrorCode;

  public constructor(code: ClientErrorCode, message: string) {
    super(message);
    this.name = "BleavitClientError";
    this.code = code;
  }
}

/**
 * Small high-level facade for services and frontends. The bridge is the only
 * descriptor-specific code: a generated PAPI adapter supplies finalized
 * proof-backed reads and typed tx builders; this facade enforces the trust and
 * refresh rules around them.
 */
export class BleavitClient<Signer, TxResult> {
  public constructor(private readonly bridge: PapiBridge<Signer, TxResult>) {}

  private static samePin(left: { blockHash: string; blockNumber: number }, right: { blockHash: string; blockNumber: number }): boolean {
    return left.blockHash === right.blockHash && left.blockNumber === right.blockNumber;
  }

  private async submit<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new BleavitClientError("FE-TX-002", `generated PAPI submission was rejected: ${detail}`);
    }
  }

  /** Read the authoritative report at one finalized pin and verify its hash. */
  public async readReport(questionId: QuestionId): Promise<Finalized<ReportView>> {
    const pin = await this.bridge.finalizedPin();
    const result = await this.bridge.readHostedReport(questionId, pin.blockHash);
    if (!BleavitClient.samePin(result.pin, pin) || !result.proofVerified) {
      throw new BleavitClientError(
        "FE-PROV-001",
        "report read was not verified against the requested finalized pin",
      );
    }
    if (result.value === null) {
      throw new BleavitClientError("FE-PROV-002", `no hosted report for ${questionId.toString()}`);
    }
    if (!verifyReportProvenance(result.value)) {
      throw new BleavitClientError(
        "FE-PROV-002",
        "hosted report provenance_hash does not match the v22 preimage",
      );
    }
    return {
      value: result.value,
      status: { kind: "verified-finalized", ...pin },
    };
  }

  /** Prepare from finalized constants, then refresh immediately before signing. */
  public async register(draft: QuestionDraft, signer: Signer): Promise<TxResult> {
    const preparationPin = await this.bridge.finalizedPin();
    const prepared = await this.bridge.prepareRegistration(draft, preparationPin.blockHash);
    const signingPin = await this.bridge.finalizedPin();
    if (!BleavitClient.samePin(preparationPin, signingPin)) {
      throw new BleavitClientError(
        "FE-TX-001",
        "registration preparation is stale; retry against the latest finalized header",
      );
    }
    return this.submit(() => this.bridge.submitRegister(prepared.input, signer, signingPin.blockHash));
  }

  public async open(questionId: QuestionId, signer: Signer): Promise<TxResult> {
    const pin = await this.bridge.finalizedPin();
    return this.submit(() => this.bridge.submitOpen(questionId, signer, pin.blockHash));
  }

  public async seal(questionId: QuestionId, signer: Signer): Promise<TxResult> {
    const pin = await this.bridge.finalizedPin();
    return this.submit(() => this.bridge.submitSeal(questionId, signer, pin.blockHash));
  }

  /** Exposed for a confirm screen that must display exact prepared bytes. */
  public async prepare(
    draft: QuestionDraft,
  ): Promise<{ prepared: PreparedRegistration; at: string }> {
    const pin = await this.bridge.finalizedPin();
    const prepared = await this.bridge.prepareRegistration(draft, pin.blockHash);
    return { prepared, at: pin.blockHash };
  }
}
