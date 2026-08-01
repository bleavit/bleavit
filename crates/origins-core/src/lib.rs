#![cfg_attr(not(feature = "std"), no_std)]
#![deny(unsafe_code)]

extern crate alloc;

use alloc::vec::Vec;
// 06 §3.3 wrapper bounds are kernel `K` constants single-homed in
// `futarchy-primitives` (13 §1 `MAX_NESTED` = 4 levels / ≤ 16 calls; 01 §5.2:
// downstream cores import, never re-declare). SQ-25 / Track-M audit fix.
use futarchy_primitives::kernel::{MAX_NESTED_CALLS, MAX_NESTED_LEVELS};
use futarchy_primitives::ProposalClass;
use parity_scale_codec::{Decode, Encode, MaxEncodedLen};
use scale_info::TypeInfo;

#[derive(Clone, Copy, Debug, Decode, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo)]
pub enum Origin {
    FutarchyParam,
    FutarchyTreasury,
    FutarchyCode,
    FutarchyMeta,
    ConstitutionalValues,
    OracleResolution,
    GuardianHold,
    EmergencyPlaybook,
}

impl Origin {
    pub const fn from_proposal_class(class: ProposalClass) -> Option<Self> {
        match class {
            ProposalClass::Param => Some(Self::FutarchyParam),
            ProposalClass::Treasury => Some(Self::FutarchyTreasury),
            ProposalClass::Code => Some(Self::FutarchyCode),
            ProposalClass::Meta => Some(Self::FutarchyMeta),
            ProposalClass::Constitutional => None,
        }
    }
}

#[derive(Clone, Copy, Debug, Decode, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo)]
pub enum CallDomain {
    Public,
    Nobody,
    Param,
    Treasury,
    Code,
    Meta,
    ConstitutionalValues,
    OracleResolution,
    GuardianHold,
    EmergencyPlaybook,
    InternalRoot,
    /// The hosted question service's client domain (D-20; [16] §3.1). Appended
    /// last — SCALE discriminants are positional.
    ///
    /// Two properties define it, and they pull in opposite directions on
    /// purpose:
    ///
    /// * **No governance origin reaches it.** [`Self::allowed_for`] is `false`
    ///   for every `Some(Origin::_)`, so the eight governance origins and this
    ///   domain are disjoint by construction rather than by review. That is
    ///   what makes 06 §1's eight-origin closure clause stay literally true
    ///   while a twelfth domain exists.
    /// * **`allowed_for(None)` is `true`**, and this is a genuine widening
    ///   stated rather than hidden. Off-chain services cannot send XCM and use
    ///   the identical calls from a local signed account ([16] §2), so the
    ///   domain must admit a plain signed origin. The consequence is that the
    ///   owning pallet's own `EnsureOrigin` is **load-bearing** in a way the
    ///   eight governance origins' is not. The alternative — routing these
    ///   calls through `dispatch_bypass_filter` — is worse under R-7, because
    ///   it removes the filter from the path entirely rather than making it
    ///   decisive.
    ///
    /// It is deliberately **not** added to [`Self::is_privileged`]'s exempt
    /// set, so a client-domain call inside a proxy-ish wrapper is refused
    /// `PrivilegedWrapper` (I-10/I-11). The cost is that an off-chain service
    /// cannot batch or proxy these calls; the benefit is that no wrapper path
    /// can carry one under another account's origin. R-7 picks the refusal.
    ExternalClient,
}

impl CallDomain {
    pub const fn is_privileged(self) -> bool {
        !matches!(self, Self::Public | Self::Nobody)
    }

    pub const fn allowed_for(self, origin: Option<Origin>) -> bool {
        match self {
            Self::Public => true,
            Self::Nobody | Self::InternalRoot => false,
            Self::Param => matches!(origin, Some(Origin::FutarchyParam)),
            Self::Treasury => matches!(origin, Some(Origin::FutarchyTreasury)),
            Self::Code => matches!(origin, Some(Origin::FutarchyCode)),
            Self::Meta => matches!(origin, Some(Origin::FutarchyMeta)),
            Self::ConstitutionalValues => matches!(origin, Some(Origin::ConstitutionalValues)),
            Self::OracleResolution => matches!(origin, Some(Origin::OracleResolution)),
            Self::GuardianHold => matches!(origin, Some(Origin::GuardianHold)),
            Self::EmergencyPlaybook => matches!(origin, Some(Origin::EmergencyPlaybook)),
            // Reachable by no governance origin, and by a plain signed origin
            // only. See the variant's own documentation for why both halves
            // are deliberate.
            Self::ExternalClient => origin.is_none(),
        }
    }
}

