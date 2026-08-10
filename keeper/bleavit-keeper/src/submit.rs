use std::{collections::BTreeMap, time::Duration};

use futures::{stream::FuturesUnordered, StreamExt};
use subxt::{
    client::{ClientAtBlock, OfflineClientAtBlockT, OnlineClientAtBlockImpl, OnlineClientAtBlockT},
    config::{polkadot::PolkadotExtrinsicParamsBuilder, substrate::BlakeTwo256, Hasher},
    dynamic,
    transactions::{TransactionProgress, TransactionsClient},
    OnlineClient, PolkadotConfig,
};
use subxt_signer::sr25519::Keypair;
use tokio::time::{sleep, timeout};
use tracing::{debug, info, warn};

use crate::{metrics::KeeperMetrics, planner::PlannedCrank, transport::is_transport};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum AttemptOutcome {
    Success,
    ExpectedFailure,
    TransportFailure,
}

struct PendingCrank {
    crank: PlannedCrank,
    nonce: u64,
    progress: TransactionProgress<PolkadotConfig, OnlineClientAtBlockImpl<PolkadotConfig>>,
}

enum SubmissionOutcome {
    Pending(Box<PendingCrank>),
    ExpectedFailure,
    TransportFailure,
}

pub struct Submitter {
    client: OnlineClient<PolkadotConfig>,
    signer: Keypair,
    nonce: Option<u64>,
    timeout: Duration,
    max_retries: u32,
    retry_base: Duration,
    cooldown_depth: u64,
    cooldowns: BTreeMap<String, u64>,
    /// What this keeper will and will not sign.
    policy: ShapePolicy,
}

/// The call shapes this keeper accepts, and whether it accepts none at all.
///
/// The two travel together everywhere the decision is made, so they are one
/// value: a pin set carried without the operator's opt-out decision beside it is
/// how the fail-open default survived unnoticed (2026-08-10 security review).
#[derive(Clone, Debug, Default)]
pub struct ShapePolicy {
    /// `Pallet.call` -> the metadata call shape this keeper will sign.
    ///
    /// Empty means unpinned, which is refused unless [`Self::allow_unpinned`]
    /// carries the operator's explicit opt-in.
    pub pins: BTreeMap<String, [u8; 32]>,
    /// The operator's `--allow-unpinned-endpoint` decision.
    pub allow_unpinned: bool,
}

/// What this keeper pins for one call: the variant shape **and** the two bytes
/// that decide which dispatchable actually runs.
///
/// A shape hash alone is not the dispatch target. `PalletMetadata::call_hash`
/// is subxt 0.50.2's `get_variant_hash` — `H(variant name) ++ XOR(field name
/// and type hashes)` — and nothing else. The encoder reads a disjoint pair of
/// facts: `frame_decode`'s `encode_call_data_to` writes `call_info.pallet_index`
/// then `call_info.call_index`, which subxt fills from `pallet.call_index()`
/// and `variant.index`. Neither index is hashed, so a shape-only pin leaves the
/// endpoint free to keep the pinned shape and move it to other indices; the
/// keeper would validate and sign bytes the real runtime dispatches elsewhere.
/// That is the same-chain redirection the pin exists to stop, one level down.
///
/// This is not hypothetical for this runtime. Shape hashes already collide
/// across its own pallets: `IncidentRegistry` and `MilestoneRegistry` are
/// shape-identical in all six of their calls, and this keeper cranks both
/// (`planner::registry_pallet`), so one shape pin cannot say which registry it
/// authorized. `ConditionalLedger.set_frozen` and `Market.set_frozen` collide
/// too. Mixing the indices in gives every call a distinct pin, and
/// `keeper_shape_pins::the_twin_registries_are_one_shape_but_two_pins` holds
/// that line against the real metadata.
pub fn dispatch_pin(metadata: &subxt::Metadata, pallet: &str, call: &str) -> Option<[u8; 32]> {
    let declared = metadata.pallet_by_name(pallet)?;
    let variant = declared.call_variant_by_name(call)?;
    let shape = declared.call_hash(call)?;

    // Exactly the bytes `encode_call_data_to` prepends, in its order, after the
    // shape they are being bound to.
    let mut preimage = [0u8; 34];
    preimage[..32].copy_from_slice(&shape);
    preimage[32] = declared.call_index();
    preimage[33] = variant.index;
    Some(BlakeTwo256::new(metadata).hash(&preimage).0)
}

