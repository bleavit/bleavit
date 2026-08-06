//! The embedded-tree assertion — F22 (10 §10.1; 12 §1).
//!
//! A desktop build carries the application inside its own binary. Everything doc 12 §1
//! promises about a Bleavit release — a per-file SHA-256 map, a signed `release.json`, two
//! independent rebuilds agreeing byte for byte — is a promise about the tree that was
//! published. A downloaded shell is covered by those promises only if the tree it embeds *is*
//! that tree, so this crate compares the two and the shell refuses to open a window when they
//! disagree.
//!
//! # It is the same comparison the browser runs, deliberately
//!
//! `app/packages/verify/src/self-check.ts` is the INV-FE-8 mechanism, and its own
//! documentation already anticipates this caller: hashing belongs to the caller because the
//! platforms differ, while the comparison belongs in one tested place. Two languages cannot
//! literally share a function, so what is shared instead is a **corpus**: `fixtures/
//! self-check-cases.json` is read in place by this crate's tests and by
//! `app/tests/platform/embedded-tree.test.ts`, and a divergence between the two
//! implementations turns one of them red.
//!
//! Three properties are carried over exactly, because each fails silently if dropped:
//!
//! 1. **Three directions, not a boolean.** `Missing`, `Changed` and `Unexpected` are separate
//!    findings. The third is the one a manifest-driven loop cannot see — nothing the manifest
//!    lists has changed, so iterating the manifest reports everything in order while an extra
//!    file sits in the tree. That is how a payload arrives.
//! 2. **An empty manifest refuses.** A comparison over no pins returns "all verified" having
//!    verified nothing.
//! 3. **There is no repair path.** INV-FE-8 closes with *"detected divergence is surfaced to
//!    the user; it is never silently repaired."* This crate returns findings and exposes no
//!    function that makes one go away.
//!
//! # There is no partial start
//!
//! The browser's self-check runs in an application that is already on screen, so its result is
//! rendered. A shell has a stronger option and takes it: the comparison runs **before the
//! window exists**, so a divergent build never renders anything at all. That is the whole of
//! what the desktop channel adds, and it is why the check lives here rather than in the page.

#![forbid(unsafe_code)]

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

use serde::Deserialize;
use sha2::{Digest, Sha256};

/// A lowercase hex SHA-256, as `release.json` writes it: 64 characters, no `0x`.
pub type Sha256Hex = String;

/// Hash bytes into the spelling the release manifest uses.
#[must_use]
pub fn sha256_hex(bytes: &[u8]) -> Sha256Hex {
    let digest = Sha256::digest(bytes);
    let mut out = String::with_capacity(64);
    for byte in digest {
        // Written by hand rather than through a hex crate: two lines against a dependency in
        // the one code path that decides whether a build may start.
        out.push(nibble(byte >> 4));
        out.push(nibble(byte & 0x0f));
    }
    out
}

fn nibble(value: u8) -> char {
    match value {
        0..=9 => (b'0' + value) as char,
        _ => (b'a' + value - 10) as char,
    }
}

/// Normalise an asset key to the spelling `release.json.perFileHashes` uses.
///
/// Tauri's `AssetKey` is rooted — `/index.html`, `/assets/app.js` — and the release manifest
/// is release-relative with no leading slash. Getting this wrong does not produce a crash: it
/// produces a report in which **every** file is both `Missing` and `Unexpected`, which is
/// fail-closed and tells nobody anything, and which somebody would then "fix" by relaxing the
/// comparison. So it lives in one place, on both sides of the language boundary, and is tested.
#[must_use]
pub fn normalise_key(key: &str) -> String {
    key.strip_prefix('/').unwrap_or(key).to_owned()
}

/// The part of `release.json` this comparison reads.
///
/// Only `perFileHashes`, and that is the same narrowing `PinnedFiles` makes on the TypeScript
/// side: the remaining INV-FE-11 pins are checked against a live chain by the application, not
/// against a tree by a build step, and requiring them here would mean fabricating blanks.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReleaseManifest {
    per_file_hashes: BTreeMap<String, Sha256Hex>,
}

