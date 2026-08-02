//! The 16 §8.5 resource partition.
//!
//! External client calls are admitted against the existing operational
//! reserved weight in both `Weight` dimensions. Primary/system calls are
//! admitted against the remainder. The reservation is made before dispatch,
//! and finalization folds unclassified system work into `PrimaryUsed`; this is
//! deliberately a partition, never a subtraction from the total sample.

use frame_support::{
    dispatch::{DispatchClass, DispatchInfo, DispatchResult, GetDispatchInfo, PostDispatchInfo},
    weights::Weight,
};
use pallet_welfare::Pallet as Welfare;
use parity_scale_codec::{Decode, DecodeWithMemTracking, Encode};
use sp_runtime::{
    traits::{Dispatchable, TransactionExtension},
    transaction_validity::{
        InvalidTransaction, TransactionSource, TransactionValidityError, ValidTransaction,
    },
    DispatchError, DispatchErrorWithPostInfo,
};
use staging_xcm_executor::traits::CallDispatcher;

use crate::{Runtime, RuntimeCall, RuntimeOrigin, System};

/// Validation data carried into `prepare`. `before_total` is captured during
/// validation because `CheckWeight`, which precedes this extension, books the
/// call before this extension's `prepare` runs.
#[derive(
    Clone, Debug, Decode, DecodeWithMemTracking, Encode, Eq, PartialEq, scale_info::TypeInfo,
)]
pub struct ResourcePartitionValidation {
    pub is_external: bool,
    pub partitioned: bool,
    pub amount: Weight,
    pub before_total: Weight,
}

/// Signed/general transaction extension for the partition.
#[derive(
    Clone,
    Debug,
    Decode,
    DecodeWithMemTracking,
    Default,
    Encode,
    Eq,
    PartialEq,
    scale_info::TypeInfo,
)]
pub struct ResourcePartition;

impl ResourcePartition {
    fn is_external(call: &RuntimeCall) -> bool {
        crate::classifier::is_external_client_call(call)
    }

    /// FRAME owns the Operational and Mandatory budgets.  The partition only
    /// bounds external work; those classes still enter the primary accumulator
    /// through the residual fold in `pallet-welfare`.
    fn is_partitioned(is_external: bool, info: &DispatchInfo) -> bool {
        is_external
            || !matches!(
                info.class,
                DispatchClass::Operational | DispatchClass::Mandatory
            )
    }

    fn exhausted() -> TransactionValidityError {
        InvalidTransaction::ExhaustsResources.into()
    }

    fn xcm_exhausted() -> DispatchErrorWithPostInfo<PostDispatchInfo> {
        DispatchErrorWithPostInfo {
            error: DispatchError::Exhausted,
            post_info: PostDispatchInfo::default(),
        }
    }

    fn physical_delta(before: Weight) -> Weight {
        System::block_weight().total().saturating_sub(before)
    }

    fn actual_with_overhead(
        info: &DispatchInfo,
        post_info: &PostDispatchInfo,
        len: usize,
    ) -> Weight {
        Welfare::<Runtime>::dispatch_resource_weight(
            &DispatchInfo {
                call_weight: post_info.calc_actual_weight(info),
                extension_weight: Weight::zero(),
                class: info.class,
                pays_fee: info.pays_fee,
            },
            len,
            Welfare::<Runtime>::resource_partition_weight(),
        )
    }
}

impl TransactionExtension<RuntimeCall> for ResourcePartition {
    const IDENTIFIER: &'static str = "ResourcePartition";
    type Implicit = ();
    type Val = ResourcePartitionValidation;
    type Pre = Option<pallet_welfare::ResourceReservation<crate::BlockNumber>>;

    fn weight(&self, _: &RuntimeCall) -> Weight {
        Welfare::<Runtime>::resource_partition_weight()
    }

