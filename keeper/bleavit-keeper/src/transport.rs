//! Transport-error classification for reconnect and endpoint failover.
//!
//! Subxt 0.50 replaced its flat `Error::{Io,Rpc}` variants with API-specific
//! errors. Keep this matcher deliberately structural: backend/RPC failures and
//! dropped streams trigger failover, while metadata, SCALE, dispatch, and other
//! protocol errors do not.

use subxt::error::{
    AccountNonceError, BackendError, BlockError, BlocksError, CombinedBackendError, Error,
    EventsError, ExtrinsicError, OnlineClientAtBlockError, OnlineClientError, RpcError,
    RuntimeApiError, StorageError, TransactionEventsError, TransactionFinalizedSuccessError,
    TransactionProgressError, ViewFunctionError,
};

pub(crate) fn is_transport(error: &Error) -> bool {
    match error {
        Error::OnlineClientError(error) => online_client(error),
        Error::OnlineClientAtBlockError(error) => online_client_at_block(error),
        Error::BlockError(error) => block(error),
        Error::BackendError(error) => backend(error),
        Error::BlocksError(error) => blocks(error),
        Error::AccountNonceError(error) => account_nonce(error),
        Error::RuntimeApiError(error) => runtime_api(error),
        Error::EventsError(error) => events(error),
        Error::ExtrinsicError(error) => extrinsic(error),
        Error::ViewFunctionError(error) => view_function(error),
        Error::TransactionProgressError(error) => transaction_progress(error),
        Error::TransactionEventsError(error) => transaction_events(error),
        Error::TransactionFinalizedSuccessError(error) => transaction_finalized(error),
        Error::StorageError(error) => storage(error),
        Error::CombinedBackendError(error) => combined_backend(error),
        Error::OtherRpcClientError(error) => rpc_client(error),
        _ => false,
    }
}

fn online_client(error: &OnlineClientError) -> bool {
    match error {
        OnlineClientError::RpcError(error) => rpc_client(error),
        OnlineClientError::CannotBuildCombinedBackend(error) => combined_backend(error),
        OnlineClientError::CannotGetGenesisHash(error) => backend(error),
        _ => false,
    }
}

fn combined_backend(error: &CombinedBackendError) -> bool {
    match error {
        CombinedBackendError::CouldNotObtainRpcMethodList(error) => rpc_client(error),
        _ => false,
    }
}

fn blocks(error: &BlocksError) -> bool {
    match error {
        BlocksError::CannotGetCurrentBlock(error) => online_client_at_block(error),
        BlocksError::CannotGetBlockHeaderStream(error)
        | BlocksError::CannotGetBlockHeader(error) => backend(error),
        _ => false,
    }
}

fn online_client_at_block(error: &OnlineClientAtBlockError) -> bool {
    match error {
        OnlineClientAtBlockError::CannotGetCurrentBlock { reason }
        | OnlineClientAtBlockError::CannotGetBlockHash { reason, .. }
        | OnlineClientAtBlockError::CannotGetBlockHeader { reason, .. }
        | OnlineClientAtBlockError::CannotGetSpecVersion { reason, .. } => backend(reason),
        // Subxt currently stringifies the backend error for metadata RPCs. Its
        // own messages keep RPC-call failures distinct from decode/not-found
        // failures, so preserve that distinction rather than classifying every
        // metadata failure as transport.
        OnlineClientAtBlockError::CannotGetMetadata { reason, .. } => {
            metadata_rpc_transport(reason)
        }
        _ => false,
    }
}

fn metadata_rpc_transport(reason: &str) -> bool {
    let Some((_, rpc_error)) = reason
        .strip_prefix("Error calling ")
        .and_then(|reason| reason.split_once(": Backend error: RPC error: "))
    else {
        return false;
    };
    [
        "RPC error: RPC error: client error:",
        "RPC error: RPC error: the connection was lost",
        "RPC error: limit reached",
        "RPC error: subscription dropped.",
    ]
    .iter()
    .any(|transport| rpc_error.starts_with(transport))
}

fn block(error: &BlockError) -> bool {
    match error {
        BlockError::CouldNotDownloadBlockHeader { reason, .. } => backend(reason),
        _ => false,
    }
}

fn account_nonce(error: &AccountNonceError) -> bool {
    match error {
        AccountNonceError::CouldNotRetrieve(error) => backend(error),
        _ => false,
    }
}

fn runtime_api(error: &RuntimeApiError) -> bool {
    match error {
        RuntimeApiError::CannotCallApi(error) => backend(error),
        _ => false,
    }
}

fn events(error: &EventsError) -> bool {
    match error {
        EventsError::CannotFetchEventBytes(error) => backend(error),
        _ => false,
    }
}

fn extrinsic(error: &ExtrinsicError) -> bool {
    match error {
        ExtrinsicError::CannotGetBlockBody(error)
        | ExtrinsicError::ErrorSubmittingTransaction(error)
        | ExtrinsicError::TransactionStatusStreamError(error)
        | ExtrinsicError::CannotGetFeeInfo(error)
        | ExtrinsicError::CannotGetValidationInfo(error) => backend(error),
        ExtrinsicError::AccountNonceError { reason, .. } => account_nonce(reason),
        // In 0.44, an unexpectedly ended transaction subscription was
        // RpcError::SubscriptionDropped and therefore triggered failover.
        ExtrinsicError::UnexpectedEndOfTransactionStatusStream => true,
        _ => false,
    }
}

fn view_function(error: &ViewFunctionError) -> bool {
    match error {
        ViewFunctionError::CannotCallApi(error) => backend(error),
        _ => false,
    }
}

