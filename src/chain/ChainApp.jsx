import { useEffect, useMemo, useState } from 'react'
import { places } from '../../shared/places.js'
import {
  commitmentHex,
  distanceMeters,
  formatWhole,
  FREE_PER_DAY,
  toE6,
} from '../../shared/rules.js'
import { applyGuess, freeRemaining, freshProfile, profileForDay } from './demoEngine.js'
import { placeImages } from './images.js'
import testnet from './testnet.json'
import { createNearSession, loadNearSession, saveNearSession, signSubmitGuess, viewCall } from './nearBrowser.js'
import { Atlas, RevealInset } from './Atlas.jsx'

const PROFILE_KEY = 'notfound-demo-profile'
const ROUND_MS = 90_000

function loadProfile() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(PROFILE_KEY) || 'null')
    if (stored && Number.isFinite(stored.balance)) return profileForDay(stored)
  } catch {
    /* a fresh demo balance is fine */
  }
  return freshProfile()
}

function txOf(label) {
  return testnet.transactions?.find((entry) => entry.label === label)?.hash ?? ''
}

function shortTx(hash) {
  if (!hash) return '—'
  return `${hash.slice(0, 12)}…${hash.slice(-5)}`
}

function metersLabel(distanceM) {
  return `${new Intl.NumberFormat('en-US').format(Math.round(distanceM))} m`
}

function randomSalt() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function readJson(response) {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || 'Request failed.')
  return payload
}

async function sealPlace(place, index) {
  const salt = randomSalt()
  const commitment = await commitmentHex(place.id, toE6(place.lat), toE6(place.lng), salt)
  return {
    mode: 'demo',
    placeId: place.id,
    salt,
    commitment,
    photoIndex: index,
    deadline: Date.now() + ROUND_MS,
  }
}

