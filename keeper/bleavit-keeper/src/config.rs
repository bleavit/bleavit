use std::{
    collections::{BTreeMap, BTreeSet},
    net::SocketAddr,
    path::PathBuf,
    str::FromStr,
    time::Duration,
};

use anyhow::{bail, Context};
use clap::{Parser, ValueEnum};
use serde::{Deserialize, Serialize};

const DEFAULT_NODE_URL: &str = "ws://127.0.0.1:9944";

#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, ValueEnum,
)]
#[serde(rename_all = "kebab-case")]
pub enum Role {
    Tick,
    Observe,
    Decide,
    Settle,
    Execute,
    OracleClose,
    RegistryClose,
    Cleanup,
    Renewal,
    Welfare,
}

impl Role {
    pub const ALL: [Self; 10] = [
        Self::Tick,
        Self::Observe,
        Self::Decide,
        Self::Settle,
        Self::Execute,
        Self::OracleClose,
        Self::RegistryClose,
        Self::Cleanup,
        Self::Renewal,
        Self::Welfare,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Tick => "tick",
            Self::Observe => "observe",
            Self::Decide => "decide",
            Self::Settle => "settle",
            Self::Execute => "execute",
            Self::OracleClose => "oracle-close",
            Self::RegistryClose => "registry-close",
            Self::Cleanup => "cleanup",
            Self::Renewal => "renewal",
            Self::Welfare => "welfare",
        }
    }
}

impl std::fmt::Display for Role {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

pub type RoleSet = BTreeSet<Role>;

#[derive(Clone, Debug, Parser)]
#[command(name = "bleavit-keeper", version, about)]
pub struct Cli {
    /// Optional TOML configuration file. CLI values take precedence.
    #[arg(long)]
    pub config: Option<PathBuf>,

    /// WebSocket RPC endpoint. Repeat for ordered failover.
    #[arg(long = "node-url")]
    pub node_urls: Vec<String>,

    /// 0x-prefixed genesis hash of the chain this keeper may sign for. A node
    /// serving any other chain is refused rather than trusted.
    #[arg(long)]
    pub genesis_hash: Option<String>,

    /// Pin one call shape as `Pallet.call=0x…`. Repeat for each call. Run with
    /// `--dry-run` once to have the keeper print the values this endpoint
    /// serves.
    #[arg(long = "call-hash")]
    pub call_hashes: Vec<String>,

    /// Sign against whatever call shapes and chain identity the endpoint
    /// declares, with no pins. Live mode refuses to start without this.
    #[arg(long)]
    pub allow_unpinned_endpoint: bool,

    /// Development/secret URI, for example //Alice. Never use a dev URI in production.
    #[arg(long, conflicts_with = "signer_file")]
    pub signer_uri: Option<String>,

    /// File containing one secret URI. Whitespace around the URI is ignored.
    #[arg(long, conflicts_with = "signer_uri")]
    pub signer_file: Option<PathBuf>,

    /// Enabled roles. Repeat or comma-separate values; defaults to all roles.
    #[arg(long, value_delimiter = ',')]
    pub enabled_roles: Vec<Role>,

    /// Override the on-chain/default TWAP observation interval in blocks.
    #[arg(long)]
    pub obs_interval: Option<u64>,

    /// Override the on-chain/default decision-window length in blocks.
    #[arg(long)]
    pub decision_window: Option<u64>,

    /// Override the on-chain/default reserve-probe interval in blocks.
    #[arg(long)]
    pub reserve_probe_interval: Option<u64>,

    /// Override the on-chain/default reserve-probe timeout in blocks.
    #[arg(long)]
    pub reserve_probe_timeout: Option<u64>,

    /// Plan and log cranks without signing or submitting.
    #[arg(long)]
    pub dry_run: bool,

    /// Optional Prometheus HTTP bind address, for example 127.0.0.1:9616.
    #[arg(long)]
    pub metrics_bind: Option<SocketAddr>,

    /// Re-plan only every Nth finalized block.
    #[arg(long)]
    pub every_n_blocks: Option<u64>,

    /// Maximum random startup delay for multi-instance politeness.
    #[arg(long)]
    pub startup_jitter_secs: Option<u64>,

    /// Suppress the same crank for this many finalized blocks after submission.
    #[arg(long)]
    pub cooldown_depth: Option<u64>,

    /// Timeout for one submission/finalization attempt.
    #[arg(long)]
    pub tx_timeout_secs: Option<u64>,