fn transaction_progress(error: &TransactionProgressError) -> bool {
    match error {
        TransactionProgressError::CannotGetNextProgressUpdate(error) => backend(error),
        // This was RpcError::SubscriptionDropped in Subxt 0.44.
        TransactionProgressError::UnexpectedEndOfTransactionStatusStream => true,
        _ => false,
    }
}

fn transaction_events(error: &TransactionEventsError) -> bool {
    match error {
        TransactionEventsError::CannotFetchBlockBody { error, .. } => backend(error),
        TransactionEventsError::CannotDecodeEventInBlock { error, .. }
        | TransactionEventsError::CannotFetchEventsForTransaction { error, .. } => events(error),
        TransactionEventsError::CannotInstantiateClientAtBlock(error) => {
            online_client_at_block(error)
        }
        _ => false,
    }
}

fn transaction_finalized(error: &TransactionFinalizedSuccessError) -> bool {
    match error {
        TransactionFinalizedSuccessError::FinalizationError(error) => transaction_progress(error),
        TransactionFinalizedSuccessError::SuccessError(error) => transaction_events(error),
        _ => false,
    }
}

fn storage(error: &StorageError) -> bool {
    match error {
        StorageError::CannotFetchValue(error)
        | StorageError::CannotIterateValues(error)
        | StorageError::StreamFailure(error) => backend(error),
        _ => false,
    }
}

fn backend(error: &BackendError) -> bool {
    match error {
        BackendError::Rpc(error) => rpc(error),
        // A custom backend's opaque error is not enough evidence to call a
        // protocol/decode failure a transport failure.
        BackendError::Other(_) => false,
        _ => false,
    }
}

fn rpc(error: &RpcError) -> bool {
    match error {
        RpcError::ClientError(error) => rpc_client(error),
        RpcError::LimitReached | RpcError::SubscriptionDropped => true,
        _ => false,
    }
}

fn rpc_client(error: &subxt::rpcs::Error) -> bool {
    match error {
        // Subxt documents Client as an underlying RPC-client problem such as
        // network I/O, in contrast to User (invalid method/parameters).
        subxt::rpcs::Error::Client(_) | subxt::rpcs::Error::DisconnectedWillReconnect(_) => true,
        subxt::rpcs::Error::User(_)
        | subxt::rpcs::Error::Serialization(_)
        | subxt::rpcs::Error::Deserialization(_)
        | subxt::rpcs::Error::Decode(_)
        | subxt::rpcs::Error::InsecureUrl(_) => false,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hash() -> subxt::error::Hex {
        Vec::<u8>::new().into()
    }

    fn metadata_call_reason(error: BackendError) -> String {
        format!("Error calling Metadata_metadata_at_version: {error}")
    }

    #[test]
    fn backend_rpc_and_dropped_streams_trigger_failover() {
        let client = subxt::rpcs::Error::Client(Box::new(std::io::Error::new(
            std::io::ErrorKind::ConnectionReset,
            "connection reset",
        )));
        let error = Error::BackendError(BackendError::Rpc(RpcError::ClientError(client)));
        assert!(is_transport(&error));

        let error = Error::TransactionProgressError(
            TransactionProgressError::UnexpectedEndOfTransactionStatusStream,
        );
        assert!(is_transport(&error));

        let error = Error::StorageError(StorageError::StreamFailure(BackendError::Rpc(
            RpcError::SubscriptionDropped,
        )));
        assert!(is_transport(&error));
    }

    #[test]
    fn rpc_user_and_decode_errors_do_not_trigger_failover() {
        let user = subxt::rpcs::UserError {
            code: -32602,
            message: "invalid params".to_owned(),
            data: None,
        };
        let error = Error::OtherRpcClientError(subxt::rpcs::Error::User(user));
        assert!(!is_transport(&error));

        let error = Error::AccountNonceError(AccountNonceError::CouldNotDecode(
            parity_scale_codec::Error::from("bad nonce"),
        ));
        assert!(!is_transport(&error));

        let error =
            Error::OnlineClientAtBlockError(OnlineClientAtBlockError::CannotDecodeSpecVersion {
                block_hash: hash(),
                reason: parity_scale_codec::Error::from("bad runtime version"),
            });
        assert!(!is_transport(&error));
    }

    #[test]
    fn stringified_metadata_rpc_failure_stays_distinct_from_decode_failure() {
        let transport =
            BackendError::Rpc(RpcError::ClientError(subxt::rpcs::Error::Client(Box::new(
                std::io::Error::new(std::io::ErrorKind::ConnectionReset, "connection reset"),
            ))));
        let rpc = Error::OnlineClientAtBlockError(OnlineClientAtBlockError::CannotGetMetadata {
            block_hash: hash(),
            reason: metadata_call_reason(transport),
        });
        assert!(is_transport(&rpc));

        let user = subxt::rpcs::UserError {
            code: -32602,
            message: "invalid params; RPC error: client error: spoofed".to_owned(),
            data: None,
        };
        let user = Error::OnlineClientAtBlockError(OnlineClientAtBlockError::CannotGetMetadata {
            block_hash: hash(),
            reason: metadata_call_reason(BackendError::Rpc(RpcError::ClientError(
                subxt::rpcs::Error::User(user),
            ))),
        });
        assert!(!is_transport(&user));

        let decode = Error::OnlineClientAtBlockError(OnlineClientAtBlockError::CannotGetMetadata {
            block_hash: hash(),
            reason: "Error decoding response for Metadata_metadata_at_version: bad bytes"
                .to_owned(),
        });
        assert!(!is_transport(&decode));
    }
}
