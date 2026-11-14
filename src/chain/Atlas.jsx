import { EARTH_PATH } from './earthPath.js'

const MAP_W = 1000
const MAP_H = 500

function project(lat, lng) {
  return {
    x: ((lng + 180) / 360) * MAP_W,
    y: ((90 - lat) / 180) * MAP_H,
  }
}

function unproject(x, y) {
  return {
    lng: (x / MAP_W) * 360 - 180,
    lat: 90 - (y / MAP_H) * 180,
  }
}

function frameOf(points) {
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const padX = 36
  const padY = 28
  const minX = Math.min(...xs) - padX
  const maxX = Math.max(...xs) + padX
  const minY = Math.min(...ys) - padY
  const maxY = Math.max(...ys) + padY
  const width = Math.max(110, maxX - minX)
  const height = Math.max(78, maxY - minY)
  return `${minX} ${minY} ${width} ${height}`
}

export function Atlas({ guess, answer, framed, onGuess }) {
  const guessPoint = guess ? project(guess.lat, guess.lng) : null
  const answerPoint = answer ? project(answer.lat, answer.lng) : null
  const view = framed && (guessPoint || answerPoint)
    ? frameOf([guessPoint, answerPoint].filter(Boolean))
    : `0 0 ${MAP_W} ${MAP_H}`
  const viewWidth = Number(view.split(' ')[2])
  const pinScale = Math.max(0.7, viewWidth / 140)

  function placePin(event) {
    if (!onGuess) return
    const svg = event.currentTarget
    const point = svg.createSVGPoint()
    point.x = event.clientX
    point.y = event.clientY
    const local = point.matrixTransform(svg.getScreenCTM().inverse())
    const next = unproject(local.x, local.y)
    onGuess({
      lat: Number(next.lat.toFixed(4)),
      lng: Number(next.lng.toFixed(4)),
    })
  }

  const verticals = []
  const horizontals = []
  for (let step = 0; step <= MAP_W; step += MAP_W / 36) {
    verticals.push(step)
  }
  for (let step = 0; step <= MAP_H; step += MAP_H / 18) {
    horizontals.push(step)
  }

  return (
    <svg
      className="atlas-svg"
      data-testid="guess-map"
      viewBox={view}
      preserveAspectRatio={framed ? 'xMidYMid slice' : 'xMidYMid meet'}
      onClick={placePin}
      role="img"
      aria-label="World atlas. Click to place your guess."
    >
      <rect x="-20" y="-20" width={MAP_W + 40} height={MAP_H + 40} fill="#cfd8cf" />
      <g stroke="#1b171222" strokeWidth="0.35">
        {verticals.map((x) => (
          <line key={`v${x}`} x1={x} y1="0" x2={x} y2={MAP_H} />
        ))}
        {horizontals.map((y) => (
          <line key={`h${y}`} x1="0" y1={y} x2={MAP_W} y2={y} />
        ))}
      </g>
      <path d={EARTH_PATH} fill="#efe6d2" stroke="#1b1712" strokeWidth="0.45" strokeLinejoin="round" />
      <g fontFamily="Space Mono, monospace" fontSize="2.4" fill="#6e6352" fontWeight="700">
        <text x="430" y="128">N. ATLANTIC</text>
        <text x="500" y="108">EUROPE</text>
        <text x="490" y="175">AFRICA</text>
      </g>
      {answerPoint ? (
        <circle
          cx={answerPoint.x}
          cy={answerPoint.y}
          r={9 * (pinScale / 2)}
          fill="none"
          stroke="#e5371f"
          strokeWidth={0.45 * pinScale}
          strokeDasharray={`${pinScale} ${pinScale}`}
        />
      ) : null}
      {guessPoint ? (
        <g transform={`translate(${guessPoint.x} ${guessPoint.y}) scale(${pinScale})`}>
          <path d="M0 0 l-1.6 -3.6 a1.8 1.8 0 1 1 3.2 0z" fill="#e5371f" stroke="#1b1712" strokeWidth="0.3" />
        </g>
      ) : null}
    </svg>
  )
}

export function RevealInset({ guess, answer, meters, reward, rewardNote, extraNote, txHref, txLabel }) {
  const dx = ((guess?.lng ?? answer.lng) - answer.lng) * 14
  const dy = (answer.lat - (guess?.lat ?? answer.lat)) * 14
  const pin = { x: Math.max(24, Math.min(200, 70 + dx)), y: Math.max(24, Math.min(70, 52 + dy)) }
  const mark = { x: Math.max(24, Math.min(200, 150)), y: Math.max(18, Math.min(70, 36)) }

  return (
    <div className="inset">
      <div className="hd">
        <span>Reveal</span>
        <span>Your pin vs answer</span>
      </div>
      <svg viewBox="0 0 226 92" className="inset-map" aria-hidden="true">
        <rect width="226" height="92" fill="#e6dbc2" />
        <g stroke="#1b171226" fill="none">
          <line x1="0" y1="18" x2="226" y2="8" strokeWidth="3" />
          <line x1="0" y1="40" x2="226" y2="30" strokeWidth="3" />
          <line x1="0" y1="62" x2="226" y2="52" strokeWidth="3" />
          <line x1="0" y1="84" x2="226" y2="74" strokeWidth="3" />
        </g>
        <line x1={pin.x} y1={pin.y} x2={mark.x} y2={mark.y} stroke="#1b1712" strokeWidth="1.5" strokeDasharray="4 3" />
        <circle cx={pin.x} cy={pin.y} r="6" fill="#e5371f" stroke="#1b1712" strokeWidth="1.5" />
        <rect x={mark.x - 6} y={mark.y - 6} width="12" height="12" fill="#1b1712" />
        <text x={pin.x - 18} y={Math.min(86, pin.y + 18)} fontFamily="Space Mono, monospace" fontSize="9" fontWeight="700" fill="#1b1712">
          YOUR PIN
        </text>
        <text x={Math.max(8, mark.x - 28)} y={Math.max(12, mark.y - 10)} fontFamily="Space Mono, monospace" fontSize="9" fontWeight="700" fill="#1b1712">
          ANSWER
        </text>
      </svg>
      <div className="res">
        <b data-testid="result-distance">{meters}</b>
        <span data-testid="reward-note">
          {reward}
          <br />
          {rewardNote}
          {extraNote ? (
            <>
              <br />
              {extraNote}
            </>
          ) : null}
          {txHref ? (
            <>
              <br />
              <a href={txHref}>{txLabel}</a>
            </>
          ) : null}
        </span>
      </div>
    </div>
  )
}
