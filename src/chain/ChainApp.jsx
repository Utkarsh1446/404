import { useEffect, useMemo, useState } from 'react'
import logo from '../assets/notfound-logo-vector.svg'
import { GuessMap } from '../components/GuessMap'
import { clientConfig } from '../config'
import { places } from '../../shared/places.js'
import {
  commitmentHex,
  distanceMeters,
  formatWhole,
  FREE_PER_DAY,
  rewardWholeNotf,
  toE6,
} from '../../shared/rules.js'
import { applyGuess, freeRemaining, freshProfile, profileForDay } from './demoEngine.js'
import { placeImages } from './images.js'
import testnet from './testnet.json'
import { createNearSession, loadNearSession, saveNearSession, signSubmitGuess, viewCall } from './nearBrowser.js'
import { WorldMap } from './WorldMap.jsx'

const PROFILE_KEY = 'notfound-demo-profile'
const ROUND_MS = 90_000

function loadProfile() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(PROFILE_KEY) || 'null')
    if (stored && Number.isFinite(stored.balance)) return profileForDay(stored)
  } catch {
    /* use a fresh demo balance */
  }
  return freshProfile()
}

function shortHash(value) {
  if (!value) return ''
  return `${value.slice(0, 10)}…${value.slice(-8)}`
}

function shortAccount(value) {
  if (!value) return ''
  return value.length > 28 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value
}

async function readJson(response) {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload.error || 'Request failed.')
  }
  return payload
}

