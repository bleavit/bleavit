import { Enum, GetEnum, SizedHex, SS58String, FixedSizeArray, ResultPayload, TxCallData } from "polkadot-api";
type AnonymousEnum<T extends {}> = T & {
    __anonymous: true;
};
type MyTuple<T> = [T, ...T[]];
type SeparateUndefined<T> = undefined extends T ? undefined | Exclude<T, undefined> : T;
type Anonymize<T> = SeparateUndefined<T extends string | number | bigint | boolean | void | undefined | null | symbol | Uint8Array | Enum<any> ? T : T extends AnonymousEnum<infer V> ? Enum<V> : T extends MyTuple<any> ? {
    [K in keyof T]: T[K];
} : T extends [] ? [] : T extends FixedSizeArray<infer L, infer T> ? number extends L ? Array<T> : FixedSizeArray<L, T> : {
    [K in keyof T & string]: T[K];
}>;
export type I5sesotjlssv2d = {
    "nonce": number;
    "consumers": number;
    "providers": number;
    "sufficients": number;
    "data": Anonymize<I1q8tnt1cluu5j>;
};
export type I1q8tnt1cluu5j = {
    "free": bigint;
    "reserved": bigint;
    "frozen": bigint;
    "flags": bigint;
};
export type Iffmde3ekjedi9 = {
    "normal": Anonymize<I4q39t5hn830vp>;
    "operational": Anonymize<I4q39t5hn830vp>;
    "mandatory": Anonymize<I4q39t5hn830vp>;
};
export type I4q39t5hn830vp = {
    "ref_time": bigint;
    "proof_size": bigint;
};
export type I4mddgoa69c0a2 = Array<DigestItem>;
export type DigestItem = Enum<{
    "PreRuntime": Anonymize<I82jm9g7pufuel>;
    "Consensus": Anonymize<I82jm9g7pufuel>;
    "Seal": Anonymize<I82jm9g7pufuel>;
    "Other": Uint8Array;
    "RuntimeEnvironmentUpdated": undefined;
}>;
export declare const DigestItem: GetEnum<DigestItem>;
export type I82jm9g7pufuel = [SizedHex<4>, Uint8Array];
export type I9vddjescnh7d4 = Array<{
    "phase": Phase;
    "event": Enum<{
        "System": Anonymize<I26kcl1c8mjt5k>;
        "ParachainSystem": Anonymize<Icbsekf57miplo>;
        "Balances": Anonymize<I5fsnqj7i7t2q7>;
        "ForeignAssets": Anonymize<Ia8v0gq53fp7hi>;
        "TransactionPayment": TransactionPaymentEvent;
        "AssetTxPayment": Anonymize<Ie598chmfqlqa>;
        "Vesting": Anonymize<I7uu9ebnucfti5>;
        "Referenda": Anonymize<Idfraa3b4eu018>;
        "ConvictionVoting": Anonymize<I7pql8a2uf8mlq>;
        "Preimage": PreimageEvent;
        "Scheduler": Anonymize<Iaq2go86oev659>;
        "Utility": Anonymize<Im9p2bvgqoq7f>;
        "Proxy": Anonymize<Ia4esao4k3srao>;
        "Multisig": Anonymize<I5e0pasqp7drus>;
        "Migrations": Anonymize<I94co7vj7h6bo>;
        "Sudo": Anonymize<Idhl9l6v9024mi>;
        "XcmpQueue": Anonymize<Idsqc7mhp6nnle>;
        "MessageQueue": Anonymize<I2kosejppk3jon>;
        "CumulusXcm": Anonymize<I5uv57c3fffoi9>;
        "PolkadotXcm": Anonymize<If95hivmqmkiku>;
        "CollatorSelection": Anonymize<I4srakrmf0fspo>;
        "Session": Anonymize<I6ue0ck5fc3u44>;
        "Constitution": Anonymize<I8jqccj5fq1oj>;
        "ConditionalLedger": Anonymize<Icog4v85gspb3i>;
        "Market": Anonymize<Icul1a5j3uhgpq>;
        "Welfare": Anonymize<Iotv6nd407lpv>;
        "Oracle": Anonymize<I9rq31q6e4anhq>;
        "IncidentRegistry": Anonymize<I9o4h3u7u17bqn>;
        "MilestoneRegistry": Anonymize<I9o4h3u7u17bqn>;
        "FutarchyTreasury": Anonymize<I3jebldn7oovcq>;
        "Guardian": Anonymize<I2hnabup83elbp>;
        "Attestor": Anonymize<Icfh12v8grnajk>;
        "Epoch": Anonymize<I16r8b84a092kl>;
        "ExecutionGuard": Anonymize<I5k67p27a3s88k>;
        "ClientRegistry": Anonymize<Iaqnvtu78qlr78>;
        "QuestionService": Anonymize<Iftu3nng0chq4r>;
        "ServiceLedger": Anonymize<Icog4v85gspb3i>;
    }>;
    "topics": Anonymize<Ic5m5lp1oioo8r>;
}>;
export type Phase = Enum<{
    "ApplyExtrinsic": number;
    "Finalization": undefined;
    "Initialization": undefined;
}>;
export declare const Phase: GetEnum<Phase>;
export type I26kcl1c8mjt5k = AnonymousEnum<{
    /**
     * An extrinsic completed successfully.
     */
    "ExtrinsicSuccess": Anonymize<Ia82mnkmeo2rhc>;
    /**
     * An extrinsic failed.
     */
    "ExtrinsicFailed": Anonymize<I40r22b6eosbg5>;
    /**
     * `:code` was updated to the code with the given hash.
     */
    "CodeUpdated": Anonymize<I1jm8m1rh9e20v>;
    /**
     * A new account was created.
     */
    "NewAccount": Anonymize<Icbccs0ug47ilf>;
    /**
     * An account was reaped.
     */
    "KilledAccount": Anonymize<Icbccs0ug47ilf>;
    /**
     * On on-chain remark happened.
     */
    "Remarked": Anonymize<I855j4i3kr8ko1>;
    /**
     * An upgrade was authorized.
     */
    "UpgradeAuthorized": Anonymize<Ibgl04rn6nbfm6>;
    /**
     * An invalid authorized upgrade was rejected while trying to apply it.
     */
    "RejectedInvalidAuthorizedUpgrade": Anonymize<I9lsk105fpepqs>;
}>;
export type Ia82mnkmeo2rhc = {
    "dispatch_info": Anonymize<Ic9s8f85vjtncc>;
};
export type Ic9s8f85vjtncc = {
    "weight": Anonymize<I4q39t5hn830vp>;
    "class": DispatchClass;
    "pays_fee": Enum<{
        "Yes": undefined;
        "No": undefined;
    }>;
};
export type DispatchClass = Enum<{
    "Normal": undefined;
    "Operational": undefined;
    "Mandatory": undefined;
}>;
export declare const DispatchClass: GetEnum<DispatchClass>;
export type I40r22b6eosbg5 = {
    "dispatch_error": Anonymize<I8341h4b88nf15>;
    "dispatch_info": Anonymize<Ic9s8f85vjtncc>;
};
export type I8341h4b88nf15 = AnonymousEnum<{
    "Other": undefined;
    "CannotLookup": undefined;
    "BadOrigin": undefined;
    "Module": Enum<{
        "System": Anonymize<I5o0s7c8q1cc9b>;
        "Timestamp": undefined;
        "ParachainSystem": Anonymize<Icjkr35j4tmg7k>;
        "ParachainInfo": undefined;
        "Balances": Anonymize<Idj13i7adlomht>;
        "ForeignAssets": Anonymize<I8ktb7n3252jn5>;
        "TransactionPayment": undefined;
        "AssetTxPayment": undefined;
        "Vesting": Anonymize<Icof2acl69lq3c>;
        "Referenda": Anonymize<I84u4ul208g742>;
        "ConvictionVoting": Anonymize<Idfa8k8ikssbsf>;
        "Preimage": Anonymize<I4cfhml1prt4lu>;
        "Scheduler": Anonymize<If7oa8fprnilo5>;
        "Utility": Anonymize<I8dt2g2hcrgh36>;
        "Proxy": Anonymize<Iuvt54ei4cehc>;
        "Multisig": Anonymize<Ia76qmhhg4jvb9>;
        "Migrations": Anonymize<Iaaqq5jevtahm8>;
        "Sudo": Anonymize<Iaug04qjhbli00>;
        "XcmpQueue": Anonymize<Idnnbndsjjeqqs>;
        "MessageQueue": Anonymize<I5iupade5ag2dp>;
        "CumulusXcm": undefined;
        "PolkadotXcm": Anonymize<I4vcvo9od6afmt>;
        "Authorship": undefined;
        "CollatorSelection": Anonymize<I36bcffk2387dv>;
        "Session": Anonymize<I1e07dgbaqd1sq>;
        "Aura": undefined;
        "AuraExt": undefined;
        "Origins": undefined;
        "Constitution": Anonymize<Iagesmeksmppjt>;
        "ConditionalLedger": Anonymize<I5hgsnolklrsfa>;
        "Market": Anonymize<I2ks874igoa6sr>;
        "Welfare": Anonymize<I64rovhghaoqvq>;
        "Oracle": Anonymize<I3fq6sj2jaqn2i>;
        "IncidentRegistry": Anonymize<I5elcsjjb7rur0>;
        "MilestoneRegistry": Anonymize<I5elcsjjb7rur0>;
        "FutarchyTreasury": Anonymize<Icfmf5mk6u773n>;
        "Guardian": Anonymize<I9n6rn7ujdds5b>;
        "Attestor": Anonymize<I7u7113h3itk4b>;
        "Epoch": Anonymize<Idim7dv3vdtr09>;
        "ExecutionGuard": Anonymize<I6r10mfpq2j8np>;
        "InflowCaps": undefined;
        "TrackOrigins": undefined;
        "ClientRegistry": Anonymize<I8d6nputfnb2vr>;
        "QuestionService": Anonymize<Ielejatsnujhn>;
        "ServiceLedger": Anonymize<I5hgsnolklrsfa>;
    }>;
    "ConsumerRemaining": undefined;
    "NoProviders": undefined;
    "TooManyConsumers": undefined;
    "Token": TokenError;
    "Arithmetic": ArithmeticError;
    "Transactional": TransactionalError;
    "Exhausted": undefined;
    "Corruption": undefined;
    "Unavailable": undefined;
    "RootNotAllowed": undefined;
    "Trie": Enum<{
        "InvalidStateRoot": undefined;
        "IncompleteDatabase": undefined;
        "ValueAtIncompleteKey": undefined;
        "DecoderError": undefined;
        "InvalidHash": undefined;
        "DuplicateKey": undefined;
        "ExtraneousNode": undefined;
        "ExtraneousValue": undefined;
        "ExtraneousHashReference": undefined;
        "InvalidChildReference": undefined;
        "ValueMismatch": undefined;
        "IncompleteProof": undefined;
        "RootMismatch": undefined;
        "DecodeError": undefined;
    }>;
}>;
export type I5o0s7c8q1cc9b = AnonymousEnum<{
    /**
     * The name of specification does not match between the current runtime
     * and the new runtime.
     */
    "InvalidSpecName": undefined;
    /**
     * The specification version is not allowed to decrease between the current runtime
     * and the new runtime.
     */
    "SpecVersionNeedsToIncrease": undefined;
    /**
     * Failed to extract the runtime version from the new runtime.
     *
     * Either calling `Core_version` or decoding `RuntimeVersion` failed.
     */
    "FailedToExtractRuntimeVersion": undefined;
    /**
     * Suicide called when the account has non-default composite data.
     */
    "NonDefaultComposite": undefined;
    /**
     * There is a non-zero reference count preventing the account from being purged.
     */
    "NonZeroRefCount": undefined;
    /**
     * The origin filter prevent the call to be dispatched.
     */
    "CallFiltered": undefined;
    /**
     * A multi-block migration is ongoing and prevents the current code from being replaced.
     */
    "MultiBlockMigrationsOngoing": undefined;
    /**
     * No upgrade authorized.
     */
    "NothingAuthorized": undefined;
    /**
     * The submitted code is not authorized.
     */
    "Unauthorized": undefined;
}>;
export type Icjkr35j4tmg7k = AnonymousEnum<{
    /**
     * Attempt to upgrade validation function while existing upgrade pending.
     */
    "OverlappingUpgrades": undefined;
    /**
     * Polkadot currently prohibits this parachain from upgrading its validation function.
     */
    "ProhibitedByPolkadot": undefined;
    /**
     * The supplied validation function has compiled into a blob larger than Polkadot is
     * willing to run.
     */
    "TooBig": undefined;
    /**
     * The inherent which supplies the validation data did not run this block.
     */
    "ValidationDataNotAvailable": undefined;
    /**
     * The inherent which supplies the host configuration did not run this block.
     */
    "HostConfigurationNotAvailable": undefined;
    /**
     * No validation function upgrade is currently scheduled.
     */
    "NotScheduled": undefined;
}>;
export type Idj13i7adlomht = AnonymousEnum<{
    /**
     * Vesting balance too high to send value.
     */
    "VestingBalance": undefined;
    /**
     * Account liquidity restrictions prevent withdrawal.
     */
    "LiquidityRestrictions": undefined;
    /**
     * Balance too low to send value.
     */
    "InsufficientBalance": undefined;
    /**
     * Value too low to create account due to existential deposit.
     */
    "ExistentialDeposit": undefined;
    /**
     * Transfer/payment would kill account.
     */
    "Expendability": undefined;
    /**
     * A vesting schedule already exists for this account.
     */
    "ExistingVestingSchedule": undefined;
    /**
     * Beneficiary account must pre-exist.
     */
    "DeadAccount": undefined;
    /**
     * Number of named reserves exceed `MaxReserves`.
     */
    "TooManyReserves": undefined;
    /**
     * Number of holds exceed `VariantCountOf<T::RuntimeHoldReason>`.
     */
    "TooManyHolds": undefined;
    /**
     * Number of freezes exceed `MaxFreezes`.
     */
    "TooManyFreezes": undefined;
    /**
     * The issuance cannot be modified since it is already deactivated.
     */
    "IssuanceDeactivated": undefined;
    /**
     * The delta cannot be zero.
     */
    "DeltaZero": undefined;
}>;
export type I8ktb7n3252jn5 = AnonymousEnum<{
    /**
     * Account balance must be greater than or equal to the transfer amount.
     */
    "BalanceLow": undefined;
    /**
     * The account to alter does not exist.
     */
    "NoAccount": undefined;
    /**
     * The signing account has no permission to do the operation.
     */
    "NoPermission": undefined;
    /**
     * The given asset ID is unknown.
     */
    "Unknown": undefined;
    /**
     * The origin account is frozen.
     */
    "Frozen": undefined;
    /**
     * The asset ID is already taken.
     */
    "InUse": undefined;
    /**
     * Invalid witness data given.
     */
    "BadWitness": undefined;
    /**
     * Minimum balance should be non-zero.
     */
    "MinBalanceZero": undefined;
    /**
     * Unable to increment the consumer reference counters on the account. Either no provider
     * reference exists to allow a non-zero balance of a non-self-sufficient asset, or one
     * fewer then the maximum number of consumers has been reached.
     */
    "UnavailableConsumer": undefined;
    /**
     * Invalid metadata given.
     */
    "BadMetadata": undefined;
    /**
     * No approval exists that would allow the transfer.
     */
    "Unapproved": undefined;
    /**
     * The source account would not survive the transfer and it needs to stay alive.
     */
    "WouldDie": undefined;
    /**
     * The asset-account already exists.
     */
    "AlreadyExists": undefined;
    /**
     * The asset-account doesn't have an associated deposit.
     */
    "NoDeposit": undefined;
    /**
     * The operation would result in funds being burned.
     */
    "WouldBurn": undefined;
    /**
     * The asset is a live asset and is actively being used. Usually emit for operations such
     * as `start_destroy` which require the asset to be in a destroying state.
     */
    "LiveAsset": undefined;
    /**
     * The asset is not live, and likely being destroyed.
     */
    "AssetNotLive": undefined;
    /**
     * The asset status is not the expected status.
     */
    "IncorrectStatus": undefined;
    /**
     * The asset should be frozen before the given operation.
     */
    "NotFrozen": undefined;
    /**
     * Callback action resulted in error
     */
    "CallbackFailed": undefined;
    /**
     * The asset ID must be equal to the [`NextAssetId`].
     */
    "BadAssetId": undefined;
    /**
     * The asset cannot be destroyed because some accounts for this asset contain freezes.
     */
    "ContainsFreezes": undefined;
    /**
     * The asset cannot be destroyed because some accounts for this asset contain holds.
     */
    "ContainsHolds": undefined;
    /**
     * Tried setting too many reserves.
     */
    "TooManyReserves": undefined;
}>;
export type Icof2acl69lq3c = AnonymousEnum<{
    /**
     * The account given is not vesting.
     */
    "NotVesting": undefined;
    /**
     * The account already has `MaxVestingSchedules` count of schedules and thus
     * cannot add another one. Consider merging existing schedules in order to add another.
     */
    "AtMaxVestingSchedules": undefined;
    /**
     * Amount being transferred is too low to create a vesting schedule.
     */
    "AmountLow": undefined;
    /**
     * An index was out of bounds of the vesting schedules.
     */
    "ScheduleIndexOutOfBounds": undefined;
    /**
     * Failed to create a new schedule because some parameter was invalid.
     */
    "InvalidScheduleParams": undefined;
}>;
export type I84u4ul208g742 = AnonymousEnum<{
    /**
     * Referendum is not ongoing.
     */
    "NotOngoing": undefined;
    /**
     * Referendum's decision deposit is already paid.
     */
    "HasDeposit": undefined;
    /**
     * The track identifier given was invalid.
     */
    "BadTrack": undefined;
    /**
     * There are already a full complement of referenda in progress for this track.
     */
    "Full": undefined;
    /**
     * The queue of the track is empty.
     */
    "QueueEmpty": undefined;
    /**
     * The referendum index provided is invalid in this context.
     */
    "BadReferendum": undefined;
    /**
     * There was nothing to do in the advancement.
     */
    "NothingToDo": undefined;
    /**
     * No track exists for the proposal origin.
     */
    "NoTrack": undefined;
    /**
     * Any deposit cannot be refunded until after the decision is over.
     */
    "Unfinished": undefined;
    /**
     * The deposit refunder is not the depositor.
     */
    "NoPermission": undefined;
    /**
     * The deposit cannot be refunded since none was made.
     */
    "NoDeposit": undefined;
    /**
     * The referendum status is invalid for this operation.
     */
    "BadStatus": undefined;
    /**
     * The preimage does not exist.
     */
    "PreimageNotExist": undefined;
    /**
     * The preimage is stored with a different length than the one provided.
     */
    "PreimageStoredWithDifferentLength": undefined;
}>;
export type Idfa8k8ikssbsf = AnonymousEnum<{
    /**
     * Poll is not ongoing.
     */
    "NotOngoing": undefined;
    /**
     * The given account did not vote on the poll.
     */
    "NotVoter": undefined;
    /**
     * The actor has no permission to conduct the action.
     */
    "NoPermission": undefined;
    /**
     * The actor has no permission to conduct the action right now but will do in the future.
     */
    "NoPermissionYet": undefined;
    /**
     * The account is already delegating.
     */
    "AlreadyDelegating": undefined;
    /**
     * The account currently has votes attached to it and the operation cannot succeed until
     * these are removed through `remove_vote`.
     */
    "AlreadyVoting": undefined;
    /**
     * Too high a balance was provided that the account cannot afford.
     */
    "InsufficientFunds": undefined;
    /**
     * The account is not currently delegating.
     */
    "NotDelegating": undefined;
    /**
     * Delegation to oneself makes no sense.
     */
    "Nonsense": undefined;
    /**
     * Maximum number of votes reached.
     */
    "MaxVotesReached": undefined;
    /**
     * The class must be supplied since it is not easily determinable from the state.
     */
    "ClassNeeded": undefined;
    /**
     * The class ID supplied is invalid.
     */
    "BadClass": undefined;
}>;
export type I4cfhml1prt4lu = AnonymousEnum<{
    /**
     * Preimage is too large to store on-chain.
     */
    "TooBig": undefined;
    /**
     * Preimage has already been noted on-chain.
     */
    "AlreadyNoted": undefined;
    /**
     * The user is not authorized to perform this action.
     */
    "NotAuthorized": undefined;
    /**
     * The preimage cannot be removed since it has not yet been noted.
     */
    "NotNoted": undefined;
    /**
     * A preimage may not be removed when there are outstanding requests.
     */
    "Requested": undefined;
    /**
     * The preimage request cannot be removed since no outstanding requests exist.
     */
    "NotRequested": undefined;
    /**
     * More than `MAX_HASH_UPGRADE_BULK_COUNT` hashes were requested to be upgraded at once.
     */
    "TooMany": undefined;
    /**
     * Too few hashes were requested to be upgraded (i.e. zero).
     */
    "TooFew": undefined;
}>;
export type If7oa8fprnilo5 = AnonymousEnum<{
    /**
     * Failed to schedule a call
     */
    "FailedToSchedule": undefined;
    /**
     * Cannot find the scheduled call.
     */
    "NotFound": undefined;
    /**
     * Given target block number is in the past.
     */
    "TargetBlockNumberInPast": undefined;
    /**
     * Reschedule failed because it does not change scheduled time.
     */
    "RescheduleNoChange": undefined;
    /**
     * Attempt to use a non-named function on a named task.
     */
    "Named": undefined;
}>;
export type I8dt2g2hcrgh36 = AnonymousEnum<{
    /**
     * Too many calls batched.
     */
    "TooManyCalls": undefined;
}>;
export type Iuvt54ei4cehc = AnonymousEnum<{
    /**
     * There are too many proxies registered or too many announcements pending.
     */
    "TooMany": undefined;
    /**
     * Proxy registration not found.
     */
    "NotFound": undefined;
    /**
     * Sender is not a proxy of the account to be proxied.
     */
    "NotProxy": undefined;
    /**
     * A call which is incompatible with the proxy type's filter was attempted.
     */
    "Unproxyable": undefined;
    /**
     * Account is already a proxy.
     */
    "Duplicate": undefined;
    /**
     * Call may not be made by proxy because it may escalate its privileges.
     */
    "NoPermission": undefined;
    /**
     * Announcement, if made at all, was made too recently.
     */
    "Unannounced": undefined;
    /**
     * Cannot add self as proxy.
     */
    "NoSelfProxy": undefined;
}>;
export type Ia76qmhhg4jvb9 = AnonymousEnum<{
    /**
     * Threshold must be 2 or greater.
     */
    "MinimumThreshold": undefined;
    /**
     * Call is already approved by this signatory.
     */
    "AlreadyApproved": undefined;
    /**
     * Call doesn't need any (more) approvals.
     */
    "NoApprovalsNeeded": undefined;
    /**
     * There are too few signatories in the list.
     */
    "TooFewSignatories": undefined;
    /**
     * There are too many signatories in the list.
     */
    "TooManySignatories": undefined;
    /**
     * The signatories were provided out of order; they should be ordered.
     */
    "SignatoriesOutOfOrder": undefined;
    /**
     * The sender was contained in the other signatories; it shouldn't be.
     */
    "SenderInSignatories": undefined;
    /**
     * Multisig operation not found in storage.
     */
    "NotFound": undefined;
    /**
     * Only the account that originally created the multisig is able to cancel it or update
     * its deposits.
     */
    "NotOwner": undefined;
    /**
     * No timepoint was given, yet the multisig operation is already underway.
     */
    "NoTimepoint": undefined;
    /**
     * A different timepoint was given to the multisig operation that is underway.
     */
    "WrongTimepoint": undefined;
    /**
     * A timepoint was given, yet no multisig operation is underway.
     */
    "UnexpectedTimepoint": undefined;
    /**
     * The maximum weight information provided was too low.
     */
    "MaxWeightTooLow": undefined;
    /**
     * The data to be stored is already stored.
     */
    "AlreadyStored": undefined;
}>;
export type Iaaqq5jevtahm8 = AnonymousEnum<{
    /**
     * The operation cannot complete since some MBMs are ongoing.
     */
    "Ongoing": undefined;
}>;
export type Iaug04qjhbli00 = AnonymousEnum<{
    /**
     * Sender must be the Sudo account.
     */
    "RequireSudo": undefined;
}>;
export type Idnnbndsjjeqqs = AnonymousEnum<{
    /**
     * Setting the queue config failed since one of its values was invalid.
     */
    "BadQueueConfig": undefined;
    /**
     * The execution is already suspended.
     */
    "AlreadySuspended": undefined;
    /**
     * The execution is already resumed.
     */
    "AlreadyResumed": undefined;
    /**
     * There are too many active outbound channels.
     */
    "TooManyActiveOutboundChannels": undefined;
    /**
     * The message is too big.
     */
    "TooBig": undefined;
}>;
export type I5iupade5ag2dp = AnonymousEnum<{
    /**
     * Page is not reapable because it has items remaining to be processed and is not old
     * enough.
     */
    "NotReapable": undefined;
    /**
     * Page to be reaped does not exist.
     */
    "NoPage": undefined;
    /**
     * The referenced message could not be found.
     */
    "NoMessage": undefined;
    /**
     * The message was already processed and cannot be processed again.
     */
    "AlreadyProcessed": undefined;
    /**
     * The message is queued for future execution.
     */
    "Queued": undefined;
    /**
     * There is temporarily not enough weight to continue servicing messages.
     */
    "InsufficientWeight": undefined;
    /**
     * This message is temporarily unprocessable.
     *
     * Such errors are expected, but not guaranteed, to resolve themselves eventually through
     * retrying.
     */
    "TemporarilyUnprocessable": undefined;
    /**
     * The queue is paused and no message can be executed from it.
     *
     * This can change at any time and may resolve in the future by re-trying.
     */
    "QueuePaused": undefined;
    /**
     * Another call is in progress and needs to finish before this call can happen.
     */
    "RecursiveDisallowed": undefined;
}>;
export type I4vcvo9od6afmt = AnonymousEnum<{
    /**
     * The desired destination was unreachable, generally because there is a no way of routing
     * to it.
     */
    "Unreachable": undefined;
    /**
     * There was some other issue (i.e. not to do with routing) in sending the message.
     * Perhaps a lack of space for buffering the message.
     */
    "SendFailure": undefined;
    /**
     * The message execution fails the filter.
     */
    "Filtered": undefined;
    /**
     * The message's weight could not be determined.
     */
    "UnweighableMessage": undefined;
    /**
     * The destination `Location` provided cannot be inverted.
     */
    "DestinationNotInvertible": undefined;
    /**
     * The assets to be sent are empty.
     */
    "Empty": undefined;
    /**
     * Could not re-anchor the assets to declare the fees for the destination chain.
     */
    "CannotReanchor": undefined;
    /**
     * Too many assets have been attempted for transfer.
     */
    "TooManyAssets": undefined;
    /**
     * Origin is invalid for sending.
     */
    "InvalidOrigin": undefined;
    /**
     * The version of the `Versioned` value used is not able to be interpreted.
     */
    "BadVersion": undefined;
    /**
     * The given location could not be used (e.g. because it cannot be expressed in the
     * desired version of XCM).
     */
    "BadLocation": undefined;
    /**
     * The referenced subscription could not be found.
     */
    "NoSubscription": undefined;
    /**
     * The location is invalid since it already has a subscription from us.
     */
    "AlreadySubscribed": undefined;
    /**
     * Could not check-out the assets for teleportation to the destination chain.
     */
    "CannotCheckOutTeleport": undefined;
    /**
     * The owner does not own (all) of the asset that they wish to do the operation on.
     */
    "LowBalance": undefined;
    /**
     * The asset owner has too many locks on the asset.
     */
    "TooManyLocks": undefined;
    /**
     * The given account is not an identifiable sovereign account for any location.
     */
    "AccountNotSovereign": undefined;
    /**
     * The operation required fees to be paid which the initiator could not meet.
     */
    "FeesNotMet": undefined;
    /**
     * A remote lock with the corresponding data could not be found.
     */
    "LockNotFound": undefined;
    /**
     * The unlock operation cannot succeed because there are still consumers of the lock.
     */
    "InUse": undefined;
    /**
     * Invalid asset, reserve chain could not be determined for it.
     */
    "InvalidAssetUnknownReserve": undefined;
    /**
     * Invalid asset, do not support remote asset reserves with different fees reserves.
     */
    "InvalidAssetUnsupportedReserve": undefined;
    /**
     * Too many assets with different reserve locations have been attempted for transfer.
     */
    "TooManyReserves": undefined;
    /**
     * Local XCM execution incomplete.
     */
    "LocalExecutionIncomplete": undefined;
    /**
     * Too many locations authorized to alias origin.
     */
    "TooManyAuthorizedAliases": undefined;
    /**
     * Expiry block number is in the past.
     */
    "ExpiresInPast": undefined;
    /**
     * The alias to remove authorization for was not found.
     */
    "AliasNotFound": undefined;
    /**
     * Local XCM execution incomplete with the actual XCM error and the index of the
     * instruction that caused the error.
     */
    "LocalExecutionIncompleteWithError": Anonymize<I5r8t4iaend96p>;
}>;
export type I5r8t4iaend96p = {
    "index": number;
    "error": Enum<{
        "Overflow": undefined;
        "Unimplemented": undefined;
        "UntrustedReserveLocation": undefined;
        "UntrustedTeleportLocation": undefined;
        "LocationFull": undefined;
        "LocationNotInvertible": undefined;
        "BadOrigin": undefined;
        "InvalidLocation": undefined;
        "AssetNotFound": undefined;
        "FailedToTransactAsset": undefined;
        "NotWithdrawable": undefined;
        "LocationCannotHold": undefined;
        "ExceedsMaxMessageSize": undefined;
        "DestinationUnsupported": undefined;
        "Transport": undefined;
        "Unroutable": undefined;
        "UnknownClaim": undefined;
        "FailedToDecode": undefined;
        "MaxWeightInvalid": undefined;
        "NotHoldingFees": undefined;
        "TooExpensive": undefined;
        "Trap": undefined;
        "ExpectationFalse": undefined;
        "PalletNotFound": undefined;
        "NameMismatch": undefined;
        "VersionIncompatible": undefined;
        "HoldingWouldOverflow": undefined;
        "ExportError": undefined;
        "ReanchorFailed": undefined;
        "NoDeal": undefined;
        "FeesNotMet": undefined;
        "LockError": undefined;
        "NoPermission": undefined;
        "Unanchored": undefined;
        "NotDepositable": undefined;
        "TooManyAssets": undefined;
        "UnhandledXcmVersion": undefined;
        "WeightLimitReached": undefined;
        "Barrier": undefined;
        "WeightNotComputable": undefined;
        "ExceedsStackLimit": undefined;
    }>;
};
export type I36bcffk2387dv = AnonymousEnum<{
    /**
     * The pallet has too many candidates.
     */
    "TooManyCandidates": undefined;
    /**
     * Leaving would result in too few candidates.
     */
    "TooFewEligibleCollators": undefined;
    /**
     * Account is already a candidate.
     */
    "AlreadyCandidate": undefined;
    /**
     * Account is not a candidate.
     */
    "NotCandidate": undefined;
    /**
     * There are too many Invulnerables.
     */
    "TooManyInvulnerables": undefined;
    /**
     * Account is already an Invulnerable.
     */
    "AlreadyInvulnerable": undefined;
    /**
     * Account is not an Invulnerable.
     */
    "NotInvulnerable": undefined;
    /**
     * Account has no associated validator ID.
     */
    "NoAssociatedValidatorId": undefined;
    /**
     * Validator ID is not yet registered.
     */
    "ValidatorNotRegistered": undefined;
    /**
     * Could not insert in the candidate list.
     */
    "InsertToCandidateListFailed": undefined;
    /**
     * Could not remove from the candidate list.
     */
    "RemoveFromCandidateListFailed": undefined;
    /**
     * New deposit amount would be below the minimum candidacy bond.
     */
    "DepositTooLow": undefined;
    /**
     * Could not update the candidate list.
     */
    "UpdateCandidateListFailed": undefined;
    /**
     * Deposit amount is too low to take the target's slot in the candidate list.
     */
    "InsufficientBond": undefined;
    /**
     * The target account to be replaced in the candidate list is not a candidate.
     */
    "TargetIsNotCandidate": undefined;
    /**
     * The updated deposit amount is equal to the amount already reserved.
     */
    "IdenticalDeposit": undefined;
    /**
     * Cannot lower candidacy bond while occupying a future collator slot in the list.
     */
    "InvalidUnreserve": undefined;
}>;
export type I1e07dgbaqd1sq = AnonymousEnum<{
    /**
     * Invalid ownership proof.
     */
    "InvalidProof": undefined;
    /**
     * No associated validator ID for account.
     */
    "NoAssociatedValidatorId": undefined;
    /**
     * Registered duplicate key.
     */
    "DuplicatedKey": undefined;
    /**
     * No keys are associated with this account.
     */
    "NoKeys": undefined;
    /**
     * Key setting account is not live, so it's impossible to associate keys.
     */
    "NoAccount": undefined;
}>;
export type Iagesmeksmppjt = AnonymousEnum<{
    /**
     * No record exists under the given `ParamKey`.
     */
    "UnknownParam": undefined;
    /**
     * No meter exists at the given index.
     */
    "UnknownMeter": undefined;
    /**
     * Value kind does not match the record's typed kind.
     */
    "WrongType": undefined;
    /**
     * Proposed value below the record's hard minimum (I-6).
     */
    "BelowMin": undefined;
    /**
     * Proposed value above the record's hard maximum (I-6).
     */
    "AboveMax": undefined;
    /**
     * Proposed step exceeds the record's max Δ/decision (I-6).
     */
    "DeltaTooLarge": undefined;
    /**
     * The record's per-key cooldown has not elapsed (I-6).
     */
    "CooldownActive": undefined;
    /**
     * Meter arithmetic overflow — rejected, never wrapped (G-1).
     */
    "MeterOverflow": undefined;
    /**
     * Charge would exceed the meter's kernel envelope (I-7/I-17).
     */
    "MeterExhausted": undefined;
    /**
     * Write touches a reserved `PhaseFlags` bit (02 §7.3).
     */
    "ReservedPhaseFlag": undefined;
    /**
     * `set_phase_flag` touches a machinery bit outside the 09 §5.4
     * sudo-armable set (bits 5–7 are sibling-pallet state).
     */
    "FlagNotArmable": undefined;
    /**
     * Release-channel bytes violate the frozen schema-1 layout (02 §12).
     */
    "BadReleaseSchema": undefined;
    /**
     * Params over the 13 §4 bound (genesis validation only).
     */
    "TooManyParams": undefined;
    /**
     * Meters over the core bound (genesis validation only).
     */
    "TooManyMeters": undefined;
    /**
     * Capability table full.
     */
    "TooManyCapabilities": undefined;
    /**
     * `amend_registry` tried to move a kernel-bounded row's bounds
     * (13 rule 7 — genesis-fixed).
     */
    "KernelBoundImmutable": undefined;
    /**
     * `amend_registry` violates the compile-time meta-bounds
     * (13 rule 2/7: `min ≤ value ≤ max`, kind-consistent, cooldown ≤ 8).
     */
    "MetaBoundViolation": undefined;
    /**
     * Core state validator rejected the aggregate (try-state only).
     */
    "TryStateViolation": undefined;
    /**
     * 08 §4.2 (SQ-180): arming a proposal class was refused because
     * published spendable NAV is below that class's 08 §4.1 floor — which
     * includes the fail-static case where the 08 §1.2 reserve-health flag
     * has zeroed spendable NAV outright. `PhaseFlags` is left unchanged.
     */
    "NavFloorUnmet": undefined;
    /**
     * 13 §5 item 6's screening obligation refused this change, fail-closed
     * (SQ-303/SQ-501). Either a class-floor key whose proposed value
     * re-derives an 08 §4.1 NAV floor above the frozen literal, or an
     * occupancy key whose proposed value would grow one of items 1–4's
     * envelopes past the frozen figure the runtime compiles against — both
     * screened **by value**, and both answering this way when the
     * derivation cannot be evaluated at all (G-1). See
     * `constitution_core::Error::BudgetDerivationRequired`.
     */
    "BudgetDerivationRequired": undefined;
    /**
     * 09 §5.2: `phase3.tvl_cap` / `phase3.dep_cap` are raised only by
     * phase gates and are not PARAM/META-adjustable during Phases ≤ 3.
     * Lowering — tightening containment — remains legal at every phase
     * (SQ-197). Deliberately not `BadOrigin`: the origin is authorized,
     * the value direction is not.
     */
    "PhaseCapRaiseRefused": undefined;
    /**
     * 07 §6.3 (SQ-495): the amendment would lower the bond-coverage rate
     * `(2^orc.rounds − 1) · orc.bond_bps` below the `Δs_max` of a component
     * already admitted to a live MetricSpec. Raising coverage is always
     * permitted; only the direction that leaves an admitted component
     * settling money under an uncovering ladder is refused. Deliberately
     * not `BadOrigin` — the origin is authorized, the resulting state is
     * not.
     */
    "CoverageBreaksAdmission": undefined;
    /**
     * 13 rule 7 / 08 §10.6 (E1): the amendment would carry the live pair
     * `ledger.redeem_fee ≤ mkt.fee` out of band. Both rows are **PARAM**,
     * so a single PARAM decision can move either side and both directions
     * are refused: raising `ledger.redeem_fee` above the live `mkt.fee`,
     * and lowering `mkt.fee` beneath the live `ledger.redeem_fee`.
     * Deliberately not `TryStateViolation` (nothing stored is violating an
     * invariant — the refusal is what keeps it that way), not `AboveMax`
     * (the row's own `[0, 100]` bps bounds are satisfied; the live coupling
     * is what binds) and not `BadOrigin` (the origin is authorized, the
     * resulting pair is not). Appended last — the preceding discriminants
     * are SCALE-stable.
     */
    "RedemptionFeeAboveMarketFee": undefined;
}>;
export type I5hgsnolklrsfa = AnonymousEnum<{
    /**
     * Origin was not the internal authority the call requires (defensive; the
     * pallet checks origins before the core, so the happy path never sees it).
     */
    "BadOrigin": undefined;
    /**
     * No proposal vault exists for the given id.
     */
    "UnknownVault": undefined;
    /**
     * No Baseline vault exists for the given epoch.
     */
    "UnknownBaselineVault": undefined;
    /**
     * The vault/Baseline vault is not in a state that admits this operation
     * (03 §2.3 transition table; the coarse status-quo default, G-1).
     */
    "WrongVaultState": undefined;
    /**
     * Amount is below `MinSplit`/`MinTransfer` (03 §7 R-2).
     */
    "BelowMinimum": undefined;
    /**
     * Checked conservation arithmetic overflowed (03 §6/§8).
     */
    "ArithmeticOverflow": undefined;
    /**
     * Caller does not hold enough of the required instrument.
     */
    "InsufficientPosition": undefined;
    /**
     * Creating the entry would exceed `MaxPositionsPerAccount` (03 §4).
     */
    "TooManyPositions": undefined;
    /**
     * Settlement score `s` is outside `[0, 1]` (1e9 scale).
     */
    "InvalidScore": undefined;
    /**
     * The gate outcome for this gate is already recorded.
     */
    "GateAlreadySettled": undefined;
    /**
     * The gate outcome for this gate is not yet recorded.
     */
    "GateNotSettled": undefined;
    /**
     * A conservation invariant was violated (surfaces only from the core's
     * internal consistency guards; try-state maps drift to I-4).
     */
    "TryStateViolation": undefined;
    /**
     * The vault is not yet reap-eligible: not terminal, or `ArchiveDelay` has
     * not elapsed, or an associated seeded market has not completed its
     * 04 §2 Sweep (03 §5.4 / 04 §2).
     */
    "ReapNotDue": undefined;
    /**
     * The position-storage deposit could not be taken from the entry owner
     * (03 §4 / §8).
     */
    "DepositFailed": undefined;
    /**
     * PB-RESERVE currently blocks public split inflows.
     */
    "SplitPaused": undefined;
    /**
     * PB-LEDGER-FREEZE currently blocks public ledger funds movement.
     */
    "Frozen": undefined;
    /**
     * The requested expiry is in the past or beyond the kernel window.
     */
    "FreezeOutOfBounds": undefined;
    /**
     * The one pallet-level LedgerFreeze renewal was already consumed.
     */
    "FreezeRenewalExhausted": undefined;
    /**
     * New escrow is halted because global USDC issuance or the signer's
     * cumulative Phase-3 deposit meter is already above its live cap.
     */
    "InflowCapExceeded": undefined;
    /**
     * Signed users cannot route positions into deposit-exempt protocol
     * custody; only the MarketAuthority wrapper may do so (03 §4/§5.1).
     */
    "ProtocolDestination": undefined;
}>;
export type I2ks874igoa6sr = AnonymousEnum<{
    "UnknownMarket": undefined;
    "DuplicateMarket": undefined;
    "DuplicateBaselineMarket": undefined;
    "NotTrading": undefined;
    "AmountTooSmall": undefined;
    "AmountTooLarge": undefined;
    "SlippageExceeded": undefined;
    "PriceBoundExceeded": undefined;
    "ArithmeticOverflow": undefined;
    "Ledger": undefined;
    "TryStateViolation": undefined;
    "BadOrigin": undefined;
    "NotReapable": undefined;
    /**
     * Creating this book would exceed `MaxLiveMarkets = 196` (I-21).
     */
    "TooManyMarkets": undefined;
    /**
     * Creating this book would exceed the archive-derived stored-book cap.
     */
    "TooManyStoredMarkets": undefined;
    /**
     * The book's POL headroom has already been seeded (04 §10, idempotence).
     */
    "AlreadySeeded": undefined;
    /**
     * PB-DEPEG blocks book creation/seeding until its bounded expiry.
     */
    "CreationFrozen": undefined;
    /**
     * PB-LEDGER-FREEZE blocks trading/observation until its bounded expiry.
     */
    "Frozen": undefined;
    /**
     * The requested expiry is in the past or beyond its kernel bound.
     */
    "FreezeOutOfBounds": undefined;
    /**
     * The one pallet-level LedgerFreeze renewal was already consumed.
     */
    "FreezeRenewalExhausted": undefined;
    /**
     * A proposed book/fee address is not the canonical, permanently
     * reserved protocol-custody address for this market id.
     */
    "UnreservedProtocolAccount": undefined;
    /**
     * The explicit event epoch disagrees with an embedded Baseline epoch.
     *
     * This is append-only: the market error discriminants above are part
     * of retained dispatch metadata and must not be renumbered.
     */
    "EpochMismatch": undefined;
    /**
     * The book's 04 §2 Sweep preconditions are unmet: it is still open, its
     * owning vault is not terminal, or a gate outcome it must price is not
     * recorded yet. Status-quo and retryable — never a silent empty sweep.
     */
    "NotSweepable": undefined;
    /**
     * External live/retained capacity is independent from protocol POL.
     */
    "TooManyExternalMarkets": undefined;
    /**
     * A protocol-only operation was presented an external book or vice versa.
     */
    "WrongFundingDomain": undefined;
    /**
     * The supplied external subsidy account is not the immutable funder.
     */
    "FunderMismatch": undefined;
    /**
     * A hosted question already owns its immutable two-book record.
     */
    "DuplicateExternalQuestion": undefined;
    /**
     * A primary/service identifier crossed `SERVICE_ID_BASE`.
     */
    "InvalidIdBand": undefined;
}>;
export type I64rovhghaoqvq = AnonymousEnum<{
    "TooManyMetricSpecs": undefined;
    "TooManySnapshots": undefined;
    "TooManyComponents": undefined;
    "TooManyGateFlags": undefined;
    "DuplicateSpecVersion": undefined;
    "SpecNotFound": undefined;
    "BadActivationEpoch": undefined;
    "SpecNotActive": undefined;
    "MissingMetricDiscipline": undefined;
    "BadEpsilonFloor": undefined;
    "BadSourceClass": undefined;
    "BadWeightSum": undefined;
    "ValueOutOfRange": undefined;
    "MissingComponent": undefined;
    "DuplicateComponent": undefined;
    "DuplicateSnapshot": undefined;
    "ArithmeticOverflow": undefined;
    "TryStateViolation": undefined;
    "BadParams": undefined;
    /**
     * A snapshot/daily-gate crank named an epoch that has not finalized yet
     * (`epoch >= CurrentEpoch`). 05 §4.6 winsorizes over *finalized* epoch
     * values, so a keeper may only record an epoch the clock has passed.
     */
    "EpochNotFinalized": undefined;
    /**
     * Gate-market settlement was asked to resolve a cohort whose e+1…e+2
     * window contains an epoch with no recorded daily observation at all
     * (05 §4.7; SQ-79). The gate input is unavailable, so settlement holds
     * at the status quo and the cohort takes 07 §10's VOID.
     */
    "GateWindowUnsampled": undefined;
    /**
     * The A-pillar milestone component declares no positive `target`, so
     * 05 §4.3's `min(1, points ÷ target)` has no defined value (07 §7).
     */
    "MilestoneTargetUnset": undefined;
    /**
     * An attested component's `delta_s_max_bps` is outside `(0, 10_000]`
     * (05 §4.4).
     */
    "BadDeltaSMax": undefined;
    /**
     * 07 §2(5): fewer than `orc.n_min` reporters or fewer than `wt.quorum`
     * watchtowers are registered, so an attested component's game could not
     * be adjudicated.
     */
    "InsufficientOracleSeats": undefined;
    /**
     * 07 §6.3: the live bond ladder does not cover the component's declared
     * `Δs_max`, so a lie about it would cost less than it can move. Also
     * returned when the ladder is unreadable — the fail-closed direction.
     */
    "BondCoverageUnmet": undefined;
    /**
     * The registry has no closed incident aggregate for this
     * `(epoch, spec_version)`, so `C_attested`'s multiplier is unknown
     * (07 §7, SQ-141). The snapshot is refused rather than resolved to the
     * favourable neutral 1.0; 07 §11(1)'s d20 money deadline guarantees the
     * record exists in time, so this is a retry, not a wedge.
     */
    "IncidentAggregateUnavailable": undefined;
    /**
     * A flagged component offered for a snapshot is not an **attested**
     * component of that spec version (07 §10; §11(1)(i)). Only class-4
     * components are reportable, so only they can carry a flagged epoch.
     */
    "BadFlaggedComponent": undefined;
    /**
     * A snapshot exists with no 07 §10 settlement context beside it. The two
     * are written and retired atomically, so this is a corrupted-state
     * signal rather than a reachable outcome.
     */
    "MissingSnapshotContext": undefined;
    /**
     * A 05 §4.6 percentile was asked of an empty winsorization sample. The
     * `prior_bounds ++ finalized` assembly is always 12 elements, so this
     * is a corrupted-state signal rather than a reachable outcome.
     */
    "EmptyNormalizationSample": undefined;
    /**
     * The 05 §4.6 min–max range is zero-width, so the component's raw
     * series has no map onto [0,1]. Refused rather than resolved to the
     * adopt-favourable 1.0 (G-1).
     */
    "DegenerateNormalizationRange": undefined;
    /**
     * The named day is not in the epoch's measurable day set (05 §4.7): the
     * epoch had fewer whole days than that, or its timing is no longer
     * retained so membership cannot be decided. Appended, not inserted —
     * error indices are part of the decoded surface (02 §13).
     */
    "DayOutsideEpoch": undefined;
    /**
     * The named `spec_version` is activated by the epoch but is not one
     * the epoch may be measured under: for `record_snapshot`, neither the
     * epoch's active spec nor a version any live cohort froze for it
     * (I-16); for `record_daily_gate`, not the epoch's active spec at all
     * — `GateBreachFlags` is keyed by epoch alone and settles money, so
     * it admits exactly one version. Appended, not inserted (02 §13).
     */
    "SpecVersionNotAdmissible": undefined;
}>;
export type I3fq6sj2jaqn2i = AnonymousEnum<{
    /**
     * Caller is already a registered reporter/watchtower (07 §3/§4).
     */
    "AlreadyRegistered": undefined;
    /**
     * Caller is not a registered reporter/watchtower (07 §3/§4).
     */
    "NotRegistered": undefined;
    /**
     * Reporter registry is full (`MAX_REPORTERS`).
     */
    "TooManyReporters": undefined;
    /**
     * Watchtower registry is full (`wt.max = 16`).
     */
    "TooManyWatchtowers": undefined;
    /**
     * The challenge/report window has closed (07 §5).
     */
    "WindowClosed": undefined;
    /**
     * The window is still open / round not yet resolvable (07 §5).
     */
    "WindowOpen": undefined;
    /**
     * Posted bond is below the value-scaled minimum (07 §6).
     */
    "BondBelowMinimum": undefined;
    /**
     * The report names a version other than the frozen cohort version (07 §2(4)).
     */
    "SpecVersionMismatch": undefined;
    /**
     * The `(component, epoch, version)` is already settled — final (I-18).
     */
    "AlreadyFinal": undefined;
    /**
     * This round already carries a challenge (07 §5.2).
     */
    "AlreadyChallenged": undefined;
    /**
     * A quorum decision is still pending for this round (07 §4).
     */
    "QuorumPending": undefined;
    /**
     * No round exists for the given key (07 §5).
     */
    "RoundNotFound": undefined;
    /**
     * Live-round registry is full (`MAX_ROUNDS`).
     */
    "RoundLimit": undefined;
    /**
     * This watchtower already acknowledged this round (07 §4).
     */
    "DuplicateAck": undefined;
    /**
     * A reserve-unhealthy condition blocked the action (07 §8).
     */
    "ReserveUnhealthy": undefined;
    /**
     * The reserve probe interval has not elapsed (07 §8).
     */
    "ProbeTooEarly": undefined;
    /**
     * The reserve probe has not yet passed its funding/readiness gate.
     */
    "ProbeUnavailable": undefined;
    /**
     * The `query_id` does not match the outstanding probe (07 §8).
     */
    "UnknownQuery": undefined;
    /**
     * Arithmetic overflow — rejected, never wrapped (G-1).
     */
    "Overflow": undefined;
    /**
     * The frozen spec does not declare this component recomputable (07 §9).
     */
    "NotRecomputable": undefined;
    /**
     * `recompute_proof` payload exceeds `orc.max_proof_bytes` (07 §9).
     */
    "ProofTooLarge": undefined;
    /**
     * The proof does not match the committed evidence hash (07 §9).
     */
    "EvidenceMismatch": undefined;
    /**
     * The committed payload does not decode to a valid value (07 §9).
     */
    "BadProof": undefined;
    /**
     * A reported/adjudicated value is off the 05 §4.4 `[0, 1]` grid.
     */
    "ValueOutOfBounds": undefined;
    /**
     * 07 §5.2 (contract v19): the round's own reporter may not challenge
     * it. §5.5 disposes of a round in favour of "the honest counterparty"
     * and §5.3 calls escalation "opt-in on both sides"; both are undefined
     * when one account holds both roles.
     */
    "SelfChallenge": undefined;
    /**
     * 07 §3 (contract v19): an account ejected on the third adjudicated
     * -false finding may never re-register. Ejection is permanent.
     */
    "ReporterEjected": undefined;
    /**
     * Core state validator rejected the aggregate (try-state only).
     */
    "TryStateViolation": undefined;
    /**
     * 07 §3 saturation clause: the retained-record store is full of
     * ejections, so no fresh registration can be proved not to be a
     * dropped ban re-entering. Permissionless entry closes until a CODE
     * change enlarges the store. Appended last — SCALE discriminants are
     * positional.
     */
    "ReporterRecordsSaturated": undefined;
}>;
export type I5elcsjjb7rur0 = AnonymousEnum<{
    /**
     * The per-epoch filing cap (`MaxFilingsPerEpoch`) is reached.
     */
    "EpochFull": undefined;
    /**
     * More than `MAX_LIVE_EPOCHS` epochs have live filings.
     */
    "TooManyLiveEpochs": undefined;
    /**
     * More than `MAX_AGGREGATES` closed-epoch aggregates are retained.
     */
    "TooManyAggregates": undefined;
    /**
     * The filing/challenge window has closed.
     */
    "WindowClosed": undefined;
    /**
     * The window/challenge round is still open (premature close/resolve).
     */
    "WindowOpen": undefined;
    /**
     * The filing is already challenged (registry games do not escalate).
     */
    "AlreadyChallenged": undefined;
    /**
     * The filing is already terminal.
     */
    "AlreadyFinal": undefined;
    /**
     * The report names a spec version other than the frozen one (I-16).
     */
    "SpecVersionMismatch": undefined;
    /**
     * The required bond is zero / below minimum.
     */
    "BondBelowMinimum": undefined;
    /**
     * No filing with that `(epoch, filing_id)`.
     */
    "FilingNotFound": undefined;
    /**
     * This watchtower already acknowledged this filing.
     */
    "DuplicateAck": undefined;
    /**
     * The close batch exceeds `REG_CLOSE_BATCH`.
     */
    "BatchTooLarge": undefined;
    /**
     * The filing class is invalid for this instance's kind.
     */
    "InvalidClass": undefined;
    /**
     * Checked arithmetic overflowed (G-1).
     */
    "Overflow": undefined;
    /**
     * The acker is not a registered bonded watchtower (07 §4).
     */
    "NotRegistered": undefined;
    /**
     * The core state validator rejected the aggregate (try-state only).
     */
    "TryStateViolation": undefined;
    /**
     * A lossy `AccountId` bridge would alias distinct accounts (02 §8).
     */
    "BadAccount": undefined;
    /**
     * The filing already has `WT_QUORUM` acknowledgments (07 §4).
     */
    "AlreadyQuorum": undefined;
    /**
     * The epoch is not yet reap-eligible: not closed, or `ArchiveDelay` has
     * not elapsed since close (07 §7).
     */
    "ReapNotDue": undefined;
    /**
     * `close_epoch` on an epoch with no live filings — nothing to close
     * (an empty epoch is welfare's "no record ⇒ 1" default, and a reaped
     * epoch must never re-close, 07 §7).
     */
    "NothingToClose": undefined;
    /**
     * The Milestone instance's frozen-MetricSpec completion `target` is zero
     * or absent, so `min(1, points ÷ target)` is undefined: `file` and
     * `close_epoch` both refuse rather than record a fabricated `0.0`
     * A-pillar component (07 §7 *Milestone normalization*). Appended last —
     * the preceding variant indices are metadata-stable (02 §13).
     */
    "MilestoneTargetUnset": undefined;
    /**
     * The epoch's cohort exposure cannot be determined, so the
     * value-scaled filing bond cannot be priced (07 §7; G-1). Appended last
     * to preserve every preceding metadata discriminant.
     */
    "ExposureUnavailable": undefined;
    /**
     * The terminal verdict named an evidence hash other than the one the
     * challenge committed, so it was authored against a different filing than
     * the one it would resolve. The bond stays custodied (07 §7; G-1).
     * Appended last to preserve every preceding metadata discriminant.
     */
    "EvidenceMismatch": undefined;
}>;
export type Icfmf5mk6u773n = AnonymousEnum<{
    /**
     * No such budget line exists in the treasury.
     */
    "UnknownBudgetLine": undefined;
    /**
     * The source (main or a line) lacks the funds for the debit.
     */
    "InsufficientFunds": undefined;
    /**
     * The reserve-health flag is set: spendable NAV is 0, no new commitments.
     */
    "ReserveImpaired": undefined;
    /**
     * Outflow exceeds `trs.cap_proposal` × spendable NAV.
     */
    "ProposalCapExceeded": undefined;
    /**
     * Grant exceeds `trs.stream_threshold`: it MUST be a stream, not a spend.
     */
    "StreamRequired": undefined;
    /**
     * A rolling outflow (30d/180d) or issuance meter would be exceeded (I-7).
     */
    "MeterExhausted": undefined;
    /**
     * No stream with the given id.
     */
    "StreamNotFound": undefined;
    /**
     * Nothing vested-but-unclaimed on the stream.
     */
    "StreamNotClaimable": undefined;
    /**
     * Caller is not the stream's recipient.
     */
    "NotRecipient": undefined;
    /**
     * The stream is already cancelled.
     */
    "AlreadyCancelled": undefined;
    /**
     * Stream duration must be non-zero.
     */
    "BadDuration": undefined;
    /**
     * No coretime renewal quote is open for this period (window closed).
     */
    "RenewalWindowClosed": undefined;
    /**
     * This coretime period is already funded (renewal idempotency).
     */
    "PeriodAlreadyFunded": undefined;
    /**
     * The `Streams` bound (13 §4) would be exceeded.
     */
    "TooManyStreams": undefined;
    /**
     * The budget-line bound (13 §4) would be exceeded.
     */
    "TooManyBudgetLines": undefined;
    /**
     * A pending-outflow / POL / coretime obligation bound (13 §4) would be exceeded.
     */
    "TooManyObligations": undefined;
    /**
     * `issue_vit` targets a line other than `REWARDS`/`ops.*` (08 §2.3).
     */
    "IssuanceLineNotAllowed": undefined;
    /**
     * Minting would exceed `iss.inflation_cap` × supply-at-window-start.
     */
    "IssuanceCapExceeded": undefined;
    /**
     * `recover_foreign` was asked to move a protocol asset (USDC/VIT).
     */
    "UnknownForeignAsset": undefined;
    /**
     * Published spendable NAV is below the class arming floor (08 §4.1).
     */
    "NavFloorUnmet": undefined;
    /**
     * A coretime renewal quote of zero was rejected (09 §4).
     */
    "ZeroQuote": undefined;
    /**
     * Arithmetic overflow — rejected, never wrapped (G-1).
     */
    "Overflow": undefined;
    /**
     * Signed caller is not the stored Coretime quote authority.
     */
    "NotQuoteAuthority": undefined;
    /**
     * The ops multisig tried to fund a non-`ops.*` line.
     */
    "BootstrapOpsLineOnly": undefined;
    /**
     * The one-way governed-funding handover closed bootstrap ops funding.
     */
    "BootstrapOpsFundingClosed": undefined;
    /**
     * A signed reserve-probe top-up was zero, over the exact live runway,
     * or the governed runway inputs were unavailable.
     */
    "BootstrapOpsFundingLimit": undefined;
    /**
     * No Coretime renewal destination is configured.
     */
    "RenewalAccountUnset": undefined;
    /**
     * The quote freshness window elapsed.
     */
    "QuoteExpired": undefined;
    /**
     * A permissionless prune was attempted before expiry.
     */
    "QuoteNotExpired": undefined;
    /**
     * The applicable DOT→USDC rate is absent, malformed, or zero.
     */
    "RateUnset": undefined;
    /**
     * `ops.ct_fee_dot` is absent, malformed, or zero.
     */
    "FeeBudgetUnset": undefined;
    /**
     * `ops.ct_quote_ttl` is absent, malformed, or zero.
     */
    "QuoteTtlUnset": undefined;
    /**
     * Stored quote timestamp is ahead of the current block.
     */
    "QuoteTimestampInFuture": undefined;
    /**
     * Community distribution has not reached Phase-4 arming.
     */
    "CommunityDistributionNotArmed": undefined;
    /**
     * The requested tranche is below the 13 minimum.
     */
    "CommunityDistributionAmountTooSmall": undefined;
    /**
     * The requested tranche exceeds the undistributed community pot.
     */
    "CommunityDistributionExhausted": undefined;
    /**
     * The bounded community-schedule count is full.
     */
    "TooManyCommunitySchedules": undefined;
    /**
     * The 24-month duration is zero or cannot yield a positive per-block
     * unlock rate for a minimum-sized tranche.
     */
    "CommunityVestingDurationInvalid": undefined;
    /**
     * A beneficiary may not be the source pot itself.
     */
    "CommunityBeneficiaryIsPot": undefined;
    /**
     * The call's real-asset leg is not wired in this runtime, so it would
     * have reported a value movement that never happened (08 §1.4's A9
     * fungibles follow-up). Status-quo default: refuse (G-1).
     *
     * Appended, never inserted: `Error` variants carry SCALE indices that
     * off-chain consumers decode, so a new variant goes at the end (02 §13
     * append-only rule) rather than shifting every variant after it.
     */
    "OutflowCustodyUnwired": undefined;
}>;
export type I9n6rn7ujdds5b = AnonymousEnum<{
    /**
     * The council has not been elected yet (no `Members`).
     */
    "NotInitialized": undefined;
    /**
     * Caller is not a current council member.
     */
    "NotMember": undefined;
    /**
     * A proposed member set contains a duplicate seat.
     */
    "DuplicateMember": undefined;
    /**
     * The member already approved this action.
     */
    "DuplicateApproval": undefined;
    /**
     * No pending action with that id.
     */
    "ActionNotFound": undefined;
    /**
     * The action's 3-day window elapsed.
     */
    "ActionExpired": undefined;
    /**
     * The action already dispatched.
     */
    "AlreadyDispatched": undefined;
    /**
     * Live pending-action set is full (`MAX_PENDING_ACTIONS`).
     */
    "TooManyPending": undefined;
    /**
     * Approval ledger is full (`MAX_APPROVALS`).
     */
    "TooManyApprovals": undefined;
    /**
     * Open-review set is full (`MAX_REVIEWS`).
     */
    "TooManyReviews": undefined;
    /**
     * Active-playbook set is full (`MAX_ACTIVE_PLAYBOOKS`).
     */
    "TooManyActivePlaybooks": undefined;
    /**
     * Rerun ledger is full (`MAX_RERUN_USED`).
     */
    "TooManyReruns": undefined;
    /**
     * Fewer than five approvals (should not surface — internal).
     */
    "ThresholdNotMet": undefined;
    /**
     * The power's allowance is exhausted this epoch/window (06 §5.2).
     */
    "AllowanceExhausted": undefined;
    /**
     * A hold/playbook duration exceeds its kernel maximum (06 §5.2/§6.3).
     */
    "DurationTooLong": undefined;
    /**
     * The playbook's verified on-chain trigger is not live (06 §6.2).
     */
    "TriggerInactive": undefined;
    /**
     * The playbook/trigger pairing is not admissible (06 §6.2).
     */
    "BadPlaybookTrigger": undefined;
    /**
     * OracleVoid requires a cohort target; every other playbook forbids one.
     */
    "BadPlaybookTarget": undefined;
    /**
     * The proposal was already rerun, or is inside a rerun (06 §5.3).
     */
    "AlreadyRerun": undefined;
    /**
     * The proposal is not in a rerunnable state (06 §5.3).
     */
    "NotRerunnable": undefined;
    /**
     * No review record for that action.
     */
    "ReviewNotFound": undefined;
    /**
     * The review was already ratified.
     */
    "AlreadyRatified": undefined;
    /**
     * Renewal is inadmissible (not `PB-LEDGER-FREEZE`, or already renewed —
     * 06 §6.3: one renewal only).
     */
    "RenewalNotAllowed": undefined;
    /**
     * The playbook is already active.
     */
    "PlaybookAlreadyActive": undefined;
    /**
     * Arithmetic overflow — rejected, never wrapped (G-1).
     */
    "Overflow": undefined;
    /**
     * Core state validator rejected the aggregate (try-state only).
     */
    "TryStateViolation": undefined;
    /**
     * The failed-action recall record is absent or already reaped.
     */
    "FailedActionNotFound": undefined;
    /**
     * `uphold_veto` targets a non-delay action.
     */
    "NotDelayAction": undefined;
    /**
     * The bounded post-term bond-release queue is full.
     */
    "TooManyBondReleases": undefined;
    /**
     * Held funds, the obligation ledger and fronting slices disagree.
     */
    "BondAccounting": undefined;
    /**
     * The values-governed availability toggle is disabled.
     */
    "PlaybookNotRegistered": undefined;
}>;
export type I7u7113h3itk4b = AnonymousEnum<{
    "NotMember": undefined;
    "DuplicateMember": undefined;
    "TooFewMembers": undefined;
    "AttestationNotFound": undefined;
    "DuplicateAttestation": undefined;
    "ChallengeWindowClosed": undefined;
    "ChallengeAlreadyOpen": undefined;
    "ChallengeBondTooSmall": undefined;
    /**
     * Retained metadata only — no dispatch can return it (SQ-342).
     * Superseded by [`Error::ChallengeOpen`]; kept because the SCALE error
     * surface is append-only.
     */
    "ChallengeStillOpen": undefined;
    /**
     * Retained metadata only — no dispatch can return it (SQ-342). Its
     * producer, a caller-less `require_quorum` helper, is deleted;
     * production branches on the boolean quorum instead.
     */
    "QuorumMissing": undefined;
    /**
     * The referenced attestation exists but has no open challenge.
     */
    "NoOpenChallenge": undefined;
    /**
     * try-state only: a member at or past the ejection threshold is still
     * active. No dispatch produces this (06 §7; SQ-262).
     */
    "EjectedMemberActive": undefined;
    "Overflow": undefined;
    "NotInitialized": undefined;
    "TooManyAttestors": undefined;
    "TooManyAttestations": undefined;
    "TooManyLiabilities": undefined;
    "TooManyRevocations": undefined;
    "LiabilityExists": undefined;
    "AttestorNotFound": undefined;
    "LiabilityNotFound": undefined;
    "ProposalNotTerminal": undefined;
    "ChallengeOpen": undefined;
    "ReapNotAllowed": undefined;
    "BondAccounting": undefined;
    /**
     * `attest` named a `pid` that `pallet-epoch` does not carry. 06 §7
     * scopes an attestation to "a CODE/META artifact" of a real proposal;
     * a record naming no proposal can never be reaped, because
     * terminality is read from the proposal.
     */
    "UnknownProposal": undefined;
    /**
     * The signer already holds their [`MAX_ATTESTATIONS_PER_ATTESTOR`]
     * share of the frozen 256-record ledger.
     */
    "AttestorQuotaExceeded": undefined;
}>;
export type Idim7dv3vdtr09 = AnonymousEnum<{
    "BadPhase": undefined;
    "IntakeFull": undefined;
    "TooManyLiveProposals": undefined;
    "TooManyResources": undefined;
    "UnknownProposal": undefined;
    "BadState": undefined;
    "DuplicateProposal": undefined;
    "LockConflict": undefined;
    "TooManyCohorts": undefined;
    "TooManyCohortProposals": undefined;
    "BadEpochLength": undefined;
    "BadParams": undefined;
    "BadDecisionInput": undefined;
    "BatchTooLarge": undefined;
    "ArithmeticOverflow": undefined;
    "Ledger": undefined;
    "ExecutionGuard": undefined;
    "Welfare": undefined;
    "TryStateViolation": undefined;
    "BadProposalShape": undefined;
    /**
     * Intake is paused by a guardian action or PB-HALT-INTAKE.
     */
    "IntakePaused": undefined;
    /**
     * The requested pause is in the past or exceeds the kernel window.
     */
    "IntakePauseOutOfBounds": undefined;
}>;
export type I6r10mfpq2j8np = AnonymousEnum<{
    "QueueFull": undefined;
    "NotFound": undefined;
    "Cancelled": undefined;
    "NotMature": undefined;
    "GraceExpired": undefined;
    "BadPreimage": undefined;
    "StaleQueue": undefined;
    "NotRatified": undefined;
    "AttestationMissing": undefined;
    "CapabilityDenied": undefined;
    "MetersBlocked": undefined;
    "ResourceLockMissing": undefined;
    "GuardianHold": undefined;
    "GateSuspended": undefined;
    "FreezeActive": undefined;
    "PayloadTooLarge": undefined;
    "TooManyCalls": undefined;
    "TooManyDomains": undefined;
    "TooManyLocks": undefined;
    "BadDomainDeclaration": undefined;
    "SafetyFilter": undefined;
    "DispatchFailed": undefined;
    "BadUpgradePayload": undefined;
    "PendingUpgradeExists": undefined;
    "NoPendingUpgrade": undefined;
    "DescriptorLeadTime": undefined;
    "UpgradeHashMismatch": undefined;
    "UpgradeVersionMismatch": undefined;
    "RecoveryImageMissing": undefined;
    "RecoveryImageInvalid": undefined;
    "ShadowMode": undefined;
    "PhaseFourBridgeUsed": undefined;
    "JustificationMissing": undefined;
    "RetryWindowOpen": undefined;
    "Overflow": undefined;
}>;
export type I8d6nputfnb2vr = AnonymousEnum<{
    "ClientBondUnset": undefined;
    "DuplicateLocation": undefined;
    "ClientsFull": undefined;
    "ClientIdExhausted": undefined;
    "NotRegistered": undefined;
    "ClientRemoved": undefined;
    "QuestionCounterOverflow": undefined;
    "NoLiveQuestions": undefined;
    "BondInsufficient": undefined;
    "BondAccounting": undefined;
    "DeliveryFloatAmountZero": undefined;
    "DeliveryFloatInsufficient": undefined;
    "DeliveryFloatWouldDrain": undefined;
    "DeliveryFloatBelowMinimum": undefined;
    "DeliveryFundingWouldDust": undefined;
    "DeliveryFloatOverflow": undefined;
    "DeliveryFloatAccounting": undefined;
}>;
export type Ielejatsnujhn = AnonymousEnum<{
    "NotRegistered": undefined;
    "ClientRemoved": undefined;
    "ServicePaused": undefined;
    "ServiceRateUnset": undefined;
    "CertificationUnavailable": undefined;
    "StakeBelowFloor": undefined;
    "SubsidyBelowMinimum": undefined;
    "EpsilonOutOfRange": undefined;
    "WindowTooLong": undefined;
    "WindowTooShort": undefined;
    "WindowCollidesWithDecision": undefined;
    "SlotsExhausted": undefined;
    "TvlCapWouldBind": undefined;
    "AttestorSetTooSmall": undefined;
    "AttestorBondInsufficient": undefined;
    "ClientIsProtocolAccount": undefined;
    "EscrowInsufficient": undefined;
    "NotSealed": undefined;
    "AlreadySealed": undefined;
    "AlreadyTerminal": undefined;
    "QuorumNotReached": undefined;
    "MedianOutOfRange": undefined;
    "DeadlineNotReached": undefined;
    "UnknownQuestion": undefined;
    "DeadlinePassed": undefined;
    "CreationFrozen": undefined;
    "DuplicateAttestor": undefined;
    "UnknownAttestor": undefined;
    "AlreadyBonded": undefined;
    "InvalidSubId": undefined;
    "ArithmeticOverflow": undefined;
    "ArchiveNotReady": undefined;
    "TryStateViolation": undefined;
}>;
export type TokenError = Enum<{
    "FundsUnavailable": undefined;
    "OnlyProvider": undefined;
    "BelowMinimum": undefined;
    "CannotCreate": undefined;
    "UnknownAsset": undefined;
    "Frozen": undefined;
    "Unsupported": undefined;
    "CannotCreateHold": undefined;
    "NotExpendable": undefined;
    "Blocked": undefined;
}>;
export declare const TokenError: GetEnum<TokenError>;
export type ArithmeticError = Enum<{
    "Underflow": undefined;
    "Overflow": undefined;
    "DivisionByZero": undefined;
}>;
export declare const ArithmeticError: GetEnum<ArithmeticError>;
export type TransactionalError = Enum<{
    "LimitReached": undefined;
    "NoLayer": undefined;
}>;
export declare const TransactionalError: GetEnum<TransactionalError>;
export type I1jm8m1rh9e20v = {
    "hash": SizedHex<32>;
};
export type Icbccs0ug47ilf = {
    "account": SS58String;
};
export type I855j4i3kr8ko1 = {
    "sender": SS58String;
    "hash": SizedHex<32>;
};
export type Ibgl04rn6nbfm6 = {
    "code_hash": SizedHex<32>;
    "check_version": boolean;
};
export type I9lsk105fpepqs = {
    "code_hash": SizedHex<32>;
    "error": Anonymize<I8341h4b88nf15>;
};
export type Icbsekf57miplo = AnonymousEnum<{
    /**
     * The validation function has been scheduled to apply.
     */
    "ValidationFunctionStored": undefined;
    /**
     * The validation function was applied as of the contained relay chain block number.
     */
    "ValidationFunctionApplied": Anonymize<Idd7hd99u0ho0n>;
    /**
     * The relay-chain aborted the upgrade process.
     */
    "ValidationFunctionDiscarded": undefined;
    /**
     * Some downward messages have been received and will be processed.
     */
    "DownwardMessagesReceived": Anonymize<Iafscmv8tjf0ou>;
    /**
     * Downward messages were processed using the given weight.
     */
    "DownwardMessagesProcessed": Anonymize<I100l07kaehdlp>;
    /**
     * An upward message was sent to the relay chain.
     */
    "UpwardMessageSent": Anonymize<I6gnbnvip5vvdi>;
}>;
export type Idd7hd99u0ho0n = {
    "relay_chain_block_num": number;
};
export type Iafscmv8tjf0ou = {
    "count": number;
};
export type I100l07kaehdlp = {
    "weight_used": Anonymize<I4q39t5hn830vp>;
    "dmq_head": SizedHex<32>;
};
export type I6gnbnvip5vvdi = {
    "message_hash"?: Anonymize<I4s6vifaf8k998>;
};
export type I4s6vifaf8k998 = (SizedHex<32>) | undefined;
export type I5fsnqj7i7t2q7 = AnonymousEnum<{
    /**
     * An account was created with some free balance.
     */
    "Endowed": Anonymize<Icv68aq8841478>;
    /**
     * An account was removed whose balance was non-zero but below ExistentialDeposit,
     * resulting in an outright loss.
     */
    "DustLost": Anonymize<Ic262ibdoec56a>;
    /**
     * Transfer succeeded.
     */
    "Transfer": Anonymize<Iflcfm9b6nlmdd>;
    /**
     * A balance was set by root.
     */
    "BalanceSet": Anonymize<Ijrsf4mnp3eka>;
    /**
     * Some balance was reserved (moved from free to reserved).
     */
    "Reserved": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * Some balance was unreserved (moved from reserved to free).
     */
    "Unreserved": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * Some balance was moved from the reserve of the first account to the second account.
     * Final argument indicates the destination balance type.
     */
    "ReserveRepatriated": Anonymize<I8tjvj9uq4b7hi>;
    /**
     * Some amount was deposited (e.g. for transaction fees).
     */
    "Deposit": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * Some amount was withdrawn from the account (e.g. for transaction fees).
     */
    "Withdraw": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * Some amount was removed from the account (e.g. for misbehavior).
     */
    "Slashed": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * Some amount was minted into an account.
     */
    "Minted": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * Some credit was balanced and added to the TotalIssuance.
     */
    "MintedCredit": Anonymize<I3qt1hgg4djhgb>;
    /**
     * Some amount was burned from an account.
     */
    "Burned": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * Some debt has been dropped from the Total Issuance.
     */
    "BurnedDebt": Anonymize<I3qt1hgg4djhgb>;
    /**
     * Some amount was suspended from an account (it can be restored later).
     */
    "Suspended": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * Some amount was restored into an account.
     */
    "Restored": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * An account was upgraded.
     */
    "Upgraded": Anonymize<I4cbvqmqadhrea>;
    /**
     * Total issuance was increased by `amount`, creating a credit to be balanced.
     */
    "Issued": Anonymize<I3qt1hgg4djhgb>;
    /**
     * Total issuance was decreased by `amount`, creating a debt to be balanced.
     */
    "Rescinded": Anonymize<I3qt1hgg4djhgb>;
    /**
     * Some balance was locked.
     */
    "Locked": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * Some balance was unlocked.
     */
    "Unlocked": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * Some balance was frozen.
     */
    "Frozen": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * Some balance was thawed.
     */
    "Thawed": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * The `TotalIssuance` was forcefully changed.
     */
    "TotalIssuanceForced": Anonymize<I4fooe9dun9o0t>;
    /**
     * Some balance was placed on hold.
     */
    "Held": Anonymize<I4ici6vhci5d5f>;
    /**
     * Held balance was burned from an account.
     */
    "BurnedHeld": Anonymize<I4ici6vhci5d5f>;
    /**
     * A transfer of `amount` on hold from `source` to `dest` was initiated.
     */
    "TransferOnHold": Anonymize<I9ia5eeknmnh40>;
    /**
     * The `transferred` balance is placed on hold at the `dest` account.
     */
    "TransferAndHold": Anonymize<I9nrdlsbtsjaoc>;
    /**
     * Some balance was released from hold.
     */
    "Released": Anonymize<I4ici6vhci5d5f>;
    /**
     * An unexpected/defensive event was triggered.
     */
    "Unexpected": Anonymize<Iph9c4rn81ub2>;
}>;
export type Icv68aq8841478 = {
    "account": SS58String;
    "free_balance": bigint;
};
export type Ic262ibdoec56a = {
    "account": SS58String;
    "amount": bigint;
};
export type Iflcfm9b6nlmdd = {
    "from": SS58String;
    "to": SS58String;
    "amount": bigint;
};
export type Ijrsf4mnp3eka = {
    "who": SS58String;
    "free": bigint;
};
export type Id5fm4p8lj5qgi = {
    "who": SS58String;
    "amount": bigint;
};
export type I8tjvj9uq4b7hi = {
    "from": SS58String;
    "to": SS58String;
    "amount": bigint;
    "destination_status": BalanceStatus;
};
export type BalanceStatus = Enum<{
    "Free": undefined;
    "Reserved": undefined;
}>;
export declare const BalanceStatus: GetEnum<BalanceStatus>;
export type I3qt1hgg4djhgb = {
    "amount": bigint;
};
export type I4cbvqmqadhrea = {
    "who": SS58String;
};
export type I4fooe9dun9o0t = {
    "old": bigint;
    "new": bigint;
};
export type I4ici6vhci5d5f = {
    "reason": Anonymize<Iau1paeqrbp4gi>;
    "who": SS58String;
    "amount": bigint;
};
export type Iau1paeqrbp4gi = AnonymousEnum<{
    "Preimage": PreimagePalletHoldReason;
    "PolkadotXcm": Enum<{
        "AuthorizeAlias": undefined;
    }>;
    "Session": Enum<{
        "Keys": undefined;
    }>;
    "Guardian": Enum<{
        "SeatBond": undefined;
    }>;
    "Attestor": Enum<{
        "AttestorBond": undefined;
        "ChallengeBond": undefined;
    }>;
    "ClientRegistry": Enum<{
        "ClientBond": undefined;
    }>;
}>;
export type PreimagePalletHoldReason = Enum<{
    "Preimage": undefined;
}>;
export declare const PreimagePalletHoldReason: GetEnum<PreimagePalletHoldReason>;
export type I9ia5eeknmnh40 = {
    "reason": Anonymize<Iau1paeqrbp4gi>;
    "source": SS58String;
    "dest": SS58String;
    "amount": bigint;
};
export type I9nrdlsbtsjaoc = {
    "reason": Anonymize<Iau1paeqrbp4gi>;
    "source": SS58String;
    "dest": SS58String;
    "transferred": bigint;
};
export type Iph9c4rn81ub2 = AnonymousEnum<{
    "BalanceUpdated": undefined;
    "FailedToMutateAccount": undefined;
}>;
export type Ia8v0gq53fp7hi = AnonymousEnum<{
    /**
     * Some asset class was created.
     */
    "Created": Anonymize<Icqe266pmnr25o>;
    /**
     * Some assets were issued.
     */
    "Issued": Anonymize<I5hoiph0lqphp>;
    /**
     * Some assets were transferred.
     */
    "Transferred": Anonymize<I5k7oropl9ofc7>;
    /**
     * Some assets were destroyed.
     */
    "Burned": Anonymize<I48vagp1omigob>;
    /**
     * The management team changed.
     */
    "TeamChanged": Anonymize<Ib5tst4ppem1g6>;
    /**
     * The owner changed.
     */
    "OwnerChanged": Anonymize<Ibn64edsrg3737>;
    /**
     * Some account `who` was frozen.
     */
    "Frozen": Anonymize<I83r9d02dh47j9>;
    /**
     * Some account `who` was thawed.
     */
    "Thawed": Anonymize<I83r9d02dh47j9>;
    /**
     * Some asset `asset_id` was frozen.
     */
    "AssetFrozen": Anonymize<I22bm4d7re21j9>;
    /**
     * Some asset `asset_id` was thawed.
     */
    "AssetThawed": Anonymize<I22bm4d7re21j9>;
    /**
     * Accounts were destroyed for given asset.
     */
    "AccountsDestroyed": Anonymize<I3jnhifvaeuama>;
    /**
     * Approvals were destroyed for given asset.
     */
    "ApprovalsDestroyed": Anonymize<I8n1gia0lo42ok>;
    /**
     * An asset class is in the process of being destroyed.
     */
    "DestructionStarted": Anonymize<I22bm4d7re21j9>;
    /**
     * An asset class was destroyed.
     */
    "Destroyed": Anonymize<I22bm4d7re21j9>;
    /**
     * Some asset class was force-created.
     */
    "ForceCreated": Anonymize<Ibn64edsrg3737>;
    /**
     * New metadata has been set for an asset.
     */
    "MetadataSet": Anonymize<I6gb0o7lqjfdjq>;
    /**
     * Metadata has been cleared for an asset.
     */
    "MetadataCleared": Anonymize<I22bm4d7re21j9>;
    /**
     * (Additional) funds have been approved for transfer to a destination account.
     */
    "ApprovedTransfer": Anonymize<Idh36v6iegkmpq>;
    /**
     * An approval for account `delegate` was cancelled by `owner`.
     */
    "ApprovalCancelled": Anonymize<I27hnueutmchbe>;
    /**
     * An `amount` was transferred in its entirety from `owner` to `destination` by
     * the approved `delegate`.
     */
    "TransferredApproved": Anonymize<Iectm2em66uhao>;
    /**
     * An asset has had its attributes changed by the `Force` origin.
     */
    "AssetStatusChanged": Anonymize<I22bm4d7re21j9>;
    /**
     * The min_balance of an asset has been updated by the asset owner.
     */
    "AssetMinBalanceChanged": Anonymize<I7q57goff3j72h>;
    /**
     * Some account `who` was created with a deposit from `depositor`.
     */
    "Touched": Anonymize<Ibe49veu9i9nro>;
    /**
     * Some account `who` was blocked.
     */
    "Blocked": Anonymize<I83r9d02dh47j9>;
    /**
     * Some assets were deposited (e.g. for transaction fees).
     */
    "Deposited": Anonymize<I1rnkmiu7usb82>;
    /**
     * Some assets were withdrawn from the account (e.g. for transaction fees).
     */
    "Withdrawn": Anonymize<I1rnkmiu7usb82>;
    /**
     * Reserve information was set or updated for `asset_id`.
     */
    "ReservesUpdated": Anonymize<Ig6jnoe1clkm7>;
    /**
     * Reserve information was removed for `asset_id`.
     */
    "ReservesRemoved": Anonymize<I22bm4d7re21j9>;
    /**
     * Some assets were issued as Credit (no owner yet).
     */
    "IssuedCredit": Anonymize<Ibtugueatkkr9s>;
    /**
     * Some assets Credit was destroyed.
     */
    "BurnedCredit": Anonymize<Ibtugueatkkr9s>;
    /**
     * Some assets were burned and a Debt was created.
     */
    "IssuedDebt": Anonymize<Ibtugueatkkr9s>;
    /**
     * Some assets Debt was destroyed (and assets issued).
     */
    "BurnedDebt": Anonymize<Ibtugueatkkr9s>;
}>;
export type Icqe266pmnr25o = {
    "asset_id": Anonymize<If9iqq7i64mur8>;
    "creator": SS58String;
    "owner": SS58String;
};
export type If9iqq7i64mur8 = {
    "parents": number;
    "interior": XcmV5Junctions;
};
export type XcmV5Junctions = Enum<{
    "Here": undefined;
    "X1": XcmV5Junction;
    "X2": FixedSizeArray<2, XcmV5Junction>;
    "X3": FixedSizeArray<3, XcmV5Junction>;
    "X4": FixedSizeArray<4, XcmV5Junction>;
    "X5": FixedSizeArray<5, XcmV5Junction>;
    "X6": FixedSizeArray<6, XcmV5Junction>;
    "X7": FixedSizeArray<7, XcmV5Junction>;
    "X8": FixedSizeArray<8, XcmV5Junction>;
}>;
export declare const XcmV5Junctions: GetEnum<XcmV5Junctions>;
export type XcmV5Junction = Enum<{
    "Parachain": number;
    "AccountId32": {
        "network"?: Anonymize<I97pd2rst02a7r>;
        "id": SizedHex<32>;
    };
    "AccountIndex64": {
        "network"?: Anonymize<I97pd2rst02a7r>;
        "index": bigint;
    };
    "AccountKey20": {
        "network"?: Anonymize<I97pd2rst02a7r>;
        "key": SizedHex<20>;
    };
    "PalletInstance": number;
    "GeneralIndex": bigint;
    "GeneralKey": Anonymize<I15lht6t53odo4>;
    "OnlyChild": undefined;
    "Plurality": Anonymize<I518fbtnclg1oc>;
    "GlobalConsensus": XcmV5NetworkId;
}>;
export declare const XcmV5Junction: GetEnum<XcmV5Junction>;
export type I97pd2rst02a7r = (XcmV5NetworkId) | undefined;
export type XcmV5NetworkId = Enum<{
    "ByGenesis": SizedHex<32>;
    "ByFork": Anonymize<I15vf5oinmcgps>;
    "Polkadot": undefined;
    "Kusama": undefined;
    "Ethereum": Anonymize<I623eo8t3jrbeo>;
    "BitcoinCore": undefined;
    "BitcoinCash": undefined;
    "PolkadotBulletin": undefined;
}>;
export declare const XcmV5NetworkId: GetEnum<XcmV5NetworkId>;
export type I15vf5oinmcgps = {
    "block_number": bigint;
    "block_hash": SizedHex<32>;
};
export type I623eo8t3jrbeo = {
    "chain_id": bigint;
};
export type I15lht6t53odo4 = {
    "length": number;
    "data": SizedHex<32>;
};
export type I518fbtnclg1oc = {
    "id": XcmV3JunctionBodyId;
    "part": XcmV2JunctionBodyPart;
};
export type XcmV3JunctionBodyId = Enum<{
    "Unit": undefined;
    "Moniker": SizedHex<4>;
    "Index": number;
    "Executive": undefined;
    "Technical": undefined;
    "Legislative": undefined;
    "Judicial": undefined;
    "Defense": undefined;
    "Administration": undefined;
    "Treasury": undefined;
}>;
export declare const XcmV3JunctionBodyId: GetEnum<XcmV3JunctionBodyId>;
export type XcmV2JunctionBodyPart = Enum<{
    "Voice": undefined;
    "Members": Anonymize<Iafscmv8tjf0ou>;
    "Fraction": {
        "nom": number;
        "denom": number;
    };
    "AtLeastProportion": {
        "nom": number;
        "denom": number;
    };
    "MoreThanProportion": {
        "nom": number;
        "denom": number;
    };
}>;
export declare const XcmV2JunctionBodyPart: GetEnum<XcmV2JunctionBodyPart>;
export type I5hoiph0lqphp = {
    "asset_id": Anonymize<If9iqq7i64mur8>;
    "owner": SS58String;
    "amount": bigint;
};
export type I5k7oropl9ofc7 = {
    "asset_id": Anonymize<If9iqq7i64mur8>;
    "from": SS58String;
    "to": SS58String;
    "amount": bigint;
};
export type I48vagp1omigob = {
    "asset_id": Anonymize<If9iqq7i64mur8>;
    "owner": SS58String;
    "balance": bigint;
};
export type Ib5tst4ppem1g6 = {
    "asset_id": Anonymize<If9iqq7i64mur8>;
    "issuer": SS58String;
    "admin": SS58String;
    "freezer": SS58String;
};
export type Ibn64edsrg3737 = {
    "asset_id": Anonymize<If9iqq7i64mur8>;
    "owner": SS58String;
};
export type I83r9d02dh47j9 = {
    "asset_id": Anonymize<If9iqq7i64mur8>;
    "who": SS58String;
};
export type I22bm4d7re21j9 = {
    "asset_id": Anonymize<If9iqq7i64mur8>;
};
export type I3jnhifvaeuama = {
    "asset_id": Anonymize<If9iqq7i64mur8>;
    "accounts_destroyed": number;
    "accounts_remaining": number;
};
export type I8n1gia0lo42ok = {
    "asset_id": Anonymize<If9iqq7i64mur8>;
    "approvals_destroyed": number;
    "approvals_remaining": number;
};
export type I6gb0o7lqjfdjq = {
    "asset_id": Anonymize<If9iqq7i64mur8>;
    "name": Uint8Array;
    "symbol": Uint8Array;
    "decimals": number;
    "is_frozen": boolean;
};
export type Idh36v6iegkmpq = {
    "asset_id": Anonymize<If9iqq7i64mur8>;
    "source": SS58String;
    "delegate": SS58String;
    "amount": bigint;
};
export type I27hnueutmchbe = {
    "asset_id": Anonymize<If9iqq7i64mur8>;
    "owner": SS58String;
    "delegate": SS58String;
};
export type Iectm2em66uhao = {
    "asset_id": Anonymize<If9iqq7i64mur8>;
    "owner": SS58String;
    "delegate": SS58String;
    "destination": SS58String;
    "amount": bigint;
};
export type I7q57goff3j72h = {
    "asset_id": Anonymize<If9iqq7i64mur8>;
    "new_min_balance": bigint;
};
export type Ibe49veu9i9nro = {
    "asset_id": Anonymize<If9iqq7i64mur8>;
    "who": SS58String;
    "depositor": SS58String;
};
export type I1rnkmiu7usb82 = {
    "asset_id": Anonymize<If9iqq7i64mur8>;
    "who": SS58String;
    "amount": bigint;
};
export type Ig6jnoe1clkm7 = {
    "asset_id": Anonymize<If9iqq7i64mur8>;
    "reserves": Anonymize<I35l6p7kq19mr0>;
};
export type I35l6p7kq19mr0 = Array<undefined>;
export type Ibtugueatkkr9s = {
    "asset_id": Anonymize<If9iqq7i64mur8>;
    "amount": bigint;
};
export type TransactionPaymentEvent = Enum<{
    /**
     * A transaction fee `actual_fee`, of which `tip` was added to the minimum inclusion fee,
     * has been paid by `who`.
     */
    "TransactionFeePaid": Anonymize<Ier2cke86dqbr2>;
}>;
export declare const TransactionPaymentEvent: GetEnum<TransactionPaymentEvent>;
export type Ier2cke86dqbr2 = {
    "who": SS58String;
    "actual_fee": bigint;
    "tip": bigint;
};
export type Ie598chmfqlqa = AnonymousEnum<{
    /**
     * A transaction fee `actual_fee`, of which `tip` was added to the minimum inclusion fee,
     * has been paid by `who` in an asset `asset_id`.
     */
    "AssetTxFeePaid": Anonymize<Iaeqj2ebnvkjqe>;
}>;
export type Iaeqj2ebnvkjqe = {
    "who": SS58String;
    "actual_fee": bigint;
    "tip": bigint;
    "asset_id"?: Anonymize<I4pai6qnfk426l>;
};
export type I4pai6qnfk426l = (Anonymize<If9iqq7i64mur8>) | undefined;
export type I7uu9ebnucfti5 = AnonymousEnum<{
    /**
     * A vesting schedule has been created.
     */
    "VestingCreated": Anonymize<Ih04jp733tqqa>;
    /**
     * The amount vested has been updated. This could indicate a change in funds available.
     * The balance given is the amount which is left unvested (and thus locked).
     */
    "VestingUpdated": Anonymize<Ievr89968437gm>;
    /**
     * An \[account\] has become fully vested.
     */
    "VestingCompleted": Anonymize<Icbccs0ug47ilf>;
}>;
export type Ih04jp733tqqa = {
    "account": SS58String;
    "schedule_index": number;
};
export type Ievr89968437gm = {
    "account": SS58String;
    "unvested": bigint;
};
export type Idfraa3b4eu018 = AnonymousEnum<{
    /**
     * A referendum has been submitted.
     */
    "Submitted": Anonymize<I229ijht536qdu>;
    /**
     * The decision deposit has been placed.
     */
    "DecisionDepositPlaced": Anonymize<I62nte77gksm0f>;
    /**
     * The decision deposit has been refunded.
     */
    "DecisionDepositRefunded": Anonymize<I62nte77gksm0f>;
    /**
     * A deposit has been slashed.
     */
    "DepositSlashed": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * A referendum has moved into the deciding phase.
     */
    "DecisionStarted": Anonymize<I9cg2delv92pvq>;
    "ConfirmStarted": Anonymize<I666bl2fqjkejo>;
    "ConfirmAborted": Anonymize<I666bl2fqjkejo>;
    /**
     * A referendum has ended its confirmation phase and is ready for approval.
     */
    "Confirmed": Anonymize<Ilhp45uime5tp>;
    /**
     * A referendum has been approved and its proposal has been scheduled.
     */
    "Approved": Anonymize<I666bl2fqjkejo>;
    /**
     * A proposal has been rejected by referendum.
     */
    "Rejected": Anonymize<Ilhp45uime5tp>;
    /**
     * A referendum has been timed out without being decided.
     */
    "TimedOut": Anonymize<Ilhp45uime5tp>;
    /**
     * A referendum has been cancelled.
     */
    "Cancelled": Anonymize<Ilhp45uime5tp>;
    /**
     * A referendum has been killed.
     */
    "Killed": Anonymize<Ilhp45uime5tp>;
    /**
     * The submission deposit has been refunded.
     */
    "SubmissionDepositRefunded": Anonymize<I62nte77gksm0f>;
    /**
     * Metadata for a referendum has been set.
     */
    "MetadataSet": Anonymize<I4f1hv034jf1dt>;
    /**
     * Metadata for a referendum has been cleared.
     */
    "MetadataCleared": Anonymize<I4f1hv034jf1dt>;
}>;
export type I229ijht536qdu = {
    /**
     * Index of the referendum.
     */
    "index": number;
    /**
     * The track (and by extension proposal dispatch origin) of this referendum.
     */
    "track": number;
    /**
     * The proposal for the referendum.
     */
    "proposal": PreimagesBounded;
};
export type PreimagesBounded = Enum<{
    "Legacy": Anonymize<I1jm8m1rh9e20v>;
    "Inline": Uint8Array;
    "Lookup": {
        "hash": SizedHex<32>;
        "len": number;
    };
}>;
export declare const PreimagesBounded: GetEnum<PreimagesBounded>;
export type I62nte77gksm0f = {
    /**
     * Index of the referendum.
     */
    "index": number;
    /**
     * The account who placed the deposit.
     */
    "who": SS58String;
    /**
     * The amount placed by the account.
     */
    "amount": bigint;
};
export type I9cg2delv92pvq = {
    /**
     * Index of the referendum.
     */
    "index": number;
    /**
     * The track (and by extension proposal dispatch origin) of this referendum.
     */
    "track": number;
    /**
     * The proposal for the referendum.
     */
    "proposal": PreimagesBounded;
    /**
     * The current tally of votes in this referendum.
     */
    "tally": Anonymize<Ifsk7cbmtit1jd>;
};
export type Ifsk7cbmtit1jd = {
    "ayes": bigint;
    "nays": bigint;
    "support": bigint;
};
export type I666bl2fqjkejo = {
    /**
     * Index of the referendum.
     */
    "index": number;
};
export type Ilhp45uime5tp = {
    /**
     * Index of the referendum.
     */
    "index": number;
    /**
     * The final tally of votes in this referendum.
     */
    "tally": Anonymize<Ifsk7cbmtit1jd>;
};
export type I4f1hv034jf1dt = {
    /**
     * Index of the referendum.
     */
    "index": number;
    /**
     * Preimage hash.
     */
    "hash": SizedHex<32>;
};
export type I7pql8a2uf8mlq = AnonymousEnum<{
    /**
     * An account has delegated their vote to another account. \[who, target\]
     */
    "Delegated": Anonymize<I7svrbkiu01iec>;
    /**
     * An \[account\] has cancelled a previous delegation operation.
     */
    "Undelegated": Anonymize<I6ouflveob4eli>;
    /**
     * An account has voted
     */
    "Voted": Anonymize<I8cbok7qd7ru4t>;
    /**
     * A vote has been removed
     */
    "VoteRemoved": Anonymize<I8cbok7qd7ru4t>;
    /**
     * The lockup period of a conviction vote expired, and the funds have been unlocked.
     */
    "VoteUnlocked": Anonymize<I7kij8p9kchdjo>;
}>;
export type I7svrbkiu01iec = [SS58String, SS58String, number];
export type I6ouflveob4eli = [SS58String, number];
export type I8cbok7qd7ru4t = {
    "who": SS58String;
    "vote": ConvictionVotingVoteAccountVote;
    "poll_index": number;
};
export type ConvictionVotingVoteAccountVote = Enum<{
    "Standard": {
        "vote": number;
        "balance": bigint;
    };
    "Split": {
        "aye": bigint;
        "nay": bigint;
    };
    "SplitAbstain": {
        "aye": bigint;
        "nay": bigint;
        "abstain": bigint;
    };
}>;
export declare const ConvictionVotingVoteAccountVote: GetEnum<ConvictionVotingVoteAccountVote>;
export type I7kij8p9kchdjo = {
    "who": SS58String;
    "class": number;
};
export type PreimageEvent = Enum<{
    /**
     * A preimage has been noted.
     */
    "Noted": Anonymize<I1jm8m1rh9e20v>;
    /**
     * A preimage has been requested.
     */
    "Requested": Anonymize<I1jm8m1rh9e20v>;
    /**
     * A preimage has ben cleared.
     */
    "Cleared": Anonymize<I1jm8m1rh9e20v>;
}>;
export declare const PreimageEvent: GetEnum<PreimageEvent>;
export type Iaq2go86oev659 = AnonymousEnum<{
    /**
     * Scheduled some task.
     */
    "Scheduled": Anonymize<I5n4sebgkfr760>;
    /**
     * Canceled some task.
     */
    "Canceled": Anonymize<I5n4sebgkfr760>;
    /**
     * Dispatched some task.
     */
    "Dispatched": Anonymize<I8t33rj099eb2o>;
    /**
     * Set a retry configuration for some task.
     */
    "RetrySet": Anonymize<Ia3c82eadg79bj>;
    /**
     * Cancel a retry configuration for some task.
     */
    "RetryCancelled": Anonymize<Ienusoeb625ftq>;
    /**
     * The call for the provided hash was not found so the task has been aborted.
     */
    "CallUnavailable": Anonymize<Ienusoeb625ftq>;
    /**
     * The given task was unable to be renewed since the agenda is full at that block.
     */
    "PeriodicFailed": Anonymize<Ienusoeb625ftq>;
    /**
     * The given task was unable to be retried since the agenda is full at that block or there
     * was not enough weight to reschedule it.
     */
    "RetryFailed": Anonymize<Ienusoeb625ftq>;
    /**
     * The given task can never be executed since it is overweight.
     */
    "PermanentlyOverweight": Anonymize<Ienusoeb625ftq>;
    /**
     * Agenda is incomplete from `when`.
     */
    "AgendaIncomplete": Anonymize<Ibtsa3docbr9el>;
}>;
export type I5n4sebgkfr760 = {
    "when": number;
    "index": number;
};
export type I8t33rj099eb2o = {
    "task": Anonymize<I9jd27rnpm8ttv>;
    "id"?: Anonymize<I4s6vifaf8k998>;
    "result": Anonymize<I7ugh66e61mfbv>;
};
export type I9jd27rnpm8ttv = FixedSizeArray<2, number>;
export type I7ugh66e61mfbv = ResultPayload<undefined, Anonymize<I8341h4b88nf15>>;
export type Ia3c82eadg79bj = {
    "task": Anonymize<I9jd27rnpm8ttv>;
    "id"?: Anonymize<I4s6vifaf8k998>;
    "period": number;
    "retries": number;
};
export type Ienusoeb625ftq = {
    "task": Anonymize<I9jd27rnpm8ttv>;
    "id"?: Anonymize<I4s6vifaf8k998>;
};
export type Ibtsa3docbr9el = {
    "when": number;
};
export type Im9p2bvgqoq7f = AnonymousEnum<{
    /**
     * Batch of dispatches did not complete fully. Index of first failing dispatch given, as
     * well as the error.
     */
    "BatchInterrupted": Anonymize<I476s2ro8t68f2>;
    /**
     * Batch of dispatches completed fully with no error.
     */
    "BatchCompleted": undefined;
    /**
     * Batch of dispatches completed but has errors.
     */
    "BatchCompletedWithErrors": undefined;
    /**
     * A single item within a Batch of dispatches has completed with no error.
     */
    "ItemCompleted": undefined;
    /**
     * A single item within a Batch of dispatches has completed with error.
     */
    "ItemFailed": Anonymize<Ids3npip9e6148>;
    /**
     * A call was dispatched.
     */
    "DispatchedAs": Anonymize<Ica5b5hrvd0b5i>;
    /**
     * Main call was dispatched.
     */
    "IfElseMainSuccess": undefined;
    /**
     * The fallback call was dispatched.
     */
    "IfElseFallbackCalled": Anonymize<I9j6s1q21td4b3>;
}>;
export type I476s2ro8t68f2 = {
    "index": number;
    "error": Anonymize<I8341h4b88nf15>;
};
export type Ids3npip9e6148 = {
    "error": Anonymize<I8341h4b88nf15>;
};
export type Ica5b5hrvd0b5i = {
    "result": Anonymize<I7ugh66e61mfbv>;
};
export type I9j6s1q21td4b3 = {
    "main_error": Anonymize<I8341h4b88nf15>;
};
export type Ia4esao4k3srao = AnonymousEnum<{
    /**
     * A proxy was executed correctly, with the given.
     */
    "ProxyExecuted": Anonymize<Ica5b5hrvd0b5i>;
    /**
     * A pure account has been created by new proxy with given
     * disambiguation index and proxy type.
     */
    "PureCreated": Anonymize<Icovh3ggbhth1s>;
    /**
     * A pure proxy was killed by its spawner.
     */
    "PureKilled": Anonymize<I8a8c1n38ann55>;
    /**
     * An announcement was placed to make a call in the future.
     */
    "Announced": Anonymize<I2ur0oeqg495j8>;
    /**
     * A proxy was added.
     */
    "ProxyAdded": Anonymize<I7f2f3co93gefl>;
    /**
     * A proxy was removed.
     */
    "ProxyRemoved": Anonymize<I7f2f3co93gefl>;
    /**
     * A deposit stored for proxies or announcements was poked / updated.
     */
    "DepositPoked": Anonymize<I1bhd210c3phjj>;
}>;
export type Icovh3ggbhth1s = {
    "pure": SS58String;
    "who": SS58String;
    "proxy_type": Anonymize<Icqldr8j4je7f4>;
    "disambiguation_index": number;
    "at": number;
    "extrinsic_index": number;
};
export type Icqldr8j4je7f4 = AnonymousEnum<{
    "Any": undefined;
}>;
export type I8a8c1n38ann55 = {
    "pure": SS58String;
    "spawner": SS58String;
    "proxy_type": Anonymize<Icqldr8j4je7f4>;
    "disambiguation_index": number;
};
export type I2ur0oeqg495j8 = {
    "real": SS58String;
    "proxy": SS58String;
    "call_hash": SizedHex<32>;
};
export type I7f2f3co93gefl = {
    "delegator": SS58String;
    "delegatee": SS58String;
    "proxy_type": Anonymize<Icqldr8j4je7f4>;
    "delay": number;
};
export type I1bhd210c3phjj = {
    "who": SS58String;
    "kind": Enum<{
        "Proxies": undefined;
        "Announcements": undefined;
    }>;
    "old_deposit": bigint;
    "new_deposit": bigint;
};
export type I5e0pasqp7drus = AnonymousEnum<{
    /**
     * A new multisig operation has begun.
     */
    "NewMultisig": Anonymize<Iep27ialq4a7o7>;
    /**
     * A multisig operation has been approved by someone.
     */
    "MultisigApproval": Anonymize<Iasu5jvoqr43mv>;
    /**
     * A multisig operation has been executed.
     */
    "MultisigExecuted": Anonymize<Id8u6ilg5ec2dc>;
    /**
     * A multisig operation has been cancelled.
     */
    "MultisigCancelled": Anonymize<I5qolde99acmd1>;
    /**
     * The deposit for a multisig operation has been updated/poked.
     */
    "DepositPoked": Anonymize<I8gtde5abn1g9a>;
}>;
export type Iep27ialq4a7o7 = {
    "approving": SS58String;
    "multisig": SS58String;
    "call_hash": SizedHex<32>;
};
export type Iasu5jvoqr43mv = {
    "approving": SS58String;
    "timepoint": Anonymize<Itvprrpb0nm3o>;
    "multisig": SS58String;
    "call_hash": SizedHex<32>;
};
export type Itvprrpb0nm3o = {
    "height": number;
    "index": number;
};
export type Id8u6ilg5ec2dc = {
    "approving": SS58String;
    "timepoint": Anonymize<Itvprrpb0nm3o>;
    "multisig": SS58String;
    "call_hash": SizedHex<32>;
    "result": Anonymize<I7ugh66e61mfbv>;
};
export type I5qolde99acmd1 = {
    "cancelling": SS58String;
    "timepoint": Anonymize<Itvprrpb0nm3o>;
    "multisig": SS58String;
    "call_hash": SizedHex<32>;
};
export type I8gtde5abn1g9a = {
    "who": SS58String;
    "call_hash": SizedHex<32>;
    "old_deposit": bigint;
    "new_deposit": bigint;
};
export type I94co7vj7h6bo = AnonymousEnum<{
    /**
     * A Runtime upgrade started.
     *
     * Its end is indicated by `UpgradeCompleted` or `UpgradeFailed`.
     */
    "UpgradeStarted": Anonymize<If1co0pilmi7oq>;
    /**
     * The current runtime upgrade completed.
     *
     * This implies that all of its migrations completed successfully as well.
     */
    "UpgradeCompleted": undefined;
    /**
     * Runtime upgrade failed.
     *
     * This is very bad and will require governance intervention.
     */
    "UpgradeFailed": undefined;
    /**
     * A migration was skipped since it was already executed in the past.
     */
    "MigrationSkipped": Anonymize<I666bl2fqjkejo>;
    /**
     * A migration progressed.
     */
    "MigrationAdvanced": Anonymize<Iae74gjak1qibn>;
    /**
     * A Migration completed.
     */
    "MigrationCompleted": Anonymize<Iae74gjak1qibn>;
    /**
     * A Migration failed.
     *
     * This implies that the whole upgrade failed and governance intervention is required.
     */
    "MigrationFailed": Anonymize<Iae74gjak1qibn>;
    /**
     * The set of historical migrations has been cleared.
     */
    "HistoricCleared": Anonymize<I3escdojpj0551>;
}>;
export type If1co0pilmi7oq = {
    /**
     * The number of migrations that this upgrade contains.
     *
     * This can be used to design a progress indicator in combination with counting the
     * `MigrationCompleted` and `MigrationSkipped` events.
     */
    "migrations": number;
};
export type Iae74gjak1qibn = {
    /**
     * The index of the migration within the [`Config::Migrations`] list.
     */
    "index": number;
    /**
     * The number of blocks that this migration took so far.
     */
    "took": number;
};
export type I3escdojpj0551 = {
    /**
     * Should be passed to `clear_historic` in a successive call.
     */
    "next_cursor"?: Anonymize<Iabpgqcjikia83>;
};
export type Iabpgqcjikia83 = (Uint8Array) | undefined;
export type Idhl9l6v9024mi = AnonymousEnum<{
    /**
     * A sudo call just took place.
     */
    "Sudid": Anonymize<Ic5n6d119limum>;
    /**
     * The sudo key has been updated.
     */
    "KeyChanged": Anonymize<I5rtkmhm2dng4u>;
    /**
     * The key was permanently removed.
     */
    "KeyRemoved": undefined;
    /**
     * A [sudo_as](Pallet::sudo_as) call just took place.
     */
    "SudoAsDone": Anonymize<Ic5n6d119limum>;
}>;
export type Ic5n6d119limum = {
    /**
     * The result of the call made by the sudo user.
     */
    "sudo_result": Anonymize<I7ugh66e61mfbv>;
};
export type I5rtkmhm2dng4u = {
    /**
     * The old sudo key (if one was previously set).
     */
    "old"?: Anonymize<Ihfphjolmsqq1>;
    /**
     * The new sudo key (if one was set).
     */
    "new": SS58String;
};
export type Ihfphjolmsqq1 = (SS58String) | undefined;
export type Idsqc7mhp6nnle = AnonymousEnum<{
    /**
     * An HRMP message was sent to a sibling parachain.
     */
    "XcmpMessageSent": Anonymize<I137t1cld92pod>;
}>;
export type I137t1cld92pod = {
    "message_hash": SizedHex<32>;
};
export type I2kosejppk3jon = AnonymousEnum<{
    /**
     * Message discarded due to an error in the `MessageProcessor` (usually a format error).
     */
    "ProcessingFailed": Anonymize<I1rvj4ubaplho0>;
    /**
     * Message is processed.
     */
    "Processed": Anonymize<Ia3uu7lqcc1q1i>;
    /**
     * Message placed in overweight queue.
     */
    "OverweightEnqueued": Anonymize<I7crucfnonitkn>;
    /**
     * This page was reaped.
     */
    "PageReaped": Anonymize<I7tmrp94r9sq4n>;
}>;
export type I1rvj4ubaplho0 = {
    /**
     * The `blake2_256` hash of the message.
     */
    "id": SizedHex<32>;
    /**
     * The queue of the message.
     */
    "origin": Anonymize<Iejeo53sea6n4q>;
    /**
     * The error that occurred.
     *
     * This error is pretty opaque. More fine-grained errors need to be emitted as events
     * by the `MessageProcessor`.
     */
    "error": Enum<{
        "BadFormat": undefined;
        "Corrupt": undefined;
        "Unsupported": undefined;
        "Overweight": Anonymize<I4q39t5hn830vp>;
        "Yield": undefined;
        "StackLimitReached": undefined;
    }>;
};
export type Iejeo53sea6n4q = AnonymousEnum<{
    "Here": undefined;
    "Parent": undefined;
    "Sibling": number;
}>;
export type Ia3uu7lqcc1q1i = {
    /**
     * The `blake2_256` hash of the message.
     */
    "id": SizedHex<32>;
    /**
     * The queue of the message.
     */
    "origin": Anonymize<Iejeo53sea6n4q>;
    /**
     * How much weight was used to process the message.
     */
    "weight_used": Anonymize<I4q39t5hn830vp>;
    /**
     * Whether the message was processed.
     *
     * Note that this does not mean that the underlying `MessageProcessor` was internally
     * successful. It *solely* means that the MQ pallet will treat this as a success
     * condition and discard the message. Any internal error needs to be emitted as events
     * by the `MessageProcessor`.
     */
    "success": boolean;
};
export type I7crucfnonitkn = {
    /**
     * The `blake2_256` hash of the message.
     */
    "id": SizedHex<32>;
    /**
     * The queue of the message.
     */
    "origin": Anonymize<Iejeo53sea6n4q>;
    /**
     * The page of the message.
     */
    "page_index": number;
    /**
     * The index of the message within the page.
     */
    "message_index": number;
};
export type I7tmrp94r9sq4n = {
    /**
     * The queue of the page.
     */
    "origin": Anonymize<Iejeo53sea6n4q>;
    /**
     * The index of the page.
     */
    "index": number;
};
export type I5uv57c3fffoi9 = AnonymousEnum<{
    /**
     * Downward message is invalid XCM.
     * \[ id \]
     */
    "InvalidFormat": SizedHex<32>;
    /**
     * Downward message is unsupported version of XCM.
     * \[ id \]
     */
    "UnsupportedVersion": SizedHex<32>;
    /**
     * Downward message executed with the given outcome.
     * \[ id, outcome \]
     */
    "ExecutedDownward": Anonymize<Ibslgga81p36aa>;
}>;
export type Ibslgga81p36aa = [SizedHex<32>, Anonymize<Ieqhmksji3pmv5>];
export type Ieqhmksji3pmv5 = AnonymousEnum<{
    "Complete": {
        "used": Anonymize<I4q39t5hn830vp>;
    };
    "Incomplete": {
        "used": Anonymize<I4q39t5hn830vp>;
        "error": Anonymize<Ieiju48dn66cuh>;
    };
    "Error": Anonymize<Ieiju48dn66cuh>;
}>;
export type Ieiju48dn66cuh = {
    "index": number;
    "error": Anonymize<Id56rgs0bdb7gl>;
};
export type Id56rgs0bdb7gl = AnonymousEnum<{
    "Overflow": undefined;
    "Unimplemented": undefined;
    "UntrustedReserveLocation": undefined;
    "UntrustedTeleportLocation": undefined;
    "LocationFull": undefined;
    "LocationNotInvertible": undefined;
    "BadOrigin": undefined;
    "InvalidLocation": undefined;
    "AssetNotFound": undefined;
    "FailedToTransactAsset": undefined;
    "NotWithdrawable": undefined;
    "LocationCannotHold": undefined;
    "ExceedsMaxMessageSize": undefined;
    "DestinationUnsupported": undefined;
    "Transport": undefined;
    "Unroutable": undefined;
    "UnknownClaim": undefined;
    "FailedToDecode": undefined;
    "MaxWeightInvalid": undefined;
    "NotHoldingFees": undefined;
    "TooExpensive": undefined;
    "Trap": bigint;
    "ExpectationFalse": undefined;
    "PalletNotFound": undefined;
    "NameMismatch": undefined;
    "VersionIncompatible": undefined;
    "HoldingWouldOverflow": undefined;
    "ExportError": undefined;
    "ReanchorFailed": undefined;
    "NoDeal": undefined;
    "FeesNotMet": undefined;
    "LockError": undefined;
    "NoPermission": undefined;
    "Unanchored": undefined;
    "NotDepositable": undefined;
    "TooManyAssets": undefined;
    "UnhandledXcmVersion": undefined;
    "WeightLimitReached": Anonymize<I4q39t5hn830vp>;
    "Barrier": undefined;
    "WeightNotComputable": undefined;
    "ExceedsStackLimit": undefined;
}>;
export type If95hivmqmkiku = AnonymousEnum<{
    /**
     * Execution of an XCM message was attempted.
     */
    "Attempted": Anonymize<I61d51nv4cou88>;
    /**
     * An XCM message was sent.
     */
    "Sent": Anonymize<If8u5kl4h8070m>;
    /**
     * An XCM message failed to send.
     */
    "SendFailed": Anonymize<Ibmuil6p3vl83l>;
    /**
     * An XCM message failed to process.
     */
    "ProcessXcmError": Anonymize<I7lul91g50ae87>;
    /**
     * Query response received which does not match a registered query. This may be because a
     * matching query was never registered, it may be because it is a duplicate response, or
     * because the query timed out.
     */
    "UnexpectedResponse": Anonymize<Icl7nl1rfeog3i>;
    /**
     * Query response has been received and is ready for taking with `take_response`. There is
     * no registered notification call.
     */
    "ResponseReady": Anonymize<Iasr6pj6shs0fl>;
    /**
     * Query response has been received and query is removed. The registered notification has
     * been dispatched and executed successfully.
     */
    "Notified": Anonymize<I2uqmls7kcdnii>;
    /**
     * Query response has been received and query is removed. The registered notification
     * could not be dispatched because the dispatch weight is greater than the maximum weight
     * originally budgeted by this runtime for the query result.
     */
    "NotifyOverweight": Anonymize<Idg69klialbkb8>;
    /**
     * Query response has been received and query is removed. There was a general error with
     * dispatching the notification call.
     */
    "NotifyDispatchError": Anonymize<I2uqmls7kcdnii>;
    /**
     * Query response has been received and query is removed. The dispatch was unable to be
     * decoded into a `Call`; this might be due to dispatch function having a signature which
     * is not `(origin, QueryId, Response)`.
     */
    "NotifyDecodeFailed": Anonymize<I2uqmls7kcdnii>;
    /**
     * Expected query response has been received but the origin location of the response does
     * not match that expected. The query remains registered for a later, valid, response to
     * be received and acted upon.
     */
    "InvalidResponder": Anonymize<I7r6b7145022pp>;
    /**
     * Expected query response has been received but the expected origin location placed in
     * storage by this runtime previously cannot be decoded. The query remains registered.
     *
     * This is unexpected (since a location placed in storage in a previously executing
     * runtime should be readable prior to query timeout) and dangerous since the possibly
     * valid response will be dropped. Manual governance intervention is probably going to be
     * needed.
     */
    "InvalidResponderVersion": Anonymize<Icl7nl1rfeog3i>;
    /**
     * Received query response has been read and removed.
     */
    "ResponseTaken": Anonymize<I30pg328m00nr3>;
    /**
     * Some assets have been placed in an asset trap.
     */
    "AssetsTrapped": Anonymize<Icmrn7bogp28cs>;
    /**
     * An XCM version change notification message has been attempted to be sent.
     *
     * The cost of sending it (borne by the chain) is included.
     */
    "VersionChangeNotified": Anonymize<I7m9b5plj4h5ot>;
    /**
     * The supported version of a location has been changed. This might be through an
     * automatic notification or a manual intervention.
     */
    "SupportedVersionChanged": Anonymize<I9kt8c221c83ln>;
    /**
     * A given location which had a version change subscription was dropped owing to an error
     * sending the notification to it.
     */
    "NotifyTargetSendFail": Anonymize<I9onhk772nfs4f>;
    /**
     * A given location which had a version change subscription was dropped owing to an error
     * migrating the location to our new XCM format.
     */
    "NotifyTargetMigrationFail": Anonymize<I3l6bnksrmt56r>;
    /**
     * Expected query response has been received but the expected querier location placed in
     * storage by this runtime previously cannot be decoded. The query remains registered.
     *
     * This is unexpected (since a location placed in storage in a previously executing
     * runtime should be readable prior to query timeout) and dangerous since the possibly
     * valid response will be dropped. Manual governance intervention is probably going to be
     * needed.
     */
    "InvalidQuerierVersion": Anonymize<Icl7nl1rfeog3i>;
    /**
     * Expected query response has been received but the querier location of the response does
     * not match the expected. The query remains registered for a later, valid, response to
     * be received and acted upon.
     */
    "InvalidQuerier": Anonymize<Idh09k0l2pmdcg>;
    /**
     * A remote has requested XCM version change notification from us and we have honored it.
     * A version information message is sent to them and its cost is included.
     */
    "VersionNotifyStarted": Anonymize<I7uoiphbm0tj4r>;
    /**
     * We have requested that a remote chain send us XCM version change notifications.
     */
    "VersionNotifyRequested": Anonymize<I7uoiphbm0tj4r>;
    /**
     * We have requested that a remote chain stops sending us XCM version change
     * notifications.
     */
    "VersionNotifyUnrequested": Anonymize<I7uoiphbm0tj4r>;
    /**
     * Fees were paid from a location for an operation (often for using `SendXcm`).
     */
    "FeesPaid": Anonymize<I512p1n7qt24l8>;
    /**
     * Some assets have been claimed from an asset trap
     */
    "AssetsClaimed": Anonymize<Icmrn7bogp28cs>;
    /**
     * A XCM version migration finished.
     */
    "VersionMigrationFinished": Anonymize<I6s1nbislhk619>;
    /**
     * An `aliaser` location was authorized by `target` to alias it, authorization valid until
     * `expiry` block number.
     */
    "AliasAuthorized": Anonymize<I3gghqnh2mj0is>;
    /**
     * `target` removed alias authorization for `aliaser`.
     */
    "AliasAuthorizationRemoved": Anonymize<I6iv852roh6t3h>;
    /**
     * `target` removed all alias authorizations.
     */
    "AliasesAuthorizationsRemoved": Anonymize<I9oc2o6itbiopq>;
}>;
export type I61d51nv4cou88 = {
    "outcome": Anonymize<Ieqhmksji3pmv5>;
};
export type If8u5kl4h8070m = {
    "origin": Anonymize<If9iqq7i64mur8>;
    "destination": Anonymize<If9iqq7i64mur8>;
    "message": Anonymize<Ict03eedr8de9s>;
    "message_id": SizedHex<32>;
};
export type Ict03eedr8de9s = Array<XcmV5Instruction>;
export type XcmV5Instruction = Enum<{
    "WithdrawAsset": Anonymize<I4npjalvhmfuj>;
    "ReserveAssetDeposited": Anonymize<I4npjalvhmfuj>;
    "ReceiveTeleportedAsset": Anonymize<I4npjalvhmfuj>;
    "QueryResponse": {
        "query_id": bigint;
        "response": Anonymize<I7vucpgm2c6959>;
        "max_weight": Anonymize<I4q39t5hn830vp>;
        "querier"?: Anonymize<I4pai6qnfk426l>;
    };
    "TransferAsset": {
        "assets": Anonymize<I4npjalvhmfuj>;
        "beneficiary": Anonymize<If9iqq7i64mur8>;
    };
    "TransferReserveAsset": {
        "assets": Anonymize<I4npjalvhmfuj>;
        "dest": Anonymize<If9iqq7i64mur8>;
        "xcm": Anonymize<Ict03eedr8de9s>;
    };
    "Transact": {
        "origin_kind": XcmV2OriginKind;
        "fallback_max_weight"?: Anonymize<Iasb8k6ash5mjn>;
        "call": Uint8Array;
    };
    "HrmpNewChannelOpenRequest": Anonymize<I5uhhrjqfuo4e5>;
    "HrmpChannelAccepted": Anonymize<Ifij4jam0o7sub>;
    "HrmpChannelClosing": Anonymize<Ieeb4svd9i8fji>;
    "ClearOrigin": undefined;
    "DescendOrigin": XcmV5Junctions;
    "ReportError": Anonymize<I6vsmh07hrp1rc>;
    "DepositAsset": {
        "assets": XcmV5AssetFilter;
        "beneficiary": Anonymize<If9iqq7i64mur8>;
    };
    "DepositReserveAsset": {
        "assets": XcmV5AssetFilter;
        "dest": Anonymize<If9iqq7i64mur8>;
        "xcm": Anonymize<Ict03eedr8de9s>;
    };
    "ExchangeAsset": {
        "give": XcmV5AssetFilter;
        "want": Anonymize<I4npjalvhmfuj>;
        "maximal": boolean;
    };
    "InitiateReserveWithdraw": {
        "assets": XcmV5AssetFilter;
        "reserve": Anonymize<If9iqq7i64mur8>;
        "xcm": Anonymize<Ict03eedr8de9s>;
    };
    "InitiateTeleport": {
        "assets": XcmV5AssetFilter;
        "dest": Anonymize<If9iqq7i64mur8>;
        "xcm": Anonymize<Ict03eedr8de9s>;
    };
    "ReportHolding": {
        "response_info": Anonymize<I6vsmh07hrp1rc>;
        "assets": XcmV5AssetFilter;
    };
    "BuyExecution": {
        "fees": Anonymize<Iffh1nc5e1mod6>;
        "weight_limit": XcmV3WeightLimit;
    };
    "RefundSurplus": undefined;
    "SetErrorHandler": Anonymize<Ict03eedr8de9s>;
    "SetAppendix": Anonymize<Ict03eedr8de9s>;
    "ClearError": undefined;
    "ClaimAsset": {
        "assets": Anonymize<I4npjalvhmfuj>;
        "ticket": Anonymize<If9iqq7i64mur8>;
    };
    "Trap": bigint;
    "SubscribeVersion": Anonymize<Ieprdqqu7ildvr>;
    "UnsubscribeVersion": undefined;
    "BurnAsset": Anonymize<I4npjalvhmfuj>;
    "ExpectAsset": Anonymize<I4npjalvhmfuj>;
    "ExpectOrigin"?: Anonymize<I4pai6qnfk426l>;
    "ExpectError"?: Anonymize<I3l6ejee750fv1>;
    "ExpectTransactStatus": XcmV3MaybeErrorCode;
    "QueryPallet": {
        "module_name": Uint8Array;
        "response_info": Anonymize<I6vsmh07hrp1rc>;
    };
    "ExpectPallet": Anonymize<Id7mf37dkpgfjs>;
    "ReportTransactStatus": Anonymize<I6vsmh07hrp1rc>;
    "ClearTransactStatus": undefined;
    "UniversalOrigin": XcmV5Junction;
    "ExportMessage": {
        "network": XcmV5NetworkId;
        "destination": XcmV5Junctions;
        "xcm": Anonymize<Ict03eedr8de9s>;
    };
    "LockAsset": {
        "asset": Anonymize<Iffh1nc5e1mod6>;
        "unlocker": Anonymize<If9iqq7i64mur8>;
    };
    "UnlockAsset": {
        "asset": Anonymize<Iffh1nc5e1mod6>;
        "target": Anonymize<If9iqq7i64mur8>;
    };
    "NoteUnlockable": {
        "asset": Anonymize<Iffh1nc5e1mod6>;
        "owner": Anonymize<If9iqq7i64mur8>;
    };
    "RequestUnlock": {
        "asset": Anonymize<Iffh1nc5e1mod6>;
        "locker": Anonymize<If9iqq7i64mur8>;
    };
    "SetFeesMode": Anonymize<I4nae9rsql8fa7>;
    "SetTopic": SizedHex<32>;
    "ClearTopic": undefined;
    "AliasOrigin": Anonymize<If9iqq7i64mur8>;
    "UnpaidExecution": {
        "weight_limit": XcmV3WeightLimit;
        "check_origin"?: Anonymize<I4pai6qnfk426l>;
    };
    "PayFees": {
        "asset": Anonymize<Iffh1nc5e1mod6>;
    };
    "InitiateTransfer": {
        "destination": Anonymize<If9iqq7i64mur8>;
        "remote_fees"?: (Anonymize<Ifhmc9e7vpeeig>) | undefined;
        "preserve_origin": boolean;
        "assets": Array<Anonymize<Ifhmc9e7vpeeig>>;
        "remote_xcm": Anonymize<Ict03eedr8de9s>;
    };
    "ExecuteWithOrigin": {
        "descendant_origin"?: (XcmV5Junctions) | undefined;
        "xcm": Anonymize<Ict03eedr8de9s>;
    };
    "SetHints": {
        "hints": Array<Enum<{
            "AssetClaimer": {
                "location": Anonymize<If9iqq7i64mur8>;
            };
        }>>;
    };
}>;
export declare const XcmV5Instruction: GetEnum<XcmV5Instruction>;
export type I4npjalvhmfuj = Array<Anonymize<Iffh1nc5e1mod6>>;
export type Iffh1nc5e1mod6 = {
    "id": Anonymize<If9iqq7i64mur8>;
    "fun": XcmV3MultiassetFungibility;
};
export type XcmV3MultiassetFungibility = Enum<{
    "Fungible": bigint;
    "NonFungible": XcmV3MultiassetAssetInstance;
}>;
export declare const XcmV3MultiassetFungibility: GetEnum<XcmV3MultiassetFungibility>;
export type XcmV3MultiassetAssetInstance = Enum<{
    "Undefined": undefined;
    "Index": bigint;
    "Array4": SizedHex<4>;
    "Array8": SizedHex<8>;
    "Array16": SizedHex<16>;
    "Array32": SizedHex<32>;
}>;
export declare const XcmV3MultiassetAssetInstance: GetEnum<XcmV3MultiassetAssetInstance>;
export type I7vucpgm2c6959 = AnonymousEnum<{
    "Null": undefined;
    "Assets": Anonymize<I4npjalvhmfuj>;
    "ExecutionResult"?: Anonymize<I3l6ejee750fv1>;
    "Version": number;
    "PalletsInfo": Anonymize<I599u7h20b52at>;
    "DispatchResult": XcmV3MaybeErrorCode;
}>;
export type I3l6ejee750fv1 = ([number, Anonymize<Id56rgs0bdb7gl>]) | undefined;
export type I599u7h20b52at = Array<{
    "index": number;
    "name": Uint8Array;
    "module_name": Uint8Array;
    "major": number;
    "minor": number;
    "patch": number;
}>;
export type XcmV3MaybeErrorCode = Enum<{
    "Success": undefined;
    "Error": Uint8Array;
    "TruncatedError": Uint8Array;
}>;
export declare const XcmV3MaybeErrorCode: GetEnum<XcmV3MaybeErrorCode>;
export type XcmV2OriginKind = Enum<{
    "Native": undefined;
    "SovereignAccount": undefined;
    "Superuser": undefined;
    "Xcm": undefined;
}>;
export declare const XcmV2OriginKind: GetEnum<XcmV2OriginKind>;
export type Iasb8k6ash5mjn = (Anonymize<I4q39t5hn830vp>) | undefined;
export type I5uhhrjqfuo4e5 = {
    "sender": number;
    "max_message_size": number;
    "max_capacity": number;
};
export type Ifij4jam0o7sub = {
    "recipient": number;
};
export type Ieeb4svd9i8fji = {
    "initiator": number;
    "sender": number;
    "recipient": number;
};
export type I6vsmh07hrp1rc = {
    "destination": Anonymize<If9iqq7i64mur8>;
    "query_id": bigint;
    "max_weight": Anonymize<I4q39t5hn830vp>;
};
export type XcmV5AssetFilter = Enum<{
    "Definite": Anonymize<I4npjalvhmfuj>;
    "Wild": XcmV5WildAsset;
}>;
export declare const XcmV5AssetFilter: GetEnum<XcmV5AssetFilter>;
export type XcmV5WildAsset = Enum<{
    "All": undefined;
    "AllOf": {
        "id": Anonymize<If9iqq7i64mur8>;
        "fun": XcmV2MultiassetWildFungibility;
    };
    "AllCounted": number;
    "AllOfCounted": {
        "id": Anonymize<If9iqq7i64mur8>;
        "fun": XcmV2MultiassetWildFungibility;
        "count": number;
    };
}>;
export declare const XcmV5WildAsset: GetEnum<XcmV5WildAsset>;
export type XcmV2MultiassetWildFungibility = Enum<{
    "Fungible": undefined;
    "NonFungible": undefined;
}>;
export declare const XcmV2MultiassetWildFungibility: GetEnum<XcmV2MultiassetWildFungibility>;
export type XcmV3WeightLimit = Enum<{
    "Unlimited": undefined;
    "Limited": Anonymize<I4q39t5hn830vp>;
}>;
export declare const XcmV3WeightLimit: GetEnum<XcmV3WeightLimit>;
export type Ieprdqqu7ildvr = {
    "query_id": bigint;
    "max_response_weight": Anonymize<I4q39t5hn830vp>;
};
export type Id7mf37dkpgfjs = {
    "index": number;
    "name": Uint8Array;
    "module_name": Uint8Array;
    "crate_major": number;
    "min_crate_minor": number;
};
export type I4nae9rsql8fa7 = {
    "jit_withdraw": boolean;
};
export type Ifhmc9e7vpeeig = AnonymousEnum<{
    "Teleport": XcmV5AssetFilter;
    "ReserveDeposit": XcmV5AssetFilter;
    "ReserveWithdraw": XcmV5AssetFilter;
}>;
export type Ibmuil6p3vl83l = {
    "origin": Anonymize<If9iqq7i64mur8>;
    "destination": Anonymize<If9iqq7i64mur8>;
    "error": Enum<{
        "NotApplicable": undefined;
        "Transport": undefined;
        "Unroutable": undefined;
        "DestinationUnsupported": undefined;
        "ExceedsMaxMessageSize": undefined;
        "MissingArgument": undefined;
        "Fees": undefined;
    }>;
    "message_id": SizedHex<32>;
};
export type I7lul91g50ae87 = {
    "origin": Anonymize<If9iqq7i64mur8>;
    "error": Anonymize<Id56rgs0bdb7gl>;
    "message_id": SizedHex<32>;
};
export type Icl7nl1rfeog3i = {
    "origin": Anonymize<If9iqq7i64mur8>;
    "query_id": bigint;
};
export type Iasr6pj6shs0fl = {
    "query_id": bigint;
    "response": Anonymize<I7vucpgm2c6959>;
};
export type I2uqmls7kcdnii = {
    "query_id": bigint;
    "pallet_index": number;
    "call_index": number;
};
export type Idg69klialbkb8 = {
    "query_id": bigint;
    "pallet_index": number;
    "call_index": number;
    "actual_weight": Anonymize<I4q39t5hn830vp>;
    "max_budgeted_weight": Anonymize<I4q39t5hn830vp>;
};
export type I7r6b7145022pp = {
    "origin": Anonymize<If9iqq7i64mur8>;
    "query_id": bigint;
    "expected_location"?: Anonymize<I4pai6qnfk426l>;
};
export type I30pg328m00nr3 = {
    "query_id": bigint;
};
export type Icmrn7bogp28cs = {
    "hash": SizedHex<32>;
    "origin": Anonymize<If9iqq7i64mur8>;
    "assets": XcmVersionedAssets;
};
export type XcmVersionedAssets = Enum<{
    "V3": Anonymize<Iai6dhqiq3bach>;
    "V4": Anonymize<I50mli3hb64f9b>;
    "V5": Anonymize<I4npjalvhmfuj>;
}>;
export declare const XcmVersionedAssets: GetEnum<XcmVersionedAssets>;
export type Iai6dhqiq3bach = Array<Anonymize<Idcm24504c8bkk>>;
export type Idcm24504c8bkk = {
    "id": XcmV3MultiassetAssetId;
    "fun": XcmV3MultiassetFungibility;
};
export type XcmV3MultiassetAssetId = Enum<{
    "Concrete": Anonymize<I4c0s5cioidn76>;
    "Abstract": SizedHex<32>;
}>;
export declare const XcmV3MultiassetAssetId: GetEnum<XcmV3MultiassetAssetId>;
export type I4c0s5cioidn76 = {
    "parents": number;
    "interior": XcmV3Junctions;
};
export type XcmV3Junctions = Enum<{
    "Here": undefined;
    "X1": XcmV3Junction;
    "X2": FixedSizeArray<2, XcmV3Junction>;
    "X3": FixedSizeArray<3, XcmV3Junction>;
    "X4": FixedSizeArray<4, XcmV3Junction>;
    "X5": FixedSizeArray<5, XcmV3Junction>;
    "X6": FixedSizeArray<6, XcmV3Junction>;
    "X7": FixedSizeArray<7, XcmV3Junction>;
    "X8": FixedSizeArray<8, XcmV3Junction>;
}>;
export declare const XcmV3Junctions: GetEnum<XcmV3Junctions>;
export type XcmV3Junction = Enum<{
    "Parachain": number;
    "AccountId32": {
        "network"?: Anonymize<Idcq3vns9tgp5p>;
        "id": SizedHex<32>;
    };
    "AccountIndex64": {
        "network"?: Anonymize<Idcq3vns9tgp5p>;
        "index": bigint;
    };
    "AccountKey20": {
        "network"?: Anonymize<Idcq3vns9tgp5p>;
        "key": SizedHex<20>;
    };
    "PalletInstance": number;
    "GeneralIndex": bigint;
    "GeneralKey": Anonymize<I15lht6t53odo4>;
    "OnlyChild": undefined;
    "Plurality": Anonymize<I518fbtnclg1oc>;
    "GlobalConsensus": XcmV3JunctionNetworkId;
}>;
export declare const XcmV3Junction: GetEnum<XcmV3Junction>;
export type Idcq3vns9tgp5p = (XcmV3JunctionNetworkId) | undefined;
export type XcmV3JunctionNetworkId = Enum<{
    "ByGenesis": SizedHex<32>;
    "ByFork": Anonymize<I15vf5oinmcgps>;
    "Polkadot": undefined;
    "Kusama": undefined;
    "Westend": undefined;
    "Rococo": undefined;
    "Wococo": undefined;
    "Ethereum": Anonymize<I623eo8t3jrbeo>;
    "BitcoinCore": undefined;
    "BitcoinCash": undefined;
    "PolkadotBulletin": undefined;
}>;
export declare const XcmV3JunctionNetworkId: GetEnum<XcmV3JunctionNetworkId>;
export type I50mli3hb64f9b = Array<Anonymize<Ia5l7mu5a6v49o>>;
export type Ia5l7mu5a6v49o = {
    "id": Anonymize<I4c0s5cioidn76>;
    "fun": XcmV3MultiassetFungibility;
};
export type I7m9b5plj4h5ot = {
    "destination": Anonymize<If9iqq7i64mur8>;
    "result": number;
    "cost": Anonymize<I4npjalvhmfuj>;
    "message_id": SizedHex<32>;
};
export type I9kt8c221c83ln = {
    "location": Anonymize<If9iqq7i64mur8>;
    "version": number;
};
export type I9onhk772nfs4f = {
    "location": Anonymize<If9iqq7i64mur8>;
    "query_id": bigint;
    "error": Anonymize<Id56rgs0bdb7gl>;
};
export type I3l6bnksrmt56r = {
    "location": XcmVersionedLocation;
    "query_id": bigint;
};
export type XcmVersionedLocation = Enum<{
    "V3": Anonymize<I4c0s5cioidn76>;
    "V4": Anonymize<I4c0s5cioidn76>;
    "V5": Anonymize<If9iqq7i64mur8>;
}>;
export declare const XcmVersionedLocation: GetEnum<XcmVersionedLocation>;
export type Idh09k0l2pmdcg = {
    "origin": Anonymize<If9iqq7i64mur8>;
    "query_id": bigint;
    "expected_querier": Anonymize<If9iqq7i64mur8>;
    "maybe_actual_querier"?: Anonymize<I4pai6qnfk426l>;
};
export type I7uoiphbm0tj4r = {
    "destination": Anonymize<If9iqq7i64mur8>;
    "cost": Anonymize<I4npjalvhmfuj>;
    "message_id": SizedHex<32>;
};
export type I512p1n7qt24l8 = {
    "paying": Anonymize<If9iqq7i64mur8>;
    "fees": Anonymize<I4npjalvhmfuj>;
};
export type I6s1nbislhk619 = {
    "version": number;
};
export type I3gghqnh2mj0is = {
    "aliaser": Anonymize<If9iqq7i64mur8>;
    "target": Anonymize<If9iqq7i64mur8>;
    "expiry"?: Anonymize<I35p85j063s0il>;
};
export type I35p85j063s0il = (bigint) | undefined;
export type I6iv852roh6t3h = {
    "aliaser": Anonymize<If9iqq7i64mur8>;
    "target": Anonymize<If9iqq7i64mur8>;
};
export type I9oc2o6itbiopq = {
    "target": Anonymize<If9iqq7i64mur8>;
};
export type I4srakrmf0fspo = AnonymousEnum<{
    /**
     * New Invulnerables were set.
     */
    "NewInvulnerables": Anonymize<I39t01nnod9109>;
    /**
     * A new Invulnerable was added.
     */
    "InvulnerableAdded": Anonymize<I6v8sm60vvkmk7>;
    /**
     * An Invulnerable was removed.
     */
    "InvulnerableRemoved": Anonymize<I6v8sm60vvkmk7>;
    /**
     * The number of desired candidates was set.
     */
    "NewDesiredCandidates": Anonymize<I1qmtmbe5so8r3>;
    /**
     * The candidacy bond was set.
     */
    "NewCandidacyBond": Anonymize<Ih99m6ehpcar7>;
    /**
     * A new candidate joined.
     */
    "CandidateAdded": Anonymize<Idgorhsbgdq2ap>;
    /**
     * Bond of a candidate updated.
     */
    "CandidateBondUpdated": Anonymize<Idgorhsbgdq2ap>;
    /**
     * A candidate was removed.
     */
    "CandidateRemoved": Anonymize<I6v8sm60vvkmk7>;
    /**
     * An account was replaced in the candidate list by another one.
     */
    "CandidateReplaced": Anonymize<I9ubb2kqevnu6t>;
    /**
     * An account was unable to be added to the Invulnerables because they did not have keys
     * registered. Other Invulnerables may have been set.
     */
    "InvalidInvulnerableSkipped": Anonymize<I6v8sm60vvkmk7>;
}>;
export type I39t01nnod9109 = {
    "invulnerables": Anonymize<Ia2lhg7l2hilo3>;
};
export type Ia2lhg7l2hilo3 = Array<SS58String>;
export type I6v8sm60vvkmk7 = {
    "account_id": SS58String;
};
export type I1qmtmbe5so8r3 = {
    "desired_candidates": number;
};
export type Ih99m6ehpcar7 = {
    "bond_amount": bigint;
};
export type Idgorhsbgdq2ap = {
    "account_id": SS58String;
    "deposit": bigint;
};
export type I9ubb2kqevnu6t = {
    "old": SS58String;
    "new": SS58String;
    "deposit": bigint;
};
export type I6ue0ck5fc3u44 = AnonymousEnum<{
    /**
     * New session has happened. Note that the argument is the session index, not the
     * block number as the type might suggest.
     */
    "NewSession": Anonymize<I2hq50pu2kdjpo>;
    /**
     * The `NewSession` event in the current block also implies a new validator set to be
     * queued.
     */
    "NewQueued": undefined;
    /**
     * Validator has been disabled.
     */
    "ValidatorDisabled": Anonymize<I9acqruh7322g2>;
    /**
     * Validator has been re-enabled.
     */
    "ValidatorReenabled": Anonymize<I9acqruh7322g2>;
}>;
export type I2hq50pu2kdjpo = {
    "session_index": number;
};
export type I9acqruh7322g2 = {
    "validator": SS58String;
};
export type I8jqccj5fq1oj = AnonymousEnum<{
    /**
     * A 13 §1 key passed its bounds/Δ/cooldown checks and was updated.
     */
    "ParamUpdated": Anonymize<Irupv22iu38vu>;
    /**
     * A capability-table row was inserted or replaced.
     */
    "CapabilitySet": Anonymize<I8i1bk7kj5k5ed>;
    /**
     * A phase-flag bit was set or cleared.
     */
    "PhaseFlagSet": Anonymize<Ie5qta40r3ho5l>;
    /**
     * The D-14 release channel was rewritten.
     */
    "ReleaseChannelSet": Anonymize<Ibfd56bn4a7kfk>;
    /**
     * A registry row's governance metadata was amended (06 §2.1).
     */
    "RegistryAmended": Anonymize<Ifcslavva7skj1>;
    /**
     * A kernel meter was charged within its envelope.
     */
    "MeterCharged": Anonymize<Icolandhn4qpus>;
}>;
export type Irupv22iu38vu = {
    "key": SizedHex<16>;
    "value": Anonymize<I9cr49fg6lsgds>;
};
export type I9cr49fg6lsgds = AnonymousEnum<{
    "U8": number;
    "U32": number;
    "Balance": bigint;
    "Fixed": bigint;
    "Percent": number;
    "Perbill": number;
}>;
export type I8i1bk7kj5k5ed = {
    "class": Anonymize<I2hfnh9jsghgur>;
    "capability": Enum<{
        "SetParam": SizedHex<16>;
        "SetCapability": undefined;
        "AmendRegistry": undefined;
        "SetReleaseChannel": undefined;
        "AuthorizeUpgrade": undefined;
        "TreasurySpend": undefined;
        "OracleConfig": undefined;
        "MarketTemplate": undefined;
        "InsuranceSweep": undefined;
    }>;
    "enabled": boolean;
};
export type I2hfnh9jsghgur = AnonymousEnum<{
    "Param": undefined;
    "Treasury": undefined;
    "Code": undefined;
    "Meta": undefined;
    "Constitutional": undefined;
}>;
export type Ie5qta40r3ho5l = {
    "flag": number;
    "enabled": boolean;
    "bits": number;
};
export type Ibfd56bn4a7kfk = {
    "spec_version": number;
    "updated_at": number;
};
export type Ifcslavva7skj1 = {
    "key": SizedHex<16>;
};
export type Icolandhn4qpus = {
    "index": number;
    "amount": bigint;
    "spent": bigint;
};
export type Icog4v85gspb3i = AnonymousEnum<{
    /**
     * `split(pid, a)`: minted `a` of both branch-USDC to the caller.
     */
    "Split": Anonymize<I6bpho1qciu1vq>;
    /**
     * `merge(pid, a)`: burned both branch-USDC, paid `a` USDC out.
     */
    "Merged": Anonymize<I6bpho1qciu1vq>;
    /**
     * `split_scalar(pid, b, a)`.
     */
    "ScalarSplit": Anonymize<I23de7n843u7sn>;
    /**
     * `merge_scalar(pid, b, a)`.
     */
    "ScalarMerged": Anonymize<I23de7n843u7sn>;
    /**
     * `split_gate(pid, b, g, a)`.
     */
    "GateSplit": Anonymize<I5fe6dsj65bbns>;
    /**
     * `merge_gate(pid, b, g, a)`.
     */
    "GateMerged": Anonymize<I5fe6dsj65bbns>;
    /**
     * `transfer(position, to, a)`.
     */
    "PositionTransferred": Anonymize<I333ps8sjf4lhr>;
    /**
     * `split_baseline(epoch, a)`.
     */
    "BaselineSplit": Anonymize<Idasi83b2hi6kd>;
    /**
     * `merge_baseline(epoch, a)`.
     */
    "BaselineMerged": Anonymize<Idasi83b2hi6kd>;
    /**
     * `resolve(pid, w)` — winning branch (02 §6).
     */
    "VaultResolved": Anonymize<Iah5vhnso7uqce>;
    /**
     * `void(pid)` (02 §6, D-1/X-11f).
     */
    "VaultVoided": Anonymize<Ibihfmtr4nutgv>;
    /**
     * `settle_scalar(pid, s)` — carries the winning branch (02 §6, B-low).
     */
    "ScalarSettlementSet": Anonymize<I2lct6m7k5r2et>;
    /**
     * `settle_gate(pid, g, outcome)` — winning-branch breach outcome (02 §6, B-2).
     */
    "GateSettled": Anonymize<I9cf6so4vur6mg>;
    /**
     * `settle_baseline(epoch, s)`.
     */
    "BaselineSettled": Anonymize<Id6e8lk3pfjocj>;
    /**
     * `redeem(pid, a)` — the par leg, **fee-exempt** (03 §5.3a(1), G-3), so
     * it deliberately carries no `fee` field (02 §6 rule 3).
     */
    "Redeemed": Anonymize<I6bpho1qciu1vq>;
    /**
     * `redeem_scalar(pid, kind, a)` — `payout` is the post-rounding
     * **gross**, `fee` the 03 §5.3a deduction, so `net = payout − fee`
     * (02 §6 rule 1, contract v17).
     */
    "ScalarRedeemed": Anonymize<Isntabb3i2t9f>;
    /**
     * `redeem_scalar_pair(pid, a)` (02 §6, B-5) — `amount` is exactly `a`
     * gross; `fee` is `fee_pair(a)` per 03 §5.3a(2a), **not** `fee(a)`.
     */
    "ScalarPairRedeemed": Anonymize<I40af445fa06rh>;
    /**
     * `redeem_gate(pid, g, a)` — `amount` gross, `fee` the deduction.
     */
    "GateRedeemed": Anonymize<Iapmmsuq8j9rcn>;
    /**
     * `redeem_void(pid, kind, a)` (02 §6, D-1) — `amount` burned, `payout`
     * paid. **Fee-exempt** (03 §5.3a(1)), so no `fee` field (rule 3).
     */
    "VoidRedeemed": Anonymize<I80dirtbv2ognl>;
    /**
     * `redeem_baseline*` — `payout` gross, `fee` the deduction.
     */
    "BaselineRedeemed": Anonymize<I6qrovovkeah6g>;
    /**
     * `sweep_redemption_fees()` moved the accrued balance to the treasury
     * `MAIN` account and zeroed the counter (02 §6, contract v17; 03 §5.4).
     * A sweep on an empty counter is a successful no-op and still emits,
     * with `amount = 0`.
     */
    "RedemptionFeesSwept": Anonymize<I3qt1hgg4djhgb>;
    /**
     * `sweep_dust(pid)` completed — residual escrow swept to INSURANCE (02 §6).
     */
    "VaultReaped": Anonymize<I5v7n6l8j8vd1f>;
    /**
     * `sweep_dust_baseline(epoch)` completed.
     */
    "BaselineVaultReaped": Anonymize<I2kpgolvhr6ftt>;
    /**
     * Operational event outside the frozen 02 ingest schema.
     */
    "SplitPauseSet": Anonymize<I20e9ph536u7ti>;
    /**
     * Operational event outside the frozen 02 ingest schema.
     */
    "SplitPauseCleared": undefined;
    /**
     * Operational event outside the frozen 02 ingest schema.
     */
    "FreezeSet": Anonymize<I20e9ph536u7ti>;
    /**
     * Operational event outside the frozen 02 ingest schema.
     */
    "FreezeCleared": undefined;
    /**
     * Operational event outside the frozen 02 ingest schema.
     */
    "FreezeExtended": Anonymize<I20e9ph536u7ti>;
    /**
     * The reconciliation crank crossed from healthy to undercollateralized.
     * Operational edge event outside the frozen 02 ingest schema.
     */
    "LedgerDriftDetected": Anonymize<Id2312c48f17dd>;
    /**
     * The reconciliation crank crossed from undercollateralized to healthy.
     * Operational edge event outside the frozen 02 ingest schema.
     */
    "LedgerDriftCleared": Anonymize<Id2312c48f17dd>;
}>;
export type I6bpho1qciu1vq = {
    "pid": bigint;
    "amount": bigint;
};
export type I23de7n843u7sn = {
    "pid": bigint;
    "branch": Anonymize<Iefmskl524g3a7>;
    "amount": bigint;
};
export type Iefmskl524g3a7 = AnonymousEnum<{
    "Accept": undefined;
    "Reject": undefined;
}>;
export type I5fe6dsj65bbns = {
    "pid": bigint;
    "branch": Anonymize<Iefmskl524g3a7>;
    "gate": Anonymize<I5mifn3r4bq1hg>;
    "amount": bigint;
};
export type I5mifn3r4bq1hg = AnonymousEnum<{
    "Survival": undefined;
    "Security": undefined;
}>;
export type I333ps8sjf4lhr = {
    "position": Anonymize<I5m1k92kcp4o6d>;
    "amount": bigint;
};
export type I5m1k92kcp4o6d = AnonymousEnum<{
    "Proposal": {
        "proposal": bigint;
        "branch": Anonymize<Iefmskl524g3a7>;
        "kind": Anonymize<I4pkqc50hbjmhi>;
    };
    "Baseline": {
        "epoch": number;
        "side": Anonymize<Idfomgju2lejvi>;
    };
}>;
export type I4pkqc50hbjmhi = AnonymousEnum<{
    "BranchUsdc": undefined;
    "Long": undefined;
    "Short": undefined;
    "GateYes": Anonymize<I5mifn3r4bq1hg>;
    "GateNo": Anonymize<I5mifn3r4bq1hg>;
}>;
export type Idfomgju2lejvi = AnonymousEnum<{
    "Long": undefined;
    "Short": undefined;
}>;
export type Idasi83b2hi6kd = {
    "epoch": number;
    "amount": bigint;
};
export type Iah5vhnso7uqce = {
    "pid": bigint;
    "branch": Anonymize<Iefmskl524g3a7>;
};
export type Ibihfmtr4nutgv = {
    "pid": bigint;
};
export type I2lct6m7k5r2et = {
    "pid": bigint;
    "branch": Anonymize<Iefmskl524g3a7>;
    "s": bigint;
};
export type I9cf6so4vur6mg = {
    "pid": bigint;
    "branch": Anonymize<Iefmskl524g3a7>;
    "gate": Anonymize<I5mifn3r4bq1hg>;
    "outcome": boolean;
};
export type Id6e8lk3pfjocj = {
    "epoch": number;
    "s": bigint;
};
export type Isntabb3i2t9f = {
    "pid": bigint;
    "side": Anonymize<Idfomgju2lejvi>;
    "payout": bigint;
    "fee": bigint;
};
export type I40af445fa06rh = {
    "pid": bigint;
    "amount": bigint;
    "fee": bigint;
};
export type Iapmmsuq8j9rcn = {
    "pid": bigint;
    "gate": Anonymize<I5mifn3r4bq1hg>;
    "amount": bigint;
    "fee": bigint;
};
export type I80dirtbv2ognl = {
    "pid": bigint;
    "kind": Anonymize<I4pkqc50hbjmhi>;
    "amount": bigint;
    "payout": bigint;
};
export type I6qrovovkeah6g = {
    "epoch": number;
    "side": Anonymize<Idfomgju2lejvi>;
    "payout": bigint;
    "fee": bigint;
};
export type I5v7n6l8j8vd1f = {
    "pid": bigint;
    "residue": bigint;
};
export type I2kpgolvhr6ftt = {
    "epoch": number;
    "residue": bigint;
};
export type I20e9ph536u7ti = {
    "until": number;
};
export type Id2312c48f17dd = {
    "liability": bigint;
    "custody": bigint;
};
export type Icul1a5j3uhgpq = AnonymousEnum<{
    /**
     * Frozen 02 §5 trade event.
     */
    "Traded": Anonymize<I7a6s4h48lmk1t>;
    /**
     * Frozen 02 §5 observation event.
     */
    "Observed": Anonymize<I2fkgb649u353b>;
    /**
     * Frozen 02 §5 creation event.
     */
    "MarketCreated": Anonymize<I3a053sft19jid>;
    /**
     * Frozen 02 §5 close event.
     */
    "MarketClosed": Anonymize<Ico0ou8pmf1cq5>;
    /**
     * Frozen 02 §5 reap event.
     */
    "MarketReaped": Anonymize<Ico0ou8pmf1cq5>;
    /**
     * Append-only operational event; not part of the frozen §5 ingest set.
     */
    "Seeded": Anonymize<Idj8pac8q2ngco>;
    /**
     * Operational event outside the frozen 02 ingest schema.
     */
    "CreationFreezeSet": Anonymize<I20e9ph536u7ti>;
    /**
     * Operational event outside the frozen 02 ingest schema.
     */
    "CreationFreezeCleared": undefined;
    /**
     * Operational event outside the frozen 02 ingest schema.
     */
    "FreezeSet": Anonymize<I20e9ph536u7ti>;
    /**
     * Operational event outside the frozen 02 ingest schema.
     */
    "FreezeCleared": undefined;
    /**
     * Operational event outside the frozen 02 ingest schema.
     */
    "FreezeExtended": Anonymize<I20e9ph536u7ti>;
    /**
     * Frozen 02 §5 sweep event (contract v17). Both amounts are real USDC
     * and either MAY be zero; exactly one exists per market, because the
     * swept marker makes a repeat run a silent no-op (04 §2/§11).
     *
     * Appended rather than grouped with the other §5 rows above: 02 §13
     * makes contract additions append-only, and inserting a variant would
     * renumber every SCALE discriminant after it.
     */
    "RevenueSwept": Anonymize<I2sg7pchi235m2>;
    /**
     * External counterpart. It deliberately does not reuse
     * `RevenueSwept.pol_returned`, whose frozen field means treasury POL.
     * Trading fees remain service revenue in `MAIN`; only the client
     * subsidy is returned here (04 §3; 16 §7.3–§7.4).
     */
    "ExternalRevenueSwept": Anonymize<Ibg0qukn7q6t5u>;
}>;
export type I7a6s4h48lmk1t = {
    "market": bigint;
    "who": SS58String;
    "side": Anonymize<Ib4c4hbfg3ril4>;
    "amount": bigint;
    "cost": bigint;
    "p_after": bigint;
};
export type Ib4c4hbfg3ril4 = AnonymousEnum<{
    "BuyLong": undefined;
    "BuyShort": undefined;
    "SellLong": undefined;
    "SellShort": undefined;
}>;
export type I2fkgb649u353b = {
    "market": bigint;
    "o_t": bigint;
};
export type I3a053sft19jid = {
    "market": bigint;
    "kind": Enum<{
        "DecisionAccept": undefined;
        "DecisionReject": undefined;
        "GateS_Adopt": undefined;
        "GateS_Reject": undefined;
        "GateC_Adopt": undefined;
        "GateC_Reject": undefined;
        "Baseline": undefined;
    }>;
    "pid"?: Anonymize<I35p85j063s0il>;
    "epoch": number;
    "b": bigint;
};
export type Ico0ou8pmf1cq5 = {
    "market": bigint;
};
export type Idj8pac8q2ngco = {
    "market": bigint;
    "headroom": bigint;
};
export type I2sg7pchi235m2 = {
    "market": bigint;
    "fee_to_main": bigint;
    "pol_returned": bigint;
};
export type Ibg0qukn7q6t5u = {
    "market": bigint;
    "fee_to_main": bigint;
    "subsidy_returned": bigint;
};
export type Iotv6nd407lpv = AnonymousEnum<{
    "MetricSpecRegistered": Anonymize<I6s1nbislhk619>;
    "SnapshotRecorded": Anonymize<I93sj8arfs7e7f>;
    "GateBreachRecorded": Anonymize<I3qf57dn94jogo>;
    "SettlementComputed": Anonymize<I7jnda8be156fb>;
    /**
     * 07 §10: this cohort's `W` was recomputed without `dropped` — flagged
     * in two consecutive epochs of its measurement window — with the
     * surviving weights renormalized. Emitted immediately before
     * `SettlementComputed`, so a score that is not the geometric mean of
     * the two published `Snapshots.welfare` values always says why.
     */
    "SettlementRenormalized": Anonymize<I27lb9t574io60>;
    /**
     * One qualifying 05 §4.3.2 defensive-path failure was counted into
     * `Π`'s window accumulator.
     *
     * Emitted on **every** increment, deliberately. An integrity failure
     * that surfaces only as a lower welfare score two cranks later is
     * unactionable: operators need to know which fault class fired, in
     * which window, and how many have accumulated — the fourth zeroes `Π`
     * (12 §6.3). Off the 02 §6 ingest set by that section's (a)–(c) rule
     * (an operator/monitoring diagnostic), so it carries no contract bump.
     */
    "IntegrityFailureRecorded": Anonymize<Ic7t67gl6oo8ed>;
}>;
export type I93sj8arfs7e7f = {
    "epoch": number;
    "spec_version": number;
    "welfare": bigint;
};
export type I3qf57dn94jogo = {
    "epoch": number;
    "day": number;
    "s_breached": boolean;
    "c_breached": boolean;
};
export type I7jnda8be156fb = {
    "epoch": number;
    "spec_version": number;
    "score": bigint;
};
export type I27lb9t574io60 = {
    "epoch": number;
    "spec_version": number;
    "dropped": Anonymize<Icgljjb6j82uhn>;
};
export type Icgljjb6j82uhn = Array<number>;
export type Ic7t67gl6oo8ed = {
    "epoch": number;
    "day": number;
    "fault": Enum<{
        "DiscardedInternalCall": undefined;
        "FailStaticLatch": undefined;
        "LostAccounting": undefined;
    }>;
    /**
     * The window's post-increment total, so a subscriber that missed
     * an earlier event still sees the true count.
     */
    "count": number;
};
export type I9rq31q6e4anhq = AnonymousEnum<{
    /**
     * A reporter registered with `orc.reporter_stake` held (07 §3).
     */
    "ReporterRegistered": Anonymize<Ifaori90nvndr0>;
    /**
     * A round-1 report was posted with its value-scaled bond (07 §5.1).
     */
    "Reported": Anonymize<Ie2rqjbtm23ftk>;
    /**
     * A challenge was posted, superseding the quorum requirement (07 §5.2).
     */
    "Challenged": Anonymize<I7oiv62sj2f3r3>;
    /**
     * A challenged round escalated; bonds doubled (07 §5.3/§6.2).
     */
    "RoundEscalated": Anonymize<I4oohlti0ugomv>;
    /**
     * A round was resolved mechanically from committed evidence (07 §9).
     */
    "RecomputeProven": Anonymize<Icj2jtt996rgo7>;
    /**
     * A round-3 dispute was escalated to the `OracleResolution` track (07 §5.4).
     */
    "AdjudicationRequested": Anonymize<I55162di4jv6rk>;
    /**
     * The values track adjudicated a terminal dispute (07 §5.4).
     */
    "Adjudicated": Anonymize<Ib8h08jrok1svd>;
    /**
     * A component value settled and is final for money (07 §5; I-18).
     */
    "ComponentSettled": Anonymize<I4m6m36nu8gsqu>;
    /**
     * A component took the neutral path, carrying its last valid value (07 §10).
     */
    "NeutralSettlement": Anonymize<Ie1dicjiiaa5q8>;
    /**
     * A watchtower acknowledged a round as observable (07 §4).
     */
    "WindowAcknowledged": Anonymize<I239j3gnc1jsps>;
    /**
     * The single 48 h quorum extension fired (07 §4).
     */
    "WindowExtended": Anonymize<I15atr7h39m6es>;
    /**
     * No challenge and no quorum after the extension ⇒ neutral (07 §4).
     */
    "QuorumFailed": Anonymize<I5052qcfs60vjm>;
    /**
     * A reporter's bond stack was slashed on a second offense (07 §3/§5.5).
     */
    "ReporterSlashed": Anonymize<If8en01tuc3bij>;
    /**
     * A reporter was ejected on the third offense (07 §3).
     */
    "ReporterEjected": Anonymize<I4cbvqmqadhrea>;
    /**
     * A watchtower registered with `wt.stake` held (07 §4).
     */
    "WatchtowerRegistered": Anonymize<Ifaori90nvndr0>;
    /**
     * A watchtower was marked inactive for an epoch (07 §4).
     */
    "WatchtowerInactive": Anonymize<I5euu4q9kmp9c3>;
    /**
     * A watchtower's stake was slashed for liveness failure (07 §4).
     */
    "WatchtowerSlashed": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * A reserve-transferability probe was sent (07 §8).
     */
    "ReserveProbeSent": Anonymize<I30pg328m00nr3>;
    /**
     * A probe outcome was recorded (07 §8).
     */
    "ReserveProbeResult": Anonymize<Ictvl5d049lms3>;
    /**
     * The reserve entered the unhealthy fail-static state (07 §8).
     */
    "ReserveUnhealthy": undefined;
    /**
     * The reserve recovered after `res.recover_threshold` passes (07 §8).
     */
    "ReserveRecovered": undefined;
    /**
     * A retained round's 07 §11(1) retention window closed with no terminal
     * verdict: both bond stacks were refunded to their posters and the
     * round reaped (SQ-492). Appended last so no earlier variant's SCALE
     * discriminant moves.
     */
    "RetentionExpired": Anonymize<I94jeskiehjtf1>;
    /**
     * The retained 07 §3 record store was full of ejections and a
     * departing or ejected account's record could not be kept
     * (contract v19). Fails **open** by design (G-1): a full table must
     * never abort a values-track verdict.
     *
     * An operational diagnostic — off the frozen 02 §6 ingest set by that
     * section's (a)–(c) rule. Appended last.
     */
    "ReporterRecordsFull": Anonymize<I4cbvqmqadhrea>;
}>;
export type Ifaori90nvndr0 = {
    "who": SS58String;
    "stake": bigint;
};
export type Ie2rqjbtm23ftk = {
    "component": number;
    "epoch": number;
    "round": number;
    "reporter": SS58String;
    "value": bigint;
    "evidence_hash": SizedHex<32>;
    "bond": bigint;
};
export type I7oiv62sj2f3r3 = {
    "component": number;
    "epoch": number;
    "round": number;
    "challenger": SS58String;
    "counter_value": bigint;
    "evidence_hash": SizedHex<32>;
    "bond": bigint;
};
export type I4oohlti0ugomv = {
    "component": number;
    "epoch": number;
    "round": number;
    "new_bond": bigint;
};
export type Icj2jtt996rgo7 = {
    "component": number;
    "epoch": number;
    "value": bigint;
    "prover": SS58String;
};
export type I55162di4jv6rk = {
    "component": number;
    "epoch": number;
    "referendum": number;
};
export type Ib8h08jrok1svd = {
    "component": number;
    "epoch": number;
    "value": bigint;
};
export type I4m6m36nu8gsqu = {
    "component": number;
    "epoch": number;
    "value": bigint;
    "path": Anonymize<I6as7fe022sv9h>;
};
export type I6as7fe022sv9h = AnonymousEnum<{
    "Unchallenged": undefined;
    "Recomputed": undefined;
    "Adjudicated": undefined;
    "ChallengerDefault": undefined;
    "Neutral": undefined;
}>;
export type Ie1dicjiiaa5q8 = {
    "component": number;
    "epoch": number;
    "carried_value": bigint;
    "flagged_epochs": number;
};
export type I239j3gnc1jsps = {
    "component": number;
    "epoch": number;
    "round": number;
    "watchtower": SS58String;
};
export type I15atr7h39m6es = {
    "component": number;
    "epoch": number;
    "round": number;
    "new_deadline": number;
};
export type I5052qcfs60vjm = {
    "component": number;
    "epoch": number;
    "round": number;
};
export type If8en01tuc3bij = {
    "who": SS58String;
    "amount": bigint;
    "offense": number;
};
export type I5euu4q9kmp9c3 = {
    "who": SS58String;
    "epoch": number;
};
export type Ictvl5d049lms3 = {
    "query_id": bigint;
    "passed": boolean;
};
export type I94jeskiehjtf1 = {
    "component": number;
    "epoch": number;
    "round": number;
    "reporter_bond": bigint;
    "challenger_bond": bigint;
};
export type I9o4h3u7u17bqn = AnonymousEnum<{
    /**
     * `file` on the Incident instance (07 §7).
     */
    "IncidentFiled": Anonymize<I36oknt2f8tl4g>;
    /**
     * `file` on the Milestone instance (07 §7).
     */
    "MilestoneFiled": Anonymize<I288nkd84a7m9u>;
    /**
     * `challenge_filing` on the Incident instance (07 §7).
     */
    "IncidentChallenged": Anonymize<Ifc75td2ivg90e>;
    /**
     * `challenge_filing` on the Milestone instance (07 §7).
     */
    "MilestoneChallenged": Anonymize<Ifc75td2ivg90e>;
    /**
     * An Incident filing closed as upheld (07 §7).
     */
    "IncidentUpheld": Anonymize<I1mjueefcqgdaj>;
    /**
     * An Incident filing closed as rejected (07 §7).
     */
    "IncidentRejected": Anonymize<I1mjueefcqgdaj>;
    /**
     * A Milestone filing closed as accepted (07 §7).
     */
    "MilestoneAccepted": Anonymize<I1mjueefcqgdaj>;
    /**
     * A Milestone filing closed as rejected (07 §7).
     */
    "MilestoneRejected": Anonymize<I1mjueefcqgdaj>;
    /**
     * A challenge resolved: the loser's bond was slashed 40 / 60 (07 §5.5/§7).
     */
    "FilingBondSlashed": Anonymize<I7i7gk545r3sv3>;
    /**
     * `close_epoch` derived the aggregate for one `(epoch, frozen version)`
     * and handed it to welfare (07 §7). `spec_version` is a **trailing**
     * field added in contract v14 (02 §6/§13, SQ-141): one epoch closes once
     * per live version, so the pair identifies the record. The ten other
     * registry events are unchanged — filing-id allocation stays per-epoch
     * precisely so `(epoch, filing_id)` remains unique.
     */
    "RegistryEpochClosed": Anonymize<I97i24r5tc4i6u>;
    /**
     * A bonded watchtower acknowledged a registry filing window.
     */
    "WindowAcknowledged": Anonymize<I5tek56pm6maiv>;
    /**
     * A registry filing received its single quorum-failure extension.
     */
    "WindowExtended": Anonymize<I60fhenaqhrkjj>;
}>;
export type I36oknt2f8tl4g = {
    "epoch": number;
    "filing_id": number;
    "who": SS58String;
    "class": Anonymize<I8mm8h51ml90lv>;
    "evidence_hash": SizedHex<32>;
    "bond": bigint;
};
export type I8mm8h51ml90lv = AnonymousEnum<{
    "S1": undefined;
    "S2": undefined;
    "S3": undefined;
    "Scope": number;
}>;
export type I288nkd84a7m9u = {
    "epoch": number;
    "filing_id": number;
    "who": SS58String;
    "class": Anonymize<I8mm8h51ml90lv>;
    "points": number;
    "evidence_hash": SizedHex<32>;
    "bond": bigint;
};
export type Ifc75td2ivg90e = {
    "epoch": number;
    "filing_id": number;
    "challenger": SS58String;
    "evidence_hash": SizedHex<32>;
    "bond": bigint;
};
export type I1mjueefcqgdaj = {
    "epoch": number;
    "filing_id": number;
};
export type I7i7gk545r3sv3 = {
    "epoch": number;
    "filing_id": number;
    "loser": SS58String;
    "amount": bigint;
    "challenger_share": bigint;
    "insurance_share": bigint;
};
export type I97i24r5tc4i6u = {
    "kind": Anonymize<I7r7b6bp2g5acg>;
    "epoch": number;
    "aggregate": bigint;
    "spec_version": number;
};
export type I7r7b6bp2g5acg = AnonymousEnum<{
    "Incident": undefined;
    "Milestone": undefined;
}>;
export type I5tek56pm6maiv = {
    "epoch": number;
    "filing_id": number;
    "watchtower": SS58String;
};
export type I60fhenaqhrkjj = {
    "epoch": number;
    "filing_id": number;
    "new_deadline": number;
};
export type I3jebldn7oovcq = AnonymousEnum<{
    /**
     * A direct in-cap grant paid from a budget line (08 §1.3).
     */
    "Spent": Anonymize<I5l0jsir5si80s>;
    /**
     * A vesting stream was opened (grant > `trs.stream_threshold`).
     */
    "StreamOpened": Anonymize<I6o7guvg1i99i2>;
    /**
     * A recipient claimed vested funds from a stream.
     */
    "StreamClaimed": Anonymize<I5l6c62egasn2e>;
    /**
     * A TREASURY decision cancelled a stream; the remainder reverts to `MAIN`.
     */
    "StreamCancelled": Anonymize<I3qv7v9gggggd4>;
    /**
     * A budget line was funded from `MAIN` (08 §1.1).
     */
    "BudgetLineFunded": Anonymize<I5c87v6pd2sdaf>;
    /**
     * VIT was minted within the `iss.inflation_cap` window (08 §2.3).
     */
    "VitIssued": Anonymize<I7dq91mkderm2o>;
    /**
     * The reserve-health flag `R` transitioned (08 §1.2, 07 §8).
     */
    "NavHaircutFlagged": Anonymize<Ie2mt3ul73mn1d>;
    /**
     * Mistakenly-sent foreign assets were recovered (TREASURY-only, 08 §1.3).
     */
    "ForeignRecovered": Anonymize<I3dg8tbt6tcck6>;
    /**
     * A coretime renewal was paid from `ops.coretime` (09 §4, dead-man exempt).
     */
    "CoretimeRenewalCalled": Anonymize<I5c87v6pd2sdaf>;
    /**
     * One bounded reserve-probe fee envelope was reserved (07 §8, SQ-114).
     */
    "ReserveProbeFeeCharged": Anonymize<I5c87v6pd2sdaf>;
    /**
     * A class-arming attempt failed the minimum-viable-NAV floor (08 §4.2, loud).
     */
    "NavFloorUnmet": Anonymize<I50qqth3sk471t>;
    /**
     * The metered keeper budget passed 80% (08 §6.3).
     */
    "KeeperBudgetLow": Anonymize<I5em265vo8vck5>;
    /**
     * The metered keeper budget is exhausted (08 §6.3).
     */
    "KeeperBudgetExhausted": Anonymize<Ibp2vba0704net>;
    /**
     * An authenticated Coretime renewal quote was noted or superseded.
     */
    "CoretimeQuoteNoted": Anonymize<I4gj9mv93je4sv>;
    /**
     * An open Coretime quote was pruned.
     */
    "CoretimeQuotePruned": Anonymize<Ibnicuotj4pjfm>;
    /**
     * Treasury governance rotated the quote authority and renewal account.
     */
    "CoretimeAuthoritySet": Anonymize<I3f8ncpioik5na>;
    /**
     * INSURANCE was swept into `MAIN` by a TREASURY decision (08 §1.2/§1.4).
     */
    "InsuranceSwept": Anonymize<I3qt1hgg4djhgb>;
    /**
     * INSURANCE held USDC above its derived target `T_ins` and the surplus
     * overflowed to `MAIN` (08 §1.2) — automatically inside the inflow's own
     * transaction, or through the permissionless reconciliation crank for
     * balance that arrived by direct transfer. Treasury-owned operational
     * history, outside the frozen 02 §6 ingest set, exactly like
     * `PolCustodyMoved` and the two keeper-budget events.
     */
    "InsuranceOverflowed": Anonymize<I3qt1hgg4djhgb>;
    /**
     * A subsidy line moved with its custody: `spent` on a book seed,
     * cleared on the 04 §2 Sweep return (08 §8 step 5; I-33). Treasury-owned
     * operational history, outside the frozen 02 §6 ingest set; it is the
     * POL revolving-balance gauge's series.
     */
    "PolCustodyMoved": Anonymize<Idts26aojvm4gr>;
    /**
     * A bounded Phase-4 community tranche was transferred into an SDK
     * vesting schedule. This is treasury-owned operational history, not a
     * frozen integration-contract event.
     */
    "CommunityScheduleCreated": Anonymize<I141piq296rc2n>;
}>;
export type I5l0jsir5si80s = {
    "line": Anonymize<Iesceati3hrhp6>;
    "dest": SS58String;
    "amount": bigint;
};
export type Iesceati3hrhp6 = AnonymousEnum<{
    "Pol": undefined;
    "PolBaseline": undefined;
    "Keeper": undefined;
    "Oracle": undefined;
    "Rewards": undefined;
    "OpsBootnodes": undefined;
    "OpsRpcArchive": undefined;
    "OpsCollators": undefined;
    "OpsKeepers": undefined;
    "OpsOracleEvidence": undefined;
    "OpsWatchtowers": undefined;
    "OpsMonitoring": undefined;
    "OpsArweave": undefined;
    "OpsCoretime": undefined;
    "OpsReserveProbe": undefined;
}>;
export type I6o7guvg1i99i2 = {
    "id": bigint;
    "recipient": SS58String;
    "total": bigint;
};
export type I5l6c62egasn2e = {
    "id": bigint;
    "recipient": SS58String;
    "amount": bigint;
};
export type I3qv7v9gggggd4 = {
    "id": bigint;
    "reverted": bigint;
};
export type I5c87v6pd2sdaf = {
    "line": Anonymize<Iesceati3hrhp6>;
    "amount": bigint;
};
export type I7dq91mkderm2o = {
    "amount": bigint;
    "line": Anonymize<Iesceati3hrhp6>;
    "meter_after": bigint;
};
export type Ie2mt3ul73mn1d = {
    "epoch": number;
    "flag": boolean;
};
export type I3dg8tbt6tcck6 = {
    "asset": Enum<{
        "Usdc": undefined;
        "Vit": undefined;
        "Foreign": SizedHex<32>;
    }>;
    "dest": SS58String;
    "amount": bigint;
};
export type I50qqth3sk471t = {
    "class": Anonymize<I2hfnh9jsghgur>;
    "nav": bigint;
    "floor": bigint;
};
export type I5em265vo8vck5 = {
    "remaining": bigint;
};
export type Ibp2vba0704net = {
    "epoch": number;
    "spent": bigint;
};
export type I4gj9mv93je4sv = {
    "period_index": number;
    "price": bigint;
};
export type Ibnicuotj4pjfm = {
    "period_index": number;
};
export type I3f8ncpioik5na = {
    "quote_authority": SS58String;
    "renewal_account": SizedHex<32>;
};
export type Idts26aojvm4gr = {
    "line": Anonymize<Iesceati3hrhp6>;
    "amount": bigint;
    "spent": boolean;
};
export type I141piq296rc2n = {
    "beneficiary": SS58String;
    "amount": bigint;
    "start": number;
    "per_block": bigint;
    "remaining": bigint;
};
export type I2hnabup83elbp = AnonymousEnum<{
    /**
     * A 5-of-7 action dispatched (06 §5.4).
     */
    "GuardianAction": Anonymize<Iasl7n2tkle090>;
    /**
     * A `force_rerun` reopened a proposal's books (06 §5.3).
     */
    "ForceRerun": Anonymize<I178uj1s35amp3>;
    /**
     * A playbook was activated on a live trigger (06 §6.2).
     */
    "PlaybookActivated": Anonymize<Iai5mccr300imn>;
    /**
     * `PB-LEDGER-FREEZE` renewed once via a values referendum (06 §6.3).
     */
    "PlaybookRenewed": Anonymize<I4m6dhgb2ar055>;
    /**
     * A playbook expired and its effects reverted (06 §6.2).
     */
    "PlaybookExpired": Anonymize<I4m6dhgb2ar055>;
    /**
     * A retrospective review was scheduled on the `ratify` track (06 §5.4);
     * `referendum` is the index returned by [`Config::ReviewScheduler`].
     */
    "ReviewScheduled": Anonymize<I1uen92pl1lhqu>;
    /**
     * The council membership was (re)elected (06 §5.1).
     */
    "MembersSet": Anonymize<I3ajpo6bheav6q>;
    /**
     * A member proposed an action (06 §5.1).
     */
    "ActionProposed": Anonymize<Id6ktlm8uq63g6>;
    /**
     * A member approved an action (06 §5.1).
     */
    "ActionApproved": Anonymize<I4f2hva90hak3m>;
    /**
     * A retrospective review passed and was ratified (06 §5.4).
     */
    "ActionRatified": Anonymize<I823eg09r939h3>;
    /**
     * A review missed its deadline: each approver slashed 50% (06 §5.4).
     */
    "ReviewFailed": Anonymize<Ibcj87mgvuqbc8>;
    /**
     * A recall referendum was auto-scheduled on the `guardian` track for a
     * failed review (06 §5.4); `referendum` is the index returned by
     * [`Config::RecallScheduler`].
     */
    "RecallScheduled": Anonymize<I1uen92pl1lhqu>;
    /**
     * A guardian-track recall enacted; listed approvers' seats are vacant.
     */
    "RecallEnacted": Anonymize<I5d87nqeditd0c>;
    /**
     * Guardian-track availability toggle for an enumerated playbook.
     */
    "PlaybookRegistrationSet": Anonymize<I8m9idjg76ip7q>;
}>;
export type Iasl7n2tkle090 = {
    "action_id": number;
    "power": Anonymize<I5ae66jaqfj2lj>;
    "target": {
        "pid"?: Anonymize<I35p85j063s0il>;
        "playbook"?: (Anonymize<I5ss06mick4shb>) | undefined;
    };
    "justification_hash": SizedHex<32>;
};
export type I5ae66jaqfj2lj = AnonymousEnum<{
    "PauseIntake": Anonymize<I20e9ph536u7ti>;
    "DelayOnce": Anonymize<Ibihfmtr4nutgv>;
    "ForceRerun": Anonymize<Ibihfmtr4nutgv>;
    "ActivatePlaybook": {
        "id": Anonymize<I5ss06mick4shb>;
        "trigger": Anonymize<I7k9h8uemc2ovm>;
        "expiry": number;
        "target"?: Anonymize<I4arjljr6dpflb>;
    };
    "SuspendOnGate": undefined;
}>;
export type I5ss06mick4shb = AnonymousEnum<{
    "Depeg": undefined;
    "Migration": undefined;
    "OracleVoid": undefined;
    "HaltIntake": undefined;
    "Reserve": undefined;
    "LedgerFreeze": undefined;
}>;
export type I7k9h8uemc2ovm = AnonymousEnum<{
    "DepegMedian": undefined;
    "MigrationHalt": undefined;
    "OracleDeadlock": undefined;
    "GateBreach": undefined;
    "DeadMan": undefined;
    "VoidInFlight": undefined;
    "ReserveHealth": undefined;
    "LedgerDrift": undefined;
}>;
export type I4arjljr6dpflb = (number) | undefined;
export type I178uj1s35amp3 = {
    "pid": bigint;
    "justification_hash": SizedHex<32>;
    "window_end": number;
};
export type Iai5mccr300imn = {
    "id": Anonymize<I5ss06mick4shb>;
    "trigger": Anonymize<I7k9h8uemc2ovm>;
    "expiry": number;
};
export type I4m6dhgb2ar055 = {
    "id": Anonymize<I5ss06mick4shb>;
};
export type I1uen92pl1lhqu = {
    "action": number;
    "referendum": number;
};
export type I3ajpo6bheav6q = {
    "members": FixedSizeArray<7, SS58String>;
};
export type Id6ktlm8uq63g6 = {
    "action_id": number;
    "power": Anonymize<I5ae66jaqfj2lj>;
};
export type I4f2hva90hak3m = {
    "action_id": number;
    "who": SS58String;
    "approvals": number;
};
export type I823eg09r939h3 = {
    "action": number;
};
export type Ibcj87mgvuqbc8 = {
    "action": number;
    "slashed_each": bigint;
};
export type I5d87nqeditd0c = {
    "action": number;
    "removed": Anonymize<Ia2lhg7l2hilo3>;
};
export type I8m9idjg76ip7q = {
    "id": Anonymize<I5ss06mick4shb>;
    "enabled": boolean;
};
export type Icfh12v8grnajk = AnonymousEnum<{
    /**
     * Registry members were replaced by the values track.
     */
    "MembersSet": Anonymize<I3c63j6sh3evqn>;
    /**
     * A bonded member submitted an artifact attestation.
     */
    "AttestationSubmitted": Anonymize<Ib4lvahglmvoj4>;
    /**
     * Anyone opened a bonded challenge inside the window.
     */
    "AttestationChallenged": Anonymize<Ib5tkqghj5b2lj>;
    /**
     * The ratify track resolved a challenge and slashed its loser.
     */
    "ChallengeResolved": Anonymize<I6d3ckosptflrl>;
    /**
     * An attestor reached the second-false-attestation ejection threshold.
     */
    "AttestorEjected": Anonymize<I4cbvqmqadhrea>;
    /**
     * A values-authorized cause removed an attestor from the active roster.
     */
    "AttestorRemovedForCause": Anonymize<I4uk5nmqsi401j>;
    /**
     * A record was durably revoked by a cause-aware removal/ejection.
     */
    "AttestationRevoked": Anonymize<I3if4k84v5n0f6>;
}>;
export type I3c63j6sh3evqn = {
    "members": Anonymize<Ia2lhg7l2hilo3>;
};
export type Ib4lvahglmvoj4 = {
    "attestation_id": number;
    "pid": bigint;
    "artifact_hash": SizedHex<32>;
    "attestor": SS58String;
};
export type Ib5tkqghj5b2lj = {
    "attestation_id": number;
    "challenger": SS58String;
    "evidence_hash": SizedHex<32>;
};
export type I6d3ckosptflrl = {
    "attestation_id": number;
    "upheld": boolean;
    "loser": SS58String;
    "slashed": bigint;
};
export type I4uk5nmqsi401j = {
    "who": SS58String;
    "cause_hash": SizedHex<32>;
};
export type I3if4k84v5n0f6 = {
    "attestation_id": number;
    "pid": bigint;
    "attestor": SS58String;
    "cause_hash": SizedHex<32>;
};
export type I16r8b84a092kl = AnonymousEnum<{
    "ProposalSubmitted": bigint;
    "ProposalWithdrawn": bigint;
    "ScreeningStarted": bigint;
    "ProposalCancelled": Anonymize<I5k37qbr3s9v15>;
    "ProposalQualified": bigint;
    "ProposalDeferred": bigint;
    "SlotsShrunk": Anonymize<I5eol3g6qqti18>;
    "MarketsOpened": bigint;
    "DecisionExtended": bigint;
    "ProposalQueued": Anonymize<I1qrnckffb9nrm>;
    "ProposalRejected": Anonymize<I5k37qbr3s9v15>;
    "ProposalDelayed": Anonymize<If5i6c2m5d9b65>;
    "RerunScheduled": bigint;
    "RerunOpened": bigint;
    "MandateExpired": bigint;
    "MeasurementStarted": Anonymize<I1e0oh3bn9igat>;
    "CohortSettled": Anonymize<Id6e8lk3pfjocj>;
    "CohortVoided": Anonymize<I36p2bgnnl36ta>;
    "BaselineCarried": Anonymize<I70l5rhpgblmim>;
    "ProposalForceRejected": Anonymize<I5k37qbr3s9v15>;
    "IntakeSlashed": Anonymize<Id94b4a7r8bjeq>;
    /**
     * Operational event outside the frozen 02 ingest schema.
     */
    "IntakePauseSet": Anonymize<I20e9ph536u7ti>;
    /**
     * Operational event outside the frozen 02 ingest schema.
     */
    "IntakePauseCleared": undefined;
    /**
     * A completed gate window lacked a committed observation and now
     * admits PB-ORACLE-VOID for exactly this cohort.
     * Operational diagnostic outside the frozen 02 ingest schema.
     */
    "OracleDeadlockLatched": Anonymize<I36p2bgnnl36ta>;
    /**
     * The target latch was consumed by cohort VOID or cleared after late
     * observations restored the settlement input.
     * Operational diagnostic outside the frozen 02 ingest schema.
     */
    "OracleDeadlockCleared": Anonymize<I36p2bgnnl36ta>;
}>;
export type I5k37qbr3s9v15 = {
    "pid": bigint;
    "reason": Anonymize<Ibabj9dc2c6tv1>;
};
export type Ibabj9dc2c6tv1 = AnonymousEnum<{
    "NotDecisionGrade": undefined;
    "GateVetoSurvival": undefined;
    "GateVetoSecurity": undefined;
    "HurdleNotMet": undefined;
    "ConvergenceFailed": undefined;
    "SecondExtensionFailed": undefined;
    "ProcessHold": undefined;
    "ConstitutionViolation": undefined;
    "ResourceConflict": undefined;
    "RateLimited": undefined;
    "VetoUpheldByReview": undefined;
    "StaleQueue": undefined;
    "PayloadReverted": undefined;
    "NotRatified": undefined;
    "SecuritySizing": undefined;
    "AttestationMissing": undefined;
    "RolloverExhausted": undefined;
}>;
export type I5eol3g6qqti18 = {
    "epoch": number;
    "requested": number;
    "funded": number;
    "dropped": Anonymize<Iafqnechp3omqg>;
};
export type Iafqnechp3omqg = Array<bigint>;
export type I1qrnckffb9nrm = {
    "pid": bigint;
    "payload_hash": SizedHex<32>;
    "maturity": number;
};
export type If5i6c2m5d9b65 = {
    "pid": bigint;
    "justification_hash": SizedHex<32>;
};
export type I1e0oh3bn9igat = {
    "cohort": number;
};
export type I36p2bgnnl36ta = {
    "epoch": number;
};
export type I70l5rhpgblmim = {
    "pid": bigint;
    "epoch": number;
};
export type Id94b4a7r8bjeq = {
    "pid": bigint;
    "reason": Anonymize<Ibabj9dc2c6tv1>;
    "amount": bigint;
};
export type I5k67p27a3s88k = AnonymousEnum<{
    "Executed": Anonymize<Ic4vbg4dnnpegu>;
    "ExecutionFailed": Anonymize<I7nl4maqn6m365>;
    "Ratified": Anonymize<I7661jqlhbtghb>;
    "UpgradeAuthorized": Anonymize<I6bq7cmd37a5ik>;
    "Enqueued": Anonymize<I9i68vrjhvjnp1>;
    "Rejected": Anonymize<I5k37qbr3s9v15>;
    "UpgradeApplied": Anonymize<Icu71ht824icnq>;
    "PreimageUnpinned": Anonymize<I3fr1hdlq8g81s>;
    "UpgradeAborted": Anonymize<Ib51vk42m1po4n>;
    /**
     * Defensive alarm: the exact queue mirror failed. `fail_static` says
     * whether the adapter successfully forced spendable NAV to zero.
     */
    "PendingOutflowSyncFailed": Anonymize<I1c5ncj72v7k27>;
    /**
     * PB-MIGRATION machine-trigger diagnostic (09 §3.2(4)): emitted on the
     * first activation of a migration halt source (failed step, stall,
     * applied-code mismatch, or failed abort cleanup). `cursor` carries the
     * SDK cursor's exact bytes (empty for a source-less halt); `failed_step`
     * is the SDK-reported step index. This is an operator/monitoring
     * diagnostic (12 §6.3, RB-UPGRADE),
     * **outside** the frozen 02 §6 ingest set by that section's (a)-(c) rule
     * — the same off-contract class as `PendingOutflowSyncFailed`, so it
     * carries no `INTEGRATION_CONTRACT_VERSION` bump.
     */
    "MigrationHalted": Anonymize<Idhhlivifn563e>;
    "RecoveryImageCommitted": Anonymize<I3o9sh4pms1jcb>;
    "RecoveryImageApplied": Anonymize<Iij42ed7fk1sg>;
    "PhaseFourUpgradeAuthorized": Anonymize<I8vg1ab5ssn90l>;
    "RecoveryImageQualified": Anonymize<Ifai7amejetiv>;
}>;
export type Ic4vbg4dnnpegu = {
    "pid": bigint;
    "record": Anonymize<If3k3a7nmekc7r>;
};
export type If3k3a7nmekc7r = {
    "pid": bigint;
    "payload_hash": SizedHex<32>;
    "class": Anonymize<I2hfnh9jsghgur>;
    "executed_at": number;
    "result": Anonymize<I87iqhvqrqh1cq>;
};
export type I87iqhvqrqh1cq = AnonymousEnum<{
    "Ok": undefined;
    "Failed": {
        "call_index": number;
        "error": SizedHex<4>;
    };
}>;
export type I7nl4maqn6m365 = {
    "pid": bigint;
    "outcome": Anonymize<I87iqhvqrqh1cq>;
};
export type I7661jqlhbtghb = {
    "pid": bigint;
    "referendum_index": number;
};
export type I6bq7cmd37a5ik = {
    "code_hash": SizedHex<32>;
    "authorized_at": number;
};
export type I9i68vrjhvjnp1 = {
    "pid": bigint;
    "maturity": number;
};
export type Icu71ht824icnq = {
    "code_hash": SizedHex<32>;
    "spec_version": number;
};
export type I3fr1hdlq8g81s = {
    "pid": bigint;
    "payload_hash": SizedHex<32>;
};
export type Ib51vk42m1po4n = {
    "code_hash": SizedHex<32>;
};
export type I1c5ncj72v7k27 = {
    "queued": number;
    "fail_static": boolean;
};
export type Idhhlivifn563e = {
    "cursor": Uint8Array;
    "failed_step"?: Anonymize<I4arjljr6dpflb>;
};
export type I3o9sh4pms1jcb = {
    "pid": bigint;
    "primary_hash": SizedHex<32>;
    "recovery_hash": SizedHex<32>;
    "target_spec_version": number;
};
export type Iij42ed7fk1sg = {
    "recovery_hash": SizedHex<32>;
    "spec_version": number;
};
export type I8vg1ab5ssn90l = {
    "pid": bigint;
    "code_hash": SizedHex<32>;
    "justification_hash": SizedHex<32>;
};
export type Ifai7amejetiv = {
    "pid": bigint;
    "recovery_hash": SizedHex<32>;
    "target_spec_version": number;
};
export type Iaqnvtu78qlr78 = AnonymousEnum<{
    "ClientAdmitted": Anonymize<I5el2hvlofnvv5>;
    "LocalClientAdmitted": Anonymize<Ibqi69m3s38lo0>;
    "ClientRemovalStarted": Anonymize<I6ctvd5gvtboll>;
    "ClientRemoved": Anonymize<Ierkp6g0vn9ojj>;
    "EgressPrepaid": Anonymize<I1srp17os6n92p>;
    "DeliveryFloatToppedUp": Anonymize<I1hd2l2dfhk11i>;
    "DeliveryFloatWithdrawn": Anonymize<I1hd2l2dfhk11i>;
}>;
export type I5el2hvlofnvv5 = {
    "client_id": number;
    "location": Anonymize<If9iqq7i64mur8>;
    "bond_owner": SS58String;
    "bond": bigint;
    "sub_id_policy": Anonymize<I8jh0enk7f0r9l>;
};
export type I8jh0enk7f0r9l = AnonymousEnum<{
    "Optional": undefined;
    "Required": undefined;
}>;
export type Ibqi69m3s38lo0 = {
    "client_id": number;
    "local_signer": SS58String;
    "bond_owner": SS58String;
    "bond": bigint;
    "sub_id_policy": Anonymize<I8jh0enk7f0r9l>;
};
export type I6ctvd5gvtboll = {
    "client_id": number;
    "questions_live": number;
};
export type Ierkp6g0vn9ojj = {
    "client_id": number;
    "bond_owner": SS58String;
    "bond_released": bigint;
};
export type I1srp17os6n92p = {
    "client_id": number;
    "beneficiary": SS58String;
    "amount": bigint;
    "delivery_float_remaining": bigint;
};
export type I1hd2l2dfhk11i = {
    "client_id": number;
    "amount": bigint;
    "delivery_float": bigint;
};
export type Iftu3nng0chq4r = AnonymousEnum<{
    "QuestionRegistered": Anonymize<Idrd3fp3ciqt4f>;
    "QuestionSealed": Anonymize<I15300qnq5mpkt>;
    "QuestionSettled": Anonymize<I7n5sdbabu8l7g>;
    "QuestionVoided": Anonymize<I689heiuu575e6>;
    "AttestorBonded": Anonymize<I6v9f8qobgk41i>;
    "AttestationSubmitted": Anonymize<Ie4auh3nmut3h7>;
    "ServicePauseSet": Anonymize<I20e9ph536u7ti>;
    "ServicePauseCleared": undefined;
    "QuestionArchived": Anonymize<Ielk7f0jb1jt1u>;
}>;
export type Idrd3fp3ciqt4f = {
    "question_id": bigint;
    "client_id": number;
    "window_end": number;
};
export type I15300qnq5mpkt = {
    "question_id": bigint;
    "provenance_hash": SizedHex<32>;
};
export type I7n5sdbabu8l7g = {
    "question_id": bigint;
    "value_1e9": bigint;
};
export type I689heiuu575e6 = {
    "question_id": bigint;
    "reason": Enum<{
        "NoQuorum": undefined;
        "MedianOutOfRange": undefined;
        "DeadlineMissed": undefined;
        "ServicePaused": undefined;
        "EscrowInsufficient": undefined;
        "AttestorSetCollapsed": undefined;
        "ClientUnreachable": undefined;
    }>;
};
export type I6v9f8qobgk41i = {
    "question_id": bigint;
    "attestor": SS58String;
    "amount": bigint;
};
export type Ie4auh3nmut3h7 = {
    "question_id": bigint;
    "attestor": SS58String;
    "value_1e9": bigint;
};
export type Ielk7f0jb1jt1u = {
    "question_id": bigint;
};
export type Ic5m5lp1oioo8r = Array<SizedHex<32>>;
export type I95g6i7ilua7lq = Array<Anonymize<I9jd27rnpm8ttv>>;
export type Ieniouoqkq4icf = {
    "spec_version": number;
    "spec_name": string;
};
export type I8re9183nrhr3n = AnonymousEnum<{
    "FullCore": {
        "context": number;
    };
    "PotentialFullCore": {
        "context": number;
        "first_transaction_index"?: Anonymize<I4arjljr6dpflb>;
        "target_weight": Anonymize<I4q39t5hn830vp>;
    };
    "FractionOfCore": {
        "context": number;
        "first_transaction_index"?: Anonymize<I4arjljr6dpflb>;
    };
}>;
export type I1v7jbnil3tjns = Array<{
    "used_bandwidth": Anonymize<Ieafp1gui1o4cl>;
    "para_head_hash"?: Anonymize<I4s6vifaf8k998>;
    "consumed_go_ahead_signal"?: Anonymize<Iav8k1edbj86k7>;
}>;
export type Ieafp1gui1o4cl = {
    "ump_msg_count": number;
    "ump_total_bytes": number;
    "hrmp_outgoing": Array<[number, {
        "msg_count": number;
        "total_bytes": number;
    }]>;
};
export type Iav8k1edbj86k7 = (UpgradeGoAhead) | undefined;
export type UpgradeGoAhead = Enum<{
    "Abort": undefined;
    "GoAhead": undefined;
}>;
export declare const UpgradeGoAhead: GetEnum<UpgradeGoAhead>;
export type I8jgj1nhcr2dg8 = {
    "used_bandwidth": Anonymize<Ieafp1gui1o4cl>;
    "hrmp_watermark"?: Anonymize<I4arjljr6dpflb>;
    "consumed_go_ahead_signal"?: Anonymize<Iav8k1edbj86k7>;
};
export type Ifn6q3equiq9qi = {
    "parent_head": Uint8Array;
    "relay_parent_number": number;
    "relay_parent_storage_root": SizedHex<32>;
    "max_pov_size": number;
};
export type Ia3sb0vgvovhtg = (UpgradeRestriction) | undefined;
export type UpgradeRestriction = Enum<{
    "Present": undefined;
}>;
export declare const UpgradeRestriction: GetEnum<UpgradeRestriction>;
export type Itom7fk49o0c9 = Array<Uint8Array>;
export type I4i91h98n3cv1b = {
    "dmq_mqc_head": SizedHex<32>;
    "relay_dispatch_queue_remaining_capacity": {
        "remaining_count": number;
        "remaining_size": number;
    };
    "ingress_channels": Array<[number, {
        "max_capacity": number;
        "max_total_size": number;
        "max_message_size": number;
        "msg_count": number;
        "total_size": number;
        "mqc_head"?: Anonymize<I4s6vifaf8k998>;
    }]>;
    "egress_channels": Array<[number, {
        "max_capacity": number;
        "max_total_size": number;
        "max_message_size": number;
        "msg_count": number;
        "total_size": number;
        "mqc_head"?: Anonymize<I4s6vifaf8k998>;
    }]>;
};
export type I4iumukclgj8ej = {
    "max_code_size": number;
    "max_head_data_size": number;
    "max_upward_queue_count": number;
    "max_upward_queue_size": number;
    "max_upward_message_size": number;
    "max_upward_message_num_per_candidate": number;
    "hrmp_max_message_num_per_candidate": number;
    "validation_upgrade_cooldown": number;
    "validation_upgrade_delay": number;
    "async_backing_params": {
        "max_candidate_depth": number;
        "allowed_ancestry_len": number;
    };
};
export type Iqnbvitf7a7l3 = Array<Anonymize<I4p5t2krb1gmvp>>;
export type I4p5t2krb1gmvp = [number, SizedHex<32>];
export type I48i407regf59r = {
    "sent_at": number;
    "reverse_idx": number;
};
export type I6r5cbv8ttrb09 = Array<{
    "recipient": number;
    "data": Uint8Array;
}>;
export type Inofn0qqbjtb9 = {
    "relay_storage_root_or_hash": SizedHex<32>;
    "core_selector": number;
    "bundle_index": number;
    "ump_msg_count": number;
    "hrmp_outbound_count": number;
    "hrmp_outbound_recipients": Anonymize<Icgljjb6j82uhn>;
};
export type I8ds64oj6581v0 = Array<{
    "id": SizedHex<8>;
    "amount": bigint;
    "reasons": BalancesTypesReasons;
}>;
export type BalancesTypesReasons = Enum<{
    "Fee": undefined;
    "Misc": undefined;
    "All": undefined;
}>;
export declare const BalancesTypesReasons: GetEnum<BalancesTypesReasons>;
export type Ia7pdug7cdsg8g = Array<{
    "id": SizedHex<8>;
    "amount": bigint;
}>;
export type Ifnu5trqcrgt5b = Array<{
    "id": Anonymize<Iau1paeqrbp4gi>;
    "amount": bigint;
}>;
export type I9bin2jc70qt6q = Array<Anonymize<I3qt1hgg4djhgb>>;
export type I3qklfjubrljqh = {
    "owner": SS58String;
    "issuer": SS58String;
    "admin": SS58String;
    "freezer": SS58String;
    "supply": bigint;
    "deposit": bigint;
    "min_balance": bigint;
    "is_sufficient": boolean;
    "accounts": number;
    "sufficients": number;
    "approvals": number;
    "status": Enum<{
        "Live": undefined;
        "Frozen": undefined;
        "Destroying": undefined;
    }>;
};
export type Iag3f1hum3p4c8 = {
    "balance": bigint;
    "status": Enum<{
        "Liquid": undefined;
        "Frozen": undefined;
        "Blocked": undefined;
    }>;
    "reason": Enum<{
        "Consumer": undefined;
        "Sufficient": undefined;
        "DepositHeld": bigint;
        "DepositRefunded": undefined;
        "DepositFrom": Anonymize<I95l2k9b1re95f>;
    }>;
};
export type I95l2k9b1re95f = [SS58String, bigint];
export type I4v5g6i7bmt06o = [Anonymize<If9iqq7i64mur8>, SS58String];
export type I4s6jkha20aoh0 = {
    "amount": bigint;
    "deposit": bigint;
};
export type I84bhscllvv07n = [Anonymize<If9iqq7i64mur8>, SS58String, SS58String];
export type I78s05f59eoi8b = {
    "deposit": bigint;
    "name": Uint8Array;
    "symbol": Uint8Array;
    "decimals": number;
    "is_frozen": boolean;
};
export type TransactionPaymentReleases = Enum<{
    "V1Ancient": undefined;
    "V2": undefined;
}>;
export declare const TransactionPaymentReleases: GetEnum<TransactionPaymentReleases>;
export type Ifble4juuml5ig = Array<Anonymize<I4aro1m78pdrtt>>;
export type I4aro1m78pdrtt = {
    "locked": bigint;
    "per_block": bigint;
    "starting_block": number;
};
export type Version = Enum<{
    "V0": undefined;
    "V1": undefined;
}>;
export declare const Version: GetEnum<Version>;
export type Ida3u2t8t1l1js = AnonymousEnum<{
    "Ongoing": {
        "track": number;
        "origin": Anonymize<I8rf10c1lb823v>;
        "proposal": PreimagesBounded;
        "enactment": TraitsScheduleDispatchTime;
        "submitted": number;
        "submission_deposit": Anonymize<Id5fm4p8lj5qgi>;
        "decision_deposit"?: Anonymize<Ibd24caul84kv2>;
        "deciding"?: ({
            "since": number;
            "confirming"?: Anonymize<I4arjljr6dpflb>;
        }) | undefined;
        "tally": Anonymize<Ifsk7cbmtit1jd>;
        "in_queue": boolean;
        "alarm"?: ([number, Anonymize<I9jd27rnpm8ttv>]) | undefined;
    };
    "Approved": [number, Anonymize<Ibd24caul84kv2>, Anonymize<Ibd24caul84kv2>];
    "Rejected": [number, Anonymize<Ibd24caul84kv2>, Anonymize<Ibd24caul84kv2>];
    "Cancelled": [number, Anonymize<Ibd24caul84kv2>, Anonymize<Ibd24caul84kv2>];
    "TimedOut": [number, Anonymize<Ibd24caul84kv2>, Anonymize<Ibd24caul84kv2>];
    "Killed": number;
}>;
export type I8rf10c1lb823v = AnonymousEnum<{
    "system": Enum<{
        "Root": undefined;
        "Signed": SS58String;
        "None": undefined;
        "Authorized": undefined;
    }>;
    "CumulusXcm": Enum<{
        "Relay": undefined;
        "SiblingParachain": number;
    }>;
    "PolkadotXcm": Enum<{
        "Xcm": Anonymize<If9iqq7i64mur8>;
        "Response": Anonymize<If9iqq7i64mur8>;
    }>;
    "Origins": Enum<{
        "FutarchyParam": undefined;
        "FutarchyTreasury": undefined;
        "FutarchyCode": undefined;
        "FutarchyMeta": undefined;
        "ConstitutionalValues": undefined;
        "OracleResolution": undefined;
        "GuardianHold": undefined;
        "EmergencyPlaybook": undefined;
    }>;
    "TrackOrigins": Enum<{
        "Metric": undefined;
        "Constitution": undefined;
        "Entrenched": undefined;
        "GuardianTrack": undefined;
        "Ratify": undefined;
    }>;
    "ClientRegistry": Enum<{
        "ExternalClient": number;
    }>;
}>;
export type TraitsScheduleDispatchTime = Enum<{
    "At": number;
    "After": number;
}>;
export declare const TraitsScheduleDispatchTime: GetEnum<TraitsScheduleDispatchTime>;
export type Ibd24caul84kv2 = (Anonymize<Id5fm4p8lj5qgi>) | undefined;
export type If9jidduiuq7vv = Array<Anonymize<I4ojmnsk1dchql>>;
export type I4ojmnsk1dchql = [number, bigint];
export type ConvictionVotingVoteVoting = Enum<{
    "Casting": {
        "votes": Array<[number, ConvictionVotingVoteAccountVote]>;
        "delegations": Anonymize<I538qha8r4j3ii>;
        "prior": Anonymize<I4ojmnsk1dchql>;
    };
    "Delegating": {
        "balance": bigint;
        "target": SS58String;
        "conviction": VotingConviction;
        "delegations": Anonymize<I538qha8r4j3ii>;
        "prior": Anonymize<I4ojmnsk1dchql>;
    };
}>;
export declare const ConvictionVotingVoteVoting: GetEnum<ConvictionVotingVoteVoting>;
export type I538qha8r4j3ii = {
    "votes": bigint;
    "capital": bigint;
};
export type VotingConviction = Enum<{
    "None": undefined;
    "Locked1x": undefined;
    "Locked2x": undefined;
    "Locked3x": undefined;
    "Locked4x": undefined;
    "Locked5x": undefined;
    "Locked6x": undefined;
}>;
export declare const VotingConviction: GetEnum<VotingConviction>;
export type PreimageOldRequestStatus = Enum<{
    "Unrequested": {
        "deposit": Anonymize<I95l2k9b1re95f>;
        "len": number;
    };
    "Requested": {
        "deposit"?: Anonymize<I92hdo1clkbp4g>;
        "count": number;
        "len"?: Anonymize<I4arjljr6dpflb>;
    };
}>;
export declare const PreimageOldRequestStatus: GetEnum<PreimageOldRequestStatus>;
export type I92hdo1clkbp4g = (Anonymize<I95l2k9b1re95f>) | undefined;
export type PreimageRequestStatus = Enum<{
    "Unrequested": {
        "ticket": Anonymize<I95l2k9b1re95f>;
        "len": number;
    };
    "Requested": {
        "maybe_ticket"?: Anonymize<I92hdo1clkbp4g>;
        "count": number;
        "maybe_len"?: Anonymize<I4arjljr6dpflb>;
    };
}>;
export declare const PreimageRequestStatus: GetEnum<PreimageRequestStatus>;
export type I4pact7n2e9a0i = [SizedHex<32>, number];
export type Ifh9leie5rtseb = Array<({
    "maybe_id"?: Anonymize<I4s6vifaf8k998>;
    "priority": number;
    "call": PreimagesBounded;
    "maybe_periodic"?: Anonymize<Iep7au1720bm0e>;
    "origin": Anonymize<I8rf10c1lb823v>;
}) | undefined>;
export type Iep7au1720bm0e = (Anonymize<I9jd27rnpm8ttv>) | undefined;
export type I56u24ncejr5kt = {
    "total_retries": number;
    "remaining": number;
    "period": number;
};
export type I775lbh1002e7f = [Array<{
    "delegate": SS58String;
    "proxy_type": Anonymize<Icqldr8j4je7f4>;
    "delay": number;
}>, bigint];
export type I9p9lq3rej5bhc = [Array<{
    "real": SS58String;
    "call_hash": SizedHex<32>;
    "height": number;
}>, bigint];
export type Iag146hmjgqfgj = {
    "when": Anonymize<Itvprrpb0nm3o>;
    "deposit": bigint;
    "depositor": SS58String;
    "approvals": Anonymize<Ia2lhg7l2hilo3>;
};
export type I8uo3fpd3bcc6f = [SS58String, SizedHex<32>];
export type Iepbsvlk3qceij = AnonymousEnum<{
    "Active": {
        "index": number;
        "inner_cursor"?: Anonymize<Iabpgqcjikia83>;
        "started_at": number;
    };
    "Stuck": undefined;
}>;
export type I5mpbmq1ooiq9i = Array<{
    "recipient": number;
    "state": Enum<{
        "Ok": undefined;
        "Suspended": undefined;
    }>;
    "signals_exist": boolean;
    "first_index": number;
    "last_index": number;
    "flags": number;
    "queued_bytes": number;
}>;
export type I5g2vv0ckl2m8b = [number, number];
export type Ifup3lg9ro8a0f = {
    "suspend_threshold": number;
    "drop_threshold": number;
    "resume_threshold": number;
};
export type Idh2ug6ou4a8og = {
    "begin": number;
    "end": number;
    "count": number;
    "ready_neighbours"?: ({
        "prev": Anonymize<Iejeo53sea6n4q>;
        "next": Anonymize<Iejeo53sea6n4q>;
    }) | undefined;
    "message_count": bigint;
    "size": bigint;
};
export type I53esa2ms463bk = {
    "remaining": number;
    "remaining_size": number;
    "first_index": number;
    "first": number;
    "last": number;
    "heap": Uint8Array;
};
export type Ib4jhb8tt3uung = [Anonymize<Iejeo53sea6n4q>, number];
export type I5qfubnuvrnqn6 = AnonymousEnum<{
    "Pending": {
        "responder": XcmVersionedLocation;
        "maybe_match_querier"?: (XcmVersionedLocation) | undefined;
        "maybe_notify"?: (SizedHex<2>) | undefined;
        "timeout": number;
    };
    "VersionNotifier": {
        "origin": XcmVersionedLocation;
        "is_active": boolean;
    };
    "Ready": {
        "response": Enum<{
            "V3": XcmV3Response;
            "V4": XcmV4Response;
            "V5": Anonymize<I7vucpgm2c6959>;
        }>;
        "at": number;
    };
}>;
export type XcmV3Response = Enum<{
    "Null": undefined;
    "Assets": Anonymize<Iai6dhqiq3bach>;
    "ExecutionResult"?: Anonymize<I7sltvf8v2nure>;
    "Version": number;
    "PalletsInfo": Anonymize<I599u7h20b52at>;
    "DispatchResult": XcmV3MaybeErrorCode;
}>;
export declare const XcmV3Response: GetEnum<XcmV3Response>;
export type I7sltvf8v2nure = ([number, XcmV3TraitsError]) | undefined;
export type XcmV3TraitsError = Enum<{
    "Overflow": undefined;
    "Unimplemented": undefined;
    "UntrustedReserveLocation": undefined;
    "UntrustedTeleportLocation": undefined;
    "LocationFull": undefined;
    "LocationNotInvertible": undefined;
    "BadOrigin": undefined;
    "InvalidLocation": undefined;
    "AssetNotFound": undefined;
    "FailedToTransactAsset": undefined;
    "NotWithdrawable": undefined;
    "LocationCannotHold": undefined;
    "ExceedsMaxMessageSize": undefined;
    "DestinationUnsupported": undefined;
    "Transport": undefined;
    "Unroutable": undefined;
    "UnknownClaim": undefined;
    "FailedToDecode": undefined;
    "MaxWeightInvalid": undefined;
    "NotHoldingFees": undefined;
    "TooExpensive": undefined;
    "Trap": bigint;
    "ExpectationFalse": undefined;
    "PalletNotFound": undefined;
    "NameMismatch": undefined;
    "VersionIncompatible": undefined;
    "HoldingWouldOverflow": undefined;
    "ExportError": undefined;
    "ReanchorFailed": undefined;
    "NoDeal": undefined;
    "FeesNotMet": undefined;
    "LockError": undefined;
    "NoPermission": undefined;
    "Unanchored": undefined;
    "NotDepositable": undefined;
    "UnhandledXcmVersion": undefined;
    "WeightLimitReached": Anonymize<I4q39t5hn830vp>;
    "Barrier": undefined;
    "WeightNotComputable": undefined;
    "ExceedsStackLimit": undefined;
}>;
export declare const XcmV3TraitsError: GetEnum<XcmV3TraitsError>;
export type XcmV4Response = Enum<{
    "Null": undefined;
    "Assets": Anonymize<I50mli3hb64f9b>;
    "ExecutionResult"?: Anonymize<I7sltvf8v2nure>;
    "Version": number;
    "PalletsInfo": Anonymize<I599u7h20b52at>;
    "DispatchResult": XcmV3MaybeErrorCode;
}>;
export declare const XcmV4Response: GetEnum<XcmV4Response>;
export type I8t3u2dv73ahbd = [number, XcmVersionedLocation];
export type I7vlvrrl2pnbgk = [bigint, Anonymize<I4q39t5hn830vp>, number];
export type Ie0rpl5bahldfk = Array<[XcmVersionedLocation, number]>;
export type XcmPalletVersionMigrationStage = Enum<{
    "MigrateSupportedVersion": undefined;
    "MigrateVersionNotifiers": undefined;
    "NotifyCurrentTargets"?: Anonymize<Iabpgqcjikia83>;
    "MigrateAndNotifyOldTargets": undefined;
}>;
export declare const XcmPalletVersionMigrationStage: GetEnum<XcmPalletVersionMigrationStage>;
export type I7e5oaj2qi4kl1 = {
    "amount": bigint;
    "owner": XcmVersionedLocation;
    "locker": XcmVersionedLocation;
    "consumers": Array<[undefined, bigint]>;
};
export type Ie849h3gncgvok = [number, SS58String, XcmVersionedAssetId];
export type XcmVersionedAssetId = Enum<{
    "V3": XcmV3MultiassetAssetId;
    "V4": Anonymize<I4c0s5cioidn76>;
    "V5": Anonymize<If9iqq7i64mur8>;
}>;
export declare const XcmVersionedAssetId: GetEnum<XcmVersionedAssetId>;
export type Iat62vud7hlod2 = Array<[bigint, XcmVersionedLocation]>;
export type Ici7ejds60vj52 = {
    "aliasers": Array<{
        "location": XcmVersionedLocation;
        "expiry"?: Anonymize<I35p85j063s0il>;
    }>;
};
export type Ifi4da1gej1fri = Array<{
    "who": SS58String;
    "deposit": bigint;
}>;
export type Ifvgo9568rpmqc = Array<Anonymize<I8uo3fpd3bcc6f>>;
export type I6cs1itejju2vv = [bigint, number];
export type I19osbbvcedbnc = {
    "key": SizedHex<16>;
    "value": Anonymize<I9cr49fg6lsgds>;
    "min": Anonymize<I9cr49fg6lsgds>;
    "max": Anonymize<I9cr49fg6lsgds>;
    "max_delta"?: Anonymize<Ilmmn5jfnups3>;
    "cooldown_epochs": number;
    "last_changed_epoch": number;
    "last_change_block": number;
    "class": Enum<{
        "Param": undefined;
        "Treasury": undefined;
        "Meta": undefined;
        "Const": undefined;
        "Entrenched": undefined;
        "MetaAndValues": undefined;
    }>;
    "kernel_bounded": boolean;
};
export type Ilmmn5jfnups3 = (Enum<{
    "Absolute": Anonymize<I9cr49fg6lsgds>;
    "Percent": number;
    "Factor": number;
}>) | undefined;
export type Iapa0pspj5na3t = Array<{
    "limit": bigint;
    "spent": bigint;
    "reset_epoch": number;
}>;
export type I5ebvuao287pjg = Array<Anonymize<I8i1bk7kj5k5ed>>;
export type I71v2rrt182hod = {
    "escrowed": bigint;
    "branches": FixedSizeArray<2, {
        "usdc": bigint;
        "scalar_sets": bigint;
        "gate_sets": Anonymize<I200n1ov5tbcvr>;
    }>;
    "state": Anonymize<I2i509mmosaj3i>;
    "gate_outcomes": FixedSizeArray<2, (boolean) | undefined>;
    "spec": number;
};
export type I200n1ov5tbcvr = FixedSizeArray<2, bigint>;
export type I2i509mmosaj3i = AnonymousEnum<{
    "Open": undefined;
    "Resolved": Anonymize<Iefmskl524g3a7>;
    "ScalarSettled": {
        "winner": Anonymize<Iefmskl524g3a7>;
        "s": bigint;
    };
    "Voided": undefined;
    "BaselineSettled": {
        "s": bigint;
    };
}>;
export type Ia03hjl5um8umc = {
    "escrowed": bigint;
    "sets": bigint;
    "state": Enum<{
        "Open": undefined;
        "Settled": bigint;
    }>;
};
export type I1bd4sfsts9lp2 = [Anonymize<I5m1k92kcp4o6d>, SS58String];
export type Ifkob0fdn3eods = {
    "liability": bigint;
    "custody": bigint;
    "at": number;
};
export type I1ai0vm56bl7eu = {
    "id": bigint;
    "kind": Enum<{
        "Decision": {
            "proposal": bigint;
            "branch": Anonymize<Iefmskl524g3a7>;
        };
        "Gate": {
            "proposal": bigint;
            "branch": Anonymize<Iefmskl524g3a7>;
            "gate": Anonymize<I5mifn3r4bq1hg>;
        };
        "Baseline": Anonymize<I36p2bgnnl36ta>;
        "External": {
            "question": bigint;
            "client": number;
            "branch": Anonymize<Iefmskl524g3a7>;
        };
    }>;
    "phase": Enum<{
        "Trading": undefined;
        "Extended": undefined;
        "Closed": undefined;
        "Settled": undefined;
    }>;
    "account": SS58String;
    "fees_account": SS58String;
    "b": bigint;
    "q_long": bigint;
    "q_short": bigint;
    "fees_accrued": bigint;
    "last_quote_1e9": bigint;
    "last_observation_1e9": bigint;
    "last_observed_block": bigint;
    "cumulative_price_blocks": Anonymize<I9ip03eo086nba>;
    "stale_events": number;
};
export type I9ip03eo086nba = {
    "hi": bigint;
    "lo": bigint;
};
export type I7aij5ls86nd9l = {
    "client": number;
    "funder": SS58String;
    "accept": bigint;
    "reject": bigint;
};
export type I3hg4c9ge064lf = Array<[number, Anonymize<I9ip03eo086nba>]>;
export type Iej87d0l2agljs = Array<{
    "start": number;
    "trailing_start": number;
    "end": number;
    "observations": number;
    "stale_events": number;
    "contest_capital_blocks": bigint;
    "contest_accrued_until": number;
    "contest_valid": boolean;
    "close_spot"?: Anonymize<I35p85j063s0il>;
    "sealed": boolean;
}>;
export type Ifr88cshss4mco = Array<[bigint, number, number, number]>;
export type I3qulnvnc3hn00 = Array<[bigint, bigint]>;
export type Iept8gvj9an6pj = Array<{
    "id": number;
    "version": number;
    "pillar": Enum<{
        "S": undefined;
        "COnchain": undefined;
        "CAttested": undefined;
        "P": undefined;
        "A": undefined;
    }>;
    "weight": bigint;
    "epsilon_floor": bigint;
    "activation_epoch": number;
    "source": Enum<{
        "Onchain": undefined;
        "RelayDerived": undefined;
        "Attested": undefined;
    }>;
    "formula_ref": SizedHex<32>;
    "units": SizedHex<16>;
    "repr": SizedHex<16>;
    "cadence_blocks": number;
    "sanity_min": bigint;
    "sanity_max": bigint;
    "has_normalization_rule": boolean;
    "has_missing_data_rule": boolean;
    "has_gaming_vectors": boolean;
    "has_challenge_procedure": boolean;
    "prior_bounds": FixedSizeArray<12, bigint>;
    "target": number;
    "delta_s_max_bps": number;
}>;
export type I3ge8l11mhestc = {
    "epoch": number;
    "spec_version": number;
    "s_pillar": bigint;
    "c_onchain": bigint;
    "c_attested": bigint;
    "p_pillar": bigint;
    "a_pillar": bigint;
    "gate_s": bigint;
    "gate_c": bigint;
    "welfare": bigint;
    "components": Array<{
        "id": number;
        "value": bigint;
    }>;
};
export type I4qqej82rtmcsa = {
    "epoch": number;
    "spec_version": number;
    "flagged": Anonymize<Icgljjb6j82uhn>;
    "incident_multiplier": bigint;
    "params": {
        "theta_s_lo": bigint;
        "theta_s_hi": bigint;
        "theta_c_lo": bigint;
        "theta_c_hi": bigint;
        "w_p": bigint;
        "w_a": bigint;
    };
};
export type I8el4qiut1afl1 = {
    "last_snapshot_epoch"?: Anonymize<I4arjljr6dpflb>;
    "due_epoch": number;
};
export type I2o134i87sa348 = {
    "s_breached": boolean;
    "c_breached": boolean;
    "day_bitmap": Anonymize<I9jd27rnpm8ttv>;
};
export type I9v1nr5t25p3gu = {
    "accepted": bigint;
    "failed": bigint;
    "probe_timeouts": bigint;
};
export type Ij23g2682mtlh = {
    "authors": Anonymize<I205qrookusi3d>;
    "truncated": boolean;
};
export type I205qrookusi3d = Array<Anonymize<I6ouflveob4eli>>;
export type Ib65ekpdoa117u = {
    "non_empty_blocks": bigint;
    "empty_blocks": bigint;
    "relay_slots": bigint;
};
export type Ic9m8l8pkrt2k5 = {
    "utilization_sum": bigint;
    "blocks": number;
};
export type Idjevvptm6gjaq = {
    "block": number;
    "primary_used": Anonymize<I4q39t5hn830vp>;
    "external_used": Anonymize<I4q39t5hn830vp>;
};
export type Id9gm4bteop71s = {
    "stake": bigint;
    "registered_at": number;
    "offenses": number;
};
export type Ibk7vl3nqtkvjq = {
    "stake": bigint;
    "registered_at": number;
    "inactive_epochs": number;
};
export type I25if6a41d56ra = {
    "component": number;
    "epoch": number;
    "round": number;
    "spec_version": number;
    "reporter": SizedHex<32>;
    "value": bigint;
    "evidence_hash": SizedHex<32>;
    "bond": bigint;
    "challenge_deadline": number;
    "extended": boolean;
    "challenger"?: Anonymize<I4s6vifaf8k998>;
    "counter_value"?: Anonymize<I35p85j063s0il>;
    "acks": number;
    "report_hash": SizedHex<32>;
    "stake_at_risk": bigint;
    "cumulative_reporter_bond": bigint;
    "cumulative_challenger_bond": bigint;
};
export type Icj2nb69liuu24 = [number, number, number];
export type Icm9f9h6nua3dd = {
    "round_one_bond": bigint;
    "round_cap": number;
};
export type I8hs8cgiei54sv = {
    "value": bigint;
    "path": Anonymize<I6as7fe022sv9h>;
    "flagged": boolean;
};
export type I43pkljl3a50rq = {
    "consecutive_fails": number;
    "consecutive_passes": number;
    "unhealthy": boolean;
    "last_query_id": bigint;
    "last_probe_at": number;
    "pending_since"?: Anonymize<I4arjljr6dpflb>;
};
export type Ic7ihfq9tebase = Array<[number, number, number, number, SizedHex<32>, SizedHex<32>]>;
export type Ia78sqv46skudk = Array<[{
    "component": number;
    "epoch": number;
    "spec_version": number;
}, number]>;
export type I8kuj5ij9r87hi = Array<{
    "account": SizedHex<32>;
    "offenses": number;
    "ejected": boolean;
}>;
export type Ieupfkt3mtrjlc = {
    "who": SizedHex<32>;
    "class": Anonymize<I8mm8h51ml90lv>;
    "points": number;
    "evidence_hash": SizedHex<32>;
    "bond": bigint;
    "state": Enum<{
        "Filed": {
            "window_end": number;
            "extended": boolean;
            "acks": number;
        };
        "Challenged": {
            "round": number;
            "window_end": number;
            "challenger": SizedHex<32>;
            "evidence_hash": SizedHex<32>;
        };
        "Upheld": undefined;
        "Rejected": undefined;
    }>;
    "spec_version": number;
};
export type I5eoome1iv99mc = [number, number, SizedHex<32>];
export type Ifs8l7uhm2p84a = {
    "main_usdc": bigint;
    "vit_supply": bigint;
    "reserve_impaired": boolean;
    "lines": Array<[Anonymize<Iesceati3hrhp6>, bigint]>;
    "streams": Array<{
        "id": bigint;
        "recipient": SizedHex<32>;
        "line": Anonymize<Iesceati3hrhp6>;
        "total": bigint;
        "claimed": bigint;
        "start": number;
        "duration": number;
        "cancelled": boolean;
    }>;
    "pending_outflows": Anonymize<Iafqnechp3omqg>;
    "pol_commitments": Anonymize<Iafqnechp3omqg>;
    "meter_30d": {
        "limit_bps": number;
        "buckets": FixedSizeArray<31, bigint>;
        "last_day": number;
    };
    "meter_180d": {
        "limit_bps": number;
        "buckets": FixedSizeArray<181, bigint>;
        "last_day": number;
    };
    "issuance": {
        "limit_bps": number;
        "buckets": FixedSizeArray<366, bigint>;
        "last_day": number;
    };
    "next_stream_id": bigint;
    "vit_lines": Array<[Anonymize<Iesceati3hrhp6>, bigint]>;
    "funded_coretime_periods": Anonymize<Icgljjb6j82uhn>;
    "coretime_quotes": Array<{
        "period_index": number;
        "price": bigint;
        "noted_at": bigint;
    }>;
    "keeper_meter": {
        "epoch": number;
        "spent": bigint;
        "general_spent": bigint;
        "low_emitted": boolean;
        "exhausted_emitted": boolean;
    };
};
export type Itdvhihql560g = FixedSizeArray<7, Anonymize<I4s6vifaf8k998>>;
export type I3fphkj3rkb8d1 = FixedSizeArray<7, bigint>;
export type Ie358p6da7iusl = Array<{
    "id": number;
    "proposer": SizedHex<32>;
    "power": Anonymize<I5ae66jaqfj2lj>;
    "justification_hash": SizedHex<32>;
    "created_at": number;
    "expires_at": number;
    "dispatched": boolean;
}>;
export type I3i3q11ol0f2a8 = Array<{
    "action_id": number;
    "deadline_epoch": number;
    "ratified": boolean;
    "recall_scheduled": boolean;
    "approvers": Anonymize<I3r4fumh7b1a2n>;
    "approver_count": number;
}>;
export type I3r4fumh7b1a2n = FixedSizeArray<7, SizedHex<32>>;
export type Iihcv2ffgfdth = Array<{
    "id": Anonymize<I5ss06mick4shb>;
    "expiry": number;
    "renewals_used": number;
}>;
export type I3a0nip7t7d0i7 = {
    "delay_used_this_epoch": number;
    "force_rerun_used_this_epoch": number;
    "pause_window_start": number;
    "pause_used_in_window": number;
};
export type I67b4evvsj5s3g = {
    "referendum": number;
    "approvers": Anonymize<I3r4fumh7b1a2n>;
    "approver_count": number;
    "obligations": Anonymize<I3fphkj3rkb8d1>;
    "slices": Anonymize<I3fphkj3rkb8d1>;
};
export type Ifolljjjlhmesh = Array<{
    "who": SS58String;
    "amount": bigint;
    "release_epoch": number;
}>;
export type I342jcra5dcalu = {
    "approvers": Anonymize<I3r4fumh7b1a2n>;
    "approver_count": number;
    "failed_epoch": number;
    "recall_referendum"?: Anonymize<I4arjljr6dpflb>;
};
export type I6lfe132so20ih = Array<{
    "account": SizedHex<32>;
    "bond": bigint;
    "false_count": number;
    "active": boolean;
}>;
export type It5jnbkpi46a7 = Array<{
    "id": number;
    "pid": bigint;
    "artifact_hash": SizedHex<32>;
    "statement_hash": SizedHex<32>;
    "attestor": SizedHex<32>;
    "submitted_at": number;
    "challenge_deadline": number;
    "challenge"?: (Enum<{
        "Open": {
            "challenger": SizedHex<32>;
            "evidence_hash": SizedHex<32>;
            "bond": bigint;
        };
        "Upheld": undefined;
        "Rejected": undefined;
    }>) | undefined;
}>;
export type I7emrdrb8oc4do = Array<{
    "account": SizedHex<32>;
    "bond": bigint;
    "false_count": number;
    "ejected": boolean;
}>;
export type I4dcivh5duqno8 = Array<{
    "attestation_id": number;
    "pid": bigint;
    "attestor": SizedHex<32>;
    "cause_hash": SizedHex<32>;
}>;
export type Iflkot84bd90qk = {
    "id": bigint;
    "proposer": SS58String;
    "class": Anonymize<I2hfnh9jsghgur>;
    "state": Anonymize<I4jen3q60pp5qd>;
    "epoch": number;
    "submitted_at": number;
    "payload_hash": SizedHex<32>;
    "payload_len": number;
    "ask": bigint;
    "bond": bigint;
    "resources": Anonymize<Ia4mcm726srfom>;
    "metric_spec": number;
    "decide_at": number;
    "rerun": boolean;
    "extended": boolean;
    "delayed_once": boolean;
    "markets"?: ({
        "accept": bigint;
        "reject": bigint;
        "gates"?: Anonymize<Ic4rgfgksgmm3e>;
        "baseline": bigint;
    }) | undefined;
    "maturity"?: Anonymize<I4arjljr6dpflb>;
    "grace_end"?: Anonymize<I4arjljr6dpflb>;
    "version_constraint"?: (Anonymize<I8dfqph7nh6ls>) | undefined;
    "decision"?: (Anonymize<Id61ca3jqg9n5l>) | undefined;
    "funder": SS58String;
};
export type I4jen3q60pp5qd = AnonymousEnum<{
    "Submitted": undefined;
    "Screening": undefined;
    "Qualified": undefined;
    "Trading": undefined;
    "Extended": undefined;
    "Queued": undefined;
    "Suspended": undefined;
    "Rerun": undefined;
    "Rejected": Anonymize<Ibabj9dc2c6tv1>;
    "Executed": undefined;
    "FailedExecuted": undefined;
    "Measuring": undefined;
    "Settled": undefined;
    "Cancelled": undefined;
    "Expired": undefined;
}>;
export type Ia4mcm726srfom = Array<SizedHex<8>>;
export type Ic4rgfgksgmm3e = (Anonymize<I4totqt881mlti>) | undefined;
export type I4totqt881mlti = FixedSizeArray<4, bigint>;
export type I8dfqph7nh6ls = {
    "spec_name": Uint8Array;
    "spec_version": number;
};
export type Id61ca3jqg9n5l = AnonymousEnum<{
    "Adopt": undefined;
    "Reject": Anonymize<Ibabj9dc2c6tv1>;
    "Extend": undefined;
}>;
export type Ibphrfq348d9fn = {
    "index": number;
    "phase": Anonymize<Ia8er6i31jhjhd>;
    "phase_start_block": number;
};
export type Ia8er6i31jhjhd = AnonymousEnum<{
    "Intake": undefined;
    "Qualify": undefined;
    "Seed": undefined;
    "Trade": undefined;
    "Decide": undefined;
    "Review": undefined;
    "Execute": undefined;
    "Housekeeping": undefined;
}>;
export type I1qevohso20t15 = Array<{
    "epoch": number;
    "s_1e9": bigint;
    "baseline_twap_1e9": bigint;
    "proposals": Array<[bigint, Anonymize<I2hfnh9jsghgur>, Anonymize<Id61ca3jqg9n5l>]>;
    "voided": boolean;
    "settled_at": number;
}>;
export type I3dp098duidkfr = {
    "epoch": number;
    "proposals": Anonymize<Iafqnechp3omqg>;
    "status": Enum<{
        "Measuring": {
            "until_epoch": number;
        };
        "AwaitingOracle": undefined;
        "Settling": {
            "cursor": number;
        };
        "Settled": undefined;
        "Void": undefined;
    }>;
};
export type I6o17cn2677nom = {
    "epoch_start_block": number;
    "length": number;
    "next_length": number;
};
export type Ias91rflo6ebo5 = Array<{
    "index": number;
    "start": number;
    "length": number;
}>;
export type Idggr61fqjm503 = {
    "in_cap_prize"?: Anonymize<I35p85j063s0il>;
    "decision_delta"?: Anonymize<I35p85j063s0il>;
};
export type I8fhaue1ob9s7m = {
    "funder": SS58String;
    "held": bigint;
};
export type I9mj1qagqpte76 = Array<[SizedHex<8>, bigint]>;
export type I44n5hoqkdsljm = {
    "epoch": number;
    "epoch_start_block": number;
    "epoch_length": number;
    "decide_at": number;
    "metric_spec": number;
};
export type I7rilbfprtfgq9 = {
    "epoch": number;
    "creation_epoch_length": number;
    "measurement_until": number;
    "settlement_epoch": number;
    "specs": Anonymize<Ifip05kcrl65am>;
};
export type Ifip05kcrl65am = Array<Anonymize<I6cs1itejju2vv>>;
export type I7dp3d6kokg6qm = Array<[bigint, {
    "commitment": bigint;
    "decision_b": bigint;
    "gate_b"?: Anonymize<I35p85j063s0il>;
}]>;
export type I806t22dpi77ls = {
    "paused_at"?: Anonymize<I4arjljr6dpflb>;
    "recovery_epoch"?: Anonymize<I4arjljr6dpflb>;
};
export type Ib9hqqd0dq5sja = {
    "causes": number;
    "incident_active": boolean;
};
export type Icqilkshp1mtl = {
    "pid": bigint;
    "payload_hash": SizedHex<32>;
    "payload_len": number;
    "class": Anonymize<I2hfnh9jsghgur>;
    "maturity": number;
    "grace_end": number;
    "version_constraint": Anonymize<I8dfqph7nh6ls>;
    "meters_declared": Anonymize<Ia4mcm726srfom>;
    "ratify_ref"?: Anonymize<I4arjljr6dpflb>;
    "ratification_passed": boolean;
    "attestation_id"?: Anonymize<I4arjljr6dpflb>;
    "pre_upgrade_checkpoint"?: (FixedSizeArray<2, SizedHex<32>>) | undefined;
    "cancelled": boolean;
    "declared_domains": Array<Enum<{
        "Public": undefined;
        "Param": undefined;
        "Treasury": undefined;
        "Code": undefined;
        "Meta": undefined;
        "InternalRootAuthorizeUpgrade": undefined;
        "InternalRootApplyUpgrade": undefined;
    }>>;
    "failed_at"?: Anonymize<I4arjljr6dpflb>;
};
export type I2rc77s0mqdebl = {
    "referendum_index": number;
    "payload_hash": SizedHex<32>;
    "ratified_at": number;
};
export type I2uoo9t5ta92pd = Array<Anonymize<If3k3a7nmekc7r>>;
export type I2og4uv7220vja = {
    "hash": SizedHex<32>;
    "authorized_at": number;
    "applicable_at": number;
    "target_spec_version": number;
};
export type I60nr0tc614tgj = Array<[bigint, SizedHex<8>]>;
export type I5lf8t4evk0fq7 = {
    "pid": bigint;
    "primary_hash": SizedHex<32>;
    "hash": SizedHex<32>;
    "len": number;
    "target_spec_version": number;
    "attestation_id": number;
    "committed_at": number;
};
export type Ic23t0smeuk6mq = {
    "hash": SizedHex<32>;
    "len": number;
    "target_spec_version": number;
    "attestation_id": number;
};
export type Iacpni5fp46chb = {
    "payload_hash": SizedHex<32>;
    "primary_hash": SizedHex<32>;
    "version_constraint": Anonymize<I8dfqph7nh6ls>;
    "descriptor": Anonymize<Ic23t0smeuk6mq>;
};
export type Ie1r5megrresvn = {
    "pid": bigint;
    "primary_hash": SizedHex<32>;
    "primary_target_spec_version": number;
};
export type Icrbds76ujpbkg = AnonymousEnum<{
    "Unused": undefined;
    "Pending": {
        "pid": bigint;
        "code_hash": SizedHex<32>;
        "plan": {
            "tvl_cap": bigint;
            "deposit_cap": bigint;
        };
    };
    "Scheduled": {
        "pid": bigint;
        "code_hash": SizedHex<32>;
        "plan": {
            "tvl_cap": bigint;
            "deposit_cap": bigint;
        };
    };
    "Consumed": undefined;
}>;
export type Ifcik8ed7tl04e = {
    "location"?: Anonymize<I4pai6qnfk426l>;
    "local_signer"?: Anonymize<Ihfphjolmsqq1>;
    "bond": bigint;
    "admitted_at": number;
    "questions_live": number;
    "questions_total": number;
    "delivery_float": bigint;
};
export type Icu5tfrap3ledf = {
    "accepted_total": bigint;
    "last_seen": number;
    "report_pushes_total": bigint;
    "report_push_failures_total": bigint;
    "report_push_failures_consecutive": number;
};
export type I7jbmorihvfg1b = {
    "client_id": number;
    "phase": Enum<{
        "Registered": undefined;
        "Open": undefined;
        "Sealed": undefined;
        "Settled": undefined;
        "Voided": undefined;
    }>;
    "window_start": number;
    "window_end": number;
    "declared_stake": bigint;
    "epsilon_1e9": bigint;
    "tolerance_1e9": bigint;
    "markets": Anonymize<I200n1ov5tbcvr>;
};
export type I7tusvhvaa2qim = {
    "question_id": bigint;
    "client_id": number;
    "sub_id": SizedHex<32>;
    "twap_accept_1e9": bigint;
    "twap_reject_1e9": bigint;
    "observations": number;
    "window_start": number;
    "window_end": number;
    "b_accept": bigint;
    "b_reject": bigint;
    "manip_floor": bigint;
    "declared_stake": bigint;
    "epsilon_1e9": bigint;
    "tolerance_1e9": bigint;
    "certified": boolean;
    "settlement_trust": {
        "attestors": number;
        "quorum": number;
        "bond_total": bigint;
    };
    "provenance_hash": SizedHex<32>;
};
export type Iar9rrgd5eqf9n = {
    "sub_id": SizedHex<32>;
    "funder": SS58String;
    "rule": bigint;
    "b": bigint;
    "escrow": bigint;
    "fee": bigint;
    "bond_each": bigint;
    "oracle_window": number;
    "seal_deadline": number;
    "attestors": Anonymize<Ia2lhg7l2hilo3>;
    "winner"?: (Anonymize<Iefmskl524g3a7>) | undefined;
    "sealed_at"?: Anonymize<I4arjljr6dpflb>;
    "settlement_deadline"?: Anonymize<I4arjljr6dpflb>;
};
export type I96rqo4i9p11oo = [bigint, SS58String];
export type In7a38730s6qs = {
    "base_block": Anonymize<I4q39t5hn830vp>;
    "max_block": Anonymize<I4q39t5hn830vp>;
    "per_class": {
        "normal": {
            "base_extrinsic": Anonymize<I4q39t5hn830vp>;
            "max_extrinsic"?: Anonymize<Iasb8k6ash5mjn>;
            "max_total"?: Anonymize<Iasb8k6ash5mjn>;
            "reserved"?: Anonymize<Iasb8k6ash5mjn>;
        };
        "operational": {
            "base_extrinsic": Anonymize<I4q39t5hn830vp>;
            "max_extrinsic"?: Anonymize<Iasb8k6ash5mjn>;
            "max_total"?: Anonymize<Iasb8k6ash5mjn>;
            "reserved"?: Anonymize<Iasb8k6ash5mjn>;
        };
        "mandatory": {
            "base_extrinsic": Anonymize<I4q39t5hn830vp>;
            "max_extrinsic"?: Anonymize<Iasb8k6ash5mjn>;
            "max_total"?: Anonymize<Iasb8k6ash5mjn>;
            "reserved"?: Anonymize<Iasb8k6ash5mjn>;
        };
    };
};
export type Ibtil0ss5munbk = {
    "max": {
        "normal": number;
        "operational": number;
        "mandatory": number;
    };
    "max_header_size"?: Anonymize<I4arjljr6dpflb>;
};
export type I9s0ave7t0vnrk = {
    "read": bigint;
    "write": bigint;
};
export type I4fo08joqmcqnm = {
    "spec_name": string;
    "impl_name": string;
    "authoring_version": number;
    "spec_version": number;
    "impl_version": number;
    "apis": Array<[SizedHex<8>, number]>;
    "transaction_version": number;
    "system_version": number;
};
export type Ibafpkl9hhno69 = Array<[number, {
    "name": string;
    "max_deciding": number;
    "decision_deposit": bigint;
    "prepare_period": number;
    "decision_period": number;
    "confirm_period": number;
    "min_enactment_period": number;
    "min_approval": ReferendaTypesCurve;
    "min_support": ReferendaTypesCurve;
}]>;
export type ReferendaTypesCurve = Enum<{
    "LinearDecreasing": {
        "length": number;
        "floor": number;
        "ceil": number;
    };
    "SteppedDecreasing": {
        "begin": number;
        "end": number;
        "step": number;
        "period": number;
    };
    "Reciprocal": {
        "factor": bigint;
        "x_offset": bigint;
        "y_offset": bigint;
    };
}>;
export declare const ReferendaTypesCurve: GetEnum<ReferendaTypesCurve>;
export type I7rm113kjbo5gc = FixedSizeArray<7, Anonymize<I9jd27rnpm8ttv>>;
export type I5pbtpcshc7f67 = FixedSizeArray<4, number>;
export type Iekve0i6djpd9f = AnonymousEnum<{
    /**
     * Make some on-chain remark.
     *
     * Can be executed by every `origin`.
     */
    "remark": Anonymize<I8ofcg5rbj0g2c>;
    /**
     * Set the number of pages in the WebAssembly environment's heap.
     */
    "set_heap_pages": Anonymize<I4adgbll7gku4i>;
    /**
     * Set the new runtime code.
     */
    "set_code": Anonymize<I6pjjpfvhvcfru>;
    /**
     * Set the new runtime code without doing any checks of the given `code`.
     *
     * Note that runtime upgrades will not run if this is called with a not-increasing spec
     * version!
     */
    "set_code_without_checks": Anonymize<I6pjjpfvhvcfru>;
    /**
     * Set some items of storage.
     */
    "set_storage": Anonymize<I9pj91mj79qekl>;
    /**
     * Kill some items from storage.
     */
    "kill_storage": Anonymize<I39uah9nss64h9>;
    /**
     * Kill all storage items with a key that starts with the given prefix.
     *
     * **NOTE:** We rely on the Root origin to provide us the number of subkeys under
     * the prefix we are removing to accurately calculate the weight of this function.
     */
    "kill_prefix": Anonymize<Ik64dknsq7k08>;
    /**
     * Make some on-chain remark and emit event.
     */
    "remark_with_event": Anonymize<I8ofcg5rbj0g2c>;
    /**
     * Authorize an upgrade to a given `code_hash` for the runtime. The runtime can be supplied
     * later.
     *
     * This call requires Root origin.
     */
    "authorize_upgrade": Anonymize<Ib51vk42m1po4n>;
    /**
     * Authorize an upgrade to a given `code_hash` for the runtime. The runtime can be supplied
     * later.
     *
     * WARNING: This authorizes an upgrade that will take place without any safety checks, for
     * example that the spec name remains the same and that the version number increases. Not
     * recommended for normal use. Use `authorize_upgrade` instead.
     *
     * This call requires Root origin.
     */
    "authorize_upgrade_without_checks": Anonymize<Ib51vk42m1po4n>;
    /**
     * Provide the preimage (runtime binary) `code` for an upgrade that has been authorized.
     *
     * If the authorization required a version check, this call will ensure the spec name
     * remains unchanged and that the spec version has increased.
     *
     * Depending on the runtime's `OnSetCode` configuration, this function may directly apply
     * the new `code` in the same block or attempt to schedule the upgrade.
     *
     * All origins are allowed.
     */
    "apply_authorized_upgrade": Anonymize<I6pjjpfvhvcfru>;
}>;
export type I8ofcg5rbj0g2c = {
    "remark": Uint8Array;
};
export type I4adgbll7gku4i = {
    "pages": bigint;
};
export type I6pjjpfvhvcfru = {
    "code": Uint8Array;
};
export type I9pj91mj79qekl = {
    "items": Array<FixedSizeArray<2, Uint8Array>>;
};
export type I39uah9nss64h9 = {
    "keys": Anonymize<Itom7fk49o0c9>;
};
export type Ik64dknsq7k08 = {
    "prefix": Uint8Array;
    "subkeys": number;
};
export type I7d75gqfg6jh9c = AnonymousEnum<{
    /**
     * Set the current time.
     *
     * This call should be invoked exactly once per block. It will panic at the finalization
     * phase, if this call hasn't been invoked by that time.
     *
     * The timestamp should be greater than the previous one by the amount specified by
     * [`Config::MinimumPeriod`].
     *
     * The dispatch origin for this call must be _None_.
     *
     * This dispatch class is _Mandatory_ to ensure it gets executed in the block. Be aware
     * that changing the complexity of this call could result exhausting the resources in a
     * block to execute any other calls.
     *
     * ## Complexity
     * - `O(1)` (Note that implementations of `OnTimestampSet` must also be `O(1)`)
     * - 1 storage read and 1 storage mutation (codec `O(1)` because of `DidUpdate::take` in
     * `on_finalize`)
     * - 1 event handler `on_timestamp_set`. Must be `O(1)`.
     */
    "set": Anonymize<Idcr6u6361oad9>;
}>;
export type Idcr6u6361oad9 = {
    "now": bigint;
};
export type I3u72uvpuo4qrt = AnonymousEnum<{
    /**
     * Set the current validation data.
     *
     * This should be invoked exactly once per block. It will panic at the finalization
     * phase if the call was not invoked.
     *
     * The dispatch origin for this call must be `Inherent`
     *
     * As a side effect, this function upgrades the current validation function
     * if the appropriate time has come.
     */
    "set_validation_data": Anonymize<Ial23jn8hp0aen>;
    "sudo_send_upward_message": Anonymize<Ifpj261e8s63m3>;
}>;
export type Ial23jn8hp0aen = {
    "data": {
        "validation_data": Anonymize<Ifn6q3equiq9qi>;
        "relay_chain_state": Anonymize<Itom7fk49o0c9>;
        "relay_parent_descendants": Array<Anonymize<Ic952bubvq4k7d>>;
        "collator_peer_id"?: Anonymize<Iabpgqcjikia83>;
    };
    "inbound_messages_data": {
        "downward_messages": {
            "full_messages": Array<{
                "sent_at": number;
                "msg": Uint8Array;
            }>;
            "hashed_messages": Array<Anonymize<Icqnh9ino03itn>>;
        };
        "horizontal_messages": {
            "full_messages": Array<[number, {
                "sent_at": number;
                "data": Uint8Array;
            }]>;
            "hashed_messages": Array<[number, Anonymize<Icqnh9ino03itn>]>;
        };
    };
};
export type Ic952bubvq4k7d = {
    "parent_hash": SizedHex<32>;
    "number": number;
    "state_root": SizedHex<32>;
    "extrinsics_root": SizedHex<32>;
    "digest": Anonymize<I4mddgoa69c0a2>;
};
export type Icqnh9ino03itn = {
    "sent_at": number;
    "msg_hash": SizedHex<32>;
};
export type Ifpj261e8s63m3 = {
    "message": Uint8Array;
};
export type I9svldsp29mh87 = AnonymousEnum<{
    /**
     * Transfer some liquid free balance to another account.
     *
     * `transfer_allow_death` will set the `FreeBalance` of the sender and receiver.
     * If the sender's account is below the existential deposit as a result
     * of the transfer, the account will be reaped.
     *
     * The dispatch origin for this call must be `Signed` by the transactor.
     */
    "transfer_allow_death": Anonymize<I4ktuaksf5i1gk>;
    /**
     * Exactly as `transfer_allow_death`, except the origin must be root and the source account
     * may be specified.
     */
    "force_transfer": Anonymize<I9bqtpv2ii35mp>;
    /**
     * Same as the [`transfer_allow_death`] call, but with a check that the transfer will not
     * kill the origin account.
     *
     * 99% of the time you want [`transfer_allow_death`] instead.
     *
     * [`transfer_allow_death`]: struct.Pallet.html#method.transfer
     */
    "transfer_keep_alive": Anonymize<I4ktuaksf5i1gk>;
    /**
     * Transfer the entire transferable balance from the caller account.
     *
     * NOTE: This function only attempts to transfer _transferable_ balances. This means that
     * any locked, reserved, or existential deposits (when `keep_alive` is `true`), will not be
     * transferred by this function. To ensure that this function results in a killed account,
     * you might need to prepare the account by removing any reference counters, storage
     * deposits, etc...
     *
     * The dispatch origin of this call must be Signed.
     *
     * - `dest`: The recipient of the transfer.
     * - `keep_alive`: A boolean to determine if the `transfer_all` operation should send all
     * of the funds the account has, causing the sender account to be killed (false), or
     * transfer everything except at least the existential deposit, which will guarantee to
     * keep the sender account alive (true).
     */
    "transfer_all": Anonymize<I9j7pagd6d4bda>;
    /**
     * Unreserve some balance from a user by force.
     *
     * Can only be called by ROOT.
     */
    "force_unreserve": Anonymize<I2h9pmio37r7fb>;
    /**
     * Upgrade a specified account.
     *
     * - `origin`: Must be `Signed`.
     * - `who`: The account to be upgraded.
     *
     * This will waive the transaction fee if at least all but 10% of the accounts needed to
     * be upgraded. (We let some not have to be upgraded just in order to allow for the
     * possibility of churn).
     */
    "upgrade_accounts": Anonymize<Ibmr18suc9ikh9>;
    /**
     * Set the regular balance of a given account.
     *
     * The dispatch origin for this call is `root`.
     */
    "force_set_balance": Anonymize<I9iq22t0burs89>;
    /**
     * Adjust the total issuance in a saturating way.
     *
     * Can only be called by root and always needs a positive `delta`.
     *
     * # Example
     */
    "force_adjust_total_issuance": Anonymize<I5u8olqbbvfnvf>;
    /**
     * Burn the specified liquid free balance from the origin account.
     *
     * If the origin's account ends up below the existential deposit as a result
     * of the burn and `keep_alive` is false, the account will be reaped.
     *
     * Unlike sending funds to a _burn_ address, which merely makes the funds inaccessible,
     * this `burn` operation will reduce total issuance by the amount _burned_.
     */
    "burn": Anonymize<I5utcetro501ir>;
}>;
export type I4ktuaksf5i1gk = {
    "dest": MultiAddress;
    "value": bigint;
};
export type MultiAddress = Enum<{
    "Id": SS58String;
    "Index": undefined;
    "Raw": Uint8Array;
    "Address32": SizedHex<32>;
    "Address20": SizedHex<20>;
}>;
export declare const MultiAddress: GetEnum<MultiAddress>;
export type I9bqtpv2ii35mp = {
    "source": MultiAddress;
    "dest": MultiAddress;
    "value": bigint;
};
export type I9j7pagd6d4bda = {
    "dest": MultiAddress;
    "keep_alive": boolean;
};
export type I2h9pmio37r7fb = {
    "who": MultiAddress;
    "amount": bigint;
};
export type Ibmr18suc9ikh9 = {
    "who": Anonymize<Ia2lhg7l2hilo3>;
};
export type I9iq22t0burs89 = {
    "who": MultiAddress;
    "new_free": bigint;
};
export type I5u8olqbbvfnvf = {
    "direction": BalancesAdjustmentDirection;
    "delta": bigint;
};
export type BalancesAdjustmentDirection = Enum<{
    "Increase": undefined;
    "Decrease": undefined;
}>;
export declare const BalancesAdjustmentDirection: GetEnum<BalancesAdjustmentDirection>;
export type I5utcetro501ir = {
    "value": bigint;
    "keep_alive": boolean;
};
export type I52be8isndtif4 = AnonymousEnum<{
    /**
     * Issue a new class of fungible assets from a public origin.
     *
     * This new asset class has no assets initially and its owner is the origin.
     *
     * The origin must conform to the configured `CreateOrigin` and have sufficient funds free.
     *
     * Funds of sender are reserved by `AssetDeposit`.
     *
     * Parameters:
     * - `id`: The identifier of the new asset. This must not be currently in use to identify
     * an existing asset. If [`NextAssetId`] is set, then this must be equal to it.
     * - `admin`: The admin of this class of assets. The admin is the initial address of each
     * member of the asset class's admin team.
     * - `min_balance`: The minimum balance of this new asset that any single account must
     * have. If an account's balance is reduced below this, then it collapses to zero.
     *
     * Emits `Created` event when successful.
     *
     * Weight: `O(1)`
     */
    "create": Anonymize<I7t2thek61ghou>;
    /**
     * Issue a new class of fungible assets from a privileged origin.
     *
     * This new asset class has no assets initially.
     *
     * The origin must conform to `ForceOrigin`.
     *
     * Unlike `create`, no funds are reserved.
     *
     * - `id`: The identifier of the new asset. This must not be currently in use to identify
     * an existing asset. If [`NextAssetId`] is set, then this must be equal to it.
     * - `owner`: The owner of this class of assets. The owner has full superuser permissions
     * over this asset, but may later change and configure the permissions using
     * `transfer_ownership` and `set_team`.
     * - `min_balance`: The minimum balance of this new asset that any single account must
     * have. If an account's balance is reduced below this, then it collapses to zero.
     *
     * Emits `ForceCreated` event when successful.
     *
     * Weight: `O(1)`
     */
    "force_create": Anonymize<I61tdrsafr1vf3>;
    /**
     * Start the process of destroying a fungible asset class.
     *
     * `start_destroy` is the first in a series of extrinsics that should be called, to allow
     * destruction of an asset class.
     *
     * The origin must conform to `ForceOrigin` or must be `Signed` by the asset's `owner`.
     *
     * - `id`: The identifier of the asset to be destroyed. This must identify an existing
     * asset.
     *
     * It will fail with either [`Error::ContainsHolds`] or [`Error::ContainsFreezes`] if
     * an account contains holds or freezes in place.
     */
    "start_destroy": Anonymize<Ibsk5g3rhm45pu>;
    /**
     * Destroy all accounts associated with a given asset.
     *
     * `destroy_accounts` should only be called after `start_destroy` has been called, and the
     * asset is in a `Destroying` state.
     *
     * Due to weight restrictions, this function may need to be called multiple times to fully
     * destroy all accounts. It will destroy `RemoveItemsLimit` accounts at a time.
     *
     * - `id`: The identifier of the asset to be destroyed. This must identify an existing
     * asset.
     *
     * Each call emits the `Event::DestroyedAccounts` event.
     */
    "destroy_accounts": Anonymize<Ibsk5g3rhm45pu>;
    /**
     * Destroy all approvals associated with a given asset up to the max (T::RemoveItemsLimit).
     *
     * `destroy_approvals` should only be called after `start_destroy` has been called, and the
     * asset is in a `Destroying` state.
     *
     * Due to weight restrictions, this function may need to be called multiple times to fully
     * destroy all approvals. It will destroy `RemoveItemsLimit` approvals at a time.
     *
     * - `id`: The identifier of the asset to be destroyed. This must identify an existing
     * asset.
     *
     * Each call emits the `Event::DestroyedApprovals` event.
     */
    "destroy_approvals": Anonymize<Ibsk5g3rhm45pu>;
    /**
     * Complete destroying asset and unreserve currency.
     *
     * `finish_destroy` should only be called after `start_destroy` has been called, and the
     * asset is in a `Destroying` state. All accounts or approvals should be destroyed before
     * hand.
     *
     * - `id`: The identifier of the asset to be destroyed. This must identify an existing
     * asset.
     *
     * Each successful call emits the `Event::Destroyed` event.
     */
    "finish_destroy": Anonymize<Ibsk5g3rhm45pu>;
    /**
     * Mint assets of a particular class.
     *
     * The origin must be Signed and the sender must be the Issuer of the asset `id`.
     *
     * - `id`: The identifier of the asset to have some amount minted.
     * - `beneficiary`: The account to be credited with the minted assets.
     * - `amount`: The amount of the asset to be minted.
     *
     * Emits `Issued` event when successful.
     *
     * Weight: `O(1)`
     * Modes: Pre-existing balance of `beneficiary`; Account pre-existence of `beneficiary`.
     */
    "mint": Anonymize<Icfoe9q8d4vs8f>;
    /**
     * Reduce the balance of `who` by as much as possible up to `amount` assets of `id`.
     *
     * Origin must be Signed and the sender should be the Manager of the asset `id`.
     *
     * Bails with `NoAccount` if the `who` is already dead.
     *
     * - `id`: The identifier of the asset to have some amount burned.
     * - `who`: The account to be debited from.
     * - `amount`: The maximum amount by which `who`'s balance should be reduced.
     *
     * Emits `Burned` with the actual amount burned. If this takes the balance to below the
     * minimum for the asset, then the amount burned is increased to take it to zero.
     *
     * Weight: `O(1)`
     * Modes: Post-existence of `who`; Pre & post Zombie-status of `who`.
     */
    "burn": Anonymize<Ibrfmvjrg4trnb>;
    /**
     * Move some assets from the sender account to another.
     *
     * Origin must be Signed.
     *
     * - `id`: The identifier of the asset to have some amount transferred.
     * - `target`: The account to be credited.
     * - `amount`: The amount by which the sender's balance of assets should be reduced and
     * `target`'s balance increased. The amount actually transferred may be slightly greater in
     * the case that the transfer would otherwise take the sender balance above zero but below
     * the minimum balance. Must be greater than zero.
     *
     * Emits `Transferred` with the actual amount transferred. If this takes the source balance
     * to below the minimum for the asset, then the amount transferred is increased to take it
     * to zero.
     *
     * Weight: `O(1)`
     * Modes: Pre-existence of `target`; Post-existence of sender; Account pre-existence of
     * `target`.
     */
    "transfer": Anonymize<Iedih7t34maii9>;
    /**
     * Move some assets from the sender account to another, keeping the sender account alive.
     *
     * Origin must be Signed.
     *
     * - `id`: The identifier of the asset to have some amount transferred.
     * - `target`: The account to be credited.
     * - `amount`: The amount by which the sender's balance of assets should be reduced and
     * `target`'s balance increased. The amount actually transferred may be slightly greater in
     * the case that the transfer would otherwise take the sender balance above zero but below
     * the minimum balance. Must be greater than zero.
     *
     * Emits `Transferred` with the actual amount transferred. If this takes the source balance
     * to below the minimum for the asset, then the amount transferred is increased to take it
     * to zero.
     *
     * Weight: `O(1)`
     * Modes: Pre-existence of `target`; Post-existence of sender; Account pre-existence of
     * `target`.
     */
    "transfer_keep_alive": Anonymize<Iedih7t34maii9>;
    /**
     * Move some assets from one account to another.
     *
     * Origin must be Signed and the sender should be the Admin of the asset `id`.
     *
     * - `id`: The identifier of the asset to have some amount transferred.
     * - `source`: The account to be debited.
     * - `dest`: The account to be credited.
     * - `amount`: The amount by which the `source`'s balance of assets should be reduced and
     * `dest`'s balance increased. The amount actually transferred may be slightly greater in
     * the case that the transfer would otherwise take the `source` balance above zero but
     * below the minimum balance. Must be greater than zero.
     *
     * Emits `Transferred` with the actual amount transferred. If this takes the source balance
     * to below the minimum for the asset, then the amount transferred is increased to take it
     * to zero.
     *
     * Weight: `O(1)`
     * Modes: Pre-existence of `dest`; Post-existence of `source`; Account pre-existence of
     * `dest`.
     */
    "force_transfer": Anonymize<I4e902qbfel1f1>;
    /**
     * Disallow further unprivileged transfers of an asset `id` from an account `who`. `who`
     * must already exist as an entry in `Account`s of the asset. If you want to freeze an
     * account that does not have an entry, use `touch_other` first.
     *
     * Origin must be Signed and the sender should be the Freezer of the asset `id`.
     *
     * - `id`: The identifier of the asset to be frozen.
     * - `who`: The account to be frozen.
     *
     * Emits `Frozen`.
     *
     * Weight: `O(1)`
     */
    "freeze": Anonymize<Ie4met0joi8sv0>;
    /**
     * Allow unprivileged transfers to and from an account again.
     *
     * Origin must be Signed and the sender should be the Admin of the asset `id`.
     *
     * - `id`: The identifier of the asset to be frozen.
     * - `who`: The account to be unfrozen.
     *
     * Emits `Thawed`.
     *
     * Weight: `O(1)`
     */
    "thaw": Anonymize<Ie4met0joi8sv0>;
    /**
     * Disallow further unprivileged transfers for the asset class.
     *
     * Origin must be Signed and the sender should be the Freezer of the asset `id`.
     *
     * - `id`: The identifier of the asset to be frozen.
     *
     * Emits `Frozen`.
     *
     * Weight: `O(1)`
     */
    "freeze_asset": Anonymize<Ibsk5g3rhm45pu>;
    /**
     * Allow unprivileged transfers for the asset again.
     *
     * Origin must be Signed and the sender should be the Admin of the asset `id`.
     *
     * - `id`: The identifier of the asset to be thawed.
     *
     * Emits `Thawed`.
     *
     * Weight: `O(1)`
     */
    "thaw_asset": Anonymize<Ibsk5g3rhm45pu>;
    /**
     * Change the Owner of an asset.
     *
     * Origin must be Signed and the sender should be the Owner of the asset `id`.
     *
     * - `id`: The identifier of the asset.
     * - `owner`: The new Owner of this asset.
     *
     * Emits `OwnerChanged`.
     *
     * Weight: `O(1)`
     */
    "transfer_ownership": Anonymize<I1t8vq6a06ohhu>;
    /**
     * Change the Issuer, Admin and Freezer of an asset.
     *
     * Origin must be Signed and the sender should be the Owner of the asset `id`.
     *
     * - `id`: The identifier of the asset to be frozen.
     * - `issuer`: The new Issuer of this asset.
     * - `admin`: The new Admin of this asset.
     * - `freezer`: The new Freezer of this asset.
     *
     * Emits `TeamChanged`.
     *
     * Weight: `O(1)`
     */
    "set_team": Anonymize<Icvt3pdunbinm7>;
    /**
     * Set the metadata for an asset.
     *
     * Origin must be Signed and the sender should be the Owner of the asset `id`.
     *
     * Funds of sender are reserved according to the formula:
     * `MetadataDepositBase + MetadataDepositPerByte * (name.len + symbol.len)` taking into
     * account any already reserved funds.
     *
     * - `id`: The identifier of the asset to update.
     * - `name`: The user friendly name of this asset. Limited in length by `StringLimit`.
     * - `symbol`: The exchange symbol for this asset. Limited in length by `StringLimit`.
     * - `decimals`: The number of decimals this asset uses to represent one unit.
     *
     * Emits `MetadataSet`.
     *
     * Weight: `O(1)`
     */
    "set_metadata": Anonymize<I9ui3n41balr2q>;
    /**
     * Clear the metadata for an asset.
     *
     * Origin must be Signed and the sender should be the Owner of the asset `id`.
     *
     * Any deposit is freed for the asset owner.
     *
     * - `id`: The identifier of the asset to clear.
     *
     * Emits `MetadataCleared`.
     *
     * Weight: `O(1)`
     */
    "clear_metadata": Anonymize<Ibsk5g3rhm45pu>;
    /**
     * Force the metadata for an asset to some value.
     *
     * Origin must be ForceOrigin.
     *
     * Any deposit is left alone.
     *
     * - `id`: The identifier of the asset to update.
     * - `name`: The user friendly name of this asset. Limited in length by `StringLimit`.
     * - `symbol`: The exchange symbol for this asset. Limited in length by `StringLimit`.
     * - `decimals`: The number of decimals this asset uses to represent one unit.
     *
     * Emits `MetadataSet`.
     *
     * Weight: `O(N + S)` where N and S are the length of the name and symbol respectively.
     */
    "force_set_metadata": Anonymize<I89sl7btgl24g2>;
    /**
     * Clear the metadata for an asset.
     *
     * Origin must be ForceOrigin.
     *
     * Any deposit is returned.
     *
     * - `id`: The identifier of the asset to clear.
     *
     * Emits `MetadataCleared`.
     *
     * Weight: `O(1)`
     */
    "force_clear_metadata": Anonymize<Ibsk5g3rhm45pu>;
    /**
     * Alter the attributes of a given asset.
     *
     * Origin must be `ForceOrigin`.
     *
     * - `id`: The identifier of the asset.
     * - `owner`: The new Owner of this asset.
     * - `issuer`: The new Issuer of this asset.
     * - `admin`: The new Admin of this asset.
     * - `freezer`: The new Freezer of this asset.
     * - `min_balance`: The minimum balance of this new asset that any single account must
     * have. If an account's balance is reduced below this, then it collapses to zero.
     * - `is_sufficient`: Whether a non-zero balance of this asset is deposit of sufficient
     * value to account for the state bloat associated with its balance storage. If set to
     * `true`, then non-zero balances may be stored without a `consumer` reference (and thus
     * an ED in the Balances pallet or whatever else is used to control user-account state
     * growth).
     * - `is_frozen`: Whether this asset class is frozen except for permissioned/admin
     * instructions.
     *
     * Emits `AssetStatusChanged` with the identity of the asset.
     *
     * Weight: `O(1)`
     */
    "force_asset_status": Anonymize<I3u6g26k9kn96u>;
    /**
     * Approve an amount of asset for transfer by a delegated third-party account.
     *
     * Origin must be Signed.
     *
     * Ensures that `ApprovalDeposit` worth of `Currency` is reserved from signing account
     * for the purpose of holding the approval. If some non-zero amount of assets is already
     * approved from signing account to `delegate`, then it is topped up or unreserved to
     * meet the right value.
     *
     * NOTE: The signing account does not need to own `amount` of assets at the point of
     * making this call.
     *
     * - `id`: The identifier of the asset.
     * - `delegate`: The account to delegate permission to transfer asset.
     * - `amount`: The amount of asset that may be transferred by `delegate`. If there is
     * already an approval in place, then this acts additively.
     *
     * Emits `ApprovedTransfer` on success.
     *
     * Weight: `O(1)`
     */
    "approve_transfer": Anonymize<If1invp94rsjms>;
    /**
     * Cancel all of some asset approved for delegated transfer by a third-party account.
     *
     * Origin must be Signed and there must be an approval in place between signer and
     * `delegate`.
     *
     * Unreserves any deposit previously reserved by `approve_transfer` for the approval.
     *
     * - `id`: The identifier of the asset.
     * - `delegate`: The account delegated permission to transfer asset.
     *
     * Emits `ApprovalCancelled` on success.
     *
     * Weight: `O(1)`
     */
    "cancel_approval": Anonymize<Ie5nc19gtiv5sv>;
    /**
     * Cancel all of some asset approved for delegated transfer by a third-party account.
     *
     * Origin must be either ForceOrigin or Signed origin with the signer being the Admin
     * account of the asset `id`.
     *
     * Unreserves any deposit previously reserved by `approve_transfer` for the approval.
     *
     * - `id`: The identifier of the asset.
     * - `delegate`: The account delegated permission to transfer asset.
     *
     * Emits `ApprovalCancelled` on success.
     *
     * Weight: `O(1)`
     */
    "force_cancel_approval": Anonymize<Iald3dgvt1hjkb>;
    /**
     * Transfer some asset balance from a previously delegated account to some third-party
     * account.
     *
     * Origin must be Signed and there must be an approval in place by the `owner` to the
     * signer.
     *
     * If the entire amount approved for transfer is transferred, then any deposit previously
     * reserved by `approve_transfer` is unreserved.
     *
     * - `id`: The identifier of the asset.
     * - `owner`: The account which previously approved for a transfer of at least `amount` and
     * from which the asset balance will be withdrawn.
     * - `destination`: The account to which the asset balance of `amount` will be transferred.
     * - `amount`: The amount of assets to transfer.
     *
     * Emits `TransferredApproved` on success.
     *
     * Weight: `O(1)`
     */
    "transfer_approved": Anonymize<Iurrhahet4gno>;
    /**
     * Create an asset account for non-provider assets.
     *
     * A deposit will be taken from the signer account.
     *
     * - `origin`: Must be Signed; the signer account must have sufficient funds for a deposit
     * to be taken.
     * - `id`: The identifier of the asset for the account to be created.
     *
     * Emits `Touched` event when successful.
     */
    "touch": Anonymize<Ibsk5g3rhm45pu>;
    /**
     * Return the deposit (if any) of an asset account or a consumer reference (if any) of an
     * account.
     *
     * The origin must be Signed.
     *
     * - `id`: The identifier of the asset for which the caller would like the deposit
     * refunded.
     * - `allow_burn`: If `true` then assets may be destroyed in order to complete the refund.
     *
     * It will fail with either [`Error::ContainsHolds`] or [`Error::ContainsFreezes`] if
     * the asset account contains holds or freezes in place.
     *
     * Emits `Refunded` event when successful.
     */
    "refund": Anonymize<I5tamv2nk8bj8o>;
    /**
     * Sets the minimum balance of an asset.
     *
     * Only works if there aren't any accounts that are holding the asset or if
     * the new value of `min_balance` is less than the old one.
     *
     * Origin must be Signed and the sender has to be the Owner of the
     * asset `id`.
     *
     * - `id`: The identifier of the asset.
     * - `min_balance`: The new value of `min_balance`.
     *
     * Emits `AssetMinBalanceChanged` event when successful.
     */
    "set_min_balance": Anonymize<I8apq8e7c7qcpp>;
    /**
     * Create an asset account for `who`.
     *
     * A deposit will be taken from the signer account.
     *
     * - `origin`: Must be Signed; the signer account must have sufficient funds for a deposit
     * to be taken.
     * - `id`: The identifier of the asset for the account to be created, the asset status must
     * be live.
     * - `who`: The account to be created.
     *
     * Emits `Touched` event when successful.
     */
    "touch_other": Anonymize<Ie4met0joi8sv0>;
    /**
     * Return the deposit (if any) of a target asset account. Useful if you are the depositor.
     *
     * The origin must be Signed and either the account owner, depositor, or asset `Admin`. In
     * order to burn a non-zero balance of the asset, the caller must be the account and should
     * use `refund`.
     *
     * - `id`: The identifier of the asset for the account holding a deposit.
     * - `who`: The account to refund.
     *
     * It will fail with either [`Error::ContainsHolds`] or [`Error::ContainsFreezes`] if
     * the asset account contains holds or freezes in place.
     *
     * Emits `Refunded` event when successful.
     */
    "refund_other": Anonymize<Ie4met0joi8sv0>;
    /**
     * Disallow further unprivileged transfers of an asset `id` to and from an account `who`.
     *
     * Origin must be Signed and the sender should be the Freezer of the asset `id`.
     *
     * - `id`: The identifier of the account's asset.
     * - `who`: The account to be unblocked.
     *
     * Emits `Blocked`.
     *
     * Weight: `O(1)`
     */
    "block": Anonymize<Ie4met0joi8sv0>;
    /**
     * Transfer the entire transferable balance from the caller asset account.
     *
     * NOTE: This function only attempts to transfer _transferable_ balances. This means that
     * any held, frozen, or minimum balance (when `keep_alive` is `true`), will not be
     * transferred by this function. To ensure that this function results in a killed account,
     * you might need to prepare the account by removing any reference counters, storage
     * deposits, etc...
     *
     * The dispatch origin of this call must be Signed.
     *
     * - `id`: The identifier of the asset for the account holding a deposit.
     * - `dest`: The recipient of the transfer.
     * - `keep_alive`: A boolean to determine if the `transfer_all` operation should send all
     * of the funds the asset account has, causing the sender asset account to be killed
     * (false), or transfer everything except at least the minimum balance, which will
     * guarantee to keep the sender asset account alive (true).
     */
    "transfer_all": Anonymize<Id1e31ij0c35fv>;
    /**
     * Sets the trusted reserve information of an asset.
     *
     * Origin must be the Owner of the asset `id`. The origin must conform to the configured
     * `CreateOrigin` or be the signed `owner` configured during asset creation.
     *
     * - `id`: The identifier of the asset.
     * - `reserves`: The full list of trusted reserves information.
     *
     * Emits `AssetMinBalanceChanged` event when successful.
     */
    "set_reserves": Anonymize<Ibm7u0qulpnrs9>;
}>;
export type I7t2thek61ghou = {
    "id": Anonymize<If9iqq7i64mur8>;
    "admin": MultiAddress;
    "min_balance": bigint;
};
export type I61tdrsafr1vf3 = {
    "id": Anonymize<If9iqq7i64mur8>;
    "owner": MultiAddress;
    "is_sufficient": boolean;
    "min_balance": bigint;
};
export type Ibsk5g3rhm45pu = {
    "id": Anonymize<If9iqq7i64mur8>;
};
export type Icfoe9q8d4vs8f = {
    "id": Anonymize<If9iqq7i64mur8>;
    "beneficiary": MultiAddress;
    "amount": bigint;
};
export type Ibrfmvjrg4trnb = {
    "id": Anonymize<If9iqq7i64mur8>;
    "who": MultiAddress;
    "amount": bigint;
};
export type Iedih7t34maii9 = {
    "id": Anonymize<If9iqq7i64mur8>;
    "target": MultiAddress;
    "amount": bigint;
};
export type I4e902qbfel1f1 = {
    "id": Anonymize<If9iqq7i64mur8>;
    "source": MultiAddress;
    "dest": MultiAddress;
    "amount": bigint;
};
export type Ie4met0joi8sv0 = {
    "id": Anonymize<If9iqq7i64mur8>;
    "who": MultiAddress;
};
export type I1t8vq6a06ohhu = {
    "id": Anonymize<If9iqq7i64mur8>;
    "owner": MultiAddress;
};
export type Icvt3pdunbinm7 = {
    "id": Anonymize<If9iqq7i64mur8>;
    "issuer": MultiAddress;
    "admin": MultiAddress;
    "freezer": MultiAddress;
};
export type I9ui3n41balr2q = {
    "id": Anonymize<If9iqq7i64mur8>;
    "name": Uint8Array;
    "symbol": Uint8Array;
    "decimals": number;
};
export type I89sl7btgl24g2 = {
    "id": Anonymize<If9iqq7i64mur8>;
    "name": Uint8Array;
    "symbol": Uint8Array;
    "decimals": number;
    "is_frozen": boolean;
};
export type I3u6g26k9kn96u = {
    "id": Anonymize<If9iqq7i64mur8>;
    "owner": MultiAddress;
    "issuer": MultiAddress;
    "admin": MultiAddress;
    "freezer": MultiAddress;
    "min_balance": bigint;
    "is_sufficient": boolean;
    "is_frozen": boolean;
};
export type If1invp94rsjms = {
    "id": Anonymize<If9iqq7i64mur8>;
    "delegate": MultiAddress;
    "amount": bigint;
};
export type Ie5nc19gtiv5sv = {
    "id": Anonymize<If9iqq7i64mur8>;
    "delegate": MultiAddress;
};
export type Iald3dgvt1hjkb = {
    "id": Anonymize<If9iqq7i64mur8>;
    "owner": MultiAddress;
    "delegate": MultiAddress;
};
export type Iurrhahet4gno = {
    "id": Anonymize<If9iqq7i64mur8>;
    "owner": MultiAddress;
    "destination": MultiAddress;
    "amount": bigint;
};
export type I5tamv2nk8bj8o = {
    "id": Anonymize<If9iqq7i64mur8>;
    "allow_burn": boolean;
};
export type I8apq8e7c7qcpp = {
    "id": Anonymize<If9iqq7i64mur8>;
    "min_balance": bigint;
};
export type Id1e31ij0c35fv = {
    "id": Anonymize<If9iqq7i64mur8>;
    "dest": MultiAddress;
    "keep_alive": boolean;
};
export type Ibm7u0qulpnrs9 = {
    "id": Anonymize<If9iqq7i64mur8>;
    "reserves": Anonymize<I35l6p7kq19mr0>;
};
export type Icgf8vmtkbnu4u = AnonymousEnum<{
    /**
     * Unlock any vested funds of the sender account.
     *
     * The dispatch origin for this call must be _Signed_ and the sender must have funds still
     * locked under this pallet.
     *
     * Emits either `VestingCompleted` or `VestingUpdated`.
     *
     * ## Complexity
     * - `O(1)`.
     */
    "vest": undefined;
    /**
     * Unlock any vested funds of a `target` account.
     *
     * The dispatch origin for this call must be _Signed_.
     *
     * - `target`: The account whose vested funds should be unlocked. Must have funds still
     * locked under this pallet.
     *
     * Emits either `VestingCompleted` or `VestingUpdated`.
     *
     * ## Complexity
     * - `O(1)`.
     */
    "vest_other": Anonymize<Id9uqtigc0il3v>;
    /**
     * Create a vested transfer.
     *
     * The dispatch origin for this call must be _Signed_.
     *
     * - `target`: The account receiving the vested funds.
     * - `schedule`: The vesting schedule attached to the transfer.
     *
     * Emits `VestingCreated`.
     *
     * NOTE: This will unlock all schedules through the current block.
     *
     * ## Complexity
     * - `O(1)`.
     */
    "vested_transfer": Anonymize<Iaa2o6cgjdpdn5>;
    /**
     * Force a vested transfer.
     *
     * The dispatch origin for this call must be _Root_.
     *
     * - `source`: The account whose funds should be transferred.
     * - `target`: The account that should be transferred the vested funds.
     * - `schedule`: The vesting schedule attached to the transfer.
     *
     * Emits `VestingCreated`.
     *
     * NOTE: This will unlock all schedules through the current block.
     *
     * ## Complexity
     * - `O(1)`.
     */
    "force_vested_transfer": Anonymize<Iam6hrl7ptd85l>;
    /**
     * Merge two vesting schedules together, creating a new vesting schedule that unlocks over
     * the highest possible start and end blocks. If both schedules have already started the
     * current block will be used as the schedule start; with the caveat that if one schedule
     * is finished by the current block, the other will be treated as the new merged schedule,
     * unmodified.
     *
     * NOTE: If `schedule1_index == schedule2_index` this is a no-op.
     * NOTE: This will unlock all schedules through the current block prior to merging.
     * NOTE: If both schedules have ended by the current block, no new schedule will be created
     * and both will be removed.
     *
     * Merged schedule attributes:
     * - `starting_block`: `MAX(schedule1.starting_block, scheduled2.starting_block,
     * current_block)`.
     * - `ending_block`: `MAX(schedule1.ending_block, schedule2.ending_block)`.
     * - `locked`: `schedule1.locked_at(current_block) + schedule2.locked_at(current_block)`.
     *
     * The dispatch origin for this call must be _Signed_.
     *
     * - `schedule1_index`: index of the first schedule to merge.
     * - `schedule2_index`: index of the second schedule to merge.
     */
    "merge_schedules": Anonymize<Ict9ivhr2c5hv0>;
    /**
     * Force remove a vesting schedule
     *
     * The dispatch origin for this call must be _Root_.
     *
     * - `target`: An account that has a vesting schedule
     * - `schedule_index`: The vesting schedule index that should be removed
     */
    "force_remove_vesting_schedule": Anonymize<I8t4vv03357lk9>;
}>;
export type Id9uqtigc0il3v = {
    "target": MultiAddress;
};
export type Iaa2o6cgjdpdn5 = {
    "target": MultiAddress;
    "schedule": Anonymize<I4aro1m78pdrtt>;
};
export type Iam6hrl7ptd85l = {
    "source": MultiAddress;
    "target": MultiAddress;
    "schedule": Anonymize<I4aro1m78pdrtt>;
};
export type Ict9ivhr2c5hv0 = {
    "schedule1_index": number;
    "schedule2_index": number;
};
export type I8t4vv03357lk9 = {
    "target": MultiAddress;
    "schedule_index": number;
};
export type I6ihmi5bjusj9v = AnonymousEnum<{
    /**
     * Propose a referendum on a privileged action.
     *
     * - `origin`: must be `SubmitOrigin` and the account must have `SubmissionDeposit` funds
     * available.
     * - `proposal_origin`: The origin from which the proposal should be executed.
     * - `proposal`: The proposal.
     * - `enactment_moment`: The moment that the proposal should be enacted.
     *
     * Emits `Submitted`.
     */
    "submit": Anonymize<Ifc6beta7g87k>;
    /**
     * Post the Decision Deposit for a referendum.
     *
     * - `origin`: must be `Signed` and the account must have funds available for the
     * referendum's track's Decision Deposit.
     * - `index`: The index of the submitted referendum whose Decision Deposit is yet to be
     * posted.
     *
     * Emits `DecisionDepositPlaced`.
     */
    "place_decision_deposit": Anonymize<I666bl2fqjkejo>;
    /**
     * Refund the Decision Deposit for a closed referendum back to the depositor.
     *
     * - `origin`: must be `Signed` or `Root`.
     * - `index`: The index of a closed referendum whose Decision Deposit has not yet been
     * refunded.
     *
     * Emits `DecisionDepositRefunded`.
     */
    "refund_decision_deposit": Anonymize<I666bl2fqjkejo>;
    /**
     * Cancel an ongoing referendum.
     *
     * - `origin`: must be the `CancelOrigin`.
     * - `index`: The index of the referendum to be cancelled.
     *
     * Emits `Cancelled`.
     */
    "cancel": Anonymize<I666bl2fqjkejo>;
    /**
     * Cancel an ongoing referendum and slash the deposits.
     *
     * - `origin`: must be the `KillOrigin`.
     * - `index`: The index of the referendum to be cancelled.
     *
     * Emits `Killed` and `DepositSlashed`.
     */
    "kill": Anonymize<I666bl2fqjkejo>;
    /**
     * Advance a referendum onto its next logical state. Only used internally.
     *
     * - `origin`: must be `Root`.
     * - `index`: the referendum to be advanced.
     */
    "nudge_referendum": Anonymize<I666bl2fqjkejo>;
    /**
     * Advance a track onto its next logical state. Only used internally.
     *
     * - `origin`: must be `Root`.
     * - `track`: the track to be advanced.
     *
     * Action item for when there is now one fewer referendum in the deciding phase and the
     * `DecidingCount` is not yet updated. This means that we should either:
     * - begin deciding another referendum (and leave `DecidingCount` alone); or
     * - decrement `DecidingCount`.
     */
    "one_fewer_deciding": Anonymize<Icbio0e1f0034b>;
    /**
     * Refund the Submission Deposit for a closed referendum back to the depositor.
     *
     * - `origin`: must be `Signed` or `Root`.
     * - `index`: The index of a closed referendum whose Submission Deposit has not yet been
     * refunded.
     *
     * Emits `SubmissionDepositRefunded`.
     */
    "refund_submission_deposit": Anonymize<I666bl2fqjkejo>;
    /**
     * Set or clear metadata of a referendum.
     *
     * Parameters:
     * - `origin`: Must be `Signed` by a creator of a referendum or by anyone to clear a
     * metadata of a finished referendum.
     * - `index`:  The index of a referendum to set or clear metadata for.
     * - `maybe_hash`: The hash of an on-chain stored preimage. `None` to clear a metadata.
     */
    "set_metadata": Anonymize<I8c0vkqjjipnuj>;
}>;
export type Ifc6beta7g87k = {
    "proposal_origin": Anonymize<I8rf10c1lb823v>;
    "proposal": PreimagesBounded;
    "enactment_moment": TraitsScheduleDispatchTime;
};
export type Icbio0e1f0034b = {
    "track": number;
};
export type I8c0vkqjjipnuj = {
    "index": number;
    "maybe_hash"?: Anonymize<I4s6vifaf8k998>;
};
export type Ie5kd08tutk56t = AnonymousEnum<{
    /**
     * Vote in a poll. If `vote.is_aye()`, the vote is to enact the proposal;
     * otherwise it is a vote to keep the status quo.
     *
     * The dispatch origin of this call must be _Signed_.
     *
     * - `poll_index`: The index of the poll to vote for.
     * - `vote`: The vote configuration.
     *
     * Weight: `O(R)` where R is the number of polls the voter has voted on.
     */
    "vote": Anonymize<Idnsr2pndm36h0>;
    /**
     * Delegate the voting power (with some given conviction) of the sending account for a
     * particular class of polls.
     *
     * The balance delegated is locked for as long as it's delegated, and thereafter for the
     * time appropriate for the conviction's lock period.
     *
     * The dispatch origin of this call must be _Signed_, and the signing account must either:
     * - be delegating already; or
     * - have no voting activity (if there is, then it will need to be removed through
     * `remove_vote`).
     *
     * - `to`: The account whose voting the `target` account's voting power will follow.
     * - `class`: The class of polls to delegate. To delegate multiple classes, multiple calls
     * to this function are required.
     * - `conviction`: The conviction that will be attached to the delegated votes. When the
     * account is undelegated, the funds will be locked for the corresponding period.
     * - `balance`: The amount of the account's balance to be used in delegating. This must not
     * be more than the account's current balance.
     *
     * Emits `Delegated`.
     *
     * Weight: `O(R)` where R is the number of polls the voter delegating to has
     * voted on. Weight is initially charged as if maximum votes, but is refunded later.
     */
    "delegate": Anonymize<Ia1pvdcbhuqf8m>;
    /**
     * Undelegate the voting power of the sending account for a particular class of polls.
     *
     * Tokens may be unlocked following once an amount of time consistent with the lock period
     * of the conviction with which the delegation was issued has passed.
     *
     * The dispatch origin of this call must be _Signed_ and the signing account must be
     * currently delegating.
     *
     * - `class`: The class of polls to remove the delegation from.
     *
     * Emits `Undelegated`.
     *
     * Weight: `O(R)` where R is the number of polls the voter delegating to has
     * voted on. Weight is initially charged as if maximum votes, but is refunded later.
     */
    "undelegate": Anonymize<I8steo882k7qns>;
    /**
     * Remove the lock caused by prior voting/delegating which has expired within a particular
     * class.
     *
     * The dispatch origin of this call must be _Signed_.
     *
     * - `class`: The class of polls to unlock.
     * - `target`: The account to remove the lock on.
     *
     * Weight: `O(R)` with R number of vote of target.
     */
    "unlock": Anonymize<I4pa4q37gj6fua>;
    /**
     * Remove a vote for a poll.
     *
     * If:
     * - the poll was cancelled, or
     * - the poll is ongoing, or
     * - the poll has ended such that
     * - the vote of the account was in opposition to the result; or
     * - there was no conviction to the account's vote; or
     * - the account made a split vote
     * ...then the vote is removed cleanly and a following call to `unlock` may result in more
     * funds being available.
     *
     * If, however, the poll has ended and:
     * - it finished corresponding to the vote of the account, and
     * - the account made a standard vote with conviction, and
     * - the lock period of the conviction is not over
     * ...then the lock will be aggregated into the overall account's lock, which may involve
     * *overlocking* (where the two locks are combined into a single lock that is the maximum
     * of both the amount locked and the time is it locked for).
     *
     * The dispatch origin of this call must be _Signed_, and the signer must have a vote
     * registered for poll `index`.
     *
     * - `index`: The index of poll of the vote to be removed.
     * - `class`: Optional parameter, if given it indicates the class of the poll. For polls
     * which have finished or are cancelled, this must be `Some`.
     *
     * Weight: `O(R + log R)` where R is the number of polls that `target` has voted on.
     * Weight is calculated for the maximum number of vote.
     */
    "remove_vote": Anonymize<I5f178ab6b89t3>;
    /**
     * Remove a vote for a poll.
     *
     * If the `target` is equal to the signer, then this function is exactly equivalent to
     * `remove_vote`. If not equal to the signer, then the vote must have expired,
     * either because the poll was cancelled, because the voter lost the poll or
     * because the conviction period is over.
     *
     * The dispatch origin of this call must be _Signed_.
     *
     * - `target`: The account of the vote to be removed; this account must have voted for poll
     * `index`.
     * - `index`: The index of poll of the vote to be removed.
     * - `class`: The class of the poll.
     *
     * Weight: `O(R + log R)` where R is the number of polls that `target` has voted on.
     * Weight is calculated for the maximum number of vote.
     */
    "remove_other_vote": Anonymize<I4nakhtbsk3c5s>;
}>;
export type Idnsr2pndm36h0 = {
    "poll_index": number;
    "vote": ConvictionVotingVoteAccountVote;
};
export type Ia1pvdcbhuqf8m = {
    "class": number;
    "to": MultiAddress;
    "conviction": VotingConviction;
    "balance": bigint;
};
export type I8steo882k7qns = {
    "class": number;
};
export type I4pa4q37gj6fua = {
    "class": number;
    "target": MultiAddress;
};
export type I5f178ab6b89t3 = {
    "class"?: Anonymize<I4arjljr6dpflb>;
    "index": number;
};
export type I4nakhtbsk3c5s = {
    "target": MultiAddress;
    "class": number;
    "index": number;
};
export type If81ks88t5mpk5 = AnonymousEnum<{
    /**
     * Register a preimage on-chain.
     *
     * If the preimage was previously requested, no fees or deposits are taken for providing
     * the preimage. Otherwise, a deposit is taken proportional to the size of the preimage.
     */
    "note_preimage": Anonymize<I82nfqfkd48n10>;
    /**
     * Clear an unrequested preimage from the runtime storage.
     *
     * If `len` is provided, then it will be a much cheaper operation.
     *
     * - `hash`: The hash of the preimage to be removed from the store.
     * - `len`: The length of the preimage of `hash`.
     */
    "unnote_preimage": Anonymize<I1jm8m1rh9e20v>;
    /**
     * Request a preimage be uploaded to the chain without paying any fees or deposits.
     *
     * If the preimage requests has already been provided on-chain, we unreserve any deposit
     * a user may have paid, and take the control of the preimage out of their hands.
     */
    "request_preimage": Anonymize<I1jm8m1rh9e20v>;
    /**
     * Clear a previously made request for a preimage.
     *
     * NOTE: THIS MUST NOT BE CALLED ON `hash` MORE TIMES THAN `request_preimage`.
     */
    "unrequest_preimage": Anonymize<I1jm8m1rh9e20v>;
    /**
     * Ensure that the bulk of pre-images is upgraded.
     *
     * The caller pays no fee if at least 90% of pre-images were successfully updated.
     */
    "ensure_updated": Anonymize<I3o5j3bli1pd8e>;
}>;
export type I82nfqfkd48n10 = {
    "bytes": Uint8Array;
};
export type I3o5j3bli1pd8e = {
    "hashes": Anonymize<Ic5m5lp1oioo8r>;
};
export type I96cem93jt0mha = AnonymousEnum<{
    /**
     * Anonymously schedule a task.
     */
    "schedule": Anonymize<I4hoqldg80onj4>;
    /**
     * Cancel a scheduled task (named or anonymous), by providing the block it is scheduled for
     * execution in, as well as the index of the task in that block's agenda.
     *
     * In the case of a named task, it will remove it from the lookup table as well.
     */
    "cancel": Anonymize<I5n4sebgkfr760>;
    /**
     * Schedule a named task.
     */
    "schedule_named": Anonymize<I7tpmr8tipe9i6>;
    /**
     * Cancel a named scheduled task.
     */
    "cancel_named": Anonymize<Ifs1i5fk9cqvr6>;
    /**
     * Anonymously schedule a task after a delay.
     */
    "schedule_after": Anonymize<Ifpr9t4r1bh02u>;
    /**
     * Schedule a named task after a delay.
     */
    "schedule_named_after": Anonymize<Idhgkffmrcrpph>;
    /**
     * Set a retry configuration for a task so that, in case its scheduled run fails, it will
     * be retried after `period` blocks, for a total amount of `retries` retries or until it
     * succeeds.
     *
     * Tasks which need to be scheduled for a retry are still subject to weight metering and
     * agenda space, same as a regular task. If a periodic task fails, it will be scheduled
     * normally while the task is retrying.
     *
     * Tasks scheduled as a result of a retry for a periodic task are unnamed, non-periodic
     * clones of the original task. Their retry configuration will be derived from the
     * original task's configuration, but will have a lower value for `remaining` than the
     * original `total_retries`.
     *
     * This call **cannot** be used to set a retry configuration for a named task.
     */
    "set_retry": Anonymize<Ieg3fd8p4pkt10>;
    /**
     * Set a retry configuration for a named task so that, in case its scheduled run fails, it
     * will be retried after `period` blocks, for a total amount of `retries` retries or until
     * it succeeds.
     *
     * Tasks which need to be scheduled for a retry are still subject to weight metering and
     * agenda space, same as a regular task. If a periodic task fails, it will be scheduled
     * normally while the task is retrying.
     *
     * Tasks scheduled as a result of a retry for a periodic task are unnamed, non-periodic
     * clones of the original task. Their retry configuration will be derived from the
     * original task's configuration, but will have a lower value for `remaining` than the
     * original `total_retries`.
     *
     * This is the only way to set a retry configuration for a named task.
     */
    "set_retry_named": Anonymize<I8kg5ll427kfqq>;
    /**
     * Removes the retry configuration of a task.
     */
    "cancel_retry": Anonymize<I467333262q1l9>;
    /**
     * Cancel the retry configuration of a named task.
     */
    "cancel_retry_named": Anonymize<Ifs1i5fk9cqvr6>;
}>;
export type I4hoqldg80onj4 = {
    "when": number;
    "maybe_periodic"?: Anonymize<Iep7au1720bm0e>;
    "priority": number;
    "call": TxCallData;
};
export type I7tpmr8tipe9i6 = {
    "id": SizedHex<32>;
    "when": number;
    "maybe_periodic"?: Anonymize<Iep7au1720bm0e>;
    "priority": number;
    "call": TxCallData;
};
export type Ifs1i5fk9cqvr6 = {
    "id": SizedHex<32>;
};
export type Ifpr9t4r1bh02u = {
    "after": number;
    "maybe_periodic"?: Anonymize<Iep7au1720bm0e>;
    "priority": number;
    "call": TxCallData;
};
export type Idhgkffmrcrpph = {
    "id": SizedHex<32>;
    "after": number;
    "maybe_periodic"?: Anonymize<Iep7au1720bm0e>;
    "priority": number;
    "call": TxCallData;
};
export type Ieg3fd8p4pkt10 = {
    "task": Anonymize<I9jd27rnpm8ttv>;
    "retries": number;
    "period": number;
};
export type I8kg5ll427kfqq = {
    "id": SizedHex<32>;
    "retries": number;
    "period": number;
};
export type I467333262q1l9 = {
    "task": Anonymize<I9jd27rnpm8ttv>;
};
export type I8cbh0i0c7taeq = AnonymousEnum<{
    /**
     * Send a batch of dispatch calls.
     *
     * May be called from any origin except `None`.
     *
     * - `calls`: The calls to be dispatched from the same origin. The number of call must not
     * exceed the constant: `batched_calls_limit` (available in constant metadata).
     *
     * If origin is root then the calls are dispatched without checking origin filter. (This
     * includes bypassing `frame_system::Config::BaseCallFilter`).
     *
     * ## Complexity
     * - O(C) where C is the number of calls to be batched.
     *
     * This will return `Ok` in all circumstances. To determine the success of the batch, an
     * event is deposited. If a call failed and the batch was interrupted, then the
     * `BatchInterrupted` event is deposited, along with the number of successful calls made
     * and the error of the failed call. If all were successful, then the `BatchCompleted`
     * event is deposited.
     */
    "batch": Anonymize<Ibhs62r2hk467a>;
    /**
     * Send a call through an indexed pseudonym of the sender.
     *
     * Filter from origin are passed along. The call will be dispatched with an origin which
     * use the same filter as the origin of this call.
     *
     * NOTE: If you need to ensure that any account-based filtering is not honored (i.e.
     * because you expect `proxy` to have been used prior in the call stack and you do not want
     * the call restrictions to apply to any sub-accounts), then use `as_multi_threshold_1`
     * in the Multisig pallet instead.
     *
     * NOTE: Prior to version *12, this was called `as_limited_sub`.
     *
     * The dispatch origin for this call must be _Signed_.
     */
    "as_derivative": Anonymize<Ifeg4pudqnboeu>;
    /**
     * Send a batch of dispatch calls and atomically execute them.
     * The whole transaction will rollback and fail if any of the calls failed.
     *
     * May be called from any origin except `None`.
     *
     * - `calls`: The calls to be dispatched from the same origin. The number of call must not
     * exceed the constant: `batched_calls_limit` (available in constant metadata).
     *
     * If origin is root then the calls are dispatched without checking origin filter. (This
     * includes bypassing `frame_system::Config::BaseCallFilter`).
     *
     * ## Complexity
     * - O(C) where C is the number of calls to be batched.
     */
    "batch_all": Anonymize<Ibhs62r2hk467a>;
    /**
     * Dispatches a function call with a provided origin.
     *
     * The dispatch origin for this call must be _Root_.
     *
     * ## Complexity
     * - O(1).
     */
    "dispatch_as": Anonymize<I1d5onj5bp3620>;
    /**
     * Send a batch of dispatch calls.
     * Unlike `batch`, it allows errors and won't interrupt.
     *
     * May be called from any origin except `None`.
     *
     * - `calls`: The calls to be dispatched from the same origin. The number of call must not
     * exceed the constant: `batched_calls_limit` (available in constant metadata).
     *
     * If origin is root then the calls are dispatch without checking origin filter. (This
     * includes bypassing `frame_system::Config::BaseCallFilter`).
     *
     * ## Complexity
     * - O(C) where C is the number of calls to be batched.
     */
    "force_batch": Anonymize<Ibhs62r2hk467a>;
    /**
     * Dispatch a function call with a specified weight.
     *
     * This function does not check the weight of the call, and instead allows the
     * Root origin to specify the weight of the call.
     *
     * The dispatch origin for this call must be _Root_.
     */
    "with_weight": Anonymize<I6jje7fctkmdam>;
    /**
     * Dispatch a fallback call in the event the main call fails to execute.
     * May be called from any origin except `None`.
     *
     * This function first attempts to dispatch the `main` call.
     * If the `main` call fails, the `fallback` is attemted.
     * if the fallback is successfully dispatched, the weights of both calls
     * are accumulated and an event containing the main call error is deposited.
     *
     * In the event of a fallback failure the whole call fails
     * with the weights returned.
     *
     * - `main`: The main call to be dispatched. This is the primary action to execute.
     * - `fallback`: The fallback call to be dispatched in case the `main` call fails.
     *
     * ## Dispatch Logic
     * - If the origin is `root`, both the main and fallback calls are executed without
     * applying any origin filters.
     * - If the origin is not `root`, the origin filter is applied to both the `main` and
     * `fallback` calls.
     *
     * ## Use Case
     * - Some use cases might involve submitting a `batch` type call in either main, fallback
     * or both.
     */
    "if_else": Anonymize<I6he8b4b4q6p14>;
    /**
     * Dispatches a function call with a provided origin.
     *
     * Almost the same as [`Pallet::dispatch_as`] but forwards any error of the inner call.
     *
     * The dispatch origin for this call must be _Root_.
     */
    "dispatch_as_fallible": Anonymize<I1d5onj5bp3620>;
}>;
export type Ibhs62r2hk467a = {
    "calls": Array<TxCallData>;
};
export type Ifeg4pudqnboeu = {
    "index": number;
    "call": TxCallData;
};
export type I1d5onj5bp3620 = {
    "as_origin": Anonymize<I8rf10c1lb823v>;
    "call": TxCallData;
};
export type I6jje7fctkmdam = {
    "call": TxCallData;
    "weight": Anonymize<I4q39t5hn830vp>;
};
export type I6he8b4b4q6p14 = {
    "main": TxCallData;
    "fallback": TxCallData;
};
export type Ibn5bl4c53tkcc = AnonymousEnum<{
    /**
     * Dispatch the given `call` from an account that the sender is authorised for through
     * `add_proxy`.
     *
     * The dispatch origin for this call must be _Signed_.
     *
     * Parameters:
     * - `real`: The account that the proxy will make a call on behalf of.
     * - `force_proxy_type`: Specify the exact proxy type to be used and checked for this call.
     * - `call`: The call to be made by the `real` account.
     */
    "proxy": Anonymize<I57mgih1qrbf70>;
    /**
     * Register a proxy account for the sender that is able to make calls on its behalf.
     *
     * The dispatch origin for this call must be _Signed_.
     *
     * Parameters:
     * - `proxy`: The account that the `caller` would like to make a proxy.
     * - `proxy_type`: The permissions allowed for this proxy account.
     * - `delay`: The announcement period required of the initial proxy. Will generally be
     * zero.
     */
    "add_proxy": Anonymize<I3lj33btcqlb1i>;
    /**
     * Unregister a proxy account for the sender.
     *
     * The dispatch origin for this call must be _Signed_.
     *
     * Parameters:
     * - `proxy`: The account that the `caller` would like to remove as a proxy.
     * - `proxy_type`: The permissions currently enabled for the removed proxy account.
     */
    "remove_proxy": Anonymize<I3lj33btcqlb1i>;
    /**
     * Unregister all proxy accounts for the sender.
     *
     * The dispatch origin for this call must be _Signed_.
     *
     * WARNING: This may be called on accounts created by `create_pure`, however if done, then
     * the unreserved fees will be inaccessible. **All access to this account will be lost.**
     */
    "remove_proxies": undefined;
    /**
     * Spawn a fresh new account that is guaranteed to be otherwise inaccessible, and
     * initialize it with a proxy of `proxy_type` for `origin` sender.
     *
     * Requires a `Signed` origin.
     *
     * - `proxy_type`: The type of the proxy that the sender will be registered as over the
     * new account. This will almost always be the most permissive `ProxyType` possible to
     * allow for maximum flexibility.
     * - `index`: A disambiguation index, in case this is called multiple times in the same
     * transaction (e.g. with `utility::batch`). Unless you're using `batch` you probably just
     * want to use `0`.
     * - `delay`: The announcement period required of the initial proxy. Will generally be
     * zero.
     *
     * Fails with `Duplicate` if this has already been called in this transaction, from the
     * same sender, with the same parameters.
     *
     * Fails if there are insufficient funds to pay for deposit.
     */
    "create_pure": Anonymize<I707m7edh0jft8>;
    /**
     * Removes a previously spawned pure proxy.
     *
     * WARNING: **All access to this account will be lost.** Any funds held in it will be
     * inaccessible.
     *
     * Requires a `Signed` origin, and the sender account must have been created by a call to
     * `create_pure` with corresponding parameters.
     *
     * - `spawner`: The account that originally called `create_pure` to create this account.
     * - `index`: The disambiguation index originally passed to `create_pure`. Probably `0`.
     * - `proxy_type`: The proxy type originally passed to `create_pure`.
     * - `height`: The height of the chain when the call to `create_pure` was processed.
     * - `ext_index`: The extrinsic index in which the call to `create_pure` was processed.
     *
     * Fails with `NoPermission` in case the caller is not a previously created pure
     * account whose `create_pure` call has corresponding parameters.
     */
    "kill_pure": Anonymize<I2j5sqe1l974kn>;
    /**
     * Publish the hash of a proxy-call that will be made in the future.
     *
     * This must be called some number of blocks before the corresponding `proxy` is attempted
     * if the delay associated with the proxy relationship is greater than zero.
     *
     * No more than `MaxPending` announcements may be made at any one time.
     *
     * This will take a deposit of `AnnouncementDepositFactor` as well as
     * `AnnouncementDepositBase` if there are no other pending announcements.
     *
     * The dispatch origin for this call must be _Signed_ and a proxy of `real`.
     *
     * Parameters:
     * - `real`: The account that the proxy will make a call on behalf of.
     * - `call_hash`: The hash of the call to be made by the `real` account.
     */
    "announce": Anonymize<I2eb501t8s6hsq>;
    /**
     * Remove a given announcement.
     *
     * May be called by a proxy account to remove a call they previously announced and return
     * the deposit.
     *
     * The dispatch origin for this call must be _Signed_.
     *
     * Parameters:
     * - `real`: The account that the proxy will make a call on behalf of.
     * - `call_hash`: The hash of the call to be made by the `real` account.
     */
    "remove_announcement": Anonymize<I2eb501t8s6hsq>;
    /**
     * Remove the given announcement of a delegate.
     *
     * May be called by a target (proxied) account to remove a call that one of their delegates
     * (`delegate`) has announced they want to execute. The deposit is returned.
     *
     * The dispatch origin for this call must be _Signed_.
     *
     * Parameters:
     * - `delegate`: The account that previously announced the call.
     * - `call_hash`: The hash of the call to be made.
     */
    "reject_announcement": Anonymize<Ianmuoljk2sk1u>;
    /**
     * Dispatch the given `call` from an account that the sender is authorized for through
     * `add_proxy`.
     *
     * Removes any corresponding announcement(s).
     *
     * The dispatch origin for this call must be _Signed_.
     *
     * Parameters:
     * - `real`: The account that the proxy will make a call on behalf of.
     * - `force_proxy_type`: Specify the exact proxy type to be used and checked for this call.
     * - `call`: The call to be made by the `real` account.
     */
    "proxy_announced": Anonymize<I1ok6cg6f6qjvq>;
    /**
     * Poke / Adjust deposits made for proxies and announcements based on current values.
     * This can be used by accounts to possibly lower their locked amount.
     *
     * The dispatch origin for this call must be _Signed_.
     *
     * The transaction fee is waived if the deposit amount has changed.
     *
     * Emits `DepositPoked` if successful.
     */
    "poke_deposit": undefined;
}>;
export type I57mgih1qrbf70 = {
    "real": MultiAddress;
    "force_proxy_type"?: Anonymize<I5gu0l454u7u79>;
    "call": TxCallData;
};
export type I5gu0l454u7u79 = (Anonymize<Icqldr8j4je7f4>) | undefined;
export type I3lj33btcqlb1i = {
    "delegate": MultiAddress;
    "proxy_type": Anonymize<Icqldr8j4je7f4>;
    "delay": number;
};
export type I707m7edh0jft8 = {
    "proxy_type": Anonymize<Icqldr8j4je7f4>;
    "delay": number;
    "index": number;
};
export type I2j5sqe1l974kn = {
    "spawner": MultiAddress;
    "proxy_type": Anonymize<Icqldr8j4je7f4>;
    "index": number;
    "height": number;
    "ext_index": number;
};
export type I2eb501t8s6hsq = {
    "real": MultiAddress;
    "call_hash": SizedHex<32>;
};
export type Ianmuoljk2sk1u = {
    "delegate": MultiAddress;
    "call_hash": SizedHex<32>;
};
export type I1ok6cg6f6qjvq = {
    "delegate": MultiAddress;
    "real": MultiAddress;
    "force_proxy_type"?: Anonymize<I5gu0l454u7u79>;
    "call": TxCallData;
};
export type Icldk30vd63l55 = AnonymousEnum<{
    /**
     * Immediately dispatch a multi-signature call using a single approval from the caller.
     *
     * The dispatch origin for this call must be _Signed_.
     *
     * - `other_signatories`: The accounts (other than the sender) who are part of the
     * multi-signature, but do not participate in the approval process.
     * - `call`: The call to be executed.
     *
     * Result is equivalent to the dispatched result.
     *
     * ## Complexity
     * O(Z + C) where Z is the length of the call and C its execution weight.
     */
    "as_multi_threshold_1": Anonymize<I7knpbpi70kjd6>;
    /**
     * Register approval for a dispatch to be made from a deterministic composite account if
     * approved by a total of `threshold - 1` of `other_signatories`.
     *
     * **If the approval threshold is met (including the sender's approval), this will
     * immediately execute the call.** This is the only way to execute a multisig call -
     * `approve_as_multi` will never trigger execution.
     *
     * Payment: `DepositBase` will be reserved if this is the first approval, plus
     * `threshold` times `DepositFactor`. It is returned once this dispatch happens or
     * is cancelled.
     *
     * The dispatch origin for this call must be _Signed_.
     *
     * - `threshold`: The total number of approvals for this dispatch before it is executed.
     * - `other_signatories`: The accounts (other than the sender) who can approve this
     * dispatch. May not be empty.
     * - `maybe_timepoint`: If this is the first approval, then this must be `None`. If it is
     * not the first approval, then it must be `Some`, with the timepoint (block number and
     * transaction index) of the first approval transaction.
     * - `call`: The call to be executed.
     *
     * NOTE: For intermediate approvals (not the final approval), you should generally use
     * `approve_as_multi` instead, since it only requires a hash of the call and is more
     * efficient.
     *
     * Result is equivalent to the dispatched result if `threshold` is exactly `1`. Otherwise
     * on success, result is `Ok` and the result from the interior call, if it was executed,
     * may be found in the deposited `MultisigExecuted` event.
     *
     * ## Complexity
     * - `O(S + Z + Call)`.
     * - Up to one balance-reserve or unreserve operation.
     * - One passthrough operation, one insert, both `O(S)` where `S` is the number of
     * signatories. `S` is capped by `MaxSignatories`, with weight being proportional.
     * - One call encode & hash, both of complexity `O(Z)` where `Z` is tx-len.
     * - One encode & hash, both of complexity `O(S)`.
     * - Up to one binary search and insert (`O(logS + S)`).
     * - I/O: 1 read `O(S)`, up to 1 mutate `O(S)`. Up to one remove.
     * - One event.
     * - The weight of the `call`.
     * - Storage: inserts one item, value size bounded by `MaxSignatories`, with a deposit
     * taken for its lifetime of `DepositBase + threshold * DepositFactor`.
     */
    "as_multi": Anonymize<I2ubgugv6pr3bd>;
    /**
     * Register approval for a dispatch to be made from a deterministic composite account if
     * approved by a total of `threshold - 1` of `other_signatories`.
     *
     * **This function will NEVER execute the call, even if the approval threshold is
     * reached.** It only registers approval. To actually execute the call, `as_multi` must
     * be called with the full call data by any of the signatories.
     *
     * This function is more efficient than `as_multi` for intermediate approvals since it
     * only requires the call hash, not the full call data.
     *
     * Payment: `DepositBase` will be reserved if this is the first approval, plus
     * `threshold` times `DepositFactor`. It is returned once this dispatch happens or
     * is cancelled.
     *
     * The dispatch origin for this call must be _Signed_.
     *
     * - `threshold`: The total number of approvals for this dispatch before it is executed.
     * - `other_signatories`: The accounts (other than the sender) who can approve this
     * dispatch. May not be empty.
     * - `maybe_timepoint`: If this is the first approval, then this must be `None`. If it is
     * not the first approval, then it must be `Some`, with the timepoint (block number and
     * transaction index) of the first approval transaction.
     * - `call_hash`: The hash of the call to be executed.
     *
     * NOTE: To execute the call after approvals are gathered, any signatory must call
     * `as_multi` with the full call data. This function cannot execute the call.
     *
     * ## Complexity
     * - `O(S)`.
     * - Up to one balance-reserve or unreserve operation.
     * - One passthrough operation, one insert, both `O(S)` where `S` is the number of
     * signatories. `S` is capped by `MaxSignatories`, with weight being proportional.
     * - One encode & hash, both of complexity `O(S)`.
     * - Up to one binary search and insert (`O(logS + S)`).
     * - I/O: 1 read `O(S)`, up to 1 mutate `O(S)`. Up to one remove.
     * - One event.
     * - Storage: inserts one item, value size bounded by `MaxSignatories`, with a deposit
     * taken for its lifetime of `DepositBase + threshold * DepositFactor`.
     */
    "approve_as_multi": Anonymize<Ideaemvoneh309>;
    /**
     * Cancel a pre-existing, on-going multisig transaction. Any deposit reserved previously
     * for this operation will be unreserved on success.
     *
     * The dispatch origin for this call must be _Signed_.
     *
     * - `threshold`: The total number of approvals for this dispatch before it is executed.
     * - `other_signatories`: The accounts (other than the sender) who can approve this
     * dispatch. May not be empty.
     * - `timepoint`: The timepoint (block number and transaction index) of the first approval
     * transaction for this dispatch.
     * - `call_hash`: The hash of the call to be executed.
     *
     * ## Complexity
     * - `O(S)`.
     * - Up to one balance-reserve or unreserve operation.
     * - One passthrough operation, one insert, both `O(S)` where `S` is the number of
     * signatories. `S` is capped by `MaxSignatories`, with weight being proportional.
     * - One encode & hash, both of complexity `O(S)`.
     * - One event.
     * - I/O: 1 read `O(S)`, one remove.
     * - Storage: removes one item.
     */
    "cancel_as_multi": Anonymize<I3d9o9d7epp66v>;
    /**
     * Poke the deposit reserved for an existing multisig operation.
     *
     * The dispatch origin for this call must be _Signed_ and must be the original depositor of
     * the multisig operation.
     *
     * The transaction fee is waived if the deposit amount has changed.
     *
     * - `threshold`: The total number of approvals needed for this multisig.
     * - `other_signatories`: The accounts (other than the sender) who are part of the
     * multisig.
     * - `call_hash`: The hash of the call this deposit is reserved for.
     *
     * Emits `DepositPoked` if successful.
     */
    "poke_deposit": Anonymize<I6lqh1vgb4mcja>;
}>;
export type I7knpbpi70kjd6 = {
    "other_signatories": Anonymize<Ia2lhg7l2hilo3>;
    "call": TxCallData;
};
export type I2ubgugv6pr3bd = {
    "threshold": number;
    "other_signatories": Anonymize<Ia2lhg7l2hilo3>;
    "maybe_timepoint"?: Anonymize<I95jfd8j5cr5eh>;
    "call": TxCallData;
    "max_weight": Anonymize<I4q39t5hn830vp>;
};
export type I95jfd8j5cr5eh = (Anonymize<Itvprrpb0nm3o>) | undefined;
export type Ideaemvoneh309 = {
    "threshold": number;
    "other_signatories": Anonymize<Ia2lhg7l2hilo3>;
    "maybe_timepoint"?: Anonymize<I95jfd8j5cr5eh>;
    "call_hash": SizedHex<32>;
    "max_weight": Anonymize<I4q39t5hn830vp>;
};
export type I3d9o9d7epp66v = {
    "threshold": number;
    "other_signatories": Anonymize<Ia2lhg7l2hilo3>;
    "timepoint": Anonymize<Itvprrpb0nm3o>;
    "call_hash": SizedHex<32>;
};
export type I6lqh1vgb4mcja = {
    "threshold": number;
    "other_signatories": Anonymize<Ia2lhg7l2hilo3>;
    "call_hash": SizedHex<32>;
};
export type I4oqb168b2d4er = AnonymousEnum<{
    /**
     * Allows root to set a cursor to forcefully start, stop or forward the migration process.
     *
     * Should normally not be needed and is only in place as emergency measure. Note that
     * restarting the migration process in this manner will not call the
     * [`MigrationStatusHandler::started`] hook or emit an `UpgradeStarted` event.
     */
    "force_set_cursor": Anonymize<Ibou4u1engb441>;
    /**
     * Allows root to set an active cursor to forcefully start/forward the migration process.
     *
     * This is an edge-case version of [`Self::force_set_cursor`] that allows to set the
     * `started_at` value to the next block number. Otherwise this would not be possible, since
     * `force_set_cursor` takes an absolute block number. Setting `started_at` to `None`
     * indicates that the current block number plus one should be used.
     */
    "force_set_active_cursor": Anonymize<Id6nbvqoqdj4o2>;
    /**
     * Forces the onboarding of the migrations.
     *
     * This process happens automatically on a runtime upgrade. It is in place as an emergency
     * measurement. The cursor needs to be `None` for this to succeed.
     */
    "force_onboard_mbms": undefined;
    /**
     * Clears the `Historic` set.
     *
     * `map_cursor` must be set to the last value that was returned by the
     * `HistoricCleared` event. The first time `None` can be used. `limit` must be chosen in a
     * way that will result in a sensible weight.
     */
    "clear_historic": Anonymize<I95iqep3b8snn9>;
}>;
export type Ibou4u1engb441 = {
    "cursor"?: (Anonymize<Iepbsvlk3qceij>) | undefined;
};
export type Id6nbvqoqdj4o2 = {
    "index": number;
    "inner_cursor"?: Anonymize<Iabpgqcjikia83>;
    "started_at"?: Anonymize<I4arjljr6dpflb>;
};
export type I95iqep3b8snn9 = {
    "selector": Enum<{
        "Specific": Anonymize<Itom7fk49o0c9>;
        "Wildcard": {
            "limit"?: Anonymize<I4arjljr6dpflb>;
            "previous_cursor"?: Anonymize<Iabpgqcjikia83>;
        };
    }>;
};
export type I7lcknubdnmpn9 = AnonymousEnum<{
    /**
     * Authenticates the sudo key and dispatches a function call with `Root` origin.
     */
    "sudo": Anonymize<I6fa9aeuk7i4ib>;
    /**
     * Authenticates the sudo key and dispatches a function call with `Root` origin.
     * This function does not check the weight of the call, and instead allows the
     * Sudo user to specify the weight of the call.
     *
     * The dispatch origin for this call must be _Signed_.
     */
    "sudo_unchecked_weight": Anonymize<I6jje7fctkmdam>;
    /**
     * Authenticates the current sudo key and sets the given AccountId (`new`) as the new sudo
     * key.
     */
    "set_key": Anonymize<I8k3rnvpeeh4hv>;
    /**
     * Authenticates the sudo key and dispatches a function call with `Signed` origin from
     * a given account.
     *
     * The dispatch origin for this call must be _Signed_.
     */
    "sudo_as": Anonymize<I1jllala72loei>;
    /**
     * Permanently removes the sudo key.
     *
     * **This cannot be un-done.**
     */
    "remove_key": undefined;
}>;
export type I6fa9aeuk7i4ib = {
    "call": TxCallData;
};
export type I8k3rnvpeeh4hv = {
    "new": MultiAddress;
};
export type I1jllala72loei = {
    "who": MultiAddress;
    "call": TxCallData;
};
export type Ib7tahn20bvsep = AnonymousEnum<{
    /**
     * Suspends all XCM executions for the XCMP queue, regardless of the sender's origin.
     *
     * - `origin`: Must pass `ControllerOrigin`.
     */
    "suspend_xcm_execution": undefined;
    /**
     * Resumes all XCM executions for the XCMP queue.
     *
     * Note that this function doesn't change the status of the in/out bound channels.
     *
     * - `origin`: Must pass `ControllerOrigin`.
     */
    "resume_xcm_execution": undefined;
    /**
     * Overwrites the number of pages which must be in the queue for the other side to be
     * told to suspend their sending.
     *
     * - `origin`: Must pass `Root`.
     * - `new`: Desired value for `QueueConfigData.suspend_value`
     */
    "update_suspend_threshold": Anonymize<I3vh014cqgmrfd>;
    /**
     * Overwrites the number of pages which must be in the queue after which we drop any
     * further messages from the channel.
     *
     * - `origin`: Must pass `Root`.
     * - `new`: Desired value for `QueueConfigData.drop_threshold`
     */
    "update_drop_threshold": Anonymize<I3vh014cqgmrfd>;
    /**
     * Overwrites the number of pages which the queue must be reduced to before it signals
     * that message sending may recommence after it has been suspended.
     *
     * - `origin`: Must pass `Root`.
     * - `new`: Desired value for `QueueConfigData.resume_threshold`
     */
    "update_resume_threshold": Anonymize<I3vh014cqgmrfd>;
}>;
export type I3vh014cqgmrfd = {
    "new": number;
};
export type Ic2uoe7jdksosp = AnonymousEnum<{
    /**
     * Remove a page which has no more messages remaining to be processed or is stale.
     */
    "reap_page": Anonymize<I40pqum1mu8qg3>;
    /**
     * Execute an overweight message.
     *
     * Temporary processing errors will be propagated whereas permanent errors are treated
     * as success condition.
     *
     * - `origin`: Must be `Signed`.
     * - `message_origin`: The origin from which the message to be executed arrived.
     * - `page`: The page in the queue in which the message to be executed is sitting.
     * - `index`: The index into the queue of the message to be executed.
     * - `weight_limit`: The maximum amount of weight allowed to be consumed in the execution
     * of the message.
     *
     * Benchmark complexity considerations: O(index + weight_limit).
     */
    "execute_overweight": Anonymize<I1r4c2ghbtvjuc>;
}>;
export type I40pqum1mu8qg3 = {
    "message_origin": Anonymize<Iejeo53sea6n4q>;
    "page_index": number;
};
export type I1r4c2ghbtvjuc = {
    "message_origin": Anonymize<Iejeo53sea6n4q>;
    "page": number;
    "index": number;
    "weight_limit": Anonymize<I4q39t5hn830vp>;
};
export type I6k1inef986368 = AnonymousEnum<{
    "send": Anonymize<Ia5cotcvi888ln>;
    /**
     * Teleport some assets from the local chain to some destination chain.
     *
     * **This function is deprecated: Use `limited_teleport_assets` instead.**
     *
     * Fee payment on the destination side is made from the asset in the `assets` vector of
     * index `fee_asset_item`. The weight limit for fees is not provided and thus is unlimited,
     * with all fees taken as needed from the asset.
     *
     * - `origin`: Must be capable of withdrawing the `assets` and executing XCM.
     * - `dest`: Destination context for the assets. Will typically be `[Parent,
     * Parachain(..)]` to send from parachain to parachain, or `[Parachain(..)]` to send from
     * relay to parachain.
     * - `beneficiary`: A beneficiary location for the assets in the context of `dest`. Will
     * generally be an `AccountId32` value.
     * - `assets`: The assets to be withdrawn. This should include the assets used to pay the
     * fee on the `dest` chain.
     * - `fee_asset_item`: The index into `assets` of the item which should be used to pay
     * fees.
     */
    "teleport_assets": Anonymize<I21jsa919m88fd>;
    /**
     * Transfer some assets from the local chain to the destination chain through their local,
     * destination or remote reserve.
     *
     * `assets` must have same reserve location and may not be teleportable to `dest`.
     * - `assets` have local reserve: transfer assets to sovereign account of destination
     * chain and forward a notification XCM to `dest` to mint and deposit reserve-based
     * assets to `beneficiary`.
     * - `assets` have destination reserve: burn local assets and forward a notification to
     * `dest` chain to withdraw the reserve assets from this chain's sovereign account and
     * deposit them to `beneficiary`.
     * - `assets` have remote reserve: burn local assets, forward XCM to reserve chain to move
     * reserves from this chain's SA to `dest` chain's SA, and forward another XCM to `dest`
     * to mint and deposit reserve-based assets to `beneficiary`.
     *
     * **This function is deprecated: Use `limited_reserve_transfer_assets` instead.**
     *
     * Fee payment on the destination side is made from the asset in the `assets` vector of
     * index `fee_asset_item`. The weight limit for fees is not provided and thus is unlimited,
     * with all fees taken as needed from the asset.
     *
     * - `origin`: Must be capable of withdrawing the `assets` and executing XCM.
     * - `dest`: Destination context for the assets. Will typically be `[Parent,
     * Parachain(..)]` to send from parachain to parachain, or `[Parachain(..)]` to send from
     * relay to parachain.
     * - `beneficiary`: A beneficiary location for the assets in the context of `dest`. Will
     * generally be an `AccountId32` value.
     * - `assets`: The assets to be withdrawn. This should include the assets used to pay the
     * fee on the `dest` (and possibly reserve) chains.
     * - `fee_asset_item`: The index into `assets` of the item which should be used to pay
     * fees.
     */
    "reserve_transfer_assets": Anonymize<I21jsa919m88fd>;
    /**
     * Execute an XCM message from a local, signed, origin.
     *
     * An event is deposited indicating whether `msg` could be executed completely or only
     * partially.
     *
     * No more than `max_weight` will be used in its attempted execution. If this is less than
     * the maximum amount of weight that the message could take to be executed, then no
     * execution attempt will be made.
     */
    "execute": Anonymize<Iegif7m3upfe1k>;
    /**
     * Extoll that a particular destination can be communicated with through a particular
     * version of XCM.
     *
     * - `origin`: Must be an origin specified by AdminOrigin.
     * - `location`: The destination that is being described.
     * - `xcm_version`: The latest version of XCM that `location` supports.
     */
    "force_xcm_version": Anonymize<I9kt8c221c83ln>;
    /**
     * Set a safe XCM version (the version that XCM should be encoded with if the most recent
     * version a destination can accept is unknown).
     *
     * - `origin`: Must be an origin specified by AdminOrigin.
     * - `maybe_xcm_version`: The default XCM encoding version, or `None` to disable.
     */
    "force_default_xcm_version": Anonymize<Ic76kfh5ebqkpl>;
    /**
     * Ask a location to notify us regarding their XCM version and any changes to it.
     *
     * - `origin`: Must be an origin specified by AdminOrigin.
     * - `location`: The location to which we should subscribe for XCM version notifications.
     */
    "force_subscribe_version_notify": Anonymize<Icscpmubum33bq>;
    /**
     * Require that a particular destination should no longer notify us regarding any XCM
     * version changes.
     *
     * - `origin`: Must be an origin specified by AdminOrigin.
     * - `location`: The location to which we are currently subscribed for XCM version
     * notifications which we no longer desire.
     */
    "force_unsubscribe_version_notify": Anonymize<Icscpmubum33bq>;
    /**
     * Transfer some assets from the local chain to the destination chain through their local,
     * destination or remote reserve.
     *
     * `assets` must have same reserve location and may not be teleportable to `dest`.
     * - `assets` have local reserve: transfer assets to sovereign account of destination
     * chain and forward a notification XCM to `dest` to mint and deposit reserve-based
     * assets to `beneficiary`.
     * - `assets` have destination reserve: burn local assets and forward a notification to
     * `dest` chain to withdraw the reserve assets from this chain's sovereign account and
     * deposit them to `beneficiary`.
     * - `assets` have remote reserve: burn local assets, forward XCM to reserve chain to move
     * reserves from this chain's SA to `dest` chain's SA, and forward another XCM to `dest`
     * to mint and deposit reserve-based assets to `beneficiary`.
     *
     * Fee payment on the destination side is made from the asset in the `assets` vector of
     * index `fee_asset_item`, up to enough to pay for `weight_limit` of weight. If more weight
     * is needed than `weight_limit`, then the operation will fail and the sent assets may be
     * at risk.
     *
     * - `origin`: Must be capable of withdrawing the `assets` and executing XCM.
     * - `dest`: Destination context for the assets. Will typically be `[Parent,
     * Parachain(..)]` to send from parachain to parachain, or `[Parachain(..)]` to send from
     * relay to parachain.
     * - `beneficiary`: A beneficiary location for the assets in the context of `dest`. Will
     * generally be an `AccountId32` value.
     * - `assets`: The assets to be withdrawn. This should include the assets used to pay the
     * fee on the `dest` (and possibly reserve) chains.
     * - `fee_asset_item`: The index into `assets` of the item which should be used to pay
     * fees.
     * - `weight_limit`: The remote-side weight limit, if any, for the XCM fee purchase.
     */
    "limited_reserve_transfer_assets": Anonymize<I21d2olof7eb60>;
    /**
     * Teleport some assets from the local chain to some destination chain.
     *
     * Fee payment on the destination side is made from the asset in the `assets` vector of
     * index `fee_asset_item`, up to enough to pay for `weight_limit` of weight. If more weight
     * is needed than `weight_limit`, then the operation will fail and the sent assets may be
     * at risk.
     *
     * - `origin`: Must be capable of withdrawing the `assets` and executing XCM.
     * - `dest`: Destination context for the assets. Will typically be `[Parent,
     * Parachain(..)]` to send from parachain to parachain, or `[Parachain(..)]` to send from
     * relay to parachain.
     * - `beneficiary`: A beneficiary location for the assets in the context of `dest`. Will
     * generally be an `AccountId32` value.
     * - `assets`: The assets to be withdrawn. This should include the assets used to pay the
     * fee on the `dest` chain.
     * - `fee_asset_item`: The index into `assets` of the item which should be used to pay
     * fees.
     * - `weight_limit`: The remote-side weight limit, if any, for the XCM fee purchase.
     */
    "limited_teleport_assets": Anonymize<I21d2olof7eb60>;
    /**
     * Set or unset the global suspension state of the XCM executor.
     *
     * - `origin`: Must be an origin specified by AdminOrigin.
     * - `suspended`: `true` to suspend, `false` to resume.
     */
    "force_suspension": Anonymize<Ibgm4rnf22lal1>;
    /**
     * Transfer some assets from the local chain to the destination chain through their local,
     * destination or remote reserve, or through teleports.
     *
     * Fee payment on the destination side is made from the asset in the `assets` vector of
     * index `fee_asset_item` (hence referred to as `fees`), up to enough to pay for
     * `weight_limit` of weight. If more weight is needed than `weight_limit`, then the
     * operation will fail and the sent assets may be at risk.
     *
     * `assets` (excluding `fees`) must have same reserve location or otherwise be teleportable
     * to `dest`, no limitations imposed on `fees`.
     * - for local reserve: transfer assets to sovereign account of destination chain and
     * forward a notification XCM to `dest` to mint and deposit reserve-based assets to
     * `beneficiary`.
     * - for destination reserve: burn local assets and forward a notification to `dest` chain
     * to withdraw the reserve assets from this chain's sovereign account and deposit them
     * to `beneficiary`.
     * - for remote reserve: burn local assets, forward XCM to reserve chain to move reserves
     * from this chain's SA to `dest` chain's SA, and forward another XCM to `dest` to mint
     * and deposit reserve-based assets to `beneficiary`.
     * - for teleports: burn local assets and forward XCM to `dest` chain to mint/teleport
     * assets and deposit them to `beneficiary`.
     *
     * - `origin`: Must be capable of withdrawing the `assets` and executing XCM.
     * - `dest`: Destination context for the assets. Will typically be `X2(Parent,
     * Parachain(..))` to send from parachain to parachain, or `X1(Parachain(..))` to send
     * from relay to parachain.
     * - `beneficiary`: A beneficiary location for the assets in the context of `dest`. Will
     * generally be an `AccountId32` value.
     * - `assets`: The assets to be withdrawn. This should include the assets used to pay the
     * fee on the `dest` (and possibly reserve) chains.
     * - `fee_asset_item`: The index into `assets` of the item which should be used to pay
     * fees.
     * - `weight_limit`: The remote-side weight limit, if any, for the XCM fee purchase.
     */
    "transfer_assets": Anonymize<I21d2olof7eb60>;
    /**
     * Claims assets trapped on this pallet because of leftover assets during XCM execution.
     *
     * - `origin`: Anyone can call this extrinsic.
     * - `assets`: The exact assets that were trapped. Use the version to specify what version
     * was the latest when they were trapped.
     * - `beneficiary`: The location/account where the claimed assets will be deposited.
     */
    "claim_assets": Anonymize<Ie68np0vpihith>;
    /**
     * Transfer assets from the local chain to the destination chain using explicit transfer
     * types for assets and fees.
     *
     * `assets` must have same reserve location or may be teleportable to `dest`. Caller must
     * provide the `assets_transfer_type` to be used for `assets`:
     * - `TransferType::LocalReserve`: transfer assets to sovereign account of destination
     * chain and forward a notification XCM to `dest` to mint and deposit reserve-based
     * assets to `beneficiary`.
     * - `TransferType::DestinationReserve`: burn local assets and forward a notification to
     * `dest` chain to withdraw the reserve assets from this chain's sovereign account and
     * deposit them to `beneficiary`.
     * - `TransferType::RemoteReserve(reserve)`: burn local assets, forward XCM to `reserve`
     * chain to move reserves from this chain's SA to `dest` chain's SA, and forward another
     * XCM to `dest` to mint and deposit reserve-based assets to `beneficiary`. Typically
     * the remote `reserve` is Asset Hub.
     * - `TransferType::Teleport`: burn local assets and forward XCM to `dest` chain to
     * mint/teleport assets and deposit them to `beneficiary`.
     *
     * On the destination chain, as well as any intermediary hops, `BuyExecution` is used to
     * buy execution using transferred `assets` identified by `remote_fees_id`.
     * Make sure enough of the specified `remote_fees_id` asset is included in the given list
     * of `assets`. `remote_fees_id` should be enough to pay for `weight_limit`. If more weight
     * is needed than `weight_limit`, then the operation will fail and the sent assets may be
     * at risk.
     *
     * `remote_fees_id` may use different transfer type than rest of `assets` and can be
     * specified through `fees_transfer_type`.
     *
     * The caller needs to specify what should happen to the transferred assets once they reach
     * the `dest` chain. This is done through the `custom_xcm_on_dest` parameter, which
     * contains the instructions to execute on `dest` as a final step.
     * This is usually as simple as:
     * `Xcm(vec![DepositAsset { assets: Wild(AllCounted(assets.len())), beneficiary }])`,
     * but could be something more exotic like sending the `assets` even further.
     *
     * - `origin`: Must be capable of withdrawing the `assets` and executing XCM.
     * - `dest`: Destination context for the assets. Will typically be `[Parent,
     * Parachain(..)]` to send from parachain to parachain, or `[Parachain(..)]` to send from
     * relay to parachain, or `(parents: 2, (GlobalConsensus(..), ..))` to send from
     * parachain across a bridge to another ecosystem destination.
     * - `assets`: The assets to be withdrawn. This should include the assets used to pay the
     * fee on the `dest` (and possibly reserve) chains.
     * - `assets_transfer_type`: The XCM `TransferType` used to transfer the `assets`.
     * - `remote_fees_id`: One of the included `assets` to be used to pay fees.
     * - `fees_transfer_type`: The XCM `TransferType` used to transfer the `fees` assets.
     * - `custom_xcm_on_dest`: The XCM to be executed on `dest` chain as the last step of the
     * transfer, which also determines what happens to the assets on the destination chain.
     * - `weight_limit`: The remote-side weight limit, if any, for the XCM fee purchase.
     */
    "transfer_assets_using_type_and_then": Anonymize<I9bnv6lu0crf1q>;
    /**
     * Authorize another `aliaser` location to alias into the local `origin` making this call.
     * The `aliaser` is only authorized until the provided `expiry` block number.
     * The call can also be used for a previously authorized alias in order to update its
     * `expiry` block number.
     *
     * Usually useful to allow your local account to be aliased into from a remote location
     * also under your control (like your account on another chain).
     *
     * WARNING: make sure the caller `origin` (you) trusts the `aliaser` location to act in
     * their/your name. Once authorized using this call, the `aliaser` can freely impersonate
     * `origin` in XCM programs executed on the local chain.
     */
    "add_authorized_alias": Anonymize<Iauhjqifrdklq7>;
    /**
     * Remove a previously authorized `aliaser` from the list of locations that can alias into
     * the local `origin` making this call.
     */
    "remove_authorized_alias": Anonymize<Ie1uso9m8rt5cf>;
    /**
     * Remove all previously authorized `aliaser`s that can alias into the local `origin`
     * making this call.
     */
    "remove_all_authorized_aliases": undefined;
}>;
export type Ia5cotcvi888ln = {
    "dest": XcmVersionedLocation;
    "message": XcmVersionedXcm;
};
export type XcmVersionedXcm = Enum<{
    "V3": Anonymize<Ianvng4e08j9ii>;
    "V4": Anonymize<Iegrepoo0c1jc5>;
    "V5": Anonymize<Ict03eedr8de9s>;
}>;
export declare const XcmVersionedXcm: GetEnum<XcmVersionedXcm>;
export type Ianvng4e08j9ii = Array<XcmV3Instruction>;
export type XcmV3Instruction = Enum<{
    "WithdrawAsset": Anonymize<Iai6dhqiq3bach>;
    "ReserveAssetDeposited": Anonymize<Iai6dhqiq3bach>;
    "ReceiveTeleportedAsset": Anonymize<Iai6dhqiq3bach>;
    "QueryResponse": {
        "query_id": bigint;
        "response": XcmV3Response;
        "max_weight": Anonymize<I4q39t5hn830vp>;
        "querier"?: Anonymize<Ia9cgf4r40b26h>;
    };
    "TransferAsset": {
        "assets": Anonymize<Iai6dhqiq3bach>;
        "beneficiary": Anonymize<I4c0s5cioidn76>;
    };
    "TransferReserveAsset": {
        "assets": Anonymize<Iai6dhqiq3bach>;
        "dest": Anonymize<I4c0s5cioidn76>;
        "xcm": Anonymize<Ianvng4e08j9ii>;
    };
    "Transact": Anonymize<I92p6l5cs3fr50>;
    "HrmpNewChannelOpenRequest": Anonymize<I5uhhrjqfuo4e5>;
    "HrmpChannelAccepted": Anonymize<Ifij4jam0o7sub>;
    "HrmpChannelClosing": Anonymize<Ieeb4svd9i8fji>;
    "ClearOrigin": undefined;
    "DescendOrigin": XcmV3Junctions;
    "ReportError": Anonymize<I4r3v6e91d1qbs>;
    "DepositAsset": {
        "assets": XcmV3MultiassetMultiAssetFilter;
        "beneficiary": Anonymize<I4c0s5cioidn76>;
    };
    "DepositReserveAsset": {
        "assets": XcmV3MultiassetMultiAssetFilter;
        "dest": Anonymize<I4c0s5cioidn76>;
        "xcm": Anonymize<Ianvng4e08j9ii>;
    };
    "ExchangeAsset": {
        "give": XcmV3MultiassetMultiAssetFilter;
        "want": Anonymize<Iai6dhqiq3bach>;
        "maximal": boolean;
    };
    "InitiateReserveWithdraw": {
        "assets": XcmV3MultiassetMultiAssetFilter;
        "reserve": Anonymize<I4c0s5cioidn76>;
        "xcm": Anonymize<Ianvng4e08j9ii>;
    };
    "InitiateTeleport": {
        "assets": XcmV3MultiassetMultiAssetFilter;
        "dest": Anonymize<I4c0s5cioidn76>;
        "xcm": Anonymize<Ianvng4e08j9ii>;
    };
    "ReportHolding": {
        "response_info": Anonymize<I4r3v6e91d1qbs>;
        "assets": XcmV3MultiassetMultiAssetFilter;
    };
    "BuyExecution": {
        "fees": Anonymize<Idcm24504c8bkk>;
        "weight_limit": XcmV3WeightLimit;
    };
    "RefundSurplus": undefined;
    "SetErrorHandler": Anonymize<Ianvng4e08j9ii>;
    "SetAppendix": Anonymize<Ianvng4e08j9ii>;
    "ClearError": undefined;
    "ClaimAsset": {
        "assets": Anonymize<Iai6dhqiq3bach>;
        "ticket": Anonymize<I4c0s5cioidn76>;
    };
    "Trap": bigint;
    "SubscribeVersion": Anonymize<Ieprdqqu7ildvr>;
    "UnsubscribeVersion": undefined;
    "BurnAsset": Anonymize<Iai6dhqiq3bach>;
    "ExpectAsset": Anonymize<Iai6dhqiq3bach>;
    "ExpectOrigin"?: Anonymize<Ia9cgf4r40b26h>;
    "ExpectError"?: Anonymize<I7sltvf8v2nure>;
    "ExpectTransactStatus": XcmV3MaybeErrorCode;
    "QueryPallet": Anonymize<Iba5bdbapp16oo>;
    "ExpectPallet": Anonymize<Id7mf37dkpgfjs>;
    "ReportTransactStatus": Anonymize<I4r3v6e91d1qbs>;
    "ClearTransactStatus": undefined;
    "UniversalOrigin": XcmV3Junction;
    "ExportMessage": {
        "network": XcmV3JunctionNetworkId;
        "destination": XcmV3Junctions;
        "xcm": Anonymize<Ianvng4e08j9ii>;
    };
    "LockAsset": {
        "asset": Anonymize<Idcm24504c8bkk>;
        "unlocker": Anonymize<I4c0s5cioidn76>;
    };
    "UnlockAsset": {
        "asset": Anonymize<Idcm24504c8bkk>;
        "target": Anonymize<I4c0s5cioidn76>;
    };
    "NoteUnlockable": {
        "asset": Anonymize<Idcm24504c8bkk>;
        "owner": Anonymize<I4c0s5cioidn76>;
    };
    "RequestUnlock": {
        "asset": Anonymize<Idcm24504c8bkk>;
        "locker": Anonymize<I4c0s5cioidn76>;
    };
    "SetFeesMode": Anonymize<I4nae9rsql8fa7>;
    "SetTopic": SizedHex<32>;
    "ClearTopic": undefined;
    "AliasOrigin": Anonymize<I4c0s5cioidn76>;
    "UnpaidExecution": Anonymize<I40d50jeai33oq>;
}>;
export declare const XcmV3Instruction: GetEnum<XcmV3Instruction>;
export type Ia9cgf4r40b26h = (Anonymize<I4c0s5cioidn76>) | undefined;
export type I92p6l5cs3fr50 = {
    "origin_kind": XcmV2OriginKind;
    "require_weight_at_most": Anonymize<I4q39t5hn830vp>;
    "call": Uint8Array;
};
export type I4r3v6e91d1qbs = {
    "destination": Anonymize<I4c0s5cioidn76>;
    "query_id": bigint;
    "max_weight": Anonymize<I4q39t5hn830vp>;
};
export type XcmV3MultiassetMultiAssetFilter = Enum<{
    "Definite": Anonymize<Iai6dhqiq3bach>;
    "Wild": XcmV3MultiassetWildMultiAsset;
}>;
export declare const XcmV3MultiassetMultiAssetFilter: GetEnum<XcmV3MultiassetMultiAssetFilter>;
export type XcmV3MultiassetWildMultiAsset = Enum<{
    "All": undefined;
    "AllOf": {
        "id": XcmV3MultiassetAssetId;
        "fun": XcmV2MultiassetWildFungibility;
    };
    "AllCounted": number;
    "AllOfCounted": {
        "id": XcmV3MultiassetAssetId;
        "fun": XcmV2MultiassetWildFungibility;
        "count": number;
    };
}>;
export declare const XcmV3MultiassetWildMultiAsset: GetEnum<XcmV3MultiassetWildMultiAsset>;
export type Iba5bdbapp16oo = {
    "module_name": Uint8Array;
    "response_info": Anonymize<I4r3v6e91d1qbs>;
};
export type I40d50jeai33oq = {
    "weight_limit": XcmV3WeightLimit;
    "check_origin"?: Anonymize<Ia9cgf4r40b26h>;
};
export type Iegrepoo0c1jc5 = Array<XcmV4Instruction>;
export type XcmV4Instruction = Enum<{
    "WithdrawAsset": Anonymize<I50mli3hb64f9b>;
    "ReserveAssetDeposited": Anonymize<I50mli3hb64f9b>;
    "ReceiveTeleportedAsset": Anonymize<I50mli3hb64f9b>;
    "QueryResponse": {
        "query_id": bigint;
        "response": XcmV4Response;
        "max_weight": Anonymize<I4q39t5hn830vp>;
        "querier"?: Anonymize<Ia9cgf4r40b26h>;
    };
    "TransferAsset": {
        "assets": Anonymize<I50mli3hb64f9b>;
        "beneficiary": Anonymize<I4c0s5cioidn76>;
    };
    "TransferReserveAsset": {
        "assets": Anonymize<I50mli3hb64f9b>;
        "dest": Anonymize<I4c0s5cioidn76>;
        "xcm": Anonymize<Iegrepoo0c1jc5>;
    };
    "Transact": Anonymize<I92p6l5cs3fr50>;
    "HrmpNewChannelOpenRequest": Anonymize<I5uhhrjqfuo4e5>;
    "HrmpChannelAccepted": Anonymize<Ifij4jam0o7sub>;
    "HrmpChannelClosing": Anonymize<Ieeb4svd9i8fji>;
    "ClearOrigin": undefined;
    "DescendOrigin": XcmV3Junctions;
    "ReportError": Anonymize<I4r3v6e91d1qbs>;
    "DepositAsset": {
        "assets": XcmV4AssetAssetFilter;
        "beneficiary": Anonymize<I4c0s5cioidn76>;
    };
    "DepositReserveAsset": {
        "assets": XcmV4AssetAssetFilter;
        "dest": Anonymize<I4c0s5cioidn76>;
        "xcm": Anonymize<Iegrepoo0c1jc5>;
    };
    "ExchangeAsset": {
        "give": XcmV4AssetAssetFilter;
        "want": Anonymize<I50mli3hb64f9b>;
        "maximal": boolean;
    };
    "InitiateReserveWithdraw": {
        "assets": XcmV4AssetAssetFilter;
        "reserve": Anonymize<I4c0s5cioidn76>;
        "xcm": Anonymize<Iegrepoo0c1jc5>;
    };
    "InitiateTeleport": {
        "assets": XcmV4AssetAssetFilter;
        "dest": Anonymize<I4c0s5cioidn76>;
        "xcm": Anonymize<Iegrepoo0c1jc5>;
    };
    "ReportHolding": {
        "response_info": Anonymize<I4r3v6e91d1qbs>;
        "assets": XcmV4AssetAssetFilter;
    };
    "BuyExecution": {
        "fees": Anonymize<Ia5l7mu5a6v49o>;
        "weight_limit": XcmV3WeightLimit;
    };
    "RefundSurplus": undefined;
    "SetErrorHandler": Anonymize<Iegrepoo0c1jc5>;
    "SetAppendix": Anonymize<Iegrepoo0c1jc5>;
    "ClearError": undefined;
    "ClaimAsset": {
        "assets": Anonymize<I50mli3hb64f9b>;
        "ticket": Anonymize<I4c0s5cioidn76>;
    };
    "Trap": bigint;
    "SubscribeVersion": Anonymize<Ieprdqqu7ildvr>;
    "UnsubscribeVersion": undefined;
    "BurnAsset": Anonymize<I50mli3hb64f9b>;
    "ExpectAsset": Anonymize<I50mli3hb64f9b>;
    "ExpectOrigin"?: Anonymize<Ia9cgf4r40b26h>;
    "ExpectError"?: Anonymize<I7sltvf8v2nure>;
    "ExpectTransactStatus": XcmV3MaybeErrorCode;
    "QueryPallet": Anonymize<Iba5bdbapp16oo>;
    "ExpectPallet": Anonymize<Id7mf37dkpgfjs>;
    "ReportTransactStatus": Anonymize<I4r3v6e91d1qbs>;
    "ClearTransactStatus": undefined;
    "UniversalOrigin": XcmV3Junction;
    "ExportMessage": {
        "network": XcmV3JunctionNetworkId;
        "destination": XcmV3Junctions;
        "xcm": Anonymize<Iegrepoo0c1jc5>;
    };
    "LockAsset": {
        "asset": Anonymize<Ia5l7mu5a6v49o>;
        "unlocker": Anonymize<I4c0s5cioidn76>;
    };
    "UnlockAsset": {
        "asset": Anonymize<Ia5l7mu5a6v49o>;
        "target": Anonymize<I4c0s5cioidn76>;
    };
    "NoteUnlockable": {
        "asset": Anonymize<Ia5l7mu5a6v49o>;
        "owner": Anonymize<I4c0s5cioidn76>;
    };
    "RequestUnlock": {
        "asset": Anonymize<Ia5l7mu5a6v49o>;
        "locker": Anonymize<I4c0s5cioidn76>;
    };
    "SetFeesMode": Anonymize<I4nae9rsql8fa7>;
    "SetTopic": SizedHex<32>;
    "ClearTopic": undefined;
    "AliasOrigin": Anonymize<I4c0s5cioidn76>;
    "UnpaidExecution": Anonymize<I40d50jeai33oq>;
}>;
export declare const XcmV4Instruction: GetEnum<XcmV4Instruction>;
export type XcmV4AssetAssetFilter = Enum<{
    "Definite": Anonymize<I50mli3hb64f9b>;
    "Wild": XcmV4AssetWildAsset;
}>;
export declare const XcmV4AssetAssetFilter: GetEnum<XcmV4AssetAssetFilter>;
export type XcmV4AssetWildAsset = Enum<{
    "All": undefined;
    "AllOf": {
        "id": Anonymize<I4c0s5cioidn76>;
        "fun": XcmV2MultiassetWildFungibility;
    };
    "AllCounted": number;
    "AllOfCounted": {
        "id": Anonymize<I4c0s5cioidn76>;
        "fun": XcmV2MultiassetWildFungibility;
        "count": number;
    };
}>;
export declare const XcmV4AssetWildAsset: GetEnum<XcmV4AssetWildAsset>;
export type I21jsa919m88fd = {
    "dest": XcmVersionedLocation;
    "beneficiary": XcmVersionedLocation;
    "assets": XcmVersionedAssets;
    "fee_asset_item": number;
};
export type Iegif7m3upfe1k = {
    "message": XcmVersionedXcm;
    "max_weight": Anonymize<I4q39t5hn830vp>;
};
export type Ic76kfh5ebqkpl = {
    "maybe_xcm_version"?: Anonymize<I4arjljr6dpflb>;
};
export type Icscpmubum33bq = {
    "location": XcmVersionedLocation;
};
export type I21d2olof7eb60 = {
    "dest": XcmVersionedLocation;
    "beneficiary": XcmVersionedLocation;
    "assets": XcmVersionedAssets;
    "fee_asset_item": number;
    "weight_limit": XcmV3WeightLimit;
};
export type Ibgm4rnf22lal1 = {
    "suspended": boolean;
};
export type Ie68np0vpihith = {
    "assets": XcmVersionedAssets;
    "beneficiary": XcmVersionedLocation;
};
export type I9bnv6lu0crf1q = {
    "dest": XcmVersionedLocation;
    "assets": XcmVersionedAssets;
    "assets_transfer_type": Enum<{
        "Teleport": undefined;
        "LocalReserve": undefined;
        "DestinationReserve": undefined;
        "RemoteReserve": XcmVersionedLocation;
    }>;
    "remote_fees_id": XcmVersionedAssetId;
    "fees_transfer_type": Enum<{
        "Teleport": undefined;
        "LocalReserve": undefined;
        "DestinationReserve": undefined;
        "RemoteReserve": XcmVersionedLocation;
    }>;
    "custom_xcm_on_dest": XcmVersionedXcm;
    "weight_limit": XcmV3WeightLimit;
};
export type Iauhjqifrdklq7 = {
    "aliaser": XcmVersionedLocation;
    "expires"?: Anonymize<I35p85j063s0il>;
};
export type Ie1uso9m8rt5cf = {
    "aliaser": XcmVersionedLocation;
};
export type I9dpq5287dur8b = AnonymousEnum<{
    /**
     * Set the list of invulnerable (fixed) collators. These collators must do some
     * preparation, namely to have registered session keys.
     *
     * The call will remove any accounts that have not registered keys from the set. That is,
     * it is non-atomic; the caller accepts all `AccountId`s passed in `new` _individually_ as
     * acceptable Invulnerables, and is not proposing a _set_ of new Invulnerables.
     *
     * This call does not maintain mutual exclusivity of `Invulnerables` and `Candidates`. It
     * is recommended to use a batch of `add_invulnerable` and `remove_invulnerable` instead. A
     * `batch_all` can also be used to enforce atomicity. If any candidates are included in
     * `new`, they should be removed with `remove_invulnerable_candidate` after execution.
     *
     * Must be called by the `UpdateOrigin`.
     */
    "set_invulnerables": Anonymize<Ifccifqltb5obi>;
    /**
     * Set the ideal number of non-invulnerable collators. If lowering this number, then the
     * number of running collators could be higher than this figure. Aside from that edge case,
     * there should be no other way to have more candidates than the desired number.
     *
     * The origin for this call must be the `UpdateOrigin`.
     */
    "set_desired_candidates": Anonymize<Iadtsfv699cq8b>;
    /**
     * Set the candidacy bond amount.
     *
     * If the candidacy bond is increased by this call, all current candidates which have a
     * deposit lower than the new bond will be kicked from the list and get their deposits
     * back.
     *
     * The origin for this call must be the `UpdateOrigin`.
     */
    "set_candidacy_bond": Anonymize<Ialpmgmhr3gk5r>;
    /**
     * Register this account as a collator candidate. The account must (a) already have
     * registered session keys and (b) be able to reserve the `CandidacyBond`.
     *
     * This call is not available to `Invulnerable` collators.
     */
    "register_as_candidate": undefined;
    /**
     * Deregister `origin` as a collator candidate. Note that the collator can only leave on
     * session change. The `CandidacyBond` will be unreserved immediately.
     *
     * This call will fail if the total number of candidates would drop below
     * `MinEligibleCollators`.
     */
    "leave_intent": undefined;
    /**
     * Add a new account `who` to the list of `Invulnerables` collators. `who` must have
     * registered session keys. If `who` is a candidate, they will be removed.
     *
     * The origin for this call must be the `UpdateOrigin`.
     */
    "add_invulnerable": Anonymize<I4cbvqmqadhrea>;
    /**
     * Remove an account `who` from the list of `Invulnerables` collators. `Invulnerables` must
     * be sorted.
     *
     * The origin for this call must be the `UpdateOrigin`.
     */
    "remove_invulnerable": Anonymize<I4cbvqmqadhrea>;
    /**
     * Update the candidacy bond of collator candidate `origin` to a new amount `new_deposit`.
     *
     * Setting a `new_deposit` that is lower than the current deposit while `origin` is
     * occupying a top-`DesiredCandidates` slot is not allowed.
     *
     * This call will fail if `origin` is not a collator candidate, the updated bond is lower
     * than the minimum candidacy bond, and/or the amount cannot be reserved.
     */
    "update_bond": Anonymize<I3sdol54kg5jaq>;
    /**
     * The caller `origin` replaces a candidate `target` in the collator candidate list by
     * reserving `deposit`. The amount `deposit` reserved by the caller must be greater than
     * the existing bond of the target it is trying to replace.
     *
     * This call will fail if the caller is already a collator candidate or invulnerable, the
     * caller does not have registered session keys, the target is not a collator candidate,
     * and/or the `deposit` amount cannot be reserved.
     */
    "take_candidate_slot": Anonymize<I8fougodaj6di6>;
}>;
export type Ifccifqltb5obi = {
    "new": Anonymize<Ia2lhg7l2hilo3>;
};
export type Iadtsfv699cq8b = {
    "max": number;
};
export type Ialpmgmhr3gk5r = {
    "bond": bigint;
};
export type I3sdol54kg5jaq = {
    "new_deposit": bigint;
};
export type I8fougodaj6di6 = {
    "deposit": bigint;
    "target": SS58String;
};
export type I77dda7hps0u37 = AnonymousEnum<{
    /**
     * Sets the session key(s) of the function caller to `keys`.
     *
     * Allows an account to set its session key prior to becoming a validator.
     * This doesn't take effect until the next session.
     *
     * - `origin`: The dispatch origin of this function must be signed.
     * - `keys`: The new session keys to set. These are the public keys of all sessions keys
     * setup in the runtime.
     * - `proof`: The proof that `origin` has access to the private keys of `keys`. See
     * [`impl_opaque_keys`](sp_runtime::impl_opaque_keys) for more information about the
     * proof format.
     */
    "set_keys": Anonymize<I81vt5eq60l4b6>;
    /**
     * Removes any session key(s) of the function caller.
     *
     * This doesn't take effect until the next session.
     *
     * The dispatch origin of this function must be Signed and the account must be either be
     * convertible to a validator ID using the chain's typical addressing system (this usually
     * means being a controller account) or directly convertible into a validator ID (which
     * usually means being a stash account).
     */
    "purge_keys": undefined;
}>;
export type I81vt5eq60l4b6 = {
    "keys": SizedHex<32>;
    "proof": Uint8Array;
};
export type Idbvqrcmm7eamc = AnonymousEnum<{
    /**
     * `constitution.set_param` — update one typed, bounded, rate-limited
     * 13 §1 key (I-6).
     *
     * Authority matrix (06 §3.2): PARAM-class keys ⇒ `FutarchyParam`;
     * TREASURY ⇒ `FutarchyTreasury`; META **and META+values** ⇒
     * `FutarchyMeta` (06 §1 bars values from parameter keys; the values
     * half of the dual consent is the guard's execute-time ratification,
     * 06 §2.2 — PLAN SQ-6); CONST/entrenched ⇒ values-layer origins. The
     * welfare low knees are direction-scoped further: constitution raises,
     * entrenched lowers (05 §4.1).
     * No Root path — 09 §5.4's bootstrap-sudo scope is exhaustive and
     * excludes parameter administration (PLAN SQ-11).
     */
    "set_param": Anonymize<Irupv22iu38vu>;
    /**
     * `constitution.set_capability` — insert or replace one capability
     * row (06 §3.2 row 4: a `FutarchyMeta` call; values participates via
     * the rule-altering ratification of 06 §2.2, never direct dispatch).
     *
     * Mirrors `ConstitutionState::set_capability` over the bounded
     * storage form (upsert by `(class, capability)`, bound
     * [`MAX_CAPABILITIES`]); the differential test pins equivalence.
     */
    "set_capability": Anonymize<I7grtu814479f3>;
    /**
     * `constitution.set_phase_flag` — set/clear 02 §7.3 **arming** bits.
     *
     * Root-only and bit-scoped: the sole origin-mediated flag writer the
     * spec names is bootstrap sudo, whose powers include "arming phase
     * flags on evidence" (09 §5.4, Phases 0–3; the Phase-3→4 upgrade
     * removes Root, after which arming bits move with phase-advancement
     * upgrades, 09 §5.2). Only `PhaseFlagsValue::SUDO_ARMABLE_MASK`
     * (bits 0–4) is writable here; the machinery bits — 5 ledger-frozen,
     * 6 dead-man, 7 reserve-health — belong to sibling-pallet state and
     * are reachable only through their dedicated internal setters, so
     * even sudo cannot fake or clear a freeze/dead-man/reserve signal.
     * Full per-bit writer map is PLAN SQ-5. Reserved bits 8–31 rejected.
     */
    "set_phase_flag": Anonymize<I93s1mcesjtqu3>;
    /**
     * `constitution.set_release_channel` — 02 §12 writer (b): the
     * scoped constitution track rewrites the D-14 fixed layout on a
     * canonical repoint, `min_supported_version` bump or key revocation;
     * internal construction may use bare `ConstitutionalValues`.
     * Offsets 112–119 and `URGENT_UPGRADE` are preserved from storage:
     * they are owned exclusively by the execution guard (I-30). Offset
     * 108 `updated_at` is stamped from the current block, never taken
     * from the caller's bytes — 02 §12 makes it the block of the last
     * write, and a caller-chosen value would let a lawful writer
     * backdate the freshness a stranded reader depends on.
     * No other origin — including bootstrap Root — may dispatch this;
     * writer (a) is the execution guard's [`Pallet::note_release_channel`].
     */
    "set_release_channel": Anonymize<I1p86ntl6dn03c>;
    /**
     * `constitution.amend_registry` — amend one key's governance
     * metadata (bounds / max-Δ / cooldown), never its value, class or
     * key set (06 §3.2 row 4; 13 rule 7).
     *
     * Origin: **`FutarchyMeta` only** (SQ-150 ruling 2026-07-21) — non-kernel
     * rows are META-amendable within meta-bounds; the former
     * `ConstitutionalValues`/track paths are removed so no values path can
     * retune metadata the classifier already treats as a belief-side call.
     * Kernel-bounded rows are **immutable**: `checked_amend` refuses them
     * with `KernelBoundImmutable` even under `FutarchyMeta`, so the two
     * error surfaces are `BadOrigin` (any non-META origin) and
     * `KernelBoundImmutable` (META on a kernel row). Every accepted
     * amendment keeps `min ≤ value ≤ max`, preserves the value kind, and
     * keeps `cooldown ≤ 8` epochs. Registry rows are never inserted or
     * removed on-chain — new keys arrive with runtime upgrades (13 §4: the
     * key set is genesis-fixed).
     */
    "amend_registry": Anonymize<I3ri98utbddtsd>;
}>;
export type I7grtu814479f3 = {
    "record": Anonymize<I8i1bk7kj5k5ed>;
};
export type I93s1mcesjtqu3 = {
    "flag": number;
    "enabled": boolean;
};
export type I1p86ntl6dn03c = {
    "bytes": SizedHex<168>;
};
export type I3ri98utbddtsd = {
    "key": SizedHex<16>;
    "min": Anonymize<I9cr49fg6lsgds>;
    "max": Anonymize<I9cr49fg6lsgds>;
    "max_delta"?: Anonymize<Ilmmn5jfnups3>;
    "cooldown_epochs": number;
};
export type Ibr1n81v7cu9sr = AnonymousEnum<{
    /**
     * 03 §5.1. Split `a` USDC into `a` Accept-USDC + `a` Reject-USDC.
     */
    "split": Anonymize<I6bpho1qciu1vq>;
    /**
     * 03 §5.1. Burn a complete Accept+Reject pair, pay `a` USDC out (par).
     */
    "merge": Anonymize<I6bpho1qciu1vq>;
    /**
     * 03 §5.1. Split branch-USDC into a LONG/SHORT scalar set.
     */
    "split_scalar": Anonymize<I23de7n843u7sn>;
    /**
     * 03 §5.1. Merge a LONG/SHORT set back to branch-USDC.
     */
    "merge_scalar": Anonymize<I23de7n843u7sn>;
    /**
     * 03 §5.1. Split branch-USDC into a gate YES/NO set.
     */
    "split_gate": Anonymize<I5fe6dsj65bbns>;
    /**
     * 03 §5.1. Merge a gate YES/NO set back to branch-USDC.
     */
    "merge_gate": Anonymize<I5fe6dsj65bbns>;
    /**
     * 03 §5.1. Move `a` of a position to another account. The recipient pays
     * the storage deposit (03 §4); the R-2 remainder sweep applies to Signed
     * senders.
     */
    "transfer": Anonymize<Ideepm5vhbl12g>;
    /**
     * 03 §5.1. Baseline split.
     */
    "split_baseline": Anonymize<Idasi83b2hi6kd>;
    /**
     * 03 §5.1. Baseline merge.
     */
    "merge_baseline": Anonymize<Idasi83b2hi6kd>;
    /**
     * 03 §5.2. `Open → Resolved(w)` (`ResolveAuthority`, exactly once, I-3).
     */
    "resolve": Anonymize<I3l1prg489cgso>;
    /**
     * 03 §5.2. `Open|Resolved → Voided` (`ResolveAuthority`, not from
     * `ScalarSettled`). Records the terminal block for reaping.
     */
    "void": Anonymize<Ibihfmtr4nutgv>;
    /**
     * 03 §5.2. `Resolved(w) → ScalarSettled{w,s}` (`SettleAuthority`).
     */
    "settle_scalar": Anonymize<I8b0duu38170aj>;
    /**
     * 03 §5.2. Record a winning-branch gate breach outcome (`SettleAuthority`).
     */
    "settle_gate": Anonymize<I7445bslhc0ic2>;
    /**
     * 03 §5.2. Settle a Baseline vault (`SettleAuthority`).
     */
    "settle_baseline": Anonymize<Id6e8lk3pfjocj>;
    /**
     * 03 §5.3. Redeem winning branch-USDC 1:1 (`ScalarSettled`).
     */
    "redeem": Anonymize<I6bpho1qciu1vq>;
    /**
     * 03 §5.3. Redeem a single scalar leg with maker-adverse flooring (B-5).
     */
    "redeem_scalar": Anonymize<I449ug3537vfu2>;
    /**
     * 03 §5.3. Redeem a complete LONG+SHORT pair for exactly `a` (no double
     * flooring, R-1).
     */
    "redeem_scalar_pair": Anonymize<I6bpho1qciu1vq>;
    /**
     * 03 §5.3. Redeem the winning side of a settled gate 1:1.
     */
    "redeem_gate": Anonymize<I7r9r972bl7s6h>;
    /**
     * 03 §5.3. VOID redemption: branch-USDC `floor(a/2)`, legs `floor(a/4)`.
     */
    "redeem_void": Anonymize<I45orgf9ulklgj>;
    /**
     * 03 §5.3. Redeem a single Baseline leg.
     */
    "redeem_baseline": Anonymize<I7gp5f34oc7pki>;
    /**
     * 03 §5.3. Redeem a complete Baseline pair for exactly `a`.
     */
    "redeem_baseline_pair": Anonymize<Idasi83b2hi6kd>;
    /**
     * 03 §5.4. Keeper crank: drain ≤ `ReapBatch` `Positions` entries of a
     * terminal, archive-elapsed proposal vault, refunding deposits; when fully
     * drained, sweep residual escrow to INSURANCE and remove the vault.
     */
    "sweep_dust": Anonymize<Ibihfmtr4nutgv>;
    /**
     * 03 §5.4. Keeper crank for Baseline vaults.
     */
    "sweep_dust_baseline": Anonymize<I36p2bgnnl36ta>;
    /**
     * PB-RESERVE effect endpoint (06 §6.2). Only public split inflows are
     * gated; every exit/recovery path remains live.
     */
    "set_split_paused": Anonymize<I6qcvfaiubjt05>;
    /**
     * PB-LEDGER-FREEZE effect endpoint (06 §6.3). No balances or
     * positions move in this call; it only installs/removes the gate.
     */
    "set_frozen": Anonymize<I7tjbm7l304tu9>;
    /**
     * Permissionless O(1) I-4 reconciliation crank (03 §5.4).
     *
     * `TotalEscrowed` is transactionally maintained by every escrow delta;
     * `try_state` independently re-sums the unbounded claimant-retained vault
     * maps. This dispatch therefore never performs an unbounded scan.
     */
    "reconcile": undefined;
    /**
     * 03 §5.4 / §5.3a(4). Permissionless O(1) keeper crank: move the whole
     * accrued redemption fee from the sovereign to the treasury `MAIN`
     * account and zero the counter, atomically.
     *
     * A sweep on an **empty** counter is a successful no-op, not an error
     * (I-31; §5.3a(6) introduces no error and the §8 list is frozen). It
     * moves surplus, never escrow: `TotalEscrowed`, every vault's
     * `escrowed` and every supply field are untouched, so it cannot
     * underflow — the counter only ever accumulates amounts already
     * withheld from completed payouts. `Preservation::Preserve` keeps the
     * sovereign above its R-4 permanent floor, which L-7 is what makes
     * safe: the accrual is bounded by the surplus **above** `min_balance`,
     * so the crank can always pay out in full.
     *
     * **Frozen under `PB-LEDGER-FREEZE`** (06 §6.3; SQ-517). L-7 is a
     * conditional, and its condition is the negation of the I-4 drift
     * flag: the bound reads `RedemptionFeesAccrued ≤ balance −
     * TotalEscrowed − held_deposits − min_balance`, while the flag says
     * exactly that `TotalEscrowed + held_deposits > balance` — so under
     * the one state that authorizes a freeze the bound is *negative* and
     * there is no surplus to sweep. "Moves surplus, never escrow" then
     * stops being true, and `Preservation::Preserve` does not rescue it:
     * it protects `min_balance` and is indifferent to escrow. Refusing
     * here is what keeps the paragraph above accurate on every path this
     * crank can actually take.
     */
    "sweep_redemption_fees": undefined;
}>;
export type Ideepm5vhbl12g = {
    "position": Anonymize<I5m1k92kcp4o6d>;
    "to": SS58String;
    "amount": bigint;
};
export type I3l1prg489cgso = {
    "pid": bigint;
    "winner": Anonymize<Iefmskl524g3a7>;
};
export type I8b0duu38170aj = {
    "pid": bigint;
    "s": bigint;
};
export type I7445bslhc0ic2 = {
    "pid": bigint;
    "gate": Anonymize<I5mifn3r4bq1hg>;
    "outcome": boolean;
};
export type I449ug3537vfu2 = {
    "pid": bigint;
    "side": Anonymize<Idfomgju2lejvi>;
    "amount": bigint;
};
export type I7r9r972bl7s6h = {
    "pid": bigint;
    "gate": Anonymize<I5mifn3r4bq1hg>;
    "amount": bigint;
};
export type I45orgf9ulklgj = {
    "pid": bigint;
    "branch": Anonymize<Iefmskl524g3a7>;
    "kind": Anonymize<I4pkqc50hbjmhi>;
    "amount": bigint;
};
export type I7gp5f34oc7pki = {
    "epoch": number;
    "side": Anonymize<Idfomgju2lejvi>;
    "amount": bigint;
};
export type I6qcvfaiubjt05 = {
    "paused": boolean;
    "expiry": number;
};
export type I7tjbm7l304tu9 = {
    "frozen": boolean;
};
export type Icljcl39701nuq = AnonymousEnum<{
    /**
     * Buy LONG or SHORT from an LMSR book (04 §6).
     */
    "buy": Anonymize<I7kcd6p94nv55v>;
    /**
     * Sell LONG or SHORT into an LMSR book (04 §6).
     */
    "sell": Anonymize<I483r8098di3t5>;
    /**
     * Permissionless TWAP observation keeper (04 §7).
     */
    "crank_observe": Anonymize<Ico0ou8pmf1cq5>;
    /**
     * Permissionlessly realize a closed book's protocol value once its
     * owning vault is terminal — the 04 §2 **Sweep** stage, and the custody
     * half of 08 §8 step 5. Every **realizable** position the book account
     * holds is redeemed to real USDC and returned to the account that
     * funded the seed (`POL` for decision and gate books, `POL_BASELINE`
     * for the Baseline book), and the treasury's matching budget line is
     * credited so `NAV` recognizes the custody again.
     *
     * "Realizable" is not "complete sets": after any asymmetric walk the
     * book holds complete sets **plus an unmatched residual leg**, because
     * delivery removes single legs while revenue recycling mints pairs, and
     * at an interior `s` that leg pays `floor(a·s)`/`floor(a·(1−s)) > 0`.
     * Returning only the sets would leave exactly that value for reap to
     * discard into ledger residue bound for `INSURANCE` — the 08 §10.5 leak
     * this milestone exists to close. Only provably zero-payout positions
     * are left behind: losing-branch instruments and the losing side of a
     * settled gate.
     *
     * Idempotent: the swept marker is written in the same storage layer as
     * the remittance, so a repeat call is a successful no-op rather than a
     * second payment and a partially applied sweep is unreachable.
     * Fail-soft: it is a separate crank that no settlement path calls, so
     * it can never fail a settlement (G-1); a failure leaves the book
     * unswept, unreapable and retryable — an NAV-recognition delay, not a
     * solvency defect, since the value is still fully collateralized in the
     * ledger sovereign.
     *
     * The **fee leg** (E2) runs in the same atomic layer and is what makes
     * the market fee a revenue instrument rather than a sink (04 §6.1;
     * 08 §1.1). It has two shapes because collection has two: a decision or
     * gate book accrues branch-USDC into its fee account, which redeems to
     * USDC paid straight to `MAIN`; a Baseline book retains its sell-side
     * fee as **plain USDC** in the book account, which is transferred above
     * the 03 §7 R-4 `min_balance` floor and leaves that floor exactly where
     * R-4 puts it. Reaching `MAIN` custody is only half of it — `nav()` is
     * computed from the treasury's internal `main_usdc` counter, so the
     * arrival is recognized through [`MainRevenueSink`] in the same layer.
     *
     * **Frozen by the owning ledger domain's I-4 status** (04 §2; 06
     * §6.3; 16 §10; I-37), because the fee leg redeems through an
     * *internal* ledger path. Protocol books consult the primary market
     * freeze; external books consult only the service instance's freeze.
     * An unguarded sweep could collect the protocol's own claim out of a
     * possibly-short sovereign while that domain's claimants are refused,
     * while consulting the other domain would wrongly strand independent
     * capital. The crank effects no terminal transition, so delaying it
     * until its own ledger is payout-safe leaves value collateralized and
     * retryable.
     */
    "sweep_revenue": Anonymize<Ico0ou8pmf1cq5>;
    /**
     * Permissionlessly reap a closed book after `ArchiveDelay` (04 §2).
     */
    "reap": Anonymize<Ico0ou8pmf1cq5>;
    /**
     * PB-DEPEG effect endpoint: freeze only new market creation/seeding.
     */
    "freeze_creation": Anonymize<Ie38ogc3bkfpu>;
    /**
     * PB-LEDGER-FREEZE effect endpoint. `true` installs exactly the
     * kernel 14-day backstop; `false` clears early/reverts expiry.
     */
    "set_frozen": Anonymize<I7tjbm7l304tu9>;
}>;
export type I7kcd6p94nv55v = {
    "market": bigint;
    "side": Anonymize<Idfomgju2lejvi>;
    "amount": bigint;
    "max_cost": bigint;
};
export type I483r8098di3t5 = {
    "market": bigint;
    "side": Anonymize<Idfomgju2lejvi>;
    "amount": bigint;
    "min_proceeds": bigint;
};
export type Ie38ogc3bkfpu = {
    "expiry": number;
};
export type I5q6e6bd4h95a4 = AnonymousEnum<{
    /**
     * Register a metric-track-approved version. Activation is implicit and
     * the core enforces the two-epoch lead time.
     */
    "register_spec": Anonymize<Iasovm2m56clga>;
    /**
     * Permissionless signed keeper crank for one **finalized** epoch's
     * snapshot. The epoch must have closed (`epoch < CurrentEpoch`; 05 §4.6
     * winsorizes over finalized epoch values), else the crank is rejected —
     * this stops an early/future call from locking a wrong `W` or consuming
     * the bounded snapshot window before the real counters exist.
     */
    "record_snapshot": Anonymize<I3s764kupqvvc3>;
    /**
     * Permissionless signed keeper crank for a **finalized** epoch's daily
     * S/C gate sample. Like `record_snapshot`, the epoch must have closed
     * (`epoch < CurrentEpoch`) so the day's counters are final (05 §4.7).
     *
     * `day` must lie in the epoch's **measurable day set** (05 §4.7): its
     * whole days, floored at one. `MAX_DAILY_GATE_SAMPLES` is the *storage*
     * bound on the breach bitmap and is not the semantic bound — for every
     * permitted `epoch.length` there are day indices below it that the epoch
     * never contained, and resolving one of those would let a keeper drive
     * `C_daily` down out of components that were never measured (`X` reads
     * its no-traffic 1, `K` reads 0 because nobody authored in a day that
     * never elapsed, `R` refuses). The day is therefore refused, not
     * resolved to any value.
     */
    "record_daily_gate": Anonymize<Ide781hv7v8ek3>;
}>;
export type Iasovm2m56clga = {
    "version": number;
    "specs": Anonymize<Iept8gvj9an6pj>;
};
export type I3s764kupqvvc3 = {
    "epoch": number;
    "spec_version": number;
};
export type Ide781hv7v8ek3 = {
    "epoch": number;
    "day": number;
    "spec_version": number;
};
export type Icmv05grq5pm7i = AnonymousEnum<{
    /**
     * `oracle.register_reporter` — permissionless entry, `orc.reporter_stake`
     * held (07 §3). Signed.
     */
    "register_reporter": undefined;
    /**
     * `oracle.deregister_reporter` — exit once every round the reporter
     * participated in is closed; stake returned (07 §3). Signed.
     */
    "deregister_reporter": undefined;
    /**
     * `oracle.report` — attest one value for `(component, epoch)` under the
     * frozen spec version, round-1 bond held (07 §5.1). Signed by a
     * registered reporter. The window end, expected version and `StakeAtRisk`
     * are derived via [`Config::Reporting`], never taken from the caller.
     */
    "report": Anonymize<I4n0jfeme2dupj>;
    /**
     * `oracle.challenge` — post the current-round bond against a report;
     * proof of observability that supersedes the quorum rule (07 §5.2).
     * Signed. `spec_version` disambiguates per-version games (07 §2(4)).
     */
    "challenge": Anonymize<Iejr8qrqkqh148>;
    /**
     * `oracle.counter_report` — the reporter's signed consent to advance
     * a challenged game. The keeper close path never creates this round or
     * its bond; the reporter must fund it explicitly (07 §5.3).
     */
    "counter_report": Anonymize<I4n0jfeme2dupj>;
    /**
     * `oracle.recompute_proof` — permissionless mechanical resolution from
     * the committed evidence, bounded at `orc.max_proof_bytes` (07 §9).
     * Signed (keeper, rebated). Fails closed for non-recomputable components.
     */
    "recompute_proof": Anonymize<Ie00dqaka54s56>;
    /**
     * `oracle.register_watchtower` — permissionless-with-stake entry,
     * `wt.stake` held, ≤ `wt.max = 16` seats (07 §4). Signed.
     */
    "register_watchtower": undefined;
    /**
     * `oracle.ack_observed` — a registered watchtower asserts a round was
     * visible in a finalized block; O(1), keeper-class rebate (07 §4).
     * Signed. `spec_version` selects the per-version round.
     */
    "ack_observed": Anonymize<I97fq4k68v5pmh>;
    /**
     * `oracle.crank_round_close(batch)` — permissionless bounded crank that
     * resolves matured rounds: quorum ⇒ final; no quorum ⇒ one extension then
     * neutral; challenged ⇒ escalate (07 §4/§5). Signed (keeper, rebated).
     */
    "crank_round_close": Anonymize<Ifh9jjrch89bli>;
    /**
     * `oracle.crank_reserve_probe` — permissionless probe crank: first counts
     * any timed-out outstanding probe as a fail (fail-static, 07 §8), then
     * sends the next probe if `res.probe_interval` has elapsed. Signed
     * (keeper, rebated). The pallet commits state first, then fires the
     * XCM-free [`ProbeDispatch`] seam; send failure remains fail-static
     * through the pending probe's timeout (I-24, rule 7).
     */
    "crank_reserve_probe": undefined;
    /**
     * `oracle.adjudicate` — the sole privileged call: the `OracleResolution`
     * values track settles a terminal dispute and, if the reporter is found
     * wrong, forfeits its bond stack (07 §5.4/§5.5).
     */
    "adjudicate": Anonymize<I17o91bl727r0j>;
}>;
export type I4n0jfeme2dupj = {
    "component": number;
    "epoch": number;
    "spec_version": number;
    "value": bigint;
    "evidence_hash": SizedHex<32>;
};
export type Iejr8qrqkqh148 = {
    "component": number;
    "epoch": number;
    "spec_version": number;
    "counter_value": bigint;
    "evidence_hash": SizedHex<32>;
};
export type Ie00dqaka54s56 = {
    "component": number;
    "epoch": number;
    "spec_version": number;
    "proof": Uint8Array;
};
export type I97fq4k68v5pmh = {
    "component": number;
    "epoch": number;
    "spec_version": number;
    "round": number;
    "report_hash": SizedHex<32>;
};
export type Ifh9jjrch89bli = {
    "batch": number;
};
export type I17o91bl727r0j = {
    "component": number;
    "epoch": number;
    "spec_version": number;
    "value": bigint;
    "reporter_wrong": boolean;
};
export type I4vus28icvst66 = AnonymousEnum<{
    /**
     * 07 §7. File a bonded claim about an off-chain fact. Holds the
     * value-scaled bond floored by `reg.bond_{incident,milestone}`, then
     * opens a 72 h challenge window under the §4 quorum rule.
     */
    "file": Anonymize<Idbt6597auf3g2>;
    /**
     * 07 §7. Challenge a live filing, posting the matching bond; opens the
     * single counter-round (registry games do not escalate).
     */
    "challenge_filing": Anonymize<I3nkq26pmovr9u>;
    /**
     * 07 §4/§7. A registered watchtower acknowledges a filing's
     * observability. O(1); the runtime rebates the keeper-class fee.
     */
    "ack_observed": Anonymize<I1mjueefcqgdaj>;
    /**
     * 07 §7. Keeper crank: close ≤ `REG_CLOSE_BATCH` due filings of `epoch` —
     * unchallenged + quorum ⇒ upheld (bond refunded); quorum failure ⇒ one
     * 48 h extension, then rejected-as-unobservable (bond refunded, §4).
     */
    "crank_close": Anonymize<Ict5mnga93gs4g>;
    /**
     * 07 §7. Resolve a challenged filing's counter-round: the loser forfeits
     * the bond 40 / 60. The verdict arrives on the `OracleResolution` values
     * track (07 §5.4) via [`Config::ResolutionAuthority`], which is the
     * registry's **only** terminal path — §9's mechanical `recompute_proof`
     * needs a `formula_ref` a bonded off-chain-fact claim does not have, and
     * §7's escalation alternative needs a `(component, epoch)` game that an
     * Incident filing has no component for (`I` is not a `MetricId`).
     *
     * `evidence_hash` must restate the hash the challenge committed, and the
     * counter-round window must have elapsed. Both bind the discretion the
     * single terminal path necessarily carries (SQ-294).
     */
    "resolve_challenge": Anonymize<If97gtgn6okleo>;
    /**
     * 07 §7. Keeper: once every filing of `epoch` is terminal, derive the
     * aggregate (Incident: `max(0, 1 − Σ severity)`, "no filings ⇒ 1";
     * Milestone: `points ÷ target`) and hand it to welfare.
     */
    "close_epoch": Anonymize<I3s764kupqvvc3>;
    /**
     * 07 §7. Keeper: reap a closed epoch's archived filings + acks + the
     * aggregate — only once `ArchiveDelay` blocks have elapsed since close, so
     * welfare has consumed the aggregate (cohort settlement) before the
     * records are destroyed. A permissionless reap without this gate would let
     * a griefer erase an incident before settlement and re-open the epoch.
     */
    "reap_epoch": Anonymize<I3s764kupqvvc3>;
}>;
export type Idbt6597auf3g2 = {
    "epoch": number;
    "class": Anonymize<I8mm8h51ml90lv>;
    "points": number;
    "evidence_hash": SizedHex<32>;
    "spec_version": number;
};
export type I3nkq26pmovr9u = {
    "epoch": number;
    "filing_id": number;
    "evidence_hash": SizedHex<32>;
};
export type Ict5mnga93gs4g = {
    "epoch": number;
    "batch": number;
};
export type If97gtgn6okleo = {
    "epoch": number;
    "filing_id": number;
    "uphold": boolean;
    "evidence_hash": SizedHex<32>;
};
export type Ia8mbqijnlnh5l = AnonymousEnum<{
    /**
     * `treasury.fund_budget_line(line, amount)` — move `amount` from `MAIN`
     * into a budget line (08 §1.1). Origin: `FutarchyTreasury`, or the
     * stored ops multisig for a runway-capped reserve-probe top-up until
     * the first successful positive TREASURY reserve-probe funding.
     */
    "fund_budget_line": Anonymize<I5c87v6pd2sdaf>;
    /**
     * `treasury.spend(line, dest, amount)` — a direct in-cap grant
     * (08 §1.3/§1.4). Rejected above `trs.stream_threshold` (`StreamRequired`),
     * above `trs.cap_proposal`×NAV (`ProposalCapExceeded`), under the
     * reserve haircut (`ReserveImpaired`), or over a rolling meter
     * (`MeterExhausted`). Origin: `FutarchyTreasury`.
     */
    "spend": Anonymize<I5l0jsir5si80s>;
    /**
     * `treasury.open_stream(line, recipient, total, start, duration)` — a
     * mandatory vesting stream for a grant > `trs.stream_threshold`
     * (08 §1.3/§1.4). The `line` names the funding budget line (08 §1.1:
     * outflow calls MUST name a line; the 08 §1.4 signature omits it — see
     * PLAN note). Origin: `FutarchyTreasury`.
     */
    "open_stream": Anonymize<I86uhg8ivvk3a8>;
    /**
     * `treasury.claim_stream(id)` — the recipient claims vested funds
     * (08 §1.4, Signed recipient).
     */
    "claim_stream": Anonymize<I4ov6e94l79mbg>;
    /**
     * `treasury.cancel_stream(id)` — a later TREASURY decision cancels a
     * stream; the undisbursed remainder reverts to `MAIN` (08 §1.3).
     * Origin: `FutarchyTreasury`.
     */
    "cancel_stream": Anonymize<I4ov6e94l79mbg>;
    /**
     * `treasury.issue_vit(amount, line)` — mint VIT within the rolling
     * `iss.inflation_cap` window to a `REWARDS`/`ops.*` line (08 §2.3).
     * Origin: `FutarchyTreasury`.
     */
    "issue_vit": Anonymize<I5c87v6pd2sdaf>;
    /**
     * `treasury.recover_foreign(asset, dest, amount)` — sweep assets sent to
     * pallet accounts outside protocol flows (08 §1.3, TREASURY-class only,
     * never a protocol asset). Origin: `FutarchyTreasury`.
     */
    "recover_foreign": Anonymize<I3dg8tbt6tcck6>;
    /**
     * `treasury.execute_coretime_renewal(period_index)` — pay the
     * runtime-noted renewal quote from `ops.coretime` (09 §4). Permissionless
     * Signed keeper, idempotent per period, freeze-exempt (D-9), bounded by
     * the pre-authorized line balance and the noted quote (a keeper can
     * neither fund a period for free nor choose the amount).
     */
    "execute_coretime_renewal": Anonymize<Ibnicuotj4pjfm>;
    /**
     * Note or supersede an authenticated Coretime renewal quote (09 §4).
     */
    "note_coretime_quote": Anonymize<I4gj9mv93je4sv>;
    /**
     * Prune an expired quote, or allow its authority to prune it early.
     */
    "prune_coretime_quote": Anonymize<Ibnicuotj4pjfm>;
    /**
     * Rotate the Coretime quote authority and funded renewal account.
     */
    "set_coretime_authority": Anonymize<I3f8ncpioik5na>;
    /**
     * `treasury.sweep_insurance(amount)` — the sole admissible outflow of
     * the INSURANCE account (08 §1.2/§1.4, SQ-207).
     *
     * Origin: `FutarchyTreasury` only, i.e. a passed TREASURY-class
     * decision — no guardian power, playbook or admin origin can reach it.
     * Destination: `MAIN`, and only `MAIN`; the sweep never pays a third
     * party, so every existing control (budget lines, §1.3 rolling meters,
     * stream thresholds, the reserve-health flag) governs the funds
     * afterwards. Takes no budget line by design — it is an inbound
     * transfer *to* `MAIN`, and 08 §1.2 rejected a `BudgetLine::Insurance`
     * outright.
     *
     * INSURANCE sits outside NAV (08 §1.2), so a sweep raises NAV by
     * exactly `amount`. Custody moves under `Preservation::Preserve`: at
     * most `balance − min_balance` is sweepable and an over-large request
     * fails whole rather than reaping this 03 §7 R-4 permanent account
     * (G-1). Accounting is credited first and custody second, so a custody
     * refusal rolls the credit back with the dispatch.
     */
    "sweep_insurance": Anonymize<I3qt1hgg4djhgb>;
    /**
     * `treasury.reconcile_insurance()` — the 08 §1.2 permissionless
     * reconciliation crank for the bounded INSURANCE reserve.
     *
     * The automatic above-target overflow covers every inflow that executes
     * treasury code. It cannot cover the rest, and 08 §1.2 says so plainly:
     * INSURANCE has a deterministic address and `ForeignAssets.transfer`
     * and its siblings are **public** calls (06 §3.3), so any account may
     * push USDC into it with no treasury code running and no interception
     * point to hook. Such a balance sits above `T_ins` until something
     * looks; this is what looks.
     *
     * Signed and permissionless, like every other keeper crank here: it
     * names no beneficiary, chooses no amount, and can move value to
     * exactly one place — `MAIN` — so there is nothing for a caller to
     * steer. Idempotent and a **no-op at or below target** (`Ok`, no
     * custody move, no event), which is what makes repeated cranking free.
     *
     * **Rebated from the ≤ 20 % general tranche when it actually moves
     * surplus** (08 §6.3; SQ-523). §6.3's closed decision-critical list
     * puts every *other* sanctioned permissionless keeper crank on the
     * general tranche, and this is one — it was the only such crank left
     * unpaid, which mattered more once SQ-518 made it the sole backstop
     * for un-interceptable direct transfers. The `> 0` condition follows
     * the orphan-Baseline precedent in the same section: a crank requests
     * a rebate only when it changes state, so the idempotent no-op at or
     * below target stays unrebated and repeated cranking cannot drain the
     * meter.
     */
    "reconcile_insurance": undefined;
    /**
     * `treasury.create_community_schedule(beneficiary, amount)` — the
     * bounded Phase-4 distribution mechanism (08 §2.1, 09 §7). A passed
     * PARAM decision authorizes one transfer from the keyless community
     * pot. The starting block is the exact block recorded by the Phase-4
     * transition; `per_block` is floor-rounded so the claimant can never
     * unlock ahead of the 24-month horizon. The SDK adapter moves custody
     * and installs the lock before the remaining pot is reduced.
     */
    "create_community_schedule": Anonymize<Idscf6boak49q1>;
}>;
export type I86uhg8ivvk3a8 = {
    "line": Anonymize<Iesceati3hrhp6>;
    "recipient": SS58String;
    "total": bigint;
    "start": number;
    "duration": number;
};
export type I4ov6e94l79mbg = {
    "id": bigint;
};
export type Idscf6boak49q1 = {
    "beneficiary": SS58String;
    "amount": bigint;
};
export type Iframrl69h51nv = AnonymousEnum<{
    /**
     * `guardian.set_members` — install the seven elected council members
     * (06 §5.1). Authority: `ConstitutionalValues` (06 §3.2 row 5). Resets
     * every seat's bond to the full 50,000 VIT and, on a re-election, drops
     * the outgoing council's un-dispatched actions + approvals (the core's
     * `set_members`) so no recalled member's live approval carries over —
     * then persists the whole cleared aggregate.
     */
    "set_members": Anonymize<I3ajpo6bheav6q>;
    /**
     * `guardian.propose_action` — a member proposes an action (06 §5.1).
     * `Signed`; the member check is enforced in the core. The proposer's
     * own approval is recorded automatically.
     */
    "propose_action": Anonymize<Iaoh4afnk8h0fj>;
    /**
     * `guardian.approve_action` — a member approves a pending action
     * (06 §5.1). `Signed`; the fifth approval dispatches the action's
     * effect atomically (records it + schedules the retrospective review).
     */
    "approve_action": Anonymize<Ie239vtc2egj50>;
    /**
     * `guardian.ratify_action` — the `ratify` referendum records a passed
     * retrospective review (06 §5.4; 06 §3.2 row 6). Authority:
     * `ConstitutionalValues`.
     */
    "ratify_action": Anonymize<Ie239vtc2egj50>;
    /**
     * `guardian.renew_playbook` — the single admissible `PB-LEDGER-FREEZE`
     * renewal via a `guardian`-track referendum (06 §6.3; 06 §3.2 row 6).
     * Authority: the scoped `GuardianTrack` AdminOrigin.
     */
    "renew_playbook": Anonymize<I4m6dhgb2ar055>;
    /**
     * Uphold a `delay_once` veto through its live ratify-track review. The
     * verdict and T24 transition are one storage transaction.
     */
    "uphold_veto": Anonymize<Ie239vtc2egj50>;
    /**
     * Enact a guardian-track recall for a failed action. Every recorded
     * approver still seated is removed; residual bonds remain held for one
     * further epoch and live approvals are cleared fail-closed.
     */
    "recall": Anonymize<Ie239vtc2egj50>;
    /**
     * Enable/disable one of the six kernel-enumerated playbooks. This is
     * availability only; adding/amending a routine is a runtime change.
     */
    "set_playbook_registered": Anonymize<I8m9idjg76ip7q>;
}>;
export type Iaoh4afnk8h0fj = {
    "power": Anonymize<I5ae66jaqfj2lj>;
    "justification_hash": SizedHex<32>;
};
export type Ie239vtc2egj50 = {
    "action_id": number;
};
export type Iduphmdloc4ns1 = AnonymousEnum<{
    /**
     * Install the values-elected member set (06 §3.2 row 5, §7).
     */
    "set_members": Anonymize<I3c63j6sh3evqn>;
    /**
     * Submit a member's bonded artifact attestation (06 §7). Membership
     * and duplicate checks are enforced by the core; the two admission
     * checks below are runtime-state questions the frame-free core cannot
     * answer, and both are evaluated before any write (G-1).
     */
    "attest": Anonymize<Idpghfv397i03j>;
    /**
     * Open a bonded challenge inside an attestation's 72-hour window
     * (06 §3.2 signed row, §7).
     */
    "challenge_attestation": Anonymize<I1iqmhg9l6j4g5>;
    /**
     * Resolve an open challenge through the `ratify` track (06 §7).
     * Permissionless deterministic-recomputation resolution is deferred
     * until B-track reproducible-build verification is available.
     */
    "resolve_challenge": Anonymize<Ifdhckj0h8qpv2>;
    /**
     * Remove an attestor with an explicit cause and revoke every
     * unexecuted record atomically (06 §7, contract v12).
     */
    "remove_for_cause": Anonymize<I4uk5nmqsi401j>;
    /**
     * Permissionlessly reap a terminal, settled record and release the
     * departing attestor's remaining bond basis when its last record is
     * gone.
     */
    "reap_attestation": Anonymize<I7eloeoebplnvf>;
}>;
export type Idpghfv397i03j = {
    "pid": bigint;
    "artifact_hash": SizedHex<32>;
    "statement_hash": SizedHex<32>;
};
export type I1iqmhg9l6j4g5 = {
    "attestation_id": number;
    "evidence_hash": SizedHex<32>;
    "bond": bigint;
};
export type Ifdhckj0h8qpv2 = {
    "attestation_id": number;
    "attestation_upheld": boolean;
};
export type I7eloeoebplnvf = {
    "attestation_id": number;
};
export type I9v7u028ou7e4g = AnonymousEnum<{
    "submit": Anonymize<Icu0h2un8nbhct>;
    "withdraw": Anonymize<Ibihfmtr4nutgv>;
    /**
     * Permissionless bounded crank. An empty batch advances only the phase
     * clock; each item is idempotent when no transition is due.
     *
     * The A13 collator payout is composed here rather than folded into the
     * benchmarked `tick` number: it fires only on an epoch crossing, and
     * `tick`'s benchmarked worst case is a full batch *without* one, so no
     * single fixture measures both. Charging it unconditionally is the
     * conservative direction — a crossing is only known after dispatch
     * (SQ-490). SQ-499 keeps that pre-charge and refunds this addend only
     * when the payout branch was not taken.
     */
    "tick": Anonymize<Ifoljaehihf3a6>;
    /**
     * Charges the A13 collator payout for the same reason `tick` does: this
     * is a clock-syncing entry point, so it can be the crossing's first
     * caller (SQ-490).
     */
    "decide": Anonymize<Ibihfmtr4nutgv>;
    /**
     * Charges the A13 collator payout for the same reason `tick` does: this
     * is a clock-syncing entry point, so it can be the crossing's first
     * caller (SQ-490).
     */
    "settle_cohort": Anonymize<Ict5mnga93gs4g>;
    /**
     * META/ConstitutionalValues refresh of the next-boundary epoch length.
     */
    "set_next_epoch_length": undefined;
    "delay_once": Anonymize<If5i6c2m5d9b65>;
    "mark_executed": Anonymize<Ibihfmtr4nutgv>;
    "mark_failed_executed": Anonymize<Ibihfmtr4nutgv>;
    "retry_exhausted_to_measurement": Anonymize<Ibihfmtr4nutgv>;
    "expire_or_stale_queue": Anonymize<I9ihjoku7164ou>;
    "force_reject_process_hold": Anonymize<Ibihfmtr4nutgv>;
    "void_cohort": Anonymize<I36p2bgnnl36ta>;
    /**
     * PB-HALT-INTAKE effect endpoint (06 §6.2). Clearing ignores the
     * supplied expiry; setting is bounded independently of guardian state.
     */
    "set_intake_paused": Anonymize<I6qcvfaiubjt05>;
    /**
     * 05 §7(6) orphan-epoch Baseline finalization (SQ-320; 03 §5.2).
     *
     * An epoch that opened a Baseline book but never formed a cohort has
     * no producer for its Baseline settlement, so the vault stays `Open`
     * forever, every single-sided holder is stranded, and the book keeps
     * an un-reapable POL commitment. This crank reaches exactly that case
     * — a strictly past, cohort-free, summary-free epoch whose every
     * proposal is terminal across both bounded storage halves
     * (`IntakeProposals` and `Proposals`) — and is a harmless no-op when
     * the vault is absent or already settled (G-1).
     *
     * Permissionless `Signed` per the 06 §3.2 authority matrix, and
     * deliberately unaffected by `PB-LEDGER-FREEZE` (06 §6.3 exempts
     * settlement calls; the freeze's own T20 sweep is one broad way an
     * epoch can be orphaned). Emits no epoch event: the settlement's
     * canonical signal is the ledger's frozen `BaselineSettled` (02 §6).
     */
    "finalize_epoch_baseline": Anonymize<I36p2bgnnl36ta>;
    /**
     * Permissionless crank for the two 07 boundaries the oracle owns and the
     * epoch clock schedules: §4's watchtower liveness sweep at each rollover,
     * and §11(1)'s `OracleSettleDeadline` force-neutralization at d20
     * (SQ-182/SQ-491).
     *
     * A separate call rather than a rider on `tick`/`decide`/`settle_cohort`
     * because both callbacks hydrate the whole bounded oracle aggregate, and
     * 13 §5 pins `decide` at 231,055 B of proof against a 384 KiB ceiling —
     * the aggregate alone measures 356,514 B, so the worst case does not fit
     * inside a per-block crank at all. 07 §11(1) calls this a crank and §13
     * gives the oracle no hooks, so this is also the shape the spec asks for.
     * Idempotent: every leg is a no-op once its boundary has been driven.
     */
    "drive_oracle_boundaries": undefined;
    /**
     * Proposer-authorized binding for the CODE/META values referendum.
     * The referendum may still be ongoing; the execution guard records
     * the submitted index separately from the eventual passed
     * `RatificationRecord` (06 §2.2, 09 §1.1(4), SQ-145). Keeping this
     * endpoint on epoch makes the proposer check independent of the
     * guard's internal origin seams and permits a pre-queue binding.
     */
    "bind_ratification": Anonymize<I7661jqlhbtghb>;
}>;
export type Icu0h2un8nbhct = {
    "proposal": Anonymize<Iflkot84bd90qk>;
};
export type Ifoljaehihf3a6 = {
    "pids": Anonymize<Iafqnechp3omqg>;
};
export type I9ihjoku7164ou = {
    "pid": bigint;
    "reason"?: (Anonymize<Ibabj9dc2c6tv1>) | undefined;
};
export type I9ro47d3g602ga = AnonymousEnum<{
    /**
     * Permissionless 09 §1.2 execution crank.
     */
    "execute": Anonymize<Ibihfmtr4nutgv>;
    /**
     * Permissionless second phase of the authorized-upgrade flow.
     */
    "apply_authorized_upgrade": Anonymize<I6pjjpfvhvcfru>;
    /**
     * T22 keeper crank after the bounded T18 retry window.
     */
    "expire_failed_execution": Anonymize<Ibihfmtr4nutgv>;
    /**
     * Sole ratify-track governance call (06 §2.2/§3.2).
     */
    "ratify": Anonymize<I7661jqlhbtghb>;
    /**
     * Permissionless T16 cleanup for a deterministically stale,
     * unratified-at-grace, or revoked-attestation queue entry.
     */
    "reject_stale": Anonymize<Ibihfmtr4nutgv>;
    /**
     * Commit the pre-attested recovery Wasm carried by the same
     * values-ratified CODE/META payload as its primary authorization.
     * The call is useful only inside the guard's transient dispatch
     * context; a bare custom-origin dispatch therefore still fails.
     */
    "commit_recovery_image": Anonymize<Ic23t0smeuk6mq>;
    /**
     * One-shot Phase-3→4 bridge. Bootstrap sudo may select only a passed
     * shadow CODE/META mandate; all authorization checks and the sole
     * internal-Root dispatch remain inside the guard (I-10).
     */
    "authorize_phase_four": Anonymize<If5i6c2m5d9b65>;
    /**
     * Permissionless, one-image recovery qualification. This operational
     * call is the only healthy-chain path that reads the full recovery
     * Wasm; epoch screening and queue admission consume the immutable
     * cached descriptor with bounded storage proofs.
     */
    "qualify_recovery_image": Anonymize<Ibihfmtr4nutgv>;
}>;
export type I23ib5mtvcma28 = AnonymousEnum<{
    /**
     * Admit an exact XCM location and hold the live `svc.client_bond`
     * amount from its nominated local funder.
     */
    "admit_client": Anonymize<I5h8g89cqhubt3>;
    /**
     * Admit one exact local signer. The identity account is also the only
     * account the question service may debit for USDC escrow.
     */
    "admit_local_client": Anonymize<I3gvjatq4m8h18>;
    /**
     * Close new-question admission immediately. Existing questions retain
     * the origin and bond until the final terminal notification.
     */
    "remove_client": Anonymize<I8vsdam138s0ak>;
    /**
     * Move exact USDC from this client's runtime-derived funding account
     * into its deterministic delivery escrow.
     */
    "top_up_delivery_float": Anonymize<I3qt1hgg4djhgb>;
    /**
     * Return exact USDC only to the runtime-derived client funder.
     */
    "withdraw_delivery_float": Anonymize<I3qt1hgg4djhgb>;
}>;
export type I5h8g89cqhubt3 = {
    "location": Anonymize<If9iqq7i64mur8>;
    "bond_owner": SS58String;
    "sub_id_policy": Anonymize<I8jh0enk7f0r9l>;
};
export type I3gvjatq4m8h18 = {
    "local_signer": SS58String;
    "bond_owner": SS58String;
    "sub_id_policy": Anonymize<I8jh0enk7f0r9l>;
};
export type I8vsdam138s0ak = {
    "client_id": number;
};
export type Ics0nn1f06vofu = AnonymousEnum<{
    /**
     * Register, escrow and create the exact two external books atomically.
     */
    "register": Anonymize<I68s7org31qt4d>;
    /**
     * Authenticate and fund one client-named attestor promise.
     */
    "bond_attestor": Anonymize<Ielk7f0jb1jt1u>;
    /**
     * Atomically expose both pre-seeded books to trading.
     */
    "open": Anonymize<Ielk7f0jb1jt1u>;
    /**
     * Seal both TWAP windows, publish the sold report, resolve the branch,
     * and earn instrument D exactly once.
     */
    "seal": Anonymize<Ielk7f0jb1jt1u>;
    /**
     * Store the signed attestor's latest in-window value.
     */
    "submit_attestation": Anonymize<I7n5sdbabu8l7g>;
    /**
     * Permissionless successful/failing settlement crank after the frozen
     * report window. Every error path becomes VOID in the same transaction.
     */
    "settle": Anonymize<Ielk7f0jb1jt1u>;
    /**
     * Permissionless clock-driven failure crank. For a sealed question it
     * shares the terminalizer with `settle`, so transaction ordering can
     * never VOID a valid quorum.
     */
    "void": Anonymize<Ielk7f0jb1jt1u>;
    /**
     * PB-HALT-INTAKE effect: stop new registration/seal work and mark every
     * bounded live question for VOID at its next clock deadline.
     */
    "set_paused": Anonymize<I1qpch3k96pn83>;
    /**
     * Remove the external-pair capacity row and service-owned retained rows
     * only after both books and the service-ledger vault completed reaping.
     */
    "archive": Anonymize<Ielk7f0jb1jt1u>;
}>;
export type I68s7org31qt4d = {
    "input": {
        "sub_id"?: Anonymize<I4s6vifaf8k998>;
        "declared_stake": bigint;
        "epsilon_1e9": bigint;
        "tolerance_1e9": bigint;
        "window_start": number;
        "window_end": number;
        "b": bigint;
        "rule": bigint;
        "attestors": Anonymize<Ia2lhg7l2hilo3>;
    };
};
export type I1qpch3k96pn83 = {
    "until"?: Anonymize<I4arjljr6dpflb>;
};
export type Iaqet9jc3ihboe = {
    "header": Anonymize<Ic952bubvq4k7d>;
    "extrinsics": Anonymize<Itom7fk49o0c9>;
};
export type I2v50gu3s1aqk6 = AnonymousEnum<{
    "AllExtrinsics": undefined;
    "OnlyInherents": undefined;
}>;
export type I4gil44d08grh = {
    "prefix": SizedHex<16>;
    "suffix": SizedHex<16>;
};
export type I7u915mvkdsb08 = ResultPayload<Uint8Array, Enum<{
    "NotImplemented": undefined;
    "NotFound": Anonymize<I4gil44d08grh>;
    "Codec": undefined;
}>>;
export type I7g3jnj59cuc3k = {
    "index": number;
    "phase": Anonymize<Ia8er6i31jhjhd>;
    "phase_start_block": number;
    "next_boundary": number;
    "dead_man_armed": boolean;
    "ledger_frozen": boolean;
    "phase_flags": number;
};
export type I3nir9l71btsd5 = Array<{
    "id": bigint;
    "class": Anonymize<I2hfnh9jsghgur>;
    "state": Anonymize<I4jen3q60pp5qd>;
    "proposer": SizedHex<32>;
    "epoch": number;
    "payload_hash": SizedHex<32>;
    "ask": bigint;
    "decision_market"?: (Anonymize<I200n1ov5tbcvr>) | undefined;
    "gate_markets"?: Anonymize<Ic4rgfgksgmm3e>;
    "decide_at": number;
    "maturity"?: Anonymize<I4arjljr6dpflb>;
    "ratification": Anonymize<I1pb9rgjl7sl5l>;
    "funder": SizedHex<32>;
}>;
export type I1pb9rgjl7sl5l = AnonymousEnum<{
    "NotRequired": undefined;
    "NoPassedRecord": undefined;
    "Passed": {
        "referendum": number;
    };
}>;
export type I6bep0s8nf1jn4 = {
    "cost": bigint;
    "fee": bigint;
    "p_after_1e9": bigint;
    "max_trade": bigint;
    "within_domain": boolean;
    "evaluable": boolean;
};
export type Idbhri2uj6av22 = ({
    "pid": bigint;
    "twap_accept_1e9": bigint;
    "twap_reject_1e9": bigint;
    "twap_baseline_1e9": bigint;
    "r_eff_1e9": bigint;
    "trailing_accept_1e9": bigint;
    "trailing_reject_1e9": bigint;
    "coverage_pct": number;
    "traded_volume": bigint;
    "v_min_required": bigint;
    "converged": boolean;
    "gate_twaps_1e9"?: Anonymize<Ic4rgfgksgmm3e>;
    "attack_cost_hat": bigint;
    "in_cap_prize": bigint;
}) | undefined;
export type Ietccudq8ucajb = Array<{
    "position": Anonymize<I5m1k92kcp4o6d>;
    "balance": bigint;
    "vault_state": Anonymize<I2i509mmosaj3i>;
}>;
export type I3fvgo362krtrr = Array<{
    "pid": bigint;
    "class": Anonymize<I2hfnh9jsghgur>;
    "payload_hash": SizedHex<32>;
    "maturity": number;
    "grace_end": number;
    "version_constraint": Anonymize<I8dfqph7nh6ls>;
    "cancelled": boolean;
    "ratification": Anonymize<I1pb9rgjl7sl5l>;
    "meters_clear": boolean;
}>;
export type Ifi0c8r8eomqru = {
    "epoch": number;
    "spec_version": number;
    "s_pillar_1e9": bigint;
    "c_onchain_1e9": bigint;
    "c_attested_1e9": bigint;
    "p_pillar_1e9": bigint;
    "a_pillar_1e9": bigint;
    "gate_s_1e9": bigint;
    "gate_c_1e9": bigint;
    "w_current_1e9": bigint;
    "s_breached": boolean;
    "c_breached": boolean;
    "reserve_flag": boolean;
    "active_spec_available": boolean;
};
export type I6tacm14gh0jtv = Array<SizedHex<16>>;
export type Ibe056naqv5jeg = Array<{
    "key": SizedHex<16>;
    "value": bigint;
    "min": bigint;
    "max": bigint;
    "max_delta": bigint;
    "cooldown_blocks": number;
    "last_change": number;
    "class": Anonymize<I2hfnh9jsghgur>;
    "min_next": bigint;
    "max_next": bigint;
}>;
export type Ifpv42fvgi4b3 = {
    "total": bigint;
    "main": bigint;
    "pol": bigint;
    "insurance": bigint;
    "keeper": bigint;
    "oracle": bigint;
    "rewards": bigint;
    "stream_remainders": bigint;
    "obligations": bigint;
    "haircut_flag": boolean;
    "spendable_nav": bigint;
    "meter_utilization_bps": number;
    "class_floors": Anonymize<I4totqt881mlti>;
};
export type I8s95j32t1rrnr = Array<{
    "component": number;
    "epoch": number;
    "spec_version": number;
    "round": number;
    "reporter": SizedHex<32>;
    "value_1e9": bigint;
    "evidence_hash": SizedHex<32>;
    "bond": bigint;
    "challenge_deadline": number;
    "acked_by_watchtowers": number;
    "escalated": boolean;
}>;
export type If9jrft6hbnnq = (Anonymize<I7tusvhvaa2qim>) | undefined;
export type I607t5e3e5mnk5 = (Array<{
    "market": bigint;
    "book_loss_usdc": bigint;
    "lmsr_loss_bound_usdc": bigint;
}>) | undefined;
export type Ie8c3gf89pirvk = (Array<{
    "market": bigint;
    "start": number;
    "end": number;
    "coverage_percent": number;
}>) | undefined;
export type Idt3pdmk8m17j6 = (Array<{
    "component": Enum<{
        "Pol": undefined;
        "Baseline": undefined;
    }>;
    "effective_pol_usdc": bigint;
    "pol_floor_usdc": bigint;
}>) | undefined;
export type I8fksma6odit5g = ({
    "custody_usdc": bigint;
    "liability_usdc": bigint;
    "anomalous_rounding_dust_usdc": bigint;
}) | undefined;
export type I996aiv3qoehvi = (Array<{
    "map": Uint8Array;
    "entries": number;
    "bound": number;
}>) | undefined;
export type I4fj3mptf3jr0q = (Array<{
    "client_id": number;
    "attempts": bigint;
    "failures": bigint;
    "consecutive_failures": number;
}>) | undefined;
export type I1ervt5j2e1l9d = ResultPayload<Anonymize<I7ugh66e61mfbv>, Anonymize<I5nrjkj9qumobs>>;
export type I5nrjkj9qumobs = AnonymousEnum<{
    "Invalid": Enum<{
        "Call": undefined;
        "Payment": undefined;
        "Future": undefined;
        "Stale": undefined;
        "BadProof": undefined;
        "AncientBirthBlock": undefined;
        "ExhaustsResources": undefined;
        "Custom": number;
        "BadMandatory": undefined;
        "MandatoryValidation": undefined;
        "BadSigner": undefined;
        "IndeterminateImplicit": undefined;
        "UnknownOrigin": undefined;
    }>;
    "Unknown": TransactionValidityUnknownTransaction;
}>;
export type TransactionValidityUnknownTransaction = Enum<{
    "CannotLookup": undefined;
    "NoUnsignedValidator": undefined;
    "Custom": number;
}>;
export declare const TransactionValidityUnknownTransaction: GetEnum<TransactionValidityUnknownTransaction>;
export type If7uv525tdvv7a = Array<[SizedHex<8>, Uint8Array]>;
export type I2an1fs2eiebjp = {
    "okay": boolean;
    "fatal_error": boolean;
    "errors": Anonymize<If7uv525tdvv7a>;
};
export type TransactionValidityTransactionSource = Enum<{
    "InBlock": undefined;
    "Local": undefined;
    "External": undefined;
}>;
export declare const TransactionValidityTransactionSource: GetEnum<TransactionValidityTransactionSource>;
export type I9ask1o4tfvcvs = ResultPayload<{
    "priority": bigint;
    "requires": Anonymize<Itom7fk49o0c9>;
    "provides": Anonymize<Itom7fk49o0c9>;
    "longevity": bigint;
    "propagate": boolean;
}, Anonymize<I5nrjkj9qumobs>>;
export type I4ph3d1eepnmr1 = {
    "keys": Uint8Array;
    "proof": Uint8Array;
};
export type Icerf8h8pdu8ss = (Array<[Uint8Array, SizedHex<4>]>) | undefined;
export type I15h4jnb8b841p = Array<Enum<{
    "Top": Uint8Array;
    "Child": {
        "storage_key": Uint8Array;
        "key": Uint8Array;
    };
}>>;
export type I6spmpef2c7svf = {
    "weight": Anonymize<I4q39t5hn830vp>;
    "class": DispatchClass;
    "partial_fee": bigint;
};
export type Iei2mvq0mjvt81 = {
    "inclusion_fee"?: ({
        "base_fee": bigint;
        "len_fee": bigint;
        "adjusted_weight_fee": bigint;
    }) | undefined;
    "tip": bigint;
};
export type Icscgdrls4bngd = AnonymousEnum<{
    "System": Anonymize<Iekve0i6djpd9f>;
    "Timestamp": Anonymize<I7d75gqfg6jh9c>;
    "ParachainSystem": Anonymize<I3u72uvpuo4qrt>;
    "ParachainInfo": undefined;
    "Balances": Anonymize<I9svldsp29mh87>;
    "ForeignAssets": Anonymize<I52be8isndtif4>;
    "Vesting": Anonymize<Icgf8vmtkbnu4u>;
    "Referenda": Anonymize<I6ihmi5bjusj9v>;
    "ConvictionVoting": Anonymize<Ie5kd08tutk56t>;
    "Preimage": Anonymize<If81ks88t5mpk5>;
    "Scheduler": Anonymize<I96cem93jt0mha>;
    "Utility": Anonymize<I8cbh0i0c7taeq>;
    "Proxy": Anonymize<Ibn5bl4c53tkcc>;
    "Multisig": Anonymize<Icldk30vd63l55>;
    "Migrations": Anonymize<I4oqb168b2d4er>;
    "Sudo": Anonymize<I7lcknubdnmpn9>;
    "XcmpQueue": Anonymize<Ib7tahn20bvsep>;
    "MessageQueue": Anonymize<Ic2uoe7jdksosp>;
    "CumulusXcm": undefined;
    "PolkadotXcm": Anonymize<I6k1inef986368>;
    "CollatorSelection": Anonymize<I9dpq5287dur8b>;
    "Session": Anonymize<I77dda7hps0u37>;
    "Constitution": Anonymize<Idbvqrcmm7eamc>;
    "ConditionalLedger": Anonymize<Ibr1n81v7cu9sr>;
    "Market": Anonymize<Icljcl39701nuq>;
    "Welfare": Anonymize<I5q6e6bd4h95a4>;
    "Oracle": Anonymize<Icmv05grq5pm7i>;
    "IncidentRegistry": Anonymize<I4vus28icvst66>;
    "MilestoneRegistry": Anonymize<I4vus28icvst66>;
    "FutarchyTreasury": Anonymize<Ia8mbqijnlnh5l>;
    "Guardian": Anonymize<Iframrl69h51nv>;
    "Attestor": Anonymize<Iduphmdloc4ns1>;
    "Epoch": Anonymize<I9v7u028ou7e4g>;
    "ExecutionGuard": Anonymize<I9ro47d3g602ga>;
    "ClientRegistry": Anonymize<I23ib5mtvcma28>;
    "QuestionService": Anonymize<Ics0nn1f06vofu>;
    "ServiceLedger": Anonymize<Ibr1n81v7cu9sr>;
}>;
export type Ic1d4u2opv3fst = {
    "upward_messages": Anonymize<Itom7fk49o0c9>;
    "horizontal_messages": Anonymize<I6r5cbv8ttrb09>;
    "new_validation_code"?: Anonymize<Iabpgqcjikia83>;
    "processed_downward_messages": number;
    "hrmp_watermark": number;
    "head_data": Uint8Array;
};
export type Ie9sr1iqcg3cgm = ResultPayload<undefined, string>;
export type I1mqgk2tmnn9i2 = (string) | undefined;
export type I6lr8sctk0bi4e = Array<string>;
export {};