/// The pin decision, factored out of the metadata lookup so it is testable
/// without a live node.
fn shape_decision(
    observed: Option<[u8; 32]>,
    policy: &ShapePolicy,
    key: &str,
) -> Result<(), ShapeRefusal> {
    let observed = observed.ok_or(ShapeRefusal::Unknown)?;
    match policy.pins.get(key) {
        Some(pinned) if *pinned == observed => Ok(()),
        Some(_) => Err(ShapeRefusal::Mismatch),
        // With no pins at all the keeper signs whatever shape the endpoint
        // declares, which is the posture this gate exists to close. It stays
        // reachable only for an operator who asked for it in writing
        // (`--allow-unpinned-endpoint`); `Config` refuses to start otherwise, and
        // this arm keeps the refusal at the signing site too, so no other caller
        // can reintroduce it (2026-08-10 security review).
        None if policy.pins.is_empty() && policy.allow_unpinned => Ok(()),
        None => Err(ShapeRefusal::Unpinned),
    }
}

/// Why a crank was refused before anything was signed.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ShapeRefusal {
    /// The node's metadata declares no such call.
    Unknown,
    /// The node's metadata declares a different shape than the pinned one.
    Mismatch,
    /// Pins are configured but this call has none, so its shape is unverified.
    Unpinned,
}

impl std::fmt::Display for ShapeRefusal {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::Unknown => "the node's metadata declares no such call",
            Self::Mismatch => "the node's metadata declares a different call shape",
            Self::Unpinned => "no pinned call shape for this call",
        })
    }
}

impl Submitter {
    pub fn new(
        client: OnlineClient<PolkadotConfig>,
        signer: Keypair,
        timeout: Duration,
        max_retries: u32,
        retry_base: Duration,
        cooldown_depth: u64,
        policy: ShapePolicy,
    ) -> Self {
        Self {
            client,
            signer,
            nonce: None,
            timeout,
            max_retries,
            retry_base,
            cooldown_depth,
            cooldowns: BTreeMap::new(),
            policy,
        }
    }

    /// Validate the call shape the node's metadata declares against the pin,
    /// before a single byte is signed.
    ///
    /// This is the check that closes the same-chain forgery. A hostile RPC
    /// provider can keep the real genesis hash, spec version, transaction
    /// version, mortality anchor and nonce — so the extrinsic is unambiguously
    /// valid on this chain — and forge only the call shape: metadata declaring
    /// `Epoch` at `Balances`' pallet index and `tick` at
    /// `transfer_allow_death`'s call index, with an argument field typed so its
    /// SCALE encoding is `MultiAddress::Id(attacker) ++ Compact(amount)`.
    /// `dynamic::tx` carries `validation_hash: None`, subxt 0.50.2 encodes
    /// RFC-78's `CheckMetadataHash` as `Disabled` on every signature, and
    /// `SafetyFilter` does not object because `transfer_allow_death` is an
    /// ordinary public leaf. Nothing else in the path looks at the shape.
    ///
    /// What is compared is [`dispatch_pin`], not the bare shape hash: the shape
    /// says what the call *looks* like, and the two index bytes say which
    /// dispatchable actually runs. Both must be pinned or the redirection just
    /// moves down one level — see that function.
    ///
    /// This checks a metadata *instance*. Which instance is the whole point —
    /// see [`Submitter::validated_tx`], the only caller.
    pub fn validate_call_shape(
        metadata: &subxt::Metadata,
        policy: &ShapePolicy,
        pallet: &str,
        call: &str,
    ) -> Result<(), ShapeRefusal> {
        let key = format!("{pallet}.{call}");
        shape_decision(dispatch_pin(metadata, pallet, call), policy, &key)
    }

    /// Validate `block`'s declared call shape and hand back **that block's own**
    /// transactions client.
    ///
    /// The only way this module obtains a `TransactionsClient`, so a signature
    /// cannot be produced by metadata that did not pass the check above.
    ///
    /// Checking one instance and signing through another is not a check.
    /// `OnlineClient::tx()` is `at_current_block().await?.transactions()`, so it
    /// opens a *second* block view with its own `Core_version` call and its own
    /// metadata fetch — the config's cache is keyed by spec version, and the
    /// endpoint states the spec version. An endpoint could therefore answer the
    /// validation call with the pinned metadata and the encoding call with
    /// forged metadata, passing the check and still redirecting the signature to
    /// another call. Deriving both from one `ClientAtBlock` removes the second
    /// fetch entirely: `create_signable_offline` encodes against the metadata
    /// this instance already holds.
    fn validated_tx<Client>(
        block: &ClientAtBlock<PolkadotConfig, Client>,
        policy: &ShapePolicy,
        pallet: &str,
        call: &str,
    ) -> Result<TransactionsClient<PolkadotConfig, Client>, ShapeRefusal>
    where
        Client: OfflineClientAtBlockT<PolkadotConfig>,
    {
        Self::validate_call_shape(block.metadata_ref(), policy, pallet, call)?;
        Ok(block.tx())
    }