#[derive(Deserialize)]
struct RawManifest {
    #[serde(rename = "perFileHashes")]
    per_file_hashes: Option<BTreeMap<String, String>>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ManifestError {
    /// The bytes are not JSON, or `perFileHashes` is not a string map.
    Unreadable(String),
    /// The document pins no files. Refused — see property 2 in this module's header.
    NoPins,
    /// A pin is present and is not a SHA-256. Refused for the same reason a missing one is:
    /// it is a comparison that can never match, shipped in a record claiming completeness.
    MalformedPin { path: String, value: String },
}

impl fmt::Display for ManifestError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unreadable(detail) => write!(formatter, "release.json is unreadable: {detail}"),
            Self::NoPins => write!(
                formatter,
                "release.json pins no file hashes, so a comparison over it would verify \
                 nothing and report success; refusing to treat that as a passing check"
            ),
            Self::MalformedPin { path, value } => write!(
                formatter,
                "release.json pins {path} to {value}, which is not a lowercase hex SHA-256"
            ),
        }
    }
}

impl std::error::Error for ManifestError {}

impl ReleaseManifest {
    /// Parse the signed release document's pin map, refusing every uncheckable shape.
    ///
    /// # Errors
    ///
    /// Returns [`ManifestError`] when the document does not parse, pins nothing, or carries a
    /// pin that is not a SHA-256.
    pub fn parse(bytes: &[u8]) -> Result<Self, ManifestError> {
        let raw: RawManifest = serde_json::from_slice(bytes)
            .map_err(|error| ManifestError::Unreadable(error.to_string()))?;
        let Some(pins) = raw.per_file_hashes else {
            return Err(ManifestError::NoPins);
        };
        if pins.is_empty() {
            return Err(ManifestError::NoPins);
        }
        for (path, value) in &pins {
            if value.len() != 64
                || !value
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            {
                return Err(ManifestError::MalformedPin {
                    path: path.clone(),
                    value: value.clone(),
                });
            }
        }
        Ok(Self {
            per_file_hashes: pins,
        })
    }

    #[must_use]
    pub fn pinned_count(&self) -> usize {
        self.per_file_hashes.len()
    }

    #[must_use]
    pub fn paths(&self) -> BTreeSet<&str> {
        self.per_file_hashes.keys().map(String::as_str).collect()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FindingKind {
    /// Signed, served, and not the same bytes.
    Changed,
    /// Signed and not present.
    Missing,
    /// Present and signed by nobody — the direction a manifest-driven loop cannot see.
    Unexpected,
}

impl FindingKind {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Changed => "changed",
            Self::Missing => "missing",
            Self::Unexpected => "unexpected",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Finding {
    pub kind: FindingKind,
    pub path: String,
    /// What the signed manifest pins. Absent for an `Unexpected` file.
    pub pinned: Option<Sha256Hex>,
    /// What the binary actually carries. Absent for a `Missing` file.
    pub served: Option<Sha256Hex>,
    /// What a person is told. Never phrased as a transient problem.
    pub detail: String,
}

#[derive(Debug, Clone)]
pub struct SelfCheckReport {
    pub findings: Vec<Finding>,
    pub pinned_count: usize,
    pub verified_count: usize,
}

impl SelfCheckReport {
    #[must_use]
    pub fn ok(&self) -> bool {
        self.findings.is_empty()
    }
}

impl fmt::Display for SelfCheckReport {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(
            formatter,
            "{}/{} pinned file(s) verified",
            self.verified_count, self.pinned_count
        )?;
        for finding in &self.findings {
            writeln!(formatter, "  {}: {}", finding.kind.as_str(), finding.detail)?;
        }
        Ok(())
    }
}

/// Compare a digest map against the signed manifest.
///
/// `served` maps a normalised release-relative path to the digest of the bytes the binary
/// actually carries. Hashing is the caller's job — see [`hash_tree`] — because the shell reads
/// its tree out of itself while a build step reads one off a disk, and the part that decides
/// whether a build may start should not depend on which.
#[must_use]
pub fn run_self_check(
    manifest: &ReleaseManifest,
    served: &BTreeMap<String, Sha256Hex>,
) -> SelfCheckReport {
    let mut findings = Vec::new();
    let mut verified_count = 0usize;

    for (path, pinned) in &manifest.per_file_hashes {
        match served.get(path) {
            None => findings.push(Finding {
                kind: FindingKind::Missing,
                path: path.clone(),
                pinned: Some(pinned.clone()),
                served: None,
                detail: format!("{path} is part of this signed release and is not in this build"),
            }),
            Some(actual) if actual != pinned => findings.push(Finding {
                kind: FindingKind::Changed,
                path: path.clone(),
                pinned: Some(pinned.clone()),
                served: Some(actual.clone()),
                detail: format!(
                    "{path} does not match the hash this release signed. The file in this \
                     download is not the file that was published."
                ),
            }),
            Some(_) => verified_count += 1,
        }
    }

    for (path, actual) in served {
        if !manifest.per_file_hashes.contains_key(path) {
            findings.push(Finding {
                kind: FindingKind::Unexpected,
                path: path.clone(),
                pinned: None,
                served: Some(actual.clone()),
                detail: format!(
                    "{path} is in this build and is not part of the signed release. Nothing \
                     that was published is missing or altered, which is why this is reported \
                     separately."
                ),
            });
        }
    }

    SelfCheckReport {
        findings,
        pinned_count: manifest.per_file_hashes.len(),
        verified_count,
    }
}

/// Hash a `path → bytes` tree into the shape [`run_self_check`] compares.
///
/// Keys are normalised on the way in, so a caller handing rooted Tauri asset keys and a caller
/// handing release-relative paths produce the same map.
#[must_use]
pub fn hash_tree<'a, I>(entries: I) -> BTreeMap<String, Sha256Hex>
where
    I: IntoIterator<Item = (&'a str, &'a [u8])>,
{
    entries
        .into_iter()
        .map(|(key, bytes)| (normalise_key(key), sha256_hex(bytes)))
        .collect()
}

#[derive(Debug)]
pub enum AttestationError {
    Manifest(ManifestError),
    /// The build carries no assets at all. A comparison over an empty tree against a non-empty
    /// manifest would report every file missing, which is correct but hides the real fact:
    /// asset embedding did not happen.
    EmptyTree,
    /// The asset table listed a key the binary cannot serve.
    ///
    /// Refused rather than folded into the comparison, and the direction matters. The obvious
    /// implementation substitutes empty bytes — and the SHA-256 of nothing is a **real digest**,
    /// so a legitimately zero-byte pinned file on an unserveable key would *verify*. Dropping
    /// the key instead is worse: the file silently stops being checked. Neither is a comparison
    /// result, so this is an error and not a [`Finding`].
    UnserveableAsset {
        key: String,
    },
    Divergent(SelfCheckReport),
}

impl fmt::Display for AttestationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Manifest(error) => write!(formatter, "{error}"),
            Self::EmptyTree => write!(
                formatter,
                "this build embeds no assets at all, so there is nothing for the signed \
                 release manifest to describe"
            ),
            Self::UnserveableAsset { key } => write!(
                formatter,
                "this build lists {key} among its embedded files and cannot read it back, so \
                 there is no byte string to compare against the signed release manifest"
            ),
            Self::Divergent(report) => write!(
                formatter,
                "this build does not match the release it claims to be:\n{report}"
            ),
        }
    }
}

