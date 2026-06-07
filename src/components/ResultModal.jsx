import { formatDistance } from '../lib/formatters'

export function ResultModal({ result, onNextRound }) {
  if (!result) return null

  return (
    <div className="result-modal-backdrop">
      <div className="result-modal">
        <span className="eyebrow">{result.rewardEligible ? 'Reward unlocked' : 'Round complete'}</span>
        <h2>{result.rewardEligible ? `+${result.rewardSp} SP earned` : 'No SP on this drop'}</h2>
        <p className="result-distance-callout">You were {formatDistance(result.distanceKm)} from the actual location.</p>
        <div className="result-grid">
          <div>
            <span>Distance</span>
            <strong>{formatDistance(result.distanceKm)}</strong>
          </div>
          <div>
            <span>Score</span>
            <strong>{result.score}</strong>
          </div>
          <div>
            <span>Threshold</span>
            <strong>{result.thresholdKm} km</strong>
          </div>
        </div>
        <div className="result-pins">
          <div>
            <span>Your pin</span>
            <strong>
              {result.guess.lat.toFixed(3)}, {result.guess.lng.toFixed(3)}
            </strong>
          </div>
          <div>
            <span>Actual pin</span>
            <strong>
              {result.answer.lat.toFixed(3)}, {result.answer.lng.toFixed(3)}
            </strong>
          </div>
        </div>
        <p className="result-caption">
          Reveal: {result.region}, {result.country}
        </p>
        <button className="submit-button" type="button" onClick={onNextRound}>
          Queue next round
        </button>
      </div>
    </div>
  )
}
