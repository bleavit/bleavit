#![cfg_attr(not(feature = "std"), no_std)]
#![deny(unsafe_code)]

extern crate alloc;

use alloc::vec::Vec;
use futarchy_primitives::ProposalClass;
use parity_scale_codec::{Decode, Encode, MaxEncodedLen};
use scale_info::TypeInfo;

pub const MAX_NESTING_DEPTH: u8 = 4;
pub const MAX_WRAPPED_CALLS: u8 = 16;

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
    depth: u8,
    calls: u8,
}

impl Budget {
    const fn root() -> Self {
        Self { depth: 0, calls: 0 }
    }

    fn enter(&mut self) -> Result<(), Error> {
        self.depth = self.depth.checked_add(1).ok_or(Error::TooDeep)?;
        ensure!(self.depth <= MAX_NESTING_DEPTH, Error::TooDeep);
        Ok(())
    }

    fn leave(&mut self) {
        self.depth = self.depth.saturating_sub(1);
    }

    fn count_call(&mut self) -> Result<(), Error> {
        self.calls = self.calls.checked_add(1).ok_or(Error::TooManyCalls)?;
        ensure!(self.calls <= MAX_WRAPPED_CALLS, Error::TooManyCalls);
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
        Self::validate_inner(origin, call, &mut budget)
    }

    fn validate_inner(
        origin: Option<Origin>,
        call: &RuntimeCall,
        budget: &mut Budget,
    ) -> Result<(), Error> {
        budget.count_call()?;
        match call {
            RuntimeCall::Leaf(domain) => match domain {
                CallDomain::Nobody => Err(Error::NobodyCall),
                _ if domain.allowed_for(origin) => Ok(()),
                _ => Err(Error::BadOrigin),
            },
            RuntimeCall::UtilityBatch(calls)
            | RuntimeCall::UtilityBatchAll(calls)
            | RuntimeCall::UtilityForceBatch(calls) => Self::validate_many(origin, calls, budget),
            RuntimeCall::UtilityWithWeight(inner) => {
                Self::validate_wrapped(origin, &inner.0, budget)
            }
            RuntimeCall::Proxy(inner)
            | RuntimeCall::ProxyAnnounced(inner)
            | RuntimeCall::MultisigAsMulti(inner)
            | RuntimeCall::MultisigAsMultiThreshold1(inner) => {
                ensure!(
                    !inner.0.static_domain().is_privileged(),
                    Error::PrivilegedWrapper
                );
                Self::validate_wrapped(origin, &inner.0, budget)
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
                Self::validate_wrapped(Some(*origin), &call.0, budget)
            }
            RuntimeCall::Sudo(inner) => Self::validate_wrapped(origin, &inner.0, budget),
        }
    }

    fn validate_many(
        origin: Option<Origin>,
        calls: &[RuntimeCall],
        budget: &mut Budget,
    ) -> Result<(), Error> {
        budget.enter()?;
        for call in calls {
            Self::validate_inner(origin, call, budget)?;
        }
        budget.leave();
        Ok(())
    }

    fn validate_wrapped(
        origin: Option<Origin>,
        call: &RuntimeCall,
        budget: &mut Budget,
    ) -> Result<(), Error> {
        budget.enter()?;
        let result = Self::validate_inner(origin, call, budget);
        budget.leave();
        result
    }
}

impl RuntimeCall {
    pub const fn leaf(domain: CallDomain) -> Self {
        Self::Leaf(domain)
    }

    pub fn static_domain(&self) -> CallDomain {
        match self {
            Self::Leaf(domain) => *domain,
            Self::UtilityBatch(_)
            | Self::UtilityBatchAll(_)
            | Self::UtilityForceBatch(_)
            | Self::UtilityWithWeight(_)
            | Self::Scheduler { .. }
            | Self::Sudo(_) => CallDomain::Public,
            Self::Proxy(inner)
            | Self::ProxyAnnounced(inner)
            | Self::MultisigAsMulti(inner)
            | Self::MultisigAsMultiThreshold1(inner)
            | Self::UtilityDispatchAs(inner)
            | Self::UtilityAsDerivative(inner) => inner.0.static_domain(),
            Self::MultisigApproveAsMulti => CallDomain::Public,
        }
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