    pub fn shape_policy(&self) -> &ShapePolicy {
        &self.policy
    }

    pub fn cooldowns(&self) -> &BTreeMap<String, u64> {
        &self.cooldowns
    }

    pub fn import_cooldowns(&mut self, cooldowns: BTreeMap<String, u64>) {
        self.cooldowns = cooldowns;
    }

    pub fn prune_cooldowns(&mut self, current_block: u64) {
        let depth = self.cooldown_depth;
        self.cooldowns
            .retain(|_, last| current_block.saturating_sub(*last) < depth);
    }

    /// Returns `true` when the caller should reconnect before processing more blocks.
    pub async fn submit_all(
        &mut self,
        cranks: &[PlannedCrank],
        current_block: u64,
        metrics: &KeeperMetrics,
    ) -> bool {
        self.prune_cooldowns(current_block);
        let mut pending = Vec::new();
        let mut reconnect = false;
        for crank in cranks {
            match self.begin_submission(crank, current_block, metrics).await {
                SubmissionOutcome::Pending(crank) => pending.push(*crank),
                SubmissionOutcome::ExpectedFailure => {}
                SubmissionOutcome::TransportFailure => {
                    reconnect = true;
                    break;
                }
            }
        }
        if reconnect {
            // Accepted calls are already in cooldown. Drop their progress
            // subscriptions and reconnect immediately instead of waiting on a
            // transport that has just failed.
            return true;
        }

        // Submit the complete priority-ordered batch before awaiting any finality.
        // A finalized block can include several observation cranks, which is
        // required to sustain the ten-block grid across all live books.
        let mut finalities = FuturesUnordered::new();
        for pending in pending {
            let timeout = self.timeout;
            let metrics = metrics.clone();
            finalities.push(async move { await_finality(pending, timeout, metrics).await });
        }
        while let Some(outcome) = finalities.next().await {
            if outcome == AttemptOutcome::TransportFailure {
                reconnect = true;
                break;
            }
        }
        reconnect
    }