    fn validate(
        &self,
        origin: RuntimeOrigin,
        call: &RuntimeCall,
        info: &DispatchInfo,
        len: usize,
        _self_implicit: Self::Implicit,
        _inherited_implication: &impl sp_runtime::traits::Implication,
        source: TransactionSource,
    ) -> sp_runtime::traits::ValidateResult<Self::Val, RuntimeCall> {
        let is_external = Self::is_external(call);
        let partitioned = Self::is_partitioned(is_external, info);
        let in_block = matches!(source, TransactionSource::InBlock);
        let before_total = if in_block {
            System::block_weight().total()
        } else {
            Weight::zero()
        };
        let amount = Welfare::<Runtime>::dispatch_resource_weight(info, len, Weight::zero());
        if partitioned
            && in_block
            && !Welfare::<Runtime>::can_reserve_resource(is_external, amount, before_total)
        {
            return Err(Self::exhausted());
        }
        Ok((
            ValidTransaction::default(),
            ResourcePartitionValidation {
                is_external,
                partitioned,
                amount,
                before_total,
            },
            origin,
        ))
    }

    fn prepare(
        self,
        val: Self::Val,
        _origin: &RuntimeOrigin,
        _call: &RuntimeCall,
        _info: &DispatchInfo,
        _len: usize,
    ) -> Result<Self::Pre, TransactionValidityError> {
        if !val.partitioned {
            return Ok(None);
        }
        Welfare::<Runtime>::reserve_resource(val.is_external, val.amount, val.before_total)
            .map(Some)
            .ok_or_else(Self::exhausted)
    }

    fn post_dispatch_details(
        pre: Self::Pre,
        info: &DispatchInfo,
        post_info: &PostDispatchInfo,
        len: usize,
        result: &DispatchResult,
    ) -> Result<Weight, TransactionValidityError> {
        if let Some(pre) = pre {
            Welfare::<Runtime>::finish_resource_dispatch(
                pre,
                info,
                post_info,
                len,
                result,
                Weight::zero(),
                Weight::zero(),
            );
        }
        Ok(Weight::zero())
    }
}

/// XCM `Transact` does not pass through signed transaction extensions. The
/// same hard partition therefore wraps its exact runtime-call dispatcher and
/// registers the full call charge in `frame_system` before dispatch.
pub struct ResourcePartitionCallDispatcher;

impl CallDispatcher<RuntimeCall> for ResourcePartitionCallDispatcher {
    fn dispatch(
        call: RuntimeCall,
        origin: RuntimeOrigin,
    ) -> Result<PostDispatchInfo, DispatchErrorWithPostInfo<PostDispatchInfo>> {
        let info = call.get_dispatch_info();
        let len = call.encode().len();
        let partition_weight = Welfare::<Runtime>::resource_partition_weight();
        let amount = Welfare::<Runtime>::dispatch_resource_weight(&info, len, partition_weight);
        let before = System::block_weight().total();
        let is_external = ResourcePartition::is_external(&call);
        let partitioned = ResourcePartition::is_partitioned(is_external, &info);
        let reservation = if partitioned {
            Some(
                Welfare::<Runtime>::reserve_resource(is_external, amount, before)
                    .ok_or_else(ResourcePartition::xcm_exhausted)?,
            )
        } else {
            None
        };

        // Admission above checks the physical max. This unchecked registration
        // is the actual reservation that makes the call visible to the block's
        // weight accounting; it is not an accounting-only side ledger.
        System::register_extra_weight_unchecked(amount, info.class);
        // N7-DISPATCH-TRIPWIRE: partition-dispatcher
        let result = call.dispatch(origin);
        let dispatch_result = result.as_ref().map(|_| ()).map_err(|error| error.error);

        let post_info = match &result {
            Ok(post_info) => post_info,
            Err(error) => &error.post_info,
        };
        let reported = ResourcePartition::actual_with_overhead(&info, post_info, len);
        // A malformed post-dispatch report must not turn an observed physical
        // excess into a refund; the side ledger keeps it.
        let nested = ResourcePartition::physical_delta(before).saturating_sub(amount);
        if result.is_ok() {
            let refund = amount.saturating_sub(reported);
            if refund != Weight::zero() {
                frame_system::BlockWeight::<Runtime>::mutate(|current| {
                    current.reduce(refund, info.class);
                });
            }
        }
        if let Some(reservation) = reservation {
            Welfare::<Runtime>::finish_resource_dispatch(
                reservation,
                &info,
                post_info,
                len,
                &dispatch_result,
                partition_weight,
                nested,
            );
        }

        result
    }
}
