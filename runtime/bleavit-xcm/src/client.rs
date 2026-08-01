//! Hosted-question client ingress components (09 §6.5; 15 I-34/I-35/I-38).
//!
//! The SDK gives the barrier, origin converter and safe-call filter three
//! different inputs. They deliberately share no whole-program predicate:
//! admission is the intersection of the checks implemented below.

use core::marker::PhantomData;

use frame_support::traits::{Contains, ProcessMessageError};
use origins_core::{CallDomain, RuntimeCall as FilterCall};
use pallet_origins::SafetyClassifier;
use staging_xcm::latest::{
    AssetFilter, AssetId, Fungibility, Instruction, Location, OriginKind, Weight, WildAsset,
};
use staging_xcm_executor::traits::{ConvertOrigin, Properties, ShouldExecute};

use crate::identity::usdc_location;

/// The positional surface has five mandatory slots and one optional trailing
/// topic slot. This constant is a review/test tripwire, not a length accepted
/// by itself.
pub const CLIENT_INGRESS_POSITION_COUNT: usize = 6;
const CLIENT_INGRESS_REQUIRED_POSITIONS: usize = CLIENT_INGRESS_POSITION_COUNT - 1;

/// Match the one whole-program shape admitted for hosted-question clients.
///
/// This function is intentionally pure. In particular, failure cannot mutate
/// barrier properties before the legacy barrier gets the same program (the
/// frozen pre-N8 differential in `n8_tests` relies on that fact).
pub fn matches_client_ingress<Call>(origin: &Location, instructions: &[Instruction<Call>]) -> bool {
    if !matches!(
        instructions.len(),
        CLIENT_INGRESS_REQUIRED_POSITIONS | CLIENT_INGRESS_POSITION_COUNT
    ) {
        return false;
    }

    let [withdraw, pay_fees, transact, refund, deposit, trailing @ ..] = instructions else {
        return false;
    };

    let withdraw_matches = match withdraw {
        Instruction::WithdrawAsset(assets) => matches!(
            assets.inner().as_slice(),
            [asset]
                if asset.id == AssetId(usdc_location())
                    && matches!(asset.fun, Fungibility::Fungible(_))
        ),
        _ => false,
    };
    let fee_matches = matches!(
        pay_fees,
        Instruction::PayFees { asset } if asset.id == AssetId(usdc_location())
    );
    let call_matches = matches!(
        transact,
        Instruction::Transact {
            origin_kind: OriginKind::Xcm,
            ..
        }
    );
    let refund_matches = matches!(refund, Instruction::RefundSurplus);
    let deposit_matches = matches!(
        deposit,
        Instruction::DepositAsset {
            assets: AssetFilter::Wild(WildAsset::AllCounted(1)),
            beneficiary,
        } if beneficiary == origin
    );
    let topic_matches = matches!(trailing, [] | [Instruction::SetTopic(_)]);

    withdraw_matches
        && fee_matches
        && call_matches
        && refund_matches
        && deposit_matches
        && topic_matches
}

/// Barrier-only half of client ingress. It sees and exhaustively matches the
/// instruction slice; it neither looks up registry state nor classifies the
/// decoded call, because those inputs exist only at the executor's later
/// conversion/filter stages.
pub struct AllowClientIngress;

impl ShouldExecute for AllowClientIngress {
    fn should_execute<Call>(
        origin: &Location,
        instructions: &mut [Instruction<Call>],
        _max_weight: Weight,
        properties: &mut Properties,
    ) -> Result<(), ProcessMessageError> {
        if !matches_client_ingress(origin, instructions) {
            return Err(ProcessMessageError::Unsupported);
        }
        if let Some(Instruction::SetTopic(topic)) = instructions.last() {
            properties.message_id = Some(*topic);
        }
        Ok(())
    }
}

/// Converts only an exact registered client `Location` using `OriginKind::Xcm`.
///
/// I-34's mechanical review point is the single `Ok(...)` expression below:
/// `RuntimeOrigin` itself admits every runtime constructor, so this is an
/// implementation-and-negative-test property, not a type-level one.
pub struct RegisteredClientOriginConverter<T>(PhantomData<T>);

impl<T> ConvertOrigin<<T as frame_system::Config>::RuntimeOrigin>
    for RegisteredClientOriginConverter<T>
where
    T: pallet_client_registry::Config,
    <T as frame_system::Config>::RuntimeOrigin: From<pallet_client_registry::Origin>,
{
    fn convert_origin(
        origin: impl Into<Location>,
        kind: OriginKind,
    ) -> Result<<T as frame_system::Config>::RuntimeOrigin, Location> {
        let origin = origin.into();
        match (
            kind,
            pallet_client_registry::Pallet::<T>::client_id_of(&origin),
        ) {
            (OriginKind::Xcm, Some(client_id))
                if pallet_client_registry::Pallet::<T>::note_ingress(client_id).is_ok() =>
            {
                Ok(pallet_client_registry::Origin::ExternalClient(client_id).into())
            }
            _ => Err(origin),
        }
    }
}

/// Safe-call half of client ingress, derived directly from the runtime's one
/// canonical SafetyFilter classifier (I-35). Wrappers project to a wrapper
/// tree, not to an `ExternalClient` leaf, and therefore fail this equality.
pub struct ExternalClientSafeCallFilter<Classifier>(PhantomData<Classifier>);

impl<Classifier> Contains<Classifier::Call> for ExternalClientSafeCallFilter<Classifier>
where
    Classifier: SafetyClassifier,
{
    fn contains(call: &Classifier::Call) -> bool {
        matches!(
            Classifier::project(call),
            FilterCall::Leaf(CallDomain::ExternalClient)
        )
    }
}