    async fn begin_submission(
        &mut self,
        crank: &PlannedCrank,
        current_block: u64,
        metrics: &KeeperMetrics,
    ) -> SubmissionOutcome {
        for attempt in 0..=self.max_retries {
            // Exactly one block view per attempt, and every later step is built
            // from it — see `validated_tx` for why validating one metadata
            // instance and signing through another closes nothing.
            let block = match timeout(self.timeout, self.client.at_current_block()).await {
                Ok(Ok(block)) => block,
                Ok(Err(error)) => {
                    metrics.failed(crank.role);
                    warn!(
                        role = %crank.role,
                        pallet = crank.pallet,
                        call = crank.call,
                        attempt,
                        %error,
                        "metadata unavailable for call-shape validation"
                    );
                    if attempt < self.max_retries {
                        sleep(backoff(self.retry_base, attempt)).await;
                        continue;
                    }
                    return SubmissionOutcome::TransportFailure;
                }
                Err(_) => {
                    metrics.failed(crank.role);
                    warn!(
                        role = %crank.role,
                        pallet = crank.pallet,
                        call = crank.call,
                        attempt,
                        "timed out fetching metadata for call-shape validation"
                    );
                    if attempt < self.max_retries {
                        sleep(backoff(self.retry_base, attempt)).await;
                        continue;
                    }
                    return SubmissionOutcome::TransportFailure;
                }
            };

            // Before anything is signed: the node's declared call shape must be
            // the pinned one. Refused cranks are an expected failure, not a
            // transport failure — reconnecting to the same hostile endpoint would
            // change nothing, and the keeper must not fall back to signing an
            // unvalidated shape.
            let mut tx = match Self::validated_tx(&block, &self.policy, crank.pallet, crank.call) {
                Ok(tx) => tx,
                Err(refusal) => {
                    metrics.failed(crank.role);
                    warn!(
                        role = %crank.role,
                        pallet = crank.pallet,
                        call = crank.call,
                        %refusal,
                        "refusing to sign: unvalidated call shape"
                    );
                    return SubmissionOutcome::ExpectedFailure;
                }
            };

            if self.nonce.is_none() {
                match timeout(self.timeout, fetch_nonce(&tx, &self.signer)).await {
                    Ok(Ok(nonce)) => self.nonce = Some(nonce),
                    Ok(Err(error)) => {
                        metrics.failed(crank.role);
                        warn!(
                            role = %crank.role,
                            pallet = crank.pallet,
                            call = crank.call,
                            attempt,
                            %error,
                            "nonce fetch failed"
                        );
                        if attempt < self.max_retries {
                            sleep(backoff(self.retry_base, attempt)).await;
                            continue;
                        }
                        return SubmissionOutcome::TransportFailure;
                    }
                    Err(_) => {
                        metrics.failed(crank.role);
                        warn!(
                            role = %crank.role,
                            pallet = crank.pallet,
                            call = crank.call,
                            attempt,
                            "nonce fetch timed out"
                        );
                        if attempt < self.max_retries {
                            sleep(backoff(self.retry_base, attempt)).await;
                            continue;
                        }
                        return SubmissionOutcome::TransportFailure;
                    }
                }
            }
            let Some(nonce) = self.nonce else {
                metrics.failed(crank.role);
                return SubmissionOutcome::TransportFailure;
            };
            let payload = dynamic::tx(crank.pallet, crank.call, crank.args.clone());
            let params = PolkadotExtrinsicParamsBuilder::<PolkadotConfig>::new()
                .nonce(nonce)
                .mortal(64)
                .build();
            let submission = timeout(self.timeout, async {
                // `tx` is the validated block's own transactions client, so the
                // metadata that passed the shape check is the metadata that
                // encodes this payload.
                let progress = tx
                    .sign_and_submit_then_watch(&payload, &self.signer, params)
                    .await?;
                Ok::<_, subxt::Error>(progress)
            })
            .await;
            let progress = match submission {
                Ok(Ok(progress)) => progress,
                Ok(Err(error)) if is_transport(&error) => {
                    metrics.failed(crank.role);
                    warn!(
                        role = %crank.role,
                        pallet = crank.pallet,
                        call = crank.call,
                        nonce,
                        attempt,
                        %error,
                        "transport error before crank submission"
                    );
                    self.nonce = None;
                    if attempt < self.max_retries {
                        sleep(backoff(self.retry_base, attempt)).await;
                        continue;
                    }
                    return SubmissionOutcome::TransportFailure;
                }
                Ok(Err(error)) => {
                    metrics.failed(crank.role);
                    debug!(
                        role = %crank.role,
                        pallet = crank.pallet,
                        call = crank.call,
                        nonce,
                        %error,
                        "crank rejected before inclusion"
                    );
                    self.nonce = None;
                    return SubmissionOutcome::ExpectedFailure;
                }
                Err(_) => {
                    metrics.failed(crank.role);
                    warn!(
                        role = %crank.role,
                        pallet = crank.pallet,
                        call = crank.call,
                        nonce,
                        attempt,
                        "crank submission timed out"
                    );
                    self.nonce = None;
                    if attempt < self.max_retries {
                        sleep(backoff(self.retry_base, attempt)).await;
                        continue;
                    }
                    return SubmissionOutcome::TransportFailure;
                }
            };

            // The node accepted the extrinsic. Reserve the nonce locally and enter
            // cooldown before awaiting finality; a lost subscription must not cause an
            // immediate duplicate submission of an extrinsic that may still land.
            self.nonce = Some(nonce.saturating_add(1));
            self.cooldowns.insert(crank.cooldown_key(), current_block);
            metrics.submitted(crank.role);
            info!(
                role = %crank.role,
                pallet = crank.pallet,
                call = crank.call,
                nonce,
                "crank submitted"
            );
            return SubmissionOutcome::Pending(Box::new(PendingCrank {
                crank: crank.clone(),
                nonce,
                progress,
            }));
        }
        SubmissionOutcome::TransportFailure
    }
}