    /// Number of bounded retries after the first attempt.
    #[arg(long)]
    pub max_retries: Option<u32>,

    /// Initial retry backoff in milliseconds.
    #[arg(long)]
    pub retry_base_ms: Option<u64>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SignerSource {
    Uri(String),
    File(PathBuf),
}

#[derive(Clone, Debug)]
pub struct Config {
    pub node_urls: Vec<String>,
    /// The chain this keeper may sign for, as a 0x-prefixed genesis hash.
    ///
    /// `PolkadotConfig::default()` carries `genesis_hash: None`, so subxt falls
    /// back to `backend.genesis_hash()` — the node's own answer. Pinning it
    /// makes a hostile endpoint unable to move the keeper onto another chain.
    pub genesis_hash: Option<[u8; 32]>,
    /// `Pallet.call` -> the metadata call hash the keeper will sign.
    ///
    /// Every byte the keeper signs is derived from metadata the node serves,
    /// every call is built with `dynamic::tx` (whose payload carries
    /// `validation_hash: None`), and subxt 0.50.2 always encodes RFC-78's
    /// `CheckMetadataHash` as `Disabled` — so the runtime's own metadata-hash
    /// control is waived on every keeper signature. A compromised endpoint can
    /// therefore keep the real genesis, spec and transaction versions and forge
    /// only the *call shape*, and the extrinsic is unambiguously valid on this
    /// chain. Pinning the shapes is what closes that; the genesis pin alone
    /// does not, because the forgery never leaves the chain.
    ///
    /// Empty means unpinned, which live mode refuses outright: the keeper
    /// starts only under `--dry-run` or an explicit
    /// [`Config::allow_unpinned_endpoint`], and then logs the shapes it observes
    /// so an operator can adopt them.
    pub call_hashes: BTreeMap<String, [u8; 32]>,
    /// The operator's explicit decision to sign against an endpoint it has not
    /// pinned — neither its chain identity nor its call shapes.
    ///
    /// Both pins default to absent, and an absent pin used to mean "trust the
    /// endpoint". `node_urls` names a third-party RPC operator by design
    /// (01 §4.2), the keeper builds every call from that endpoint's own metadata
    /// (`dynamic::tx` carries `validation_hash: None` and subxt encodes RFC-78's
    /// `CheckMetadataHash` as `Disabled`), and nothing downstream re-checks what
    /// was signed. So the default had to become refusal, and the old posture had
    /// to become something an operator asks for in writing (2026-08-10 security
    /// review).
    pub allow_unpinned_endpoint: bool,
    pub signer: Option<SignerSource>,
    pub enabled_roles: RoleSet,
    pub obs_interval: Option<u64>,
    pub decision_window: Option<u64>,
    pub reserve_probe_interval: Option<u64>,
    pub reserve_probe_timeout: Option<u64>,
    pub dry_run: bool,
    pub metrics_bind: Option<SocketAddr>,
    pub every_n_blocks: u64,
    pub startup_jitter: Duration,
    pub cooldown_depth: u64,
    pub tx_timeout: Duration,
    pub max_retries: u32,
    pub retry_base: Duration,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct FileConfig {
    node_urls: Option<Vec<String>>,
    genesis_hash: Option<String>,
    call_hashes: Option<BTreeMap<String, String>>,
    allow_unpinned_endpoint: Option<bool>,
    signer_uri: Option<String>,
    signer_file: Option<PathBuf>,
    enabled_roles: Option<Vec<Role>>,
    obs_interval: Option<u64>,
    decision_window: Option<u64>,
    reserve_probe_interval: Option<u64>,
    reserve_probe_timeout: Option<u64>,
    dry_run: Option<bool>,
    metrics_bind: Option<SocketAddr>,
    every_n_blocks: Option<u64>,
    startup_jitter_secs: Option<u64>,
    cooldown_depth: Option<u64>,
    tx_timeout_secs: Option<u64>,
    max_retries: Option<u32>,
    retry_base_ms: Option<u64>,
}

impl Config {
    pub async fn load(cli: Cli) -> anyhow::Result<Self> {
        let file = match &cli.config {
            Some(path) => {
                let raw = tokio::fs::read_to_string(path)
                    .await
                    .with_context(|| format!("failed to read config file {}", path.display()))?;
                toml::from_str::<FileConfig>(&raw)
                    .with_context(|| format!("invalid config file {}", path.display()))?
            }
            None => FileConfig::default(),
        };
        Self::merge(cli, file)
    }

