#!/usr/bin/env node
/**
 * The 02 §7.7 foreign-chain feed gate (F4).
 *
 * `check-chain-feed.py` does this job for Bleavit's own runtimes. It cannot do it here,
 * and the reason is not laziness: `extract-metadata.py` obtains **v15** by booting the
 * runtime in `bleavit-node` and calling `Metadata_metadata_at_version`, and a foreign
 * runtime cannot be booted that way — it has neither the genesis config nor the pallets
 * that node expects. PAPI reads metadata **straight out of the wasm** (V-76) and returns
 * **v16**, which `tools/release/scale_metadata.py` does not implement.
 *
 * So the presence check lives here, over PAPI's own decoder. That is the better home
 * regardless of the version accident: what has to be proven present is what the *client*
 * will be able to name, and the client names what this decoder produces.
 *
 * ## What it checks, and why each one is not redundant
 *
 * 1. **The directory name is the `spec_version` inside it.** A directory whose name
 *    disagrees with its runtime hands out the wrong artifact while every internal check
 *    still passes — the same rule the Bleavit feed carries.
 * 2. **`metadata.scale` hashes to what `runtime-info.json` claims**, and the blob really
 *    decodes at the declared version. A pin that records a hash of a file it does not
 *    contain is a pin of nothing.
 * 3. **Every 02 §7.7 surface is present in the metadata**, with the surface list read out
 *    of `packages/descriptors/src/foreign.ts` rather than restated here. This is the load
 *    bearing one. 10 §5.2's foreign verdict probes exactly `FOREIGN_SURFACE`, so a
 *    surface that quietly left the upstream runtime would make the verdict *unable to
 *    fail* on it — the same defect SQ-580 repaired for Bleavit's own reads, reached across
 *    a chain boundary. `limited_reserve_transfer_assets` makes this concrete rather than
 *    hypothetical: upstream has been steering callers to `transfer_assets` for releases,
 *    and the day it is removed this must go red rather than yield a smaller descriptor set.
 * 4. **At least two distinct genesis sources.** Chain identity is the field whose error
 *    makes every balance the client renders belong to somebody else, and it is the one
 *    field no artifact can produce — genesis is a property of the chain spec's genesis
 *    storage, not of the runtime. One operator agreeing with itself is not a cross-check.
 * 5. **`FOREIGN_CHAIN_PINS` matches the feed in both directions**, exactly as
 *    `SUPPORTED_RUNTIMES` is matched against `fixtures/chain-feed/`. One direction alone
 *    lets a pin name a chain with no artifacts, or artifacts sit unreferenced.
 * 6. **Every pinned chain has a descriptor entry** in `.papi/polkadot-api.json`. 10 §5.1
 *    requires descriptors per `spec_version`; a pin without them is a chain the client
 *    can identify and cannot read.
 *
 * Usage: node tools/check-foreign-feed.ts
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { decAnyMetadata, unifyMetadata } from "@polkadot-api/substrate-bindings";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FEED = path.join(APP, "fixtures", "foreign-chain-feed");
const FOREIGN_TS = path.join(APP, "packages", "descriptors", "src", "foreign.ts");
const PAPI_CONFIG = path.join(APP, ".papi", "polkadot-api.json");

const problems: string[] = [];
const warnings: string[] = [];
const fail = (message: string): number => problems.push(message);

const sha256 = (bytes: Uint8Array): string => "0x" + createHash("sha256").update(bytes).digest("hex");

/** One 02 §7.7 surface, as `foreign.ts` declares it. */
interface ForeignSurface {
  readonly id: string;
  readonly kind: string;
  readonly citation?: string;
}

/**
 * PAPI's unified metadata, narrowed to what this gate reads.
 *
 * `unknown`-leaved on purpose: the parts below the pallet list differ between metadata
 * versions, and every read of them here is already guarded — a shape asserted at the top
 * would move those guards from runtime, where a foreign runtime's real metadata meets
 * them, to compile time, where only this file's guess does.
 */
/**
 * PAPI's own unified metadata, not a restatement of it.
 *
 * A hand-written interface here was the first attempt and it was wrong in the way that
 * matters: it did not describe the SDK's type, so handing one to the other required an
 * `as unknown as` — the double assertion this workspace bans outright, and the ban caught
 * it. Taking the type off `unifyMetadata` instead means the version-straddling reads below
 * (`calls` is a bare type id in v14/v15 and `{ type, deprecationInfo }` in v16) are checked
 * against PAPI's declaration rather than against a guess at it.
 */