export default function ChainApp() {
  const forceDemo = new URLSearchParams(window.location.search).has('demo')
  const [profile, setProfile] = useState(loadProfile)
  const [round, setRound] = useState(null)
  const [guess, setGuess] = useState(null)
  const [result, setResult] = useState(null)
  const [dropMode, setDropMode] = useState(false)
  const [dropResult, setDropResult] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [relayer, setRelayer] = useState(null)
  const [chainRound, setChainRound] = useState(null)
  const [supply, setSupply] = useState('')

  useEffect(() => {
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
  }, [profile])

  useEffect(() => {
    let cancelled = false
    async function boot() {
      if (!forceDemo) {
        const base = import.meta.env.VITE_RELAYER_URL || 'http://127.0.0.1:8788'
        try {
          const healthResponse = await fetch(`${base}/health`)
          if (healthResponse.ok) {
            const health = await healthResponse.json()
            if (health?.ok && !cancelled) {
              const nextRelayer = { ...health, base }
              setRelayer(nextRelayer)
              let session = loadNearSession()
              if (!session?.secretKey) session = await createNearSession()
              const opened = await readJson(
                await fetch(`${base}/session`, {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ publicKey: session.publicKey }),
                }),
              )
              session = { ...session, accountId: opened.accountId }
              saveNearSession(session)
              const started = await readJson(
                await fetch(`${base}/rounds/start`, {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ accountId: opened.accountId }),
                }),
              )
              if (!cancelled) {
                setRound({
                  mode: 'testnet',
                  placeId: started.placeId,
                  commitment: started.commitment,
                  roundId: started.roundId,
                  commitTx: started.commitTx,
                  accountId: opened.accountId,
                  photoIndex: 0,
                  deadline: Date.now() + ROUND_MS,
                })
              }
              return
            }
          }
        } catch {
          /* demo atlas */
        }
      }
      const sealed = await sealPlace(places[0], 0)
      if (!cancelled) setRound(sealed)
    }
    boot()
    return () => {
      cancelled = true
    }
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

  const place = round ? places.find((entry) => entry.id === round.placeId) : null
  const dropPlace = places[((round?.photoIndex ?? 0) + 1) % places.length]
  const stagePlace = dropMode ? dropPlace : place
  const free = freeRemaining(profile)
  const chainMeters = Number(chainRound?.distance_m ?? chainRound?.distanceM)
  const chainReward = chainRound ? Number(BigInt(chainRound.reward || 0) / 10n ** 18n) : 15
  const sampleCommit = txOf('commit round')
  const sampleGuess = txOf('gasless guess')
  const sampleReveal = txOf('reveal round')
  const sampleSettle = txOf('settle drop')

  const reveal = dropMode ? dropResult : result
  const answer = reveal
    ? { lat: reveal.actual.lat, lng: reveal.actual.lng }
    : null

  const commitHash = result?.commitTx || sampleCommit
  const guessHash = result?.guessTx || sampleGuess
  const revealHash = result?.revealTx || sampleReveal

  const dropDistance = dropResult
    ? `${(dropResult.distanceM / 1000).toFixed(1)} km`
    : testnet.dropDistanceM
      ? `${(testnet.dropDistanceM / 1000).toFixed(1)} km`
      : '—'
  const dropPrize = dropResult ? (dropResult.won ? `+${dropResult.prize}` : 'stays locked') : '+25 NOTF'
  const dropTx = dropResult?.revealTx || sampleSettle

  const ticker = useMemo(() => {
    const roundBit = Number.isFinite(chainMeters)
      ? `Testnet round settled · ${metersLabel(chainMeters)} · +${chainReward} NOTF`
      : 'Place hash stored before the pin'
    const dropBit = `Drop settled · closest inside 50 km · ${dropResult ? dropPrize : '+25 NOTF'}`
    const supplyBit = supply ? `Live supply ${supply} NOTF` : 'Contract measures the distance'
    return [roundBit, dropBit, supplyBit, 'Server signatures are not payouts']
  }, [chainMeters, chainReward, dropPrize, dropResult, supply])

  async function nextDemo(index) {
    setBusy(true)
    setError('')
    setGuess(null)
    setResult(null)
    setDropMode(false)
    setDropResult(null)
    const sealed = await sealPlace(places[index % places.length], index)
    setRound(sealed)
    setBusy(false)
  }

  async function openTestnetRound() {
    setBusy(true)
    setError('')
    try {
      let session = loadNearSession()
      if (!session?.secretKey) session = await createNearSession()
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
      const index = (round?.photoIndex ?? 0) + 1
      setGuess(null)
      setResult(null)
      setDropMode(false)
      setRound({
        mode: 'testnet',
        placeId: started.placeId,
        commitment: started.commitment,
        roundId: started.roundId,
        commitTx: started.commitTx,
        accountId: opened.accountId,
        photoIndex: index,
        deadline: Date.now() + ROUND_MS,
      })
    } catch (openError) {
      setError(openError.message)
    } finally {
      setBusy(false)
    }
  }

  async function lockGuess() {
    if (!guess || !stagePlace || busy) return
    setBusy(true)
    setError('')
    try {
      if (dropMode) {
        const distanceM = distanceMeters(
          toE6(stagePlace.lat),
          toE6(stagePlace.lng),
          toE6(guess.lat),
          toE6(guess.lng),
        )
        const won = distanceM <= 50_000
        if (won) setProfile((current) => ({ ...current, balance: current.balance + 25 }))
        setDropResult({
          distanceM,
          won,
          prize: 25,
          actual: { lat: stagePlace.lat, lng: stagePlace.lng },
          reward: won ? 25 : 0,
        })
        return
      }

      if (round?.mode === 'testnet' && relayer) {
        const session = loadNearSession()
        const signedDelegate = await signSubmitGuess({
          accountId: round.accountId,
          secretKey: session.secretKey,
          receiverId: relayer.gameContract,
          rpcUrl: testnet.rpcUrl,
          args: { round_id: round.roundId, lat_e6: toE6(guess.lat), lng_e6: toE6(guess.lng) },
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
        const distanceM = Number(revealed.round?.distance_m ?? revealed.round?.distanceM)
        const reward = Number(BigInt(revealed.round?.reward ?? 0) / 10n ** 18n)
        setResult({
          distanceM,
          reward,
          actual: { lat: revealed.lat, lng: revealed.lng },
          commitTx: round.commitTx,
          guessTx: relayed.txHash,
          revealTx: revealed.revealTx,
        })
        return
      }

      const settled = applyGuess({ profile, place: stagePlace, guess })
      setProfile(settled.profile)
      setResult({
        distanceM: settled.distanceM,
        reward: settled.reward,
        actual: { lat: stagePlace.lat, lng: stagePlace.lng },
      })
    } catch (lockError) {
      setError(lockError.message)
    } finally {
      setBusy(false)
    }
  }

  const photoLabel = `Photo ${(stagePlace ? places.findIndex((entry) => entry.id === stagePlace.id) : 0) + 1}`
  const committedLabel = round?.mode === 'testnet'
    ? 'Answer committed · place hash on chain'
    : 'Answer committed · place hash sealed'

  return (
    <div className="board">
      <header>
        <button className="logo" type="button" onClick={() => nextDemo((round?.photoIndex ?? 0) + 1)}>
          404 <span>NOTFOUND</span>
        </button>
        <div className="chip">Free {free} / {FREE_PER_DAY}</div>
        <button className="chip" type="button" onClick={() => { setDropMode(true); setGuess(null); setResult(null) }}>
          {dropResult ? 'Drop settled' : 'Daily drop open'}
        </button>
        <div className="grow" />
        <div className="chip">
          <i />
          {relayer && !forceDemo ? 'Gasless · NEP-366 relayer' : 'Demo · no wallet popup'}
        </div>
        <div className="chip f">{profile.balance} NOTF</div>
      </header>
      {error ? <div className="err">{error}</div> : null}
      <div className="ticker">
        {ticker.map((item) => (
          <span key={item}>{item.includes('·') ? <Ticker item={item} /> : item}</span>
        ))}
      </div>
      <div className="stage">
        <div className="photo">
          {stagePlace ? (
            <img src={placeImages[stagePlace.image]} alt="" data-place={stagePlace.id} />
          ) : null}
          <div className="ph-top">
            <span className="chip">{photoLabel}</span>
            <span className="chip">{round ? committedLabel : 'Sealing the place…'}</span>
          </div>
          <div className="q">
            <b>{dropMode ? 'WHERE IS THE DROP?' : 'WHERE IS THIS?'}</b>
            <small>
              {dropMode
                ? 'Pin the atlas. Inside 50 km takes the pool.'
                : 'Pin the atlas. Lock the guess. No wallet popup.'}
            </small>
          </div>
        </div>
        <div className="atlas">
          <Atlas
            guess={guess}
            answer={reveal ? answer : null}
            framed={Boolean(reveal)}
            onGuess={reveal ? undefined : setGuess}
          />
          <div className="legend">Atlas · equirectangular · Natural Earth</div>
          <div className="lock">
            <button className="btn" type="button" data-testid="submit-guess" disabled={!guess || busy || Boolean(reveal)} onClick={lockGuess}>
              {busy ? 'Settling…' : 'Lock guess'}
            </button>
            <button
              className="btn g"
              type="button"
              onClick={() => (relayer && !forceDemo ? openTestnetRound() : nextDemo((round?.photoIndex ?? 0) + 1))}
            >
              Skip
            </button>
          </div>
          {reveal ? (
            <RevealInset
              guess={guess}
              answer={answer}
              meters={metersLabel(reveal.distanceM)}
              reward={dropMode ? (reveal.won ? '+25 NOTF' : '+0 NOTF') : `+${reveal.reward} NOTF`}
              rewardNote={dropMode ? 'from the pool' : 'minted by contract'}
            />
          ) : null}
        </div>
      </div>
      <div className="low">
        <section className="flow">
          <h2 className="h">
            How a round settles <small>commit → guess → reveal · NEAR testnet</small>
          </h2>
          <div className="steps">
            <div className="step">
              <div className="n">01</div>
              <h4>Commit</h4>
              <p>The place hash is stored before you drop a pin.</p>
              <div className="tx">
                <a href={`https://testnet.nearblocks.io/txns/${commitHash}`}>{shortTx(commitHash)}</a>
              </div>
            </div>
            <div className="step">
              <div className="n">02</div>
              <h4>Guess, gasless</h4>
              <p>A local key signs. The relayer pays gas.</p>
              <div className="tx">
                <a href={`https://testnet.nearblocks.io/txns/${guessHash}`}>{shortTx(guessHash)}</a>
              </div>
            </div>
            <div className="step">
              <div className="n">03</div>
              <h4>Reveal & pay</h4>
              <p>The contract checks the hash, measures distance, mints NOTF.</p>
              <div className="tx">
                <a href={`https://testnet.nearblocks.io/txns/${revealHash}`}>{shortTx(revealHash)}</a>
              </div>
            </div>
          </div>
        </section>
        <section className="drop">
          <div className="dcard">
            <h2 className="h" style={{ margin: 0 }}>
              Drop <small>escrowed prize pool</small>
            </h2>
            <div className="big">25 NOTF</div>
            <div className="row">
              <span>Rule</span>
              <span>Closest guess inside 50 km</span>
            </div>
            <div className="row">
              <span>{dropResult ? 'This pin' : 'Winner'}</span>
              <span data-testid="drop-distance">{dropDistance}</span>
            </div>
            <div className="row">
              <span>Payout</span>
              <span>{dropPrize}</span>
            </div>
            <div className="row">
              <span>Settle tx</span>
              <a href={`https://testnet.nearblocks.io/txns/${dropTx}`}>{shortTx(dropTx)}</a>
            </div>
          </div>
        </section>
      </div>
      <footer>
        <a href={`https://testnet.nearblocks.io/address/${testnet.tokenContract || ''}`}>
          NEP-141 · {testnet.tokenContract || 'token not recorded'}
        </a>
        <div className="grow" />
        <span>{supply ? `Live supply ${supply} NOTF` : 'Bundled photos · testnet contracts'}</span>
      </footer>
    </div>
  )
}

function Ticker({ item }) {
  const parts = item.split('·').map((part) => part.trim())
  return (
    <>
      {parts.map((part, index) => (
        <span key={part}>
          {index > 0 ? ' · ' : ''}
          {/NOTF|m$|km$/i.test(part) ? <b>{part}</b> : part}
        </span>
      ))}
    </>
  )
}
