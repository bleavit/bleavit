use crate as pallet_bleavit_client;
use crate::OnReport;
use frame_support::{
    derive_impl,
    dispatch::{DispatchErrorWithPostInfo, DispatchResultWithPostInfo, Pays, PostDispatchInfo},
    parameter_types,
    weights::Weight,
};
use frame_system::EnsureRoot;
use parity_scale_codec::Encode;
use sp_core::crypto::AccountId32;
use sp_runtime::{traits::IdentityLookup, BuildStorage, DispatchError};
use staging_xcm::latest::{Location, SendError, SendResult, Xcm, XcmHash};
use std::{cell::RefCell, collections::VecDeque};

pub type AccountId = AccountId32;
type Block = frame_system::mocking::MockBlock<Test>;

frame_support::construct_runtime!(
    pub enum Test {
        System: frame_system,
        BleavitClient: pallet_bleavit_client,
    }
);

#[derive_impl(frame_system::config_preludes::TestDefaultConfig)]
impl frame_system::Config for Test {
    type Block = Block;
    type AccountId = AccountId;
    type Lookup = IdentityLookup<AccountId>;
}

parameter_types! {
    pub BleavitLocation: Location = Location::new(1, [staging_xcm::latest::Junction::Parachain(2)]);
    pub UsdcLocation: Location = Location::new(1, [staging_xcm::latest::Junction::GeneralIndex(42)]);
    pub RefundLocation: Location = Location::new(1, [staging_xcm::latest::Junction::Parachain(7)]);
    pub const ClientId: futarchy_primitives::ClientId = 11;
    pub const RegistrationFeeBuffer: futarchy_primitives::Balance = 1_000_000;
    pub const XcmFee: futarchy_primitives::Balance = 10_000;
    pub const WindowLead: futarchy_primitives::BlockNumber = 5;
    pub const MaxReports: u32 = 2;
}

thread_local! {
    pub static SENT: RefCell<VecDeque<(Location, Xcm<()>)>> = const { RefCell::new(VecDeque::new()) };
    pub static HANDLER_CALLS: RefCell<u32> = const { RefCell::new(0) };
    pub static HANDLER_FAILS: RefCell<bool> = const { RefCell::new(false) };
}

pub struct RecordingSender;
impl staging_xcm::latest::SendXcm for RecordingSender {
    type Ticket = (Location, Xcm<()>);

    fn validate(
        destination: &mut Option<Location>,
        message: &mut Option<Xcm<()>>,
    ) -> SendResult<Self::Ticket> {
        match (destination.take(), message.take()) {
            (Some(destination), Some(message)) => Ok(((destination, message), Default::default())),
            _ => Err(SendError::MissingArgument),
        }
    }

    fn deliver(ticket: Self::Ticket) -> Result<XcmHash, SendError> {
        let hash = ticket.1.using_encoded(sp_io::hashing::blake2_256);
        SENT.with(|messages| messages.borrow_mut().push_back(ticket));
        Ok(hash)
    }
}

pub struct TestHandler;
impl OnReport for TestHandler {
    fn weight() -> Weight {
        Weight::from_parts(25_000, 0)
    }

    fn on_report(_: &crate::ReportView) -> DispatchResultWithPostInfo {
        HANDLER_CALLS.with(|calls| {
            let mut calls = calls.borrow_mut();
            *calls = calls.saturating_add(1);
        });
        if HANDLER_FAILS.with(|fails| *fails.borrow()) {
            Err(DispatchErrorWithPostInfo {
                post_info: PostDispatchInfo::default(),
                error: DispatchError::Other("test handler refusal"),
            })
        } else {
            Ok(PostDispatchInfo {
                actual_weight: Some(Weight::from_parts(7_000, 0)),
                pays_fee: Pays::Yes,
            })
        }
    }
}

impl pallet_bleavit_client::Config for Test {
    type BleavitLocation = BleavitLocation;
    type UsdcLocation = UsdcLocation;
    type RefundLocation = RefundLocation;
    type ClientId = ClientId;
    type RegistrationFeeBuffer = RegistrationFeeBuffer;
    type XcmFee = XcmFee;
    type WindowLead = WindowLead;
    type XcmSender = RecordingSender;
    type BleavitOrigin = EnsureRoot<AccountId>;
    // The reference runtime is fail-closed: only governance/root may spend
    // the shared sovereign account until an integrator explicitly widens it.
    type SpendingOrigin = EnsureRoot<AccountId>;
    type ReportPruneOrigin = EnsureRoot<AccountId>;
    type OnReport = TestHandler;
    type MaxReports = MaxReports;
    type WeightInfo = ();
}

pub fn account(seed: u8) -> AccountId {
    AccountId::from([seed; 32])
}

pub fn reset() {
    SENT.with(|messages| messages.borrow_mut().clear());
    HANDLER_CALLS.with(|calls| *calls.borrow_mut() = 0);
    HANDLER_FAILS.with(|fails| *fails.borrow_mut() = false);
}

pub fn new_test_ext() -> sp_io::TestExternalities {
    reset();
    let storage = frame_system::GenesisConfig::<Test>::default()
        .build_storage()
        .unwrap_or_default();
    let mut ext = sp_io::TestExternalities::new(storage);
    ext.execute_with(|| System::set_block_number(10));
    ext
}