    fn merge(cli: Cli, file: FileConfig) -> anyhow::Result<Self> {
        if file.signer_uri.is_some() && file.signer_file.is_some() {
            bail!("config must set only one of signer_uri or signer_file");
        }

        let dry_run = cli.dry_run || file.dry_run.unwrap_or(false);

        let signer = match (cli.signer_uri, cli.signer_file) {
            (Some(uri), None) => Some(SignerSource::Uri(uri)),
            (None, Some(path)) => Some(SignerSource::File(path)),
            (None, None) => match (file.signer_uri, file.signer_file) {
                (Some(uri), None) => Some(SignerSource::Uri(uri)),
                (None, Some(path)) => Some(SignerSource::File(path)),
                (None, None) if dry_run => None,
                (None, None) => bail!(
                    "explicit signer required: set --signer-uri or --signer-file, or use --dry-run"
                ),
                (Some(_), Some(_)) => bail!("config must set only one signer source"),
            },
            (Some(_), Some(_)) => bail!("set only one signer source"),
        };

        let node_urls = if cli.node_urls.is_empty() {
            file.node_urls
                .unwrap_or_else(|| vec![DEFAULT_NODE_URL.to_owned()])
        } else {
            cli.node_urls
        };
        if node_urls.is_empty() || node_urls.iter().any(|url| url.trim().is_empty()) {
            bail!("at least one non-empty node URL is required");
        }

        let roles = if cli.enabled_roles.is_empty() {
            file.enabled_roles.unwrap_or_else(|| Role::ALL.to_vec())
        } else {
            cli.enabled_roles
        };
        let enabled_roles = roles.into_iter().collect::<RoleSet>();
        if enabled_roles.is_empty() {
            bail!("at least one keeper role must be enabled");
        }

        let genesis_hash = match cli.genesis_hash.or(file.genesis_hash) {
            Some(raw) => Some(parse_h256(&raw).context("invalid genesis_hash")?),
            None => None,
        };
        let mut call_hashes = BTreeMap::new();
        for (key, raw) in file.call_hashes.unwrap_or_default() {
            insert_call_hash(&mut call_hashes, &key, &raw)?;
        }
        // `--call-hash Pallet.call=0x…` overrides the file entry for that call,
        // so an operator can pin without authoring a TOML file at all.
        for entry in &cli.call_hashes {
            let (key, raw) = entry
                .split_once('=')
                .with_context(|| format!("--call-hash {entry:?} must be \"Pallet.call=0x…\""))?;
            insert_call_hash(&mut call_hashes, key, raw)?;
        }

        let allow_unpinned_endpoint =
            cli.allow_unpinned_endpoint || file.allow_unpinned_endpoint.unwrap_or(false);
        // Every byte this keeper signs is encoded against metadata the endpoint
        // served, and no later stage re-checks it, so an unpinned live keeper
        // signs whatever that endpoint asks it to. Refuse rather than warn; the
        // operator opts back in explicitly, and `--dry-run` (which signs
        // nothing) is how they collect the values to pin.
        if !dry_run && !allow_unpinned_endpoint {
            if call_hashes.is_empty() {
                bail!(
                    "no pinned call shapes: pin them with --call-hash Pallet.call=0x… or the \
                     config file's `call_hashes`, or pass --allow-unpinned-endpoint to sign \
                     against the endpoint's own metadata. Run with --dry-run to print the \
                     shapes this endpoint serves"
                );
            }
            if genesis_hash.is_none() {
                bail!(
                    "no pinned genesis hash: pass --genesis-hash 0x… (or the config file's \
                     `genesis_hash`), or --allow-unpinned-endpoint to sign for whichever chain \
                     the endpoint claims to be"
                );
            }
        }

        let obs_interval = cli.obs_interval.or(file.obs_interval);
        let decision_window = cli.decision_window.or(file.decision_window);
        let reserve_probe_interval = cli.reserve_probe_interval.or(file.reserve_probe_interval);
        let reserve_probe_timeout = cli.reserve_probe_timeout.or(file.reserve_probe_timeout);
        let every_n_blocks = cli.every_n_blocks.or(file.every_n_blocks).unwrap_or(1);
        let cooldown_depth = cli.cooldown_depth.or(file.cooldown_depth).unwrap_or(3);
        let tx_timeout_secs = cli.tx_timeout_secs.or(file.tx_timeout_secs).unwrap_or(90);
        let retry_base_ms = cli.retry_base_ms.or(file.retry_base_ms).unwrap_or(500);
        if [
            obs_interval,
            decision_window,
            reserve_probe_interval,
            reserve_probe_timeout,
        ]
        .into_iter()
        .flatten()
        .any(|value| value == 0)
            || every_n_blocks == 0
            || tx_timeout_secs == 0
            || retry_base_ms == 0
        {
            bail!("intervals and timeouts must be greater than zero");
        }

        Ok(Self {
            node_urls,
            genesis_hash,
            call_hashes,
            allow_unpinned_endpoint,
            signer,
            enabled_roles,
            obs_interval,
            decision_window,
            reserve_probe_interval,
            reserve_probe_timeout,
            dry_run,
            metrics_bind: cli.metrics_bind.or(file.metrics_bind),
            every_n_blocks,
            startup_jitter: Duration::from_secs(
                cli.startup_jitter_secs
                    .or(file.startup_jitter_secs)
                    .unwrap_or(0),
            ),
            cooldown_depth,
            tx_timeout: Duration::from_secs(tx_timeout_secs),
            max_retries: cli.max_retries.or(file.max_retries).unwrap_or(2),
            retry_base: Duration::from_millis(retry_base_ms),
        })
    }