#[derive(Clone, Debug, Decode, Encode, Eq, PartialEq, TypeInfo)]
pub enum RuntimeCall {
    Leaf(CallDomain),
    UtilityBatch(Vec<RuntimeCall>),
    UtilityBatchAll(Vec<RuntimeCall>),
    UtilityForceBatch(Vec<RuntimeCall>),
    UtilityDispatchAs(BoxedCall),
    UtilityAsDerivative(BoxedCall),
    UtilityWithWeight(BoxedCall),
    Proxy(BoxedCall),
    ProxyAnnounced(BoxedCall),
    MultisigAsMulti(BoxedCall),
    MultisigAsMultiThreshold1(BoxedCall),
    MultisigApproveAsMulti,
    Scheduler { origin: Origin, call: BoxedCall },
    Sudo(BoxedCall),
}

#[derive(Clone, Debug, Decode, Encode, Eq, PartialEq, TypeInfo)]
pub struct BoxedCall(pub alloc::boxed::Box<RuntimeCall>);

impl BoxedCall {
    pub fn new(call: RuntimeCall) -> Self {
        Self(alloc::boxed::Box::new(call))
    }
}

#[derive(Clone, Copy, Debug, Decode, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo)]
pub enum Error {
    NobodyCall,
    BadOrigin,
    PrivilegedWrapper,
    DispatchAsDenied,
    SchedulerDenied,
    TooDeep,
    TooManyCalls,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct Budget {
    depth: u32,
    calls: u32,
}

impl Budget {
    const fn root() -> Self {
        Self { depth: 0, calls: 0 }
    }

    fn enter(&mut self) -> Result<(), Error> {
        self.depth = self.depth.checked_add(1).ok_or(Error::TooDeep)?;
        ensure!(self.depth <= MAX_NESTED_LEVELS, Error::TooDeep);
        Ok(())
    }

    fn leave(&mut self) {
        self.depth = self.depth.saturating_sub(1);
    }

    fn count_call(&mut self) -> Result<(), Error> {
        self.calls = self.calls.checked_add(1).ok_or(Error::TooManyCalls)?;
        ensure!(self.calls <= MAX_NESTED_CALLS, Error::TooManyCalls);
        Ok(())
    }
}

pub struct SafetyFilter;

impl SafetyFilter {
    pub fn contains(call: &RuntimeCall) -> bool {
        Self::validate(None, call).is_ok()
    }

    pub fn contains_for(origin: Origin, call: &RuntimeCall) -> bool {
        Self::validate(Some(origin), call).is_ok()
    }

    pub fn validate(origin: Option<Origin>, call: &RuntimeCall) -> Result<(), Error> {
        let mut budget = Budget::root();
        Self::validate_inner(origin, call, &mut budget, false)
    }

    /// Validate a batch of top-level calls under a SINGLE shared budget so the
    /// `MAX_NESTED_CALLS` ("≤ 16 calls total", 06 §3.3 / 09 §1.4) bound is
    /// enforced across the whole payload, not reset once per top-level call.
    /// Each top-level call still gets its own nesting-depth budget (`depth` is
    /// `enter`/`leave`-balanced); only the aggregate call count is shared —
    /// `count_call` is monotone, so it accumulates across siblings. The
    /// execution guard uses this so its frame-free core matches the FRAME
    /// pallet's aggregate re-derivation (differential parity).
    pub fn validate_batch<'a>(
        origin: Option<Origin>,
        calls: impl IntoIterator<Item = &'a RuntimeCall>,
    ) -> Result<(), Error> {
        let mut budget = Budget::root();
        for call in calls {
            Self::validate_inner(origin, call, &mut budget, false)?;
        }
        Ok(())
    }

