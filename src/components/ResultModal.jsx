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
        <div className="result-stops">
          {result.stops.map((stop, index) => (
            <div key={`${stop.answer.lat}-${stop.answer.lng}`} className="result-stop-card">
              <span>R{index + 1}</span>
              <strong>{stop.score.toLocaleString()} pts</strong>
              <p>
                Reveal: {stop.region}, {stop.country}
              </p>
              <p>Distance: {formatDistance(stop.distanceKm)}</p>
              <p>Reward: {stop.rewardSp > 0 ? `+${stop.rewardSp} SP` : '0 SP'}</p>
              <p>
                Pin {stop.guess.lat.toFixed(3)}, {stop.guess.lng.toFixed(3)}
              </p>
            </div>
          ))}
        </div>
        <HoverButton className="submit-button" type="button" onClick={onNextRound}>
          Next round
        </HoverButton>
      </div>
    </div>
  )
}