/// Read the signer's nonce at the block whose shape was validated, rather than
/// opening a fresh block view for it.
async fn fetch_nonce<Client>(
    tx: &TransactionsClient<PolkadotConfig, Client>,
    signer: &Keypair,
) -> Result<u64, subxt::Error>
where
    Client: OnlineClientAtBlockT<PolkadotConfig>,
{
    let account = signer.public_key().to_account_id();
    Ok(tx.account_nonce(&account).await?)
}

async fn await_finality(
    pending: PendingCrank,
    finality_timeout: Duration,
    metrics: KeeperMetrics,
) -> AttemptOutcome {
    let PendingCrank {
        crank,
        nonce,
        progress,
    } = pending;
    match timeout(finality_timeout, progress.wait_for_finalized_success()).await {
        Ok(Ok(_)) => {
            metrics.succeeded(crank.role);
            info!(
                role = %crank.role,
                pallet = crank.pallet,
                call = crank.call,
                nonce,
                "crank finalized successfully"
            );
            AttemptOutcome::Success
        }
        Ok(Err(error)) => {
            let error = subxt::Error::from(error);
            metrics.failed(crank.role);
            if is_transport(&error) {
                warn!(
                    role = %crank.role,
                    pallet = crank.pallet,
                    call = crank.call,
                    nonce,
                    %error,
                    "transport error while awaiting crank finality; reconnecting"
                );
                return AttemptOutcome::TransportFailure;
            }
            // A concurrent keeper commonly wins the state race between our
            // finalized snapshot and inclusion. This is expected and quiet.
            debug!(
                role = %crank.role,
                pallet = crank.pallet,
                call = crank.call,
                nonce,
                %error,
                "crank extrinsic failed (expected under keeper concurrency)"
            );
            AttemptOutcome::ExpectedFailure
        }
        Err(_) => {
            metrics.failed(crank.role);
            warn!(
                role = %crank.role,
                pallet = crank.pallet,
                call = crank.call,
                nonce,
                "timed out awaiting crank finality; reconnecting without resubmission"
            );
            AttemptOutcome::TransportFailure
        }
    }
}

fn backoff(base: Duration, attempt: u32) -> Duration {
    let multiplier = 1_u32.checked_shl(attempt.min(31)).unwrap_or(u32::MAX);
    base.saturating_mul(multiplier)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retry_backoff_is_bounded_and_monotone() {
        let base = Duration::from_millis(100);
        assert_eq!(backoff(base, 0), base);
        assert_eq!(backoff(base, 3), Duration::from_millis(800));
        assert!(backoff(base, u32::MAX) >= backoff(base, 3));
    }
}

#[cfg(test)]
mod call_shape_tests {
    use super::*;

    fn policy(entries: &[(&str, [u8; 32])], allow_unpinned: bool) -> ShapePolicy {
        ShapePolicy {
            pins: entries
                .iter()
                .map(|(key, hash)| ((*key).to_owned(), *hash))
                .collect(),
            allow_unpinned,
        }
    }

    /// MAX-07. With pins configured, a call the operator did not pin is
    /// refused rather than signed on the node's word — otherwise a hostile
    /// endpoint would only have to declare a *new* call name to bypass every
    /// pin. Fails at baseline: no shape check existed at all.
    #[test]
    fn an_unpinned_call_is_refused_once_any_pin_exists() {
        let configured = policy(&[("Epoch.tick", [7u8; 32])], false);
        // The lookup itself needs metadata, so this exercises the decision
        // table directly: `Some(pinned) == observed` -> Ok, `Some(_)` ->
        // Mismatch, `None` with a non-empty map -> Unpinned.
        assert_eq!(
            shape_decision(Some([7u8; 32]), &configured, "Epoch.tick"),
            Ok(())
        );
        assert_eq!(
            shape_decision(Some([9u8; 32]), &configured, "Epoch.tick"),
            Err(ShapeRefusal::Mismatch)
        );
        assert_eq!(
            shape_decision(
                Some([9u8; 32]),
                &configured,
                "Balances.transfer_allow_death"
            ),
            Err(ShapeRefusal::Unpinned)
        );
        assert_eq!(
            shape_decision(None, &configured, "Epoch.tick"),
            Err(ShapeRefusal::Unknown)
        );
        // The opt-out is not a way past a *configured* pin: it only reaches the
        // no-pins-at-all arm.
        let opted_out = policy(&[("Epoch.tick", [7u8; 32])], true);
        assert_eq!(
            shape_decision(Some([9u8; 32]), &opted_out, "Epoch.tick"),
            Err(ShapeRefusal::Mismatch)
        );
        assert_eq!(
            shape_decision(Some([9u8; 32]), &opted_out, "Balances.transfer_allow_death"),
            Err(ShapeRefusal::Unpinned)
        );
    }

