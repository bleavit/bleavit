#![no_main]

use bleavit_xcm::{client::matches_client_ingress, identity::usdc_location};
use libfuzzer_sys::fuzz_target;
use staging_xcm::latest::{prelude::*, Instruction};

fn byte(data: &[u8], index: usize) -> u8 {
    data.get(index).copied().unwrap_or_default()
}

fn origin(data: &[u8]) -> Location {
    let para = u32::from_le_bytes([byte(data, 1), byte(data, 2), byte(data, 3), byte(data, 4)]);
    Location::new(1, [Parachain(para)])
}

fn usdc(amount: u128) -> Asset {
    Asset {
        id: AssetId(usdc_location()),
        fun: Fungible(amount),
    }
}

fn foreign(amount: u128) -> Asset {
    Asset {
        id: AssetId(Location::new(1, [Parachain(2_000)])),
        fun: Fungible(amount),
    }
}

fn transact<Call>(encoded: Vec<u8>) -> Instruction<Call> {
    Transact {
        origin_kind: OriginKind::Xcm,
        fallback_max_weight: None,
        call: encoded.into(),
    }
}

fn remote_transact() -> Xcm<()> {
    Xcm(vec![transact(Vec::new())])
}

fn instruction(tag: u8, seed: u8, beneficiary: &Location) -> Instruction<()> {
    let amount = u128::from(seed).saturating_add(1);
    match tag % 20 {
        0 => WithdrawAsset(Assets::from(usdc(amount))),
        1 => ReserveAssetDeposited(Assets::from(usdc(amount))),
        2 => PayFees {
            asset: usdc(amount),
        },
        3 => transact(vec![seed]),
        4 => RefundSurplus,
        5 => DepositAsset {
            assets: Wild(AllCounted(1)),
            beneficiary: beneficiary.clone(),
        },
        6 => SetTopic([seed; 32]),
        7 => DescendOrigin(Here),
        8 => AliasOrigin(beneficiary.clone()),
        9 => TransferReserveAsset {
            assets: Assets::from(usdc(amount)),
            dest: Location::parent(),
            xcm: remote_transact(),
        },
        10 => DepositReserveAsset {
            assets: Wild(AllCounted(1)),
            dest: Location::parent(),
            xcm: remote_transact(),
        },
        11 => InitiateReserveWithdraw {
            assets: Wild(AllCounted(1)),
            reserve: Location::parent(),
            xcm: remote_transact(),
        },
        12 => InitiateTeleport {
            assets: Wild(AllCounted(1)),
            dest: Location::parent(),
            xcm: remote_transact(),
        },
        13 => InitiateTransfer {
            destination: Location::parent(),
            remote_fees: None,
            preserve_origin: true,
            assets: Default::default(),
            remote_xcm: remote_transact(),
        },
        14 => ExportMessage {
            network: NetworkId::Polkadot,
            destination: Here,
            xcm: remote_transact(),
        },
        15 => SetErrorHandler(Xcm(vec![transact(vec![seed])])),
        16 => SetAppendix(Xcm(vec![transact(vec![seed])])),
        17 => ExecuteWithOrigin {
            descendant_origin: Some(Here),
            xcm: Xcm(vec![transact(vec![seed])]),
        },
        18 => Trap(u64::from(seed)),
        _ => ClearOrigin,
    }
}

/// Independent, spec-written oracle. Keep this match separate from the
/// production helper: the target exists to catch a shared implementation
/// error, following the nested-wrapper-filter precedent (16 §12).
fn oracle(origin: &Location, instructions: &[Instruction<()>]) -> bool {
    let (withdraw, pay, call, refund, deposit) = match instructions {
        [withdraw, pay, call, refund, deposit] => (withdraw, pay, call, refund, deposit),
        [withdraw, pay, call, refund, deposit, SetTopic(_)] => {
            (withdraw, pay, call, refund, deposit)
        }
        _ => return false,
    };
    let withdraw_ok = match withdraw {
        WithdrawAsset(assets) => match assets.inner().as_slice() {
            [asset] => asset.id == AssetId(usdc_location()) && matches!(&asset.fun, Fungible(_)),
            _ => false,
        },
        _ => false,
    };
    let pay_ok = matches!(pay, PayFees { asset } if asset.id == AssetId(usdc_location()));
    let call_ok = matches!(
        call,
        Transact {
            origin_kind: OriginKind::Xcm,
            ..
        }
    );
    let refund_ok = matches!(refund, RefundSurplus);
    let deposit_ok = matches!(
        deposit,
        DepositAsset {
            assets: Wild(AllCounted(1)),
            beneficiary,
        } if beneficiary == origin
    );
    withdraw_ok && pay_ok && call_ok && refund_ok && deposit_ok
}

fn canonical(data: &[u8], origin: &Location) -> Vec<Instruction<()>> {
    let amount = u128::from(byte(data, 5)).saturating_add(1);
    let mut program = vec![
        WithdrawAsset(Assets::from(usdc(amount))),
        PayFees {
            asset: usdc(amount),
        },
        transact(data.get(8..).unwrap_or_default().to_vec()),
        RefundSurplus,
        DepositAsset {
            assets: Wild(AllCounted(1)),
            beneficiary: origin.clone(),
        },
    ];
    if byte(data, 6) & 1 == 1 {
        program.push(SetTopic([byte(data, 7); 32]));
    }
    program
}

fuzz_target!(|data: &[u8]| {
    let sender = origin(data);
    let canonical_case = byte(data, 0).is_multiple_of(3);
    let mut program = if canonical_case {
        canonical(data, &sender)
    } else {
        let len = usize::from(byte(data, 5) % 9);
        (0..len)
            .map(|index| {
                instruction(
                    byte(data, 6usize.saturating_add(index.saturating_mul(2))),
                    byte(data, 7usize.saturating_add(index.saturating_mul(2))),
                    &sender,
                )
            })
            .collect()
    };

    // Make canonical cases spend substantial time one mutation away from the
    // boundary, including an issuance-increasing position zero.
    if canonical_case {
        match byte(data, 7) % 9 {
            0 => {}
            1 => program.insert(0, ClearOrigin),
            2 => program[0] = ReserveAssetDeposited(Assets::from(usdc(1))),
            3 => program[0] = WithdrawAsset(Assets::from(foreign(1))),
            4 => program[1] = PayFees { asset: foreign(1) },
            5 => {
                program[2] = Transact {
                    origin_kind: OriginKind::SovereignAccount,
                    fallback_max_weight: None,
                    call: Vec::new().into(),
                }
            }
            6 => program[3] = ClearOrigin,
            7 => {
                program[4] = DepositAsset {
                    assets: Wild(AllCounted(1)),
                    beneficiary: Location::parent(),
                }
            }
            _ => program.push(ClearOrigin),
        }
    }

    let production = matches_client_ingress(&sender, &program);
    let independent = oracle(&sender, &program);
    assert_eq!(production, independent);
    if production {
        assert!(matches!(program.len(), 5 | 6));
        assert!(!program
            .iter()
            .any(|instruction| matches!(instruction, ReserveAssetDeposited(_))));
    }
});
