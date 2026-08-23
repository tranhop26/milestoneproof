export type TransactionPhase =
  | "DISCONNECTED"
  | "AWAITING_SIGNATURE"
  | "PENDING"
  | "FINALIZED"
  | "SUCCESS"
  | "ERROR"
  | "READBACK"

export type TransactionErrorCode =
  | "WALLET_DISCONNECTED"
  | "SIGNATURE_REJECTED"
  | "WRONG_NETWORK"
  | "EXECUTION_FAILED"
  | "READBACK_FAILED"
  | "LOCAL_CONFIRMATION_FAILED"
  | "RPC_ERROR"

export type TransactionProgressPhase = Exclude<TransactionPhase, "DISCONNECTED" | "ERROR">

export interface TransactionState {
  phase: TransactionPhase
  progressPhase?: TransactionProgressPhase
  hash?: `0x${string}`
  code?: TransactionErrorCode
  message: string
}

export interface FinalizedExecution {
  executionSucceeded: boolean
  error?: string
}

export interface TransactionAdapter<TReadback> {
  assertReady: () => void | Promise<void>
  submit: () => Promise<`0x${string}`>
  waitForFinalized: (hash: `0x${string}`) => Promise<FinalizedExecution>
  readback: () => Promise<TReadback>
}

export interface TransactionRunOptions<TReadback> {
  onReadbackConfirmed?: (readback: TReadback) => void
}

export class TransactionLifecycleError extends Error {
  constructor(
    public readonly code: TransactionErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = "TransactionLifecycleError"
  }
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown transaction error"
}

function normalizeSubmissionError(error: unknown): TransactionLifecycleError {
  if (error instanceof TransactionLifecycleError) return error
  const providerCode = typeof error === "object" && error !== null && "code" in error
    ? (error as { code?: unknown }).code
    : undefined
  if (providerCode === 4001 || providerCode === "ACTION_REJECTED") {
    return new TransactionLifecycleError(
      "SIGNATURE_REJECTED",
      "The wallet signature request was rejected.",
      { cause: error },
    )
  }
  return new TransactionLifecycleError("RPC_ERROR", messageFrom(error), { cause: error })
}

function readyFailureState(error: TransactionLifecycleError): TransactionState {
  if (error.code === "WALLET_DISCONNECTED") {
    return { phase: "DISCONNECTED", code: error.code, message: error.message }
  }
  return { phase: "ERROR", code: error.code, message: error.message }
}

export async function runWriteAndReadback<TReadback>(
  adapter: TransactionAdapter<TReadback>,
  onState: (state: TransactionState) => void,
  options: TransactionRunOptions<TReadback> = {},
): Promise<TReadback> {
  try {
    await adapter.assertReady()
  } catch (error) {
    const normalized = error instanceof TransactionLifecycleError
      ? error
      : new TransactionLifecycleError("RPC_ERROR", messageFrom(error), { cause: error })
    onState(readyFailureState(normalized))
    throw normalized
  }

  onState({ phase: "AWAITING_SIGNATURE", message: "Confirm this transaction in your wallet." })

  let hash: `0x${string}`
  try {
    hash = await adapter.submit()
  } catch (error) {
    const normalized = normalizeSubmissionError(error)
    onState({ phase: "ERROR", progressPhase: "AWAITING_SIGNATURE", code: normalized.code, message: normalized.message })
    throw normalized
  }

  onState({ phase: "PENDING", hash, message: "Transaction submitted. Waiting for consensus." })

  let execution: FinalizedExecution
  try {
    execution = await adapter.waitForFinalized(hash)
  } catch (error) {
    const normalized = new TransactionLifecycleError("RPC_ERROR", messageFrom(error), { cause: error })
    onState({ phase: "ERROR", progressPhase: "PENDING", hash, code: normalized.code, message: normalized.message })
    throw normalized
  }

  onState({ phase: "FINALIZED", hash, message: "Consensus finalized. Checking execution result." })
  if (!execution.executionSucceeded) {
    const normalized = new TransactionLifecycleError(
      "EXECUTION_FAILED",
      execution.error || "The contract rejected this transaction.",
    )
    onState({ phase: "ERROR", progressPhase: "FINALIZED", hash, code: normalized.code, message: normalized.message })
    throw normalized
  }

  onState({ phase: "SUCCESS", hash, message: "Contract execution succeeded." })

  let readback: TReadback
  try {
    readback = await adapter.readback()
  } catch (error) {
    const normalized = new TransactionLifecycleError(
      "READBACK_FAILED",
      "Execution succeeded, but authoritative readback could not be confirmed.",
      { cause: error },
    )
    onState({ phase: "ERROR", progressPhase: "SUCCESS", hash, code: normalized.code, message: normalized.message })
    throw normalized
  }

  try {
    options.onReadbackConfirmed?.(readback)
  } catch (error) {
    const normalized = new TransactionLifecycleError(
      "LOCAL_CONFIRMATION_FAILED",
      "Contract readback succeeded, but the local confirmation update failed.",
      { cause: error },
    )
    onState({ phase: "ERROR", progressPhase: "READBACK", hash, code: normalized.code, message: normalized.message })
    throw normalized
  }
  onState({ phase: "READBACK", hash, message: "Authoritative contract readback confirmed." })
  return readback
}