    // `in_proxyish_wrapper` marks that the walk crossed a proxy/multisig
    // wrapper (06 §3.3: those are denied when the inner call is
    // privileged-domain). The flag makes the check recursive — a privileged
    // leaf hidden under batch/with_weight/sudo layers inside the wrapper is
    // still denied — within the same depth/call budget as the ordinary walk.
    fn validate_inner(
        origin: Option<Origin>,
        call: &RuntimeCall,
        budget: &mut Budget,
        in_proxyish_wrapper: bool,
    ) -> Result<(), Error> {
        budget.count_call()?;
        match call {
            RuntimeCall::Leaf(domain) => match domain {
                CallDomain::Nobody => Err(Error::NobodyCall),
                _ if domain.is_privileged() && in_proxyish_wrapper => Err(Error::PrivilegedWrapper),
                _ if domain.allowed_for(origin) => Ok(()),
                _ => Err(Error::BadOrigin),
            },
            RuntimeCall::UtilityBatch(calls)
            | RuntimeCall::UtilityBatchAll(calls)
            | RuntimeCall::UtilityForceBatch(calls) => {
                Self::validate_many(origin, calls, budget, in_proxyish_wrapper)
            }
            RuntimeCall::UtilityWithWeight(inner) => {
                Self::validate_wrapped(origin, &inner.0, budget, in_proxyish_wrapper)
            }
            RuntimeCall::Proxy(inner)
            | RuntimeCall::ProxyAnnounced(inner)
            | RuntimeCall::MultisigAsMulti(inner)
            | RuntimeCall::MultisigAsMultiThreshold1(inner) => {
                Self::validate_wrapped(origin, &inner.0, budget, true)
            }
            RuntimeCall::MultisigApproveAsMulti => Ok(()),
            RuntimeCall::UtilityDispatchAs(_) | RuntimeCall::UtilityAsDerivative(_) => {
                Err(Error::DispatchAsDenied)
            }
            RuntimeCall::Scheduler { origin, call } => {
                ensure!(
                    matches!(
                        origin,
                        Origin::ConstitutionalValues | Origin::OracleResolution
                    ),
                    Error::SchedulerDenied
                );
                Self::validate_wrapped(Some(*origin), &call.0, budget, in_proxyish_wrapper)
            }
            RuntimeCall::Sudo(inner) => {
                Self::validate_wrapped(origin, &inner.0, budget, in_proxyish_wrapper)
            }
        }
    }

    fn validate_many(
        origin: Option<Origin>,
        calls: &[RuntimeCall],
        budget: &mut Budget,
        in_proxyish_wrapper: bool,
    ) -> Result<(), Error> {
        budget.enter()?;
        for call in calls {
            Self::validate_inner(origin, call, budget, in_proxyish_wrapper)?;
        }
        budget.leave();
        Ok(())
    }

    fn validate_wrapped(
        origin: Option<Origin>,
        call: &RuntimeCall,
        budget: &mut Budget,
        in_proxyish_wrapper: bool,
    ) -> Result<(), Error> {
        budget.enter()?;
        let result = Self::validate_inner(origin, call, budget, in_proxyish_wrapper);
        budget.leave();
        result
    }
}

impl RuntimeCall {
    pub const fn leaf(domain: CallDomain) -> Self {
        Self::Leaf(domain)
    }
}

#[macro_export]
macro_rules! ensure {
    ($cond:expr, $err:expr $(,)?) => {
        if !$cond {
            return Err($err);
        }
    };
}

#[cfg(feature = "runtime-benchmarks")]
pub mod benchmarking {
    pub fn benchmark_stub() {}
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::vec;

    fn boxed(call: RuntimeCall) -> BoxedCall {
        BoxedCall::new(call)
    }

    #[test]
    fn external_client_domain_is_reachable_by_no_governance_origin() {
        // I-35 / 16 §3.1. The whole point of a twelfth domain is that the
        // governance surface and the client surface are disjoint *by
        // construction*. If this ever passes for a `Some(_)`, the XCM ingress
        // has become a governance path.
        let governance = [
            Origin::FutarchyParam,
            Origin::FutarchyTreasury,
            Origin::FutarchyCode,
            Origin::FutarchyMeta,
            Origin::ConstitutionalValues,
            Origin::OracleResolution,
            Origin::GuardianHold,
            Origin::EmergencyPlaybook,
        ];
        for origin in governance {
            assert!(
                !CallDomain::ExternalClient.allowed_for(Some(origin)),
                "{origin:?} must not reach the client domain"
            );
        }
        // And the converse: no governance domain is reachable *without* an
        // origin, so the widening below cannot leak the other way.
        for domain in [
            CallDomain::Param,
            CallDomain::Treasury,
            CallDomain::Code,
            CallDomain::Meta,
            CallDomain::ConstitutionalValues,
            CallDomain::OracleResolution,
            CallDomain::GuardianHold,
            CallDomain::EmergencyPlaybook,
            CallDomain::InternalRoot,
            CallDomain::Nobody,
        ] {
            assert!(!domain.allowed_for(None), "{domain:?} must need an origin");
        }
    }