    pub async fn signer_uri(&self) -> anyhow::Result<String> {
        match &self.signer {
            Some(SignerSource::Uri(uri)) => Ok(uri.clone()),
            Some(SignerSource::File(path)) => {
                let uri = tokio::fs::read_to_string(path)
                    .await
                    .with_context(|| format!("failed to read signer file {}", path.display()))?;
                let uri = uri.trim();
                if uri.is_empty() {
                    bail!("signer file {} is empty", path.display());
                }
                Ok(uri.to_owned())
            }
            None => bail!("no signer configured; set --signer-uri or --signer-file"),
        }
    }
}

impl FromStr for SignerSource {
    type Err = anyhow::Error;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        if value.trim().is_empty() {
            bail!("signer URI cannot be empty");
        }
        Ok(Self::Uri(value.to_owned()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_cli_roles_and_failover_urls() {
        let cli = Cli::try_parse_from([
            "keeper",
            "--node-url",
            "wss://one.example",
            "--node-url",
            "wss://two.example",
            "--enabled-roles",
            "tick,oracle-close",
            "--obs-interval",
            "12",
            "--dry-run",
        ])
        .expect("test CLI should parse");
        let config = Config::merge(cli, FileConfig::default()).expect("config should merge");
        assert_eq!(config.node_urls.len(), 2);
        assert_eq!(config.obs_interval, Some(12));
        assert!(config.dry_run);
        assert_eq!(config.enabled_roles, [Role::Tick, Role::OracleClose].into());
    }

    #[test]
    fn file_values_are_used_and_cli_wins() {
        let file: FileConfig = toml::from_str(
            r#"
                node_urls = ["wss://file.example"]
                signer_uri = "//Bob"
                enabled_roles = ["cleanup"]
                obs_interval = 20
                cooldown_depth = 9
                genesis_hash = "0x1111111111111111111111111111111111111111111111111111111111111111"

                [call_hashes]
                "Epoch.tick" = "0x2222222222222222222222222222222222222222222222222222222222222222"
            "#,
        )
        .expect("test TOML should parse");
        let cli =
            Cli::try_parse_from(["keeper", "--obs-interval", "7"]).expect("test CLI should parse");
        let config = Config::merge(cli, file).expect("config should merge");
        assert_eq!(config.node_urls, ["wss://file.example"]);
        assert_eq!(config.signer, Some(SignerSource::Uri("//Bob".to_owned())));
        assert_eq!(config.obs_interval, Some(7));
        assert_eq!(config.cooldown_depth, 9);
        assert_eq!(config.enabled_roles, [Role::Cleanup].into());
    }

    #[test]
    fn rejects_zero_intervals() {
        let cli = Cli::try_parse_from(["keeper", "--obs-interval", "0", "--dry-run"])
            .expect("test CLI should parse");
        assert!(Config::merge(cli, FileConfig::default()).is_err());
    }

    #[test]
    fn refuses_to_start_without_an_explicit_signer_unless_dry_run() {
        let cli = Cli::try_parse_from(["keeper"]).expect("test CLI should parse");
        let error = Config::merge(cli, FileConfig::default())
            .expect_err("live mode without a signer must fail");
        let message = error.to_string();
        assert!(message.contains("--signer-uri"));
        assert!(message.contains("--signer-file"));
        assert!(message.contains("--dry-run"));

        let cli =
            Cli::try_parse_from(["keeper", "--dry-run"]).expect("test dry-run CLI should parse");
        let config =
            Config::merge(cli, FileConfig::default()).expect("dry-run should not require a signer");
        assert!(config.dry_run);
        assert_eq!(config.signer, None);
    }
}

/// Validate one `Pallet.call` -> shape entry and record it, from either source.
fn insert_call_hash(
    into: &mut BTreeMap<String, [u8; 32]>,
    key: &str,
    raw: &str,
) -> anyhow::Result<()> {
    let key = key.trim();
    if key.split('.').count() != 2 || key.split('.').any(str::is_empty) {
        bail!("call_hashes key {key:?} must be \"Pallet.call\"");
    }
    let hash = parse_h256(raw).with_context(|| format!("invalid call_hashes.{key}"))?;
    into.insert(key.to_owned(), hash);
    Ok(())
}

/// Parse a 0x-prefixed 32-byte hex string.
fn parse_h256(raw: &str) -> anyhow::Result<[u8; 32]> {
    let trimmed = raw.trim();
    let body = trimmed.strip_prefix("0x").unwrap_or(trimmed);
    if body.len() != 64 {
        bail!("expected 32 hex bytes, got {} characters", body.len());
    }
    let mut out = [0u8; 32];
    for (index, byte) in out.iter_mut().enumerate() {
        let pair = body
            .get(index * 2..index * 2 + 2)
            .ok_or_else(|| anyhow::anyhow!("truncated hex"))?;
        *byte = u8::from_str_radix(pair, 16).context("non-hexadecimal digit")?;
    }
    Ok(out)
}

/// Render a 32-byte hash the way the config file accepts it.
pub fn format_h256(bytes: &[u8; 32]) -> String {
    let mut out = String::with_capacity(66);
    out.push_str("0x");
    for byte in bytes {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

#[cfg(test)]
mod chain_identity_tests {
    use super::*;

    /// MAX-07. The keeper holds a funded signing key and derived every byte it
    /// signed from the node it was asking. `node_urls` legitimately names a
    /// third party (doc 01 §4.2 provisions RPC operators as a role distinct
    /// from keeper operators, and `main.rs` rotates the endpoint on every
    /// connection attempt), so the data that party serves is untrusted network
    /// input — while `PolkadotConfig::default()` carries `genesis_hash: None`
    /// and subxt therefore takes the node's own answer for which chain this is.
    #[test]
    fn genesis_hash_pins_parse_and_round_trip() {
        let raw = "0x".to_owned() + &"ab".repeat(32);
        let parsed = parse_h256(&raw).expect("valid pin");
        assert_eq!(parsed, [0xabu8; 32]);
        assert_eq!(format_h256(&parsed), raw);
        // The 0x prefix is optional and surrounding whitespace is ignored.
        assert_eq!(
            parse_h256(&format!("  {}  ", "ab".repeat(32))).unwrap(),
            parsed
        );
    }

    #[test]
    fn malformed_pins_are_rejected_rather_than_truncated() {
        for raw in ["0x", "0xzz", &"ab".repeat(31), &"ab".repeat(33)] {
            assert!(parse_h256(raw).is_err(), "{raw:?} must not parse");
        }
    }

    #[test]
    fn call_hash_keys_must_name_a_pallet_and_a_call() {
        let hash = "0x".to_owned() + &"cd".repeat(32);
        for key in ["Epoch", "Epoch.", ".tick", "Epoch.tick.extra"] {
            let file = FileConfig {
                call_hashes: Some(BTreeMap::from([(key.to_owned(), hash.clone())])),
                dry_run: Some(true),
                ..Default::default()
            };
            assert!(
                Config::merge(Cli::parse_from(["keeper", "--dry-run"]), file).is_err(),
                "{key:?} must be rejected"
            );
        }
    }

    #[test]
    fn well_formed_pins_are_accepted() {
        let file = FileConfig {
            genesis_hash: Some("0x".to_owned() + &"11".repeat(32)),
            call_hashes: Some(BTreeMap::from([(
                "Epoch.tick".to_owned(),
                "0x".to_owned() + &"22".repeat(32),
            )])),
            dry_run: Some(true),
            ..Default::default()
        };
        let config = Config::merge(Cli::parse_from(["keeper", "--dry-run"]), file)
            .expect("pins are well formed");

        assert_eq!(config.genesis_hash, Some([0x11u8; 32]));
        assert_eq!(config.call_hashes.get("Epoch.tick"), Some(&[0x22u8; 32]));
    }

    /// Both pins were optional and both defaulted to absent, so the documented
    /// quickstart produced a keeper that signed whatever call shape the endpoint
    /// declared, on whichever chain it claimed to be. The mitigation existed and
    /// was correct; it was simply off. Live mode now refuses to start.
    /// Regression for the 2026-08-10 security review.
    #[test]
    fn live_mode_refuses_an_endpoint_it_has_not_pinned() {
        let signer = ["keeper", "--signer-uri", "//Alice"];

        let unpinned = Config::merge(Cli::parse_from(signer), FileConfig::default())
            .expect_err("an unpinned live keeper must not start");
        assert!(
            unpinned.to_string().contains("no pinned call shapes"),
            "{unpinned}"
        );

        // Call shapes pinned, chain identity still not: also refused, because a
        // keeper that signs for the wrong chain is the other half of the same
        // problem.
        let calls_only = Config::merge(
            Cli::parse_from([
                "keeper",
                "--signer-uri",
                "//Alice",
                "--call-hash",
                &format!("Epoch.tick=0x{}", "22".repeat(32)),
            ]),
            FileConfig::default(),
        )
        .expect_err("a live keeper without a genesis pin must not start");
        assert!(
            calls_only.to_string().contains("no pinned genesis hash"),
            "{calls_only}"
        );
    }

    /// The two ways back in, and nothing else: `--dry-run`, which signs nothing
    /// and is how an operator collects the values to pin, and an explicit
    /// opt-out that the operator has to write down.
    #[test]
    fn dry_run_and_the_explicit_opt_out_are_the_only_unpinned_paths() {
        let dry = Config::merge(
            Cli::parse_from(["keeper", "--dry-run"]),
            FileConfig::default(),
        )
        .expect("dry run signs nothing, so it needs no pins");
        assert!(!dry.allow_unpinned_endpoint);

        let opted_out = Config::merge(
            Cli::parse_from([
                "keeper",
                "--signer-uri",
                "//Alice",
                "--allow-unpinned-endpoint",
            ]),
            FileConfig::default(),
        )
        .expect("the operator asked for the old posture explicitly");
        assert!(opted_out.allow_unpinned_endpoint);
        assert!(opted_out.call_hashes.is_empty());

        // The file may carry the same decision, for an operator who configures
        // by file rather than by flag.
        let by_file = Config::merge(
            Cli::parse_from(["keeper", "--signer-uri", "//Alice"]),
            FileConfig {
                allow_unpinned_endpoint: Some(true),
                ..Default::default()
            },
        )
        .expect("the file carries the same explicit decision");
        assert!(by_file.allow_unpinned_endpoint);
    }

    /// Pinning must not require authoring a TOML file: there was no CLI flag for
    /// call shapes at all, which is part of why the quickstart left them empty.
    #[test]
    fn call_hash_flags_pin_without_a_config_file_and_win_over_it() {
        let config = Config::merge(
            Cli::parse_from([
                "keeper",
                "--signer-uri",
                "//Alice",
                "--genesis-hash",
                &format!("0x{}", "11".repeat(32)),
                "--call-hash",
                &format!("Epoch.tick=0x{}", "22".repeat(32)),
                "--call-hash",
                &format!("Market.crank_close=0x{}", "33".repeat(32)),
            ]),
            FileConfig {
                call_hashes: Some(BTreeMap::from([(
                    "Epoch.tick".to_owned(),
                    "0x".to_owned() + &"44".repeat(32),
                )])),
                ..Default::default()
            },
        )
        .expect("flag-only pinning is a supported path");

        assert_eq!(config.call_hashes.len(), 2);
        assert_eq!(config.call_hashes.get("Epoch.tick"), Some(&[0x22u8; 32]));
        assert_eq!(
            config.call_hashes.get("Market.crank_close"),
            Some(&[0x33u8; 32])
        );

        for malformed in ["Epoch.tick", &format!("Epoch=0x{}", "22".repeat(32))] {
            assert!(
                Config::merge(
                    Cli::parse_from(["keeper", "--dry-run", "--call-hash", malformed]),
                    FileConfig::default(),
                )
                .is_err(),
                "{malformed:?} must be rejected"
            );
        }
    }
}
