import { formatWallet } from '../lib/formatters'

export function WalletPanel({
  session,
  quota,
  isBusy,
  phase,
  onConnect,
  onStartRound,
  onUnlockPaidRound,
}) {
  const buttonLabel = session
    ? `Wallet ${formatWallet(session.walletAddress)}`
    : isBusy
      ? 'Connecting...'
      : 'Connect Solana Wallet'

  return (
    <aside className="wallet-panel">
      <div className="wallet-card">
        <span className="eyebrow">Wallet gate</span>
        <h2>Play with one verified Solana wallet.</h2>
        <p>
          Three rounds are free each UTC day. Every round after that unlocks through
          a mocked $1 checkout flow designed for a real payment adapter later.
        </p>
        <button
          className="wallet-button"
          type="button"
          onClick={onConnect}
          disabled={isBusy || Boolean(session)}
        >
          {buttonLabel}
        </button>
      </div>

      <div className="quota-card">
        <span className="eyebrow">Attempt economy</span>
        <div className="quota-metrics">
          <div>
            <strong>{quota?.freeRemaining ?? 3}</strong>
            <span>Free rounds left</span>
          </div>
          <div>
            <strong>{quota?.paidCredits ?? 0}</strong>
            <span>Paid credits</span>
          </div>
          <div>
            <strong>${quota?.paidAttemptPriceUsd ?? 1}</strong>
            <span>Per extra round</span>
          </div>
        </div>

        {phase === 'quota_blocked' ? (
          <button className="submit-button" type="button" onClick={onUnlockPaidRound}>
            Unlock a paid round
          </button>
        ) : (
          <button
            className="ghost-button"
            type="button"
            disabled={!session || isBusy}
            onClick={onStartRound}
          >
            Start a world drop
          </button>
        )}
      </div>
    </aside>
  )
}
