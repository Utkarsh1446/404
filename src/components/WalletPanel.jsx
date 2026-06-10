import { formatWallet } from '../lib/formatters'
import { HoverButton } from './HoverButton'

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
          Three rounds are free each UTC day. Every game after that costs 10 NOTF
          from your in-game wallet balance.
        </p>
        <HoverButton
          className="wallet-button"
          type="button"
          onClick={onConnect}
          disabled={isBusy || Boolean(session)}
        >
          {buttonLabel}
        </HoverButton>
      </div>

      <div className="quota-card">
        <span className="eyebrow">Attempt economy</span>
        <div className="quota-metrics">
          <div>
            <strong>{quota?.freeRemaining ?? 3}</strong>
            <span>Free rounds left</span>
          </div>
          <div>
            <strong>{quota?.paidConsumed ?? 0}</strong>
            <span>Paid games used</span>
          </div>
          <div>
            <strong>{quota?.paidAttemptCostNotf ?? 10} NOTF</strong>
            <span>Per extra game</span>
          </div>
        </div>

        {phase === 'quota_blocked' ? (
          <HoverButton className="submit-button" type="button" onClick={onUnlockPaidRound}>
            Play for 10 NOTF
          </HoverButton>
        ) : (
          <HoverButton
            className="ghost-button"
            type="button"
            disabled={!session || isBusy}
            onClick={onStartRound}
          >
            Start a round
          </HoverButton>
        )}
      </div>
    </aside>
  )
}
