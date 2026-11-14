import worldMap from '../assets/maps/world-uv-dots.svg'

export function WorldMap({ guess, onGuess }) {
  function placePin(event) {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
    onGuess({
      lat: Number((90 - y * 180).toFixed(4)),
      lng: Number((x * 360 - 180).toFixed(4)),
    })
  }

  const pinStyle = guess
    ? {
        left: `${((guess.lng + 180) / 360) * 100}%`,
        top: `${((90 - guess.lat) / 180) * 100}%`,
      }
    : null

  return (
    <div
      className="atlas"
      data-testid="guess-map"
      onClick={placePin}
      onKeyDown={(event) => {
        if (event.key === 'Enter') placePin(event)
      }}
      role="button"
      tabIndex={0}
      aria-label="World map. Click to place your guess."
    >
      <img src={worldMap} alt="" />
      {pinStyle ? <span className="atlas-pin" style={pinStyle} /> : null}
    </div>
  )
}