type UnifiedMetadata = ReturnType<typeof unifyMetadata>;

/**
 * The §7.7 surfaces, parsed out of `foreign.ts`.
 *
 * Parsed rather than imported because this runs before `tsc -b` in a cold checkout, and
 * parsed rather than restated because a second copy of the list is a second thing to keep
 * true — and the copy that rots is always the one nothing reads back.
 */
function foreignSurfaces(): ForeignSurface[] {
  const source = fs.readFileSync(FOREIGN_TS, "utf8");
  const block = /export const FOREIGN_SURFACE = \[(.*?)\n\] as const/s.exec(source);
  if (!block || block[1] === undefined) throw new Error("could not find FOREIGN_SURFACE in foreign.ts");
  const entries = [...block[1].matchAll(/id:\s*'([^']+)'[\s\S]*?kind:\s*'([^']+)'/g)]
    .map(([, id, kind]) => ({ id: id ?? "", kind: kind ?? "" }))
    .filter((entry) => entry.id !== "" && entry.kind !== "");
  if (entries.length === 0) {
    // The fail-closed half. A regex that matched nothing would otherwise report every
    // surface as present, which is precisely the shape this gate exists to refuse.
    throw new Error("FOREIGN_SURFACE parsed to zero entries — the extractor is broken");
  }
  return entries;
}

/** `assethub.Assets.Account` -> `{ chain: 'assethub', pallet: 'Assets', member: 'Account' }`. */
function splitSurfaceId(id: string): { chain: string; pallet: string; member: string } {
  const parts = id.split(".");
  const [chain, pallet, member] = parts;
  if (parts.length !== 3 || chain === undefined || pallet === undefined || member === undefined) {
    throw new Error(`foreign surface id must be chain.Pallet.Member: ${id}`);
  }
  return { chain, pallet, member };
}

function checkSurfacePresence(
  unified: UnifiedMetadata,
  surfaces: readonly ForeignSurface[],
  label: string,
): void {
  for (const surface of surfaces) {
    const { pallet: palletName, member } = splitSurfaceId(surface.id);
    const pallet = unified.pallets.find((p) => p.name === palletName);
    if (pallet === undefined) {
      fail(`${label}: pallet ${palletName} absent (${surface.id}, ${surface.citation ?? "02 §7.7"})`);
      continue;
    }
    if (surface.kind === "storage") {
      const item = pallet.storage?.items?.find((i) => i.name === member);
      if (item === undefined) fail(`${label}: ${palletName}.${member} is not a storage item`);
    } else if (surface.kind === "call") {
      // `calls` is a bare type id in v14/v15 and `{ type, deprecationInfo }` in v16. Read
      // both, because a shape assumption here fails as "the pallet declares no calls",
      // which reads like a missing surface and would have been "fixed" by removing the row.
      const callsRef = pallet.calls;
      const callsType = typeof callsRef === "number" ? callsRef : (callsRef?.type ?? undefined);
      const lookup = callsType === undefined ? undefined : unified.lookup[callsType];
      const variants = lookup?.def?.tag === "variant" ? lookup.def.value : undefined;
      if (variants === undefined) {
        fail(`${label}: ${palletName} declares no calls, so ${member} cannot be dispatched`);
        continue;
      }
      const variant = variants.find((v) => v.name === member);
      if (variant === undefined) {
        fail(
          `${label}: ${palletName}.${member} is not a call in this runtime. ` +
            `It declares: ${variants.map((v) => v.name).join(", ")}`,
        );
        continue;
      }
      // **Deprecation is reported, never failed on.** A deprecated call still dispatches,
      // so failing would take the deposit leg offline for a runtime that works. But a
      // silent deprecation is exactly how the call vanishes one release later and the
      // §7.7 row becomes a citation of nothing, so it has to be visible now — this is the
      // only warning this gate emits, and it is deliberately not an error.
      // v16 adds `deprecationInfo` beside the type id; v14/v15 carry the bare id, and even
      // in v16 the field is present only on the arm that has it — so it is read through the
      // `in` guard rather than optional-chained off a union that does not declare it.
      const deprecations =
        callsRef !== null && typeof callsRef === "object" && "deprecationInfo" in callsRef
          ? callsRef.deprecationInfo
          : [];
      //
      // **Presence is the signal.** The previous version also required the tag not to be
      // `"NotDeprecated"`, and typing this file against PAPI's own declaration showed that
      // tag does not exist: `deprecationInfo` carries only `Deprecated` and
      // `DeprecatedWithoutNote`, so an entry is *only* ever written for a deprecated call
      // and the extra comparison was always true. It read like a filter and filtered
      // nothing — which would have mattered the moment somebody trusted it.
      const note = deprecations.find((d) => d.index === variant.index);
      if (note !== undefined) {
        const detail =
          note.deprecation.tag === "Deprecated" ? note.deprecation.value.note : "(no note)";
        warnings.push(
          `${label}: ${palletName}.${member} is DEPRECATED upstream — ` +
            `${detail} ` +
            "It still dispatches, so this is not a failure; it is the notice that 02 §7.7's " +
            "row will need re-pinning before it becomes a citation of a call that is gone.",
        );
      }
    } else {
      fail(`${label}: unknown surface kind ${surface.kind} for ${surface.id}`);
    }
  }
}

