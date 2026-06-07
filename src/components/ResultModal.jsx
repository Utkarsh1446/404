import { formatDistance } from '../lib/formatters'
import { HoverButton } from './HoverButton'

export function ResultModal({ result, onNextRound }) {
  if (!result) return null

  return (
    <div className="result-modal-backdrop">
      <div className="result-modal">
        <span className="eyebrow">{result.totalRewardSp > 0 ? 'Reward unlocked' : 'Round complete'}</span>
        <h2>{result.totalRewardSp > 0 ? `+${result.totalRewardSp} SP earned` : 'No SP on this round'}</h2>
        <p className="result-distance-callout">
          Average distance across both locations: {formatDistance(result.averageDistanceKm)}.
        </p>
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
              <strong>{formatDistance(stop.distanceKm)}</strong>
              <p>
                Reveal: {stop.region}, {stop.country}
              </p>
              <p>
                Pin {stop.guess.lat.toFixed(3)}, {stop.guess.lng.toFixed(3)}
              </p>
            </div>
          ))}
        </div>
        <HoverButton className="submit-button" type="button" onClick={onNextRound}>
          Queue next round
        </HoverButton>
      </div>
    </div>
  )
}
