export const DAILY_FREE_ATTEMPTS = 3
export const PAID_ATTEMPT_COST_NOTF = 10

export function getDayKey(date = new Date()) {
  return date.toISOString().slice(0, 10)
}

export function ensureLedgerEntry(state, walletAddress, dayKey = getDayKey()) {
  let ledger = state.dailyAttemptLedger.find(
    (entry) => entry.walletAddress === walletAddress && entry.dayKey === dayKey,
  )

  if (!ledger) {
    ledger = {
      walletAddress,
      dayKey,
      freeUsed: 0,
      paidCredits: 0,
      paidConsumed: 0,
      updatedAt: new Date().toISOString(),
    }
    state.dailyAttemptLedger.push(ledger)
  }

  return ledger
}

export function summarizeQuota(ledger) {
  return {
    freeLimit: DAILY_FREE_ATTEMPTS,
    freeUsed: ledger.freeUsed,
    freeRemaining: Math.max(0, DAILY_FREE_ATTEMPTS - ledger.freeUsed),
    paidCredits: ledger.paidCredits,
    paidConsumed: ledger.paidConsumed,
    paidAttemptCostNotf: PAID_ATTEMPT_COST_NOTF,
  }
}