/** `FOREIGN_CHAIN_PINS`, parsed out of `foreign.ts` for the same reason as above. */
interface DeclaredPin {
  readonly label: string | undefined;
  readonly genesisHash: string | undefined;
  readonly supportedSpecVersions: number[];
}

function declaredPins(): DeclaredPin[] {
  const source = fs.readFileSync(FOREIGN_TS, "utf8");
  const block = /export const FOREIGN_CHAIN_PINS: readonly ForeignChainPin\[\] = \[(.*?)\n\];/s.exec(
    source,
  );
  if (!block || block[1] === undefined) throw new Error("could not find FOREIGN_CHAIN_PINS in foreign.ts");
  return [...block[1].matchAll(/\{([\s\S]*?)\}/g)].map(([, body]) => ({
    label: /label:\s*'([^']+)'/.exec(body ?? "")?.[1],
    genesisHash: /genesisHash:\s*'([^']+)'/.exec(body ?? "")?.[1],
    supportedSpecVersions: [
      ...(/supportedSpecVersions:\s*\[([^\]]*)\]/.exec(body ?? "")?.[1] ?? "").matchAll(/\d+/g),
    ].map(([n]) => Number(n)),
  }));
}

function main(): number {
  const surfaces = foreignSurfaces();
  const chains = fs.existsSync(FEED)
    ? fs.readdirSync(FEED, { withFileTypes: true }).filter((e) => e.isDirectory())
    : [];

  const papiEntries = Object.keys(
    JSON.parse(fs.readFileSync(PAPI_CONFIG, "utf8")).entries ?? {},
  );

  /** Every (label, genesis, specVersion) the committed feed actually contains. */
  const fromFeed = [];

  for (const chainDir of chains) {
    const chainPath = path.join(FEED, chainDir.name);
    const versions = fs.readdirSync(chainPath, { withFileTypes: true }).filter((e) => e.isDirectory());
    if (versions.length === 0) fail(`${chainDir.name}/ has no spec_version directory`);
    for (const versionDir of versions) {
      const dir = path.join(chainPath, versionDir.name);
      const label = `${chainDir.name}/${versionDir.name}`;
      const infoPath = path.join(dir, "runtime-info.json");
      const metaPath = path.join(dir, "metadata.scale");
      if (!fs.existsSync(infoPath) || !fs.existsSync(metaPath)) {
        fail(`${label}: needs both runtime-info.json and metadata.scale`);
        continue;
      }
      const info = JSON.parse(fs.readFileSync(infoPath, "utf8"));
      if (info.schema !== "bleavit.foreign-runtime-info.v1") {
        fail(`${label}: unexpected schema ${info.schema}`);
        continue;
      }

      // (1) the directory name IS the selector
      if (String(info.core_version?.spec_version) !== versionDir.name) {
        fail(
          `${label}: directory name disagrees with the spec_version inside ` +
            `(${info.core_version?.spec_version}) — it would hand out the wrong artifact`,
        );
      }

      // (2) the blob is the blob the record describes, and it decodes
      const raw = fs.readFileSync(metaPath);
      const measured = sha256(raw);
      if (measured !== info.metadata?.sha256) {
        fail(`${label}: metadata.scale is ${measured}, runtime-info says ${info.metadata?.sha256}`);
      }
      let unified: UnifiedMetadata;
      try {
        // `decAnyMetadata` is typed for the SDK's own metadata union; a foreign runtime's
        // bytes arrive here as `unknown` from the filesystem, so this is where they enter
        // the typed world — guarded immediately below by the tag comparison.
        const any = decAnyMetadata(raw as Parameters<typeof decAnyMetadata>[0]);
        if (any.metadata.tag !== `v${info.metadata?.version}`) {
          fail(`${label}: blob decodes as ${any.metadata.tag}, record says v${info.metadata?.version}`);
        }
        unified = unifyMetadata(any.metadata.value as Parameters<typeof unifyMetadata>[0]);
      } catch (error) {
        fail(`${label}: metadata does not decode — ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }

      // (3) every 02 §7.7 surface is present
      checkSurfacePresence(unified, surfaces, label);

      // (4) genesis identity is cross-checked, not asserted
      const sources = new Set(info.genesis_sources ?? []);
      if (sources.size < 2) {
        fail(
          `${label}: genesis_sources has ${sources.size} distinct entries; at least two are ` +
            "required, because one operator agreeing with itself is not a cross-check",
        );
      }
      if (!/^0x[0-9a-f]{64}$/.test(info.genesis_hash ?? "")) {
        fail(`${label}: genesis_hash is not 0x + 64 lowercase hex`);
      }
      if (!/^0x[0-9a-f]{64}$/.test(info.artifact?.sha256 ?? "")) {
        fail(`${label}: artifact.sha256 is not 0x + 64 lowercase hex`);
      }

      // (6) descriptors exist for it
      if (!papiEntries.includes(info.chain_key)) {
        fail(
          `${label}: chain_key ${info.chain_key} has no entry in .papi/polkadot-api.json, so ` +
            "10 §5.1's per-spec_version descriptors do not exist for a chain we pin",
        );
      }

      fromFeed.push({
        label: info.label,
        genesisHash: info.genesis_hash,
        specVersion: info.core_version.spec_version,
      });
    }
  }

  // (5) the declared pins and the feed agree, in both directions
  const pins = declaredPins();
  for (const pin of pins) {
    const matching = fromFeed.filter((f) => f.label === pin.label);
    if (matching.length === 0) {
      fail(`FOREIGN_CHAIN_PINS names "${pin.label}", which has no directory in the feed`);
      continue;
    }
    for (const entry of matching) {
      if (entry.genesisHash !== pin.genesisHash) {
        fail(
          `"${pin.label}": pinned genesis ${pin.genesisHash} != feed ${entry.genesisHash}`,
        );
      }
    }
    const feedVersions = matching.map((m) => m.specVersion).sort((a, b) => a - b);
    const pinned = [...pin.supportedSpecVersions].sort((a, b) => a - b);
    if (feedVersions.join(",") !== pinned.join(",")) {
      fail(
        `"${pin.label}": supportedSpecVersions [${pinned}] != the feed's [${feedVersions}]`,
      );
    }
  }
  for (const entry of fromFeed) {
    if (!pins.some((p) => p.label === entry.label)) {
      fail(
        `the feed carries "${entry.label}" spec ${entry.specVersion} which FOREIGN_CHAIN_PINS ` +
          "does not name — a pinned artifact nothing reads is an artifact nobody maintains",
      );
    }
  }

  for (const warning of warnings) console.warn(`WARN ${warning}`);
  if (problems.length > 0) {
    console.error(`FAIL foreign-chain feed (${problems.length}):`);
    for (const problem of problems) console.error(`  ${problem}`);
    return 1;
  }
  if (fromFeed.length === 0) {
    // Empty is a legitimate state — `FOREIGN_CHAIN_PINS` shipped empty by design while the
    // artifacts did not exist — but it must be *reported*, never mistaken for coverage.
    console.log("OK  foreign-chain feed is empty; the deposit leg is blocked as `unreachable`");
    return 0;
  }
  for (const entry of fromFeed) {
    console.log(`OK  ${entry.label} spec ${entry.specVersion} — ${surfaces.length} §7.7 surfaces present`);
  }
  return 0;
}

process.exit(main());