impl std::error::Error for AttestationError {}

/// Hash the shell's own asset table into the shape [`run_self_check`] compares.
///
/// Takes `Option<&[u8]>` because that is exactly what a Tauri asset table yields: a key list,
/// and a lookup per key that can answer `None`. Modelling the `None` here rather than at the
/// call site is what makes it testable — the shell's `Context<Wry>` cannot be constructed in a
/// unit test, so anything decided there is decided in code no suite executes.
///
/// # Errors
///
/// Returns [`AttestationError::UnserveableAsset`] for a key the caller could not read back.
pub fn hash_assets<'a, I>(entries: I) -> Result<BTreeMap<String, Sha256Hex>, AttestationError>
where
    I: IntoIterator<Item = (&'a str, Option<&'a [u8]>)>,
{
    let mut out = BTreeMap::new();
    for (key, bytes) in entries {
        let Some(bytes) = bytes else {
            return Err(AttestationError::UnserveableAsset {
                key: normalise_key(key),
            });
        };
        out.insert(normalise_key(key), sha256_hex(bytes));
    }
    Ok(out)
}

/// The whole assertion, as the shell calls it.
///
/// # Errors
///
/// Returns [`AttestationError`] when the manifest is uncheckable, the build embeds nothing, an
/// asset cannot be read back, or any file is missing, changed or unexpected. There is
/// deliberately no argument that softens any of those into a warning.
pub fn attest<'a, I>(manifest_bytes: &[u8], entries: I) -> Result<SelfCheckReport, AttestationError>
where
    I: IntoIterator<Item = (&'a str, Option<&'a [u8]>)>,
{
    let manifest = ReleaseManifest::parse(manifest_bytes).map_err(AttestationError::Manifest)?;
    let served = hash_assets(entries)?;
    if served.is_empty() {
        return Err(AttestationError::EmptyTree);
    }
    let report = run_self_check(&manifest, &served);
    if report.ok() {
        Ok(report)
    } else {
        Err(AttestationError::Divergent(report))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    /// The differential corpus, read in place by this crate and by
    /// `app/tests/platform/embedded-tree.test.ts`. Hand-authored rather than generated,
    /// because what it certifies is that two independent implementations agree — a corpus
    /// produced by either would certify that one agrees with itself.
    #[derive(Deserialize)]
    struct Corpus {
        cases: Vec<Case>,
    }

    #[derive(Deserialize)]
    struct Case {
        name: String,
        #[serde(rename = "perFileHashes")]
        per_file_hashes: BTreeMap<String, String>,
        /// path → the file's **content**, which each side hashes itself. Publishing content
        /// rather than digests is what makes this a differential: a corpus of digests would
        /// never exercise either side's hash function.
        tree: BTreeMap<String, String>,
        expected: Vec<ExpectedFinding>,
        #[serde(rename = "expectedVerified")]
        expected_verified: usize,
    }

    #[derive(Deserialize)]
    struct ExpectedFinding {
        kind: String,
        path: String,
    }

    fn corpus() -> Corpus {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures/self-check-cases.json");
        let bytes = std::fs::read(&path).unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[test]
    fn the_corpus_agrees_with_this_implementation() {
        let corpus = corpus();
        assert!(corpus.cases.len() >= 6, "the corpus lost cases");
        for case in &corpus.cases {
            let document = serde_json::json!({ "perFileHashes": case.per_file_hashes });
            let manifest = ReleaseManifest::parse(document.to_string().as_bytes()).unwrap();
            let served: BTreeMap<String, Sha256Hex> = case
                .tree
                .iter()
                .map(|(path, content)| (normalise_key(path), sha256_hex(content.as_bytes())))
                .collect();
            let report = run_self_check(&manifest, &served);

            let mut actual: Vec<(String, String)> = report
                .findings
                .iter()
                .map(|finding| (finding.kind.as_str().to_owned(), finding.path.clone()))
                .collect();
            let mut expected: Vec<(String, String)> = case
                .expected
                .iter()
                .map(|finding| (finding.kind.clone(), finding.path.clone()))
                .collect();
            actual.sort();
            expected.sort();
            assert_eq!(actual, expected, "case {}", case.name);
            assert_eq!(
                report.verified_count, case.expected_verified,
                "case {}",
                case.name
            );
            assert_eq!(report.ok(), case.expected.is_empty(), "case {}", case.name);
        }
    }

    /// The corpus must exercise every finding kind and at least one clean case. A corpus that
    /// drifted to only the easy cases would still pass the test above.
    #[test]
    fn the_corpus_covers_every_direction() {
        let corpus = corpus();
        let kinds: BTreeSet<&str> = corpus
            .cases
            .iter()
            .flat_map(|case| case.expected.iter().map(|finding| finding.kind.as_str()))
            .collect();
        assert_eq!(
            kinds,
            BTreeSet::from(["changed", "missing", "unexpected"]),
            "the differential corpus must exercise all three directions"
        );
        assert!(
            corpus.cases.iter().any(|case| case.expected.is_empty()),
            "without a clean case the corpus proves only that everything is rejected"
        );
    }

    #[test]
    fn an_empty_manifest_is_refused_rather_than_passing() {
        assert_eq!(
            ReleaseManifest::parse(br#"{"perFileHashes":{}}"#),
            Err(ManifestError::NoPins)
        );
        assert_eq!(ReleaseManifest::parse(b"{}"), Err(ManifestError::NoPins));
    }

    #[test]
    fn a_pin_that_is_not_a_hash_is_refused() {
        let error = ReleaseManifest::parse(br#"{"perFileHashes":{"a.js":"NOTAHASH"}}"#);
        assert!(matches!(error, Err(ManifestError::MalformedPin { .. })));
        // Upper-case hex is refused too: the manifest's spelling is lowercase, and a
        // case-insensitive comparison here would disagree with the browser's `/^[0-9a-f]{64}$/`.
        let upper = format!("{:A>64}", "");
        let document = format!(r#"{{"perFileHashes":{{"a.js":"{upper}"}}}}"#);
        assert!(matches!(
            ReleaseManifest::parse(document.as_bytes()),
            Err(ManifestError::MalformedPin { .. })
        ));
    }

    #[test]
    fn an_empty_tree_is_refused_rather_than_reported_as_all_missing() {
        let document = format!(r#"{{"perFileHashes":{{"a.js":"{}"}}}}"#, sha256_hex(b"x"));
        let empty: Vec<(&str, Option<&[u8]>)> = Vec::new();
        assert!(matches!(
            attest(document.as_bytes(), empty),
            Err(AttestationError::EmptyTree)
        ));
    }

    /// The shell's own asset-table shape, which is why `hash_assets` takes `Option`.
    ///
    /// A Tauri `Context<Wry>` cannot be constructed in a unit test, so a `None` decided at the
    /// call site would be decided in code no suite executes. The obvious decision there is to
    /// substitute empty bytes — and this is why that is wrong: `sha256("")` is a **real
    /// digest**, so a legitimately zero-byte pinned file on an unserveable key would verify.
    /// Both halves are asserted, because the second is the one a green run cannot show.
    #[test]
    fn an_asset_the_binary_cannot_read_back_is_refused_not_hashed_as_empty() {
        let empty_digest = sha256_hex(b"");
        let document = format!(r#"{{"perFileHashes":{{"a.js":"{empty_digest}"}}}}"#);
        let entries: Vec<(&str, Option<&[u8]>)> = vec![("/a.js", None)];
        match attest(document.as_bytes(), entries) {
            Err(AttestationError::UnserveableAsset { key }) => assert_eq!(key, "a.js"),
            other => panic!("expected UnserveableAsset, got {other:?}"),
        }
        // The negative control: the same manifest and a genuinely zero-byte asset verifies, so
        // the refusal above is about the unreadable key and not about the digest.
        let served: Vec<(&str, Option<&[u8]>)> = vec![("/a.js", Some(b"".as_slice()))];
        let report = attest(document.as_bytes(), served).unwrap();
        assert!(report.ok());
        assert_eq!(report.verified_count, 1);
    }

    #[test]
    fn hash_assets_normalises_rooted_keys_and_refuses_an_unreadable_one() {
        let entries: Vec<(&str, Option<&[u8]>)> = vec![
            ("/index.html", Some(b"<!doctype html>\n".as_slice())),
            ("assets/app.js", Some(b"export const app = 1;\n".as_slice())),
        ];
        let hashed = hash_assets(entries).unwrap();
        assert_eq!(
            hashed.keys().collect::<Vec<_>>(),
            vec!["assets/app.js", "index.html"]
        );
        let broken: Vec<(&str, Option<&[u8]>)> =
            vec![("/index.html", Some(b"x".as_slice())), ("/gone.js", None)];
        assert!(matches!(
            hash_assets(broken),
            Err(AttestationError::UnserveableAsset { .. })
        ));
    }

    /// The key-spelling trap, asserted rather than assumed. Tauri hands rooted keys and the
    /// manifest is release-relative; if only one side normalised, every file would be reported
    /// as both missing and unexpected and the assertion would be useless while still failing.
    #[test]
    fn rooted_tauri_keys_and_manifest_paths_meet() {
        let content = b"console.log(1)\n";
        let document = format!(
            r#"{{"perFileHashes":{{"assets/app.js":"{}"}}}}"#,
            sha256_hex(content)
        );
        let entries: Vec<(&str, Option<&[u8]>)> =
            vec![("/assets/app.js", Some(content.as_slice()))];
        let report = attest(document.as_bytes(), entries).unwrap();
        assert!(report.ok());
        assert_eq!(report.verified_count, 1);
    }

    #[test]
    fn sha256_hex_matches_the_known_digest_of_the_empty_string() {
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    /// There is no repair path, and that is enforced by absence. The test states the rule so a
    /// future addition has to delete an assertion that says why it must not exist.
    #[test]
    fn the_crate_exposes_no_way_to_make_a_divergence_go_away() {
        let source = include_str!("lib.rs");
        // The needle is assembled rather than written, so this test does not fail on its own
        // list of names — which is what the first version did, and is a neat illustration of
        // why a source scan needs a negative control.
        for name in [
            "repair",
            "refetch",
            "ignore_finding",
            "force_start",
            "override_divergence",
        ] {
            let needle = format!("fn {name}");
            assert!(
                !source.contains(&needle),
                "INV-FE-8: divergence is surfaced, never repaired — found {needle}"
            );
        }
        // The negative control: the scan must be able to find something. Without it, a typo in
        // the needle makes this test pass for the reason it exists to prevent.
        assert!(source.contains(&format!("fn {}", "run_self_check")));
    }
}