    /// With no pins at all the keeper refuses to sign, because an unpinned shape
    /// is the endpoint's word for what the signature authorizes.
    ///
    /// This used to return `Ok(())`, and that default is what the 2026-08-10
    /// security review found: `dynamic::tx` carries `validation_hash: None`,
    /// subxt encodes RFC-78's `CheckMetadataHash` as `Disabled`, and nothing
    /// downstream re-checks the bytes — so a hostile endpoint could keep the
    /// real genesis, spec and transaction versions and move a routine crank onto
    /// `Balances.transfer_allow_death`. The keeper now starts only with pins,
    /// under `--dry-run`, or under an explicit `--allow-unpinned-endpoint`, and
    /// this arm holds the same line at the signing site.
    #[test]
    fn no_pins_at_all_is_refused_unless_the_operator_opted_out() {
        let empty = policy(&[], false);
        assert_eq!(
            shape_decision(Some([1u8; 32]), &empty, "Epoch.tick"),
            Err(ShapeRefusal::Unpinned)
        );
        assert_eq!(
            shape_decision(None, &empty, "Epoch.tick"),
            Err(ShapeRefusal::Unknown)
        );
        // The explicit opt-out restores the old posture, and only that.
        let empty_opted_out = policy(&[], true);
        assert_eq!(
            shape_decision(Some([1u8; 32]), &empty_opted_out, "Epoch.tick"),
            Ok(())
        );
        assert_eq!(
            shape_decision(None, &empty_opted_out, "Epoch.tick"),
            Err(ShapeRefusal::Unknown)
        );
    }
}

/// `validated_tx` over the production metadata, through a real `ClientAtBlock`.
///
/// What this proves: the gate returns a transactions client only when the
/// block's own metadata carries the pinned shape, and the pin key format is the
/// one this repository's metadata actually answers to.
///
/// What it does not prove, because no offline test can: that the validated
/// instance is the encoding instance. That is enforced by construction —
/// `validated_tx` derives the client from the block it checked and is the only
/// place in this module that produces one — not by an assertion here.
#[cfg(test)]
mod validated_tx_tests {
    use super::*;
    use subxt::{
        client::OfflineClient, config::substrate::SpecVersionForRange, ext::codec::Decode,
        ArcMetadata, Metadata, PolkadotConfig,
    };

    type OfflineBlock =
        ClientAtBlock<PolkadotConfig, subxt::client::OfflineClientAtBlockImpl<PolkadotConfig>>;

    fn production_metadata() -> Metadata {
        // The same artifact `snapshot.rs` uses: this repository's bootstrap
        // runtime metadata, extracted with `subwasm metadata --format scale`.
        let encoded = include_bytes!("../tests/fixtures/runtime-metadata.scale");
        Metadata::decode(&mut &encoded[..]).expect("actual runtime metadata decodes for Subxt")
    }

    fn offline_block(metadata: Metadata) -> OfflineBlock {
        let config = PolkadotConfig::builder()
            .set_metadata_for_spec_versions([(1u32, ArcMetadata::new(metadata))])
            .set_spec_version_for_block_ranges([SpecVersionForRange {
                block_range: 0..u64::MAX,
                spec_version: 1,
                transaction_version: 1,
            }])
            .build();
        OfflineClient::new_with_config(config)
            .at_block(0u64)
            .expect("the configured spec version and metadata resolve")
    }

    fn pinned(key: &str, hash: [u8; 32]) -> ShapePolicy {
        ShapePolicy {
            pins: BTreeMap::from([(key.to_owned(), hash)]),
            allow_unpinned: false,
        }
    }

    #[test]
    fn the_gate_admits_only_the_shape_the_block_itself_declares() {
        let metadata = production_metadata();
        let declared = dispatch_pin(&metadata, "Epoch", "tick")
            .expect("the production runtime declares Epoch.tick");
        let block = offline_block(metadata);

        assert!(
            Submitter::validated_tx(&block, &pinned("Epoch.tick", declared), "Epoch", "tick")
                .is_ok(),
            "the shape this block declares is the shape the operator pinned"
        );

        let mut forged = declared;
        forged[0] ^= 0xff;
        assert_eq!(
            Submitter::validated_tx(&block, &pinned("Epoch.tick", forged), "Epoch", "tick").err(),
            Some(ShapeRefusal::Mismatch),
            "no transactions client is produced for a shape that is not the pinned one"
        );
    }