    #[test]
    fn external_client_admits_a_plain_signed_origin_but_never_a_wrapper() {
        // The deliberate widening (16 §3.1): off-chain services cannot send
        // XCM and use the same calls from a local signed account, so the
        // domain must admit `None`.
        assert!(CallDomain::ExternalClient.allowed_for(None));

        // But it stays **privileged**, so no proxy-ish wrapper can carry a
        // client-domain call under another account's origin (I-10/I-11). This
        // is the R-7 trade recorded on the variant: an off-chain service loses
        // batching, and nothing gains a smuggling path.
        assert!(CallDomain::ExternalClient.is_privileged());
        assert_eq!(
            SafetyFilter::validate(
                None,
                &RuntimeCall::Proxy(BoxedCall::new(RuntimeCall::leaf(
                    CallDomain::ExternalClient
                )))
            ),
            Err(Error::PrivilegedWrapper)
        );
        // Unwrapped, the same call and origin are fine.
        assert_eq!(
            SafetyFilter::validate(None, &RuntimeCall::leaf(CallDomain::ExternalClient)),
            Ok(())
        );
    }

    #[test]
    fn eight_custom_origins_and_class_mapping_are_fixed() {
        let origins = [
            Origin::FutarchyParam,
            Origin::FutarchyTreasury,
            Origin::FutarchyCode,
            Origin::FutarchyMeta,
            Origin::ConstitutionalValues,
            Origin::OracleResolution,
            Origin::GuardianHold,
            Origin::EmergencyPlaybook,
        ];
        assert_eq!(origins.len(), 8);
        assert_eq!(
            Origin::from_proposal_class(ProposalClass::Param),
            Some(Origin::FutarchyParam)
        );
        assert_eq!(
            Origin::from_proposal_class(ProposalClass::Treasury),
            Some(Origin::FutarchyTreasury)
        );
        assert_eq!(
            Origin::from_proposal_class(ProposalClass::Code),
            Some(Origin::FutarchyCode)
        );
        assert_eq!(
            Origin::from_proposal_class(ProposalClass::Meta),
            Some(Origin::FutarchyMeta)
        );
        assert_eq!(
            Origin::from_proposal_class(ProposalClass::Constitutional),
            None
        );
    }

    #[test]
    fn nobody_and_mismatched_privileged_domains_are_denied() {
        assert_eq!(
            SafetyFilter::validate(None, &RuntimeCall::leaf(CallDomain::Nobody)),
            Err(Error::NobodyCall)
        );
        assert_eq!(
            SafetyFilter::validate(None, &RuntimeCall::leaf(CallDomain::Param)),
            Err(Error::BadOrigin)
        );
        assert!(SafetyFilter::contains_for(
            Origin::FutarchyParam,
            &RuntimeCall::leaf(CallDomain::Param)
        ));
        assert_eq!(
            SafetyFilter::validate(
                Some(Origin::FutarchyTreasury),
                &RuntimeCall::leaf(CallDomain::Param)
            ),
            Err(Error::BadOrigin)
        );
    }

    #[test]
    fn wrapper_set_recurses_and_blocks_privileged_proxy_multisig() {
        let public = RuntimeCall::Proxy(boxed(RuntimeCall::leaf(CallDomain::Public)));
        assert!(SafetyFilter::contains(&public));
        for call in [
            RuntimeCall::Proxy(boxed(RuntimeCall::leaf(CallDomain::Param))),
            RuntimeCall::ProxyAnnounced(boxed(RuntimeCall::leaf(CallDomain::Param))),
            RuntimeCall::MultisigAsMulti(boxed(RuntimeCall::leaf(CallDomain::Code))),
            RuntimeCall::MultisigAsMultiThreshold1(boxed(RuntimeCall::leaf(CallDomain::Code))),
        ] {
            assert_eq!(
                SafetyFilter::validate(None, &call),
                Err(Error::PrivilegedWrapper)
            );
        }
    }

