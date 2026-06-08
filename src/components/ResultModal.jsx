import { formatDistance } from '../lib/formatters'
import { HoverButton } from './HoverButton'

export function ResultModal({ result, onNextRound }) {
  if (!result) return null

  const rewardLabel = result.totalRewardSp > 0 ? `+${result.totalRewardSp} SP` : '0 SP'

  return (
    <div className="result-modal-backdrop">
      <div className="result-modal">
        <h2>Round results</h2>
        <div className="result-reward-hero">
          <div className="result-reward-pill">
            <span>Earned</span>
            <strong>{rewardLabel}</strong>
          </div>
          <p>
            Average distance: {formatDistance(result.averageDistanceKm)}
          </p>
        </div>
        <div className="result-grid">
          <div>
            <span>Average distance</span>
            <strong>{formatDistance(result.averageDistanceKm)}</strong>
          </div>
          <div>
            <span>Total score</span>
            <strong>{result.totalScore}</strong>
          </div>
          <div>
            <span>Threshold</span>
            <strong>{result.thresholdKm} km</strong>
          </div>
        </div>
        <HoverButton className="submit-button" type="button" onClick={onNextRound}>
          Next round
        </HoverButton>
      </div>
    </div>
  )
}