    #[test]
    fn a_call_the_block_does_not_declare_is_refused_not_signed() {
        let block = offline_block(production_metadata());
        let pins = pinned("Epoch.tick", [7u8; 32]);

        assert_eq!(
            Submitter::validated_tx(&block, &pins, "NotAPallet", "tick").err(),
            Some(ShapeRefusal::Unknown)
        );
        assert_eq!(
            Submitter::validated_tx(&block, &pins, "Epoch", "not_a_call").err(),
            Some(ShapeRefusal::Unknown)
        );
    }
}

#[cfg(test)]
mod keeper_shape_pins {
    use super::*;
    use subxt::{ext::codec::Decode, Metadata};

    fn production_metadata() -> Metadata {
        let encoded = include_bytes!("../tests/fixtures/runtime-metadata.scale");
        Metadata::decode(&mut &encoded[..]).expect("actual runtime metadata decodes for Subxt")
    }

    /// The collision this pin has to survive, taken from the real runtime
    /// rather than from forged metadata.
    ///
    /// `IncidentRegistry` and `MilestoneRegistry` declare identically-shaped
    /// calls, so `call_hash` returns one value for both — and the keeper cranks
    /// both pallets. Under a shape-only pin, an operator who pinned
    /// `IncidentRegistry.crank_close` had also, unknowingly, authorized
    /// `MilestoneRegistry.crank_close`: an endpoint that swaps the two pallets'
    /// indices redirects the signature to the other registry without inventing
    /// a single byte of shape. The pin must separate them.
    #[test]
    fn the_twin_registries_are_one_shape_but_two_pins() {
        let metadata = production_metadata();
        let shape = |pallet: &str| {
            metadata
                .pallet_by_name(pallet)
                .and_then(|declared| declared.call_hash("crank_close"))
                .expect("both registries declare crank_close")
        };

        assert_eq!(
            shape("IncidentRegistry"),
            shape("MilestoneRegistry"),
            "the premise: subxt's call hash cannot tell these two calls apart",
        );

        let incident = dispatch_pin(&metadata, "IncidentRegistry", "crank_close")
            .expect("IncidentRegistry.crank_close resolves");
        let milestone = dispatch_pin(&metadata, "MilestoneRegistry", "crank_close")
            .expect("MilestoneRegistry.crank_close resolves");
        assert_ne!(
            incident, milestone,
            "a pin for one registry's crank must not authorize the other's",
        );

        // And the gate, not just the derivation, keeps them apart.
        let pins = ShapePolicy {
            pins: BTreeMap::from([("MilestoneRegistry.crank_close".to_owned(), incident)]),
            allow_unpinned: false,
        };
        assert_eq!(
            Submitter::validate_call_shape(&metadata, &pins, "MilestoneRegistry", "crank_close"),
            Err(ShapeRefusal::Mismatch),
            "the other registry's pin is refused before anything is signed",
        );
    }

    /// The pin covers the two bytes `encode_call_data_to` prepends, so no two
    /// calls in the runtime the keeper signs against can share one.
    #[test]
    fn every_call_this_runtime_declares_has_its_own_pin() {
        let metadata = production_metadata();
        let mut seen: BTreeMap<[u8; 32], String> = BTreeMap::new();
        let mut shapes: BTreeMap<[u8; 32], String> = BTreeMap::new();
        let mut shape_collisions = 0usize;

        for pallet in metadata.pallets() {
            for call in pallet.call_variants().into_iter().flatten() {
                let key = format!("{}.{}", pallet.name(), call.name);
                let pin = dispatch_pin(&metadata, pallet.name(), &call.name)
                    .expect("a declared call resolves a pin");
                if let Some(previous) = seen.insert(pin, key.clone()) {
                    panic!("{key} and {previous} share a dispatch pin");
                }
                if let Some(shape) = pallet.call_hash(&call.name) {
                    if shapes.insert(shape, key).is_some() {
                        shape_collisions += 1;
                    }
                }
            }
        }

        assert!(
            shape_collisions > 0,
            "this runtime is supposed to contain shape collisions; if it no \
             longer does, the test above is no longer exercising the defect",
        );
    }
}
