use std::{collections::BTreeMap, time::Duration};

use futures::{stream::FuturesUnordered, StreamExt};
use subxt::{
    client::OnlineClientAtBlockImpl, config::polkadot::PolkadotExtrinsicParamsBuilder, dynamic,
    transactions::TransactionProgress, OnlineClient, PolkadotConfig,
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
    /// `Pallet.call` -> the metadata call shape this keeper will sign.
    ///
    /// Empty means unpinned, which is the pre-existing trust posture and is
    /// reported as such at startup.
    call_hashes: BTreeMap<String, [u8; 32]>,
}

/// The pin decision, factored out of the metadata lookup so it is testable
/// without a live node.
fn shape_decision(
    observed: Option<[u8; 32]>,
    pins: &BTreeMap<String, [u8; 32]>,
    key: &str,
) -> Result<(), ShapeRefusal> {
    let observed = observed.ok_or(ShapeRefusal::Unknown)?;
    match pins.get(key) {
        Some(pinned) if *pinned == observed => Ok(()),
        Some(_) => Err(ShapeRefusal::Mismatch),
        // Fail closed only once the operator has opted in: with no pins at all
        // the keeper is in its pre-existing posture and says so loudly at
        // startup instead of refusing every crank.
        None if pins.is_empty() => Ok(()),
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
        call_hashes: BTreeMap<String, [u8; 32]>,
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
            call_hashes,
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
    pub fn validate_call_shape(
        metadata: &subxt::Metadata,
        pins: &BTreeMap<String, [u8; 32]>,
        pallet: &str,
        call: &str,
    ) -> Result<(), ShapeRefusal> {
        let key = format!("{pallet}.{call}");
        let observed = metadata
            .pallet_by_name(pallet)
            .and_then(|declared| declared.call_hash(call));
        shape_decision(observed, pins, &key)
    }

    pub fn call_hashes(&self) -> &BTreeMap<String, [u8; 32]> {
        &self.call_hashes
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
        // Before anything is signed: the node's declared call shape must be
        // the pinned one. Refused cranks are an expected failure, not a
        // transport failure — reconnecting to the same hostile endpoint would
        // change nothing, and the keeper must not fall back to signing an
        // unvalidated shape.
        match self.client.at_current_block().await {
            Ok(block) => {
                if let Err(refusal) = Self::validate_call_shape(
                    &block.metadata(),
                    &self.call_hashes,
                    crank.pallet,
                    crank.call,
                ) {
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
            }
            Err(error) => {
                metrics.failed(crank.role);
                warn!(
                    role = %crank.role,
                    pallet = crank.pallet,
                    call = crank.call,
                    %error,
                    "metadata unavailable for call-shape validation"
                );
                return SubmissionOutcome::TransportFailure;
            }
        }
        for attempt in 0..=self.max_retries {
            if self.nonce.is_none() {
                match timeout(self.timeout, self.fetch_nonce()).await {
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
                let mut tx = self.client.tx().await?;
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

    async fn fetch_nonce(&self) -> Result<u64, subxt::Error> {
        let account = self.signer.public_key().to_account_id();
        let tx = self.client.tx().await?;
        Ok(tx.account_nonce(&account).await?)
    }
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

    fn pins(entries: &[(&str, [u8; 32])]) -> BTreeMap<String, [u8; 32]> {
        entries
            .iter()
            .map(|(key, hash)| ((*key).to_owned(), *hash))
            .collect()
    }

    /// MAX-07. With pins configured, a call the operator did not pin is
    /// refused rather than signed on the node's word — otherwise a hostile
    /// endpoint would only have to declare a *new* call name to bypass every
    /// pin. Fails at baseline: no shape check existed at all.
    #[test]
    fn an_unpinned_call_is_refused_once_any_pin_exists() {
        let configured = pins(&[("Epoch.tick", [7u8; 32])]);
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
    }

    /// With no pins at all the keeper keeps its pre-existing posture: it warns
    /// at startup and does not refuse every crank, so an operator who has not
    /// adopted pinning is not silently taken offline by an upgrade.
    #[test]
    fn no_pins_at_all_keeps_the_previous_posture() {
        let empty = BTreeMap::new();
        assert_eq!(
            shape_decision(Some([1u8; 32]), &empty, "Epoch.tick"),
            Ok(())
        );
        assert_eq!(
            shape_decision(None, &empty, "Epoch.tick"),
            Err(ShapeRefusal::Unknown)
        );
    }
}
