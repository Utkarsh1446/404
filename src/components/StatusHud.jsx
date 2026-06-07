export function StatusHud({ phase, quota, status, error, secondsLeft }) {
  return (
    <section className="status-hud">
      <div className="status-pill-group">
        <div className="status-pill">
          <span>Phase</span>
          <strong>{phase.replace('_', ' ')}</strong>
        </div>
        <div className="status-pill">
          <span>Timer</span>
          <strong>{secondsLeft}s</strong>
        </div>
        <div className="status-pill">
          <span>Free used</span>
          <strong>{quota?.freeUsed ?? 0}/3</strong>
        </div>
      </div>
      <p className="status-copy">{status}</p>
      {error ? <p className="error-copy">{error}</p> : null}
    </section>
  )
}
