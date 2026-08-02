import { blake2b } from "@noble/hashes/blake2b";
import type { ReportView } from "./types.js";

const PROVENANCE_DOMAIN = new TextEncoder().encode("bleavit/hosted-report/v1");

function littleEndian(value: bigint, bytes: number): Uint8Array {
  if (value < 0n || value >= 1n << BigInt(bytes * 8)) {
    throw new RangeError(`value does not fit in ${bytes} SCALE bytes`);
  }
  const output = new Uint8Array(bytes);
  let remaining = value;
  for (let index = 0; index < bytes; index += 1) {
    output[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return output;
}

function fixed(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("u32 SCALE field is outside the safe integer range");
  }
  return littleEndian(BigInt(value), 4);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function bool(value: boolean): Uint8Array {
  return new Uint8Array([value ? 1 : 0]);
}

/** The exact v22 SCALE preimage, excluding only provenance_hash. */
export function reportProvenancePreimage(report: ReportView): Uint8Array {
  if (report.subId.length !== 32 || report.provenanceHash.length !== 32) {
    throw new RangeError("ReportView hashes and sub_id must be exactly 32 bytes");
  }
  return concat([
    PROVENANCE_DOMAIN,
    littleEndian(report.questionId, 8),
    fixed(report.clientId),
    report.subId,
    littleEndian(report.twapAccept1e9, 8),
    littleEndian(report.twapReject1e9, 8),
    fixed(report.observations),
    fixed(report.windowStart),
    fixed(report.windowEnd),
    littleEndian(report.bAccept, 16),
    littleEndian(report.bReject, 16),
    littleEndian(report.manipFloor, 16),
    littleEndian(report.declaredStake, 16),
    littleEndian(report.epsilon1e9, 8),
    littleEndian(report.tolerance1e9, 8),
    bool(report.certified),
    fixed(report.settlementTrust.attestors),
    fixed(report.settlementTrust.quorum),
    littleEndian(report.settlementTrust.bondTotal, 16),
  ]);
}

export function reportProvenanceHash(report: ReportView): Uint8Array {
  return blake2b(reportProvenancePreimage(report), { dkLen: 32 });
}

export function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function verifyReportProvenance(report: ReportView): boolean {
  return equalBytes(reportProvenanceHash(report), report.provenanceHash);
}