export default function ChainApp() {
  const forceDemo = new URLSearchParams(window.location.search).has('demo')
  const [screen, setScreen] = useState('home')
  const [profile, setProfile] = useState(loadProfile)
  const [round, setRound] = useState(null)
  const [guess, setGuess] = useState(null)
  const [result, setResult] = useState(null)
  const [drop, setDrop] = useState(null)
  const [dropGuess, setDropGuess] = useState(null)
  const [dropResult, setDropResult] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(0)
  const [relayer, setRelayer] = useState(null)
  const [chainRound, setChainRound] = useState(null)
  const [supply, setSupply] = useState('')
  const mapsKey = clientConfig.googleMapsApiKey

  useEffect(() => {
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
  }, [profile])

  useEffect(() => {
    if (screen !== 'play' && screen !== 'drops') return undefined
    const tick = () => setNow(Date.now())
    const immediate = window.setTimeout(tick, 0)
    const timer = window.setInterval(tick, 500)
    return () => {
      window.clearTimeout(immediate)
      window.clearInterval(timer)
    }
  }, [screen])

  useEffect(() => {
    if (forceDemo) return undefined
    const base = import.meta.env.VITE_RELAYER_URL || 'http://127.0.0.1:8788'
    const controller = new AbortController()
    fetch(`${base}/health`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((health) => {
        if (health?.ok) setRelayer({ ...health, base })
      })
      .catch(() => {})
    return () => controller.abort()
  }, [forceDemo])

  useEffect(() => {
    if (!testnet.configured) return undefined
    let cancelled = false
    viewCall(testnet.rpcUrl, testnet.tokenContract, 'ft_total_supply')
      .then((value) => {
        if (!cancelled) setSupply(formatWhole(value))
      })
      .catch(() => {})
    if (testnet.sampleRoundId) {
      viewCall(testnet.rpcUrl, testnet.gameContract, 'get_round', { round_id: testnet.sampleRoundId })
        .then((value) => {
          if (!cancelled) setChainRound(value)
        })
        .catch(() => {})
    }
    return () => {
      cancelled = true
    }
  }, [])

  const secondsLeft = !round
    ? 0
    : now === 0
      ? Math.ceil(ROUND_MS / 1000)
      : Math.max(0, Math.ceil((round.deadline - now) / 1000))
  const mode = relayer && !forceDemo ? 'testnet' : 'demo'
  const place = round ? places.find((entry) => entry.id === round.placeId) : null
  const free = freeRemaining(profile)

  const chainDistance = chainRound?.distance_m ?? chainRound?.distanceM
  const chainSummary = useMemo(() => {
    if (!chainRound) return ''
    const kilometers = Number(chainDistance) / 1000
    return Number.isFinite(kilometers) ? `${kilometers.toFixed(2)} km` : chainRound.status
  }, [chainDistance, chainRound])

  function goHome() {
    setScreen('home')
    setError('')
  }

  async function startDemo() {
    const placeIndex = profile.used % places.length
    const nextPlace = places[placeIndex]
    const saltBytes = crypto.getRandomValues(new Uint8Array(32))
    const salt = [...saltBytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
    const commitment = await commitmentHex(nextPlace.id, toE6(nextPlace.lat), toE6(nextPlace.lng), salt)
    setGuess(null)
    setResult(null)
    setRound({
      mode: 'demo',
      placeId: nextPlace.id,
      salt,
      commitment,
      deadline: Date.now() + ROUND_MS,
    })
    setScreen('play')
  }

  async function startTestnet() {
    let session = loadNearSession()
    if (!session?.secretKey) session = await createNearSession()
    setBusy(true)
    setError('')
    try {
      const opened = await readJson(
        await fetch(`${relayer.base}/session`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ publicKey: session.publicKey }),
        }),
      )
      session = { ...session, accountId: opened.accountId }
      saveNearSession(session)
      const started = await readJson(
        await fetch(`${relayer.base}/rounds/start`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ accountId: opened.accountId }),
        }),
      )
      setGuess(null)
      setResult(null)
      setRound({
        mode: 'testnet',
        placeId: started.placeId,
        commitment: started.commitment,
        roundId: started.roundId,
        commitTx: started.commitTx,
        accountId: opened.accountId,
        deadline: Date.now() + ROUND_MS,
      })
      setScreen('play')
    } catch (startError) {
      setError(startError.message)
    } finally {
      setBusy(false)
    }
  }

  async function submitGuess() {
    if (!guess || !place || !round) return
    setBusy(true)
    setError('')
    try {
      if (round.mode === 'demo') {
        const settled = applyGuess({ profile, place, guess })
        setProfile(settled.profile)
        setResult({
          ...settled,
          city: place.city,
          country: place.country,
          commitment: round.commitment,
          mode: 'demo',
          actual: { lat: place.lat, lng: place.lng },
        })
      } else {
        const session = loadNearSession()
        const signedDelegate = await signSubmitGuess({
          accountId: round.accountId,
          secretKey: session.secretKey,
          receiverId: relayer.gameContract,
          rpcUrl: testnet.rpcUrl,
          args: {
            round_id: round.roundId,
            lat_e6: toE6(guess.lat),
            lng_e6: toE6(guess.lng),
          },
        })
        const relayed = await readJson(
          await fetch(`${relayer.base}/relay`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ signedDelegate }),
          }),
        )
        const revealed = await readJson(
          await fetch(`${relayer.base}/rounds/${round.roundId}/reveal`, { method: 'POST' }),
        )
        const distanceM = revealed.round?.distance_m ?? revealed.round?.distanceM
        const rewardRaw = revealed.round?.reward ?? '0'
        setResult({
          mode: 'testnet',
          distanceM: Number(distanceM),
          reward: Number(BigInt(rewardRaw) / 10n ** 18n),
          city: revealed.city,
          country: revealed.country,
          commitment: round.commitment,
          actual: { lat: revealed.lat, lng: revealed.lng },
          guessTx: relayed.txHash,
          revealTx: revealed.revealTx,
          commitTx: round.commitTx,
        })
      }
      setScreen('result')
    } catch (submitError) {
      setError(submitError.message)
    } finally {
      setBusy(false)
    }
  }

  function openDrop() {
    const nextPlace = places[(profile.used + 1) % places.length]
    setDropGuess(null)
    setDropResult(null)
    setDrop({ placeId: nextPlace.id, prize: 25, deadline: Date.now() + ROUND_MS })
    setScreen('drops')
  }

  function submitDrop() {
    if (!drop || !dropGuess) return
    const dropPlace = places.find((entry) => entry.id === drop.placeId)
    const distanceM = distanceMeters(
      toE6(dropPlace.lat),
      toE6(dropPlace.lng),
      toE6(dropGuess.lat),
      toE6(dropGuess.lng),
    )
    const won = distanceM <= 50_000
    if (won) {
      setProfile((current) => ({ ...current, balance: current.balance + drop.prize }))
    }
    setDropResult({
      distanceM,
      won,
      prize: won ? drop.prize : 0,
      city: dropPlace.city,
      country: dropPlace.country,
    })
  }

  return (
    <div className="nf">
      <header className="nf-top">
        <button className="nf-brand" type="button" onClick={goHome}>
          <img src={logo} alt="notfound" />
        </button>
        <p className="nf-kicker">{mode === 'testnet' ? 'Guest session on testnet' : 'Demo atlas'}</p>
        <nav className="nf-nav">
          <button type="button" aria-current={screen === 'home' ? 'page' : undefined} onClick={goHome}>
            Play
          </button>
          <button type="button" data-testid="nav-drops" onClick={openDrop}>
            Drops
          </button>
          <button type="button" data-testid="nav-wallet" onClick={() => setScreen('wallet')}>
            {profile.balance} NOTF
          </button>
        </nav>
      </header>
      {error ? <p className="nf-error">{error}</p> : null}
      <main className="nf-main">
        {screen === 'home' ? (
          <section className="nf-home">
            <div>
              <h1>Where was this?</h1>
              <p className="nf-lead">
                A photo, a pin, and a payout that was fixed before you guessed. Three rounds a day are free.
                The next ones cost {10} NOTF.
              </p>
              <div className="nf-actions">
                <button
                  className="nf-primary"
                  type="button"
                  data-testid="play-button"
                  disabled={busy}
                  onClick={() => {
                    setError('')
                    if (mode === 'testnet') startTestnet()
                    else startDemo()
                  }}
                >
                  {busy ? 'Opening a round…' : 'Play'}
                </button>
                {mode === 'testnet' ? (
                  <button className="nf-ghost" type="button" onClick={startDemo}>
                    Play offline demo
                  </button>
                ) : null}
              </div>
              <p className="nf-copy">
                {mapsKey
                  ? 'Google Maps is enabled from the environment for the guess map.'
                  : 'No Google Maps key is set. This demo uses bundled photos and an atlas, and still runs the full guess, score, and NOTF loop.'}
              </p>
            </div>
            <aside className="nf-card">
              <h2>{free} free left</h2>
              <div className="nf-stat-row">
                <div className="nf-stat">
                  <span>Balance</span>
                  <strong>{profile.balance}</strong>
                </div>
                <div className="nf-stat">
                  <span>Close guess</span>
                  <strong>25</strong>
                </div>
                <div className="nf-stat">
                  <span>Within 50 km</span>
                  <strong>3</strong>
                </div>
              </div>
              {testnet.configured ? (
                <div className="nf-links">
                  <span className="nf-quiet">
                    Testnet supply {supply || '…'} NOTF. Sample round {chainSummary || '…'}.
                  </span>
                  <a href={`https://testnet.nearblocks.io/address/${testnet.tokenContract}`}>
                    Token {shortAccount(testnet.tokenContract)}
                  </a>
                  <a href={`https://testnet.nearblocks.io/address/${testnet.gameContract}`}>
                    Game {shortAccount(testnet.gameContract)}
                  </a>
                  <a href={`https://testnet.nearblocks.io/address/${testnet.poolContract}`}>
                    Drop pool {shortAccount(testnet.poolContract)}
                  </a>
                </div>
              ) : (
                <p className="nf-quiet">Testnet contracts are not recorded in this build.</p>
              )}
            </aside>
          </section>
        ) : null}

        {screen === 'play' && place ? (
          <section className="nf-play">
            <figure className="nf-photo">
              <img src={placeImages[place.image]} alt="Guess where this photo was taken" data-place={place.id} />
              <figcaption>{secondsLeft}s · commitment {shortHash(round.commitment)}</figcaption>
            </figure>
            <div className="nf-board">
              <h2>Drop a pin</h2>
              <p>The place is already committed. The contract will measure the distance.</p>
              {mapsKey ? (
                <GuessMap
                  selectedGuess={guess}
                  onSelectGuess={setGuess}
                  disabled={busy}
                  isExpanded
                  onRequestExpand={() => {}}
                />
              ) : (
                <WorldMap guess={guess} onGuess={setGuess} />
              )}
              <div className="nf-guess-bar">
                <p>{guess ? `${guess.lat.toFixed(2)}, ${guess.lng.toFixed(2)}` : 'No pin yet'}</p>
                <button
                  className="nf-primary"
                  type="button"
                  data-testid="submit-guess"
                  disabled={!guess || busy || secondsLeft === 0}
                  onClick={submitGuess}
                >
                  {busy ? 'Settling…' : free > 0 && round.mode === 'demo' ? 'Lock guess' : 'Lock guess'}
                </button>
              </div>
            </div>
          </section>
        ) : null}

        {screen === 'result' && result ? (
          <section className="nf-result">
            <p className="nf-kicker">{result.mode === 'testnet' ? 'Settled on NEAR testnet' : 'Settled locally'}</p>
            <h2>
              {result.city}, {result.country}
            </h2>
            <div className="nf-result-grid">
              <div className="nf-card">
                <span className="nf-quiet">Distance</span>
                <strong data-testid="result-distance">{(result.distanceM / 1000).toFixed(2)} km</strong>
              </div>
              <div className="nf-card">
                <span className="nf-quiet">NOTF</span>
                <strong data-testid="result-reward">+{result.reward}</strong>
              </div>
            </div>
            <p className="nf-copy">
              Reward tier for this distance is {rewardWholeNotf(result.distanceM)} NOTF. The commitment{' '}
              <span className="nf-hash">{shortHash(result.commitment)}</span> was stored before the pin.
            </p>
            {result.revealTx ? (
              <p className="nf-links">
                <a href={`https://testnet.nearblocks.io/txns/${result.commitTx}`}>Commit</a>
                <a href={`https://testnet.nearblocks.io/txns/${result.guessTx}`}>Gasless guess</a>
                <a href={`https://testnet.nearblocks.io/txns/${result.revealTx}`}>Reveal</a>
              </p>
            ) : null}
            <div className="nf-actions">
              <button className="nf-primary" type="button" onClick={mode === 'testnet' ? startTestnet : startDemo}>
                Next round
              </button>
              <button className="nf-ghost" type="button" onClick={goHome}>
                Back
              </button>
            </div>
          </section>
        ) : null}

        {screen === 'drops' ? (
          <section className="nf-drops">
            <h1>Drop</h1>
            <p className="nf-lead">One prize, locked in the pool. Closest pin inside 50 km takes it.</p>
            {drop && !dropResult ? (
              <div className="nf-play">
                <figure className="nf-photo">
                  <img
                    src={placeImages[places.find((entry) => entry.id === drop.placeId).image]}
                    alt="Drop location"
                  />
                  <figcaption>25 NOTF in the pool</figcaption>
                </figure>
                <div className="nf-board">
                  <h2>Enter the drop</h2>
                  <WorldMap guess={dropGuess} onGuess={setDropGuess} />
                  <div className="nf-guess-bar">
                    <p>{dropGuess ? `${dropGuess.lat.toFixed(2)}, ${dropGuess.lng.toFixed(2)}` : 'No pin yet'}</p>
                    <button className="nf-primary" type="button" data-testid="submit-drop" disabled={!dropGuess} onClick={submitDrop}>
                      Submit
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
            {dropResult ? (
              <div className="nf-result">
                <p className="nf-kicker">{dropResult.won ? 'Paid from the pool' : 'Prize stays locked'}</p>
                <h2>
                  {dropResult.city}, {dropResult.country}
                </h2>
                <div className="nf-result-grid">
                  <div className="nf-card">
                    <span className="nf-quiet">Distance</span>
                    <strong data-testid="drop-distance">{(dropResult.distanceM / 1000).toFixed(2)} km</strong>
                  </div>
                  <div className="nf-card">
                    <span className="nf-quiet">Pool</span>
                    <strong>{dropResult.won ? `+${dropResult.prize}` : '0'}</strong>
                  </div>
                </div>
                <p className="nf-copy">
                  {dropResult.won
                    ? 'Inside 50 km, so the locked prize is paid to this guess.'
                    : 'Outside 50 km, so the prize stays in the pool.'}
                </p>
                <button className="nf-primary" type="button" onClick={openDrop}>
                  Another drop
                </button>
              </div>
            ) : null}
          </section>
        ) : null}

        {screen === 'wallet' ? (
          <section className="nf-wallet">
            <h1>Wallet</h1>
            <div className="nf-stat-row">
              <div className="nf-stat">
                <span>Demo balance</span>
                <strong>{profile.balance} NOTF</strong>
              </div>
              <div className="nf-stat">
                <span>Free rounds</span>
                <strong>
                  {free}/{FREE_PER_DAY}
                </strong>
              </div>
              <div className="nf-stat">
                <span>Entry after that</span>
                <strong>10</strong>
              </div>
            </div>
            <p className="nf-copy">
              {mode === 'testnet'
                ? `This browser holds a local key for ${shortAccount(loadNearSession()?.accountId)}. The relayer pays the gas, so the round does not ask for a wallet popup.`
                : 'Offline demo balance lives in this browser. A relayer on 127.0.0.1:8788 switches Play to a gasless testnet session without a wallet popup.'}
            </p>
            {testnet.configured ? (
              <div className="nf-links">
                <a href={`https://testnet.nearblocks.io/txns/${testnet.transactions?.find((entry) => entry.label === 'gasless guess')?.hash}`}>
                  Sample gasless guess
                </a>
                <a href={`https://testnet.nearblocks.io/address/${testnet.poolContract}`}>Drop pool escrow</a>
              </div>
            ) : null}
            <p className="nf-quiet">
              <a href="?legacy=1">Classic server game</a>
            </p>
          </section>
        ) : null}
      </main>
    </div>
  )
}