    #[test]
    fn proxy_multisig_deny_privileged_leaves_through_any_nesting() {
        // Codex review, PR #18: a batch (or any other wrapper) between the
        // proxy/multisig wrapper and a privileged leaf must not launder the
        // 06 §3.3 privileged-wrapper denial - even when the payload would
        // match the class origin being validated.
        let laundered = [
            RuntimeCall::Proxy(boxed(RuntimeCall::UtilityBatch(vec![RuntimeCall::leaf(
                CallDomain::Param,
            )]))),
            RuntimeCall::ProxyAnnounced(boxed(RuntimeCall::UtilityWithWeight(boxed(
                RuntimeCall::leaf(CallDomain::Meta),
            )))),
            RuntimeCall::MultisigAsMulti(boxed(RuntimeCall::UtilityBatchAll(vec![
                RuntimeCall::leaf(CallDomain::Code),
            ]))),
            RuntimeCall::MultisigAsMultiThreshold1(boxed(RuntimeCall::UtilityForceBatch(vec![
                RuntimeCall::leaf(CallDomain::Treasury),
            ]))),
            RuntimeCall::Proxy(boxed(RuntimeCall::Sudo(boxed(RuntimeCall::leaf(
                CallDomain::Param,
            ))))),
        ];
        for call in laundered {
            assert_eq!(
                SafetyFilter::validate(None, &call),
                Err(Error::PrivilegedWrapper)
            );
            assert!(!SafetyFilter::contains_for(Origin::FutarchyParam, &call));
            assert!(!SafetyFilter::contains_for(Origin::FutarchyCode, &call));
        }
        // Public payloads under the same shapes stay admissible.
        let public = RuntimeCall::Proxy(boxed(RuntimeCall::UtilityBatch(vec![RuntimeCall::leaf(
            CallDomain::Public,
        )])));
        assert!(SafetyFilter::contains(&public));
        // The nobody row still wins over the wrapper denial error inside a proxy.
        let nobody = RuntimeCall::Proxy(boxed(RuntimeCall::UtilityBatch(vec![RuntimeCall::leaf(
            CallDomain::Nobody,
        )])));
        assert_eq!(
            SafetyFilter::validate(None, &nobody),
            Err(Error::NobodyCall)
        );
    }

    #[test]
    fn batch_sudo_and_with_weight_recurse_to_nobody_row() {
        for call in [
            RuntimeCall::UtilityBatch(vec![RuntimeCall::leaf(CallDomain::Nobody)]),
            RuntimeCall::UtilityBatchAll(vec![RuntimeCall::leaf(CallDomain::Nobody)]),
            RuntimeCall::UtilityForceBatch(vec![RuntimeCall::leaf(CallDomain::Nobody)]),
            RuntimeCall::UtilityWithWeight(boxed(RuntimeCall::leaf(CallDomain::Nobody))),
            RuntimeCall::Sudo(boxed(RuntimeCall::leaf(CallDomain::Nobody))),
        ] {
            assert_eq!(SafetyFilter::validate(None, &call), Err(Error::NobodyCall));
        }
    }

    #[test]
    fn dispatch_as_and_as_derivative_are_denied() {
        assert_eq!(
            SafetyFilter::validate(
                None,
                &RuntimeCall::UtilityDispatchAs(boxed(RuntimeCall::leaf(CallDomain::Public)))
            ),
            Err(Error::DispatchAsDenied)
        );
        assert_eq!(
            SafetyFilter::validate(
                None,
                &RuntimeCall::UtilityAsDerivative(boxed(RuntimeCall::leaf(CallDomain::Public)))
            ),
            Err(Error::DispatchAsDenied)
        );
    }

    #[test]
    fn scheduler_is_values_only_and_revalidates_captured_origin() {
        let good = RuntimeCall::Scheduler {
            origin: Origin::OracleResolution,
            call: boxed(RuntimeCall::leaf(CallDomain::OracleResolution)),
        };
        assert!(SafetyFilter::contains(&good));
        let bad_origin = RuntimeCall::Scheduler {
            origin: Origin::GuardianHold,
            call: boxed(RuntimeCall::leaf(CallDomain::GuardianHold)),
        };
        assert_eq!(
            SafetyFilter::validate(None, &bad_origin),
            Err(Error::SchedulerDenied)
        );
        let bad_call = RuntimeCall::Scheduler {
            origin: Origin::ConstitutionalValues,
            call: boxed(RuntimeCall::leaf(CallDomain::Treasury)),
        };
        assert_eq!(
            SafetyFilter::validate(None, &bad_call),
            Err(Error::BadOrigin)
        );
    }

    #[test]
    fn nesting_and_total_call_limits_are_enforced() {
        let too_deep = RuntimeCall::UtilityBatch(vec![RuntimeCall::UtilityBatch(vec![
            RuntimeCall::UtilityBatch(vec![RuntimeCall::UtilityBatch(vec![
                RuntimeCall::UtilityBatch(vec![RuntimeCall::leaf(CallDomain::Public)]),
            ])]),
        ])]);
        assert_eq!(SafetyFilter::validate(None, &too_deep), Err(Error::TooDeep));
        let too_many = RuntimeCall::UtilityBatch(
            (0..17)
                .map(|_| RuntimeCall::leaf(CallDomain::Public))
                .collect(),
        );
        assert_eq!(
            SafetyFilter::validate(None, &too_many),
            Err(Error::TooManyCalls)
        );
    }
}
