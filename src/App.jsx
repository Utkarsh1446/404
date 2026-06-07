import { useState } from 'react'
import './App.css'
import notfoundLogo from './assets/notfound-logo-bw.png'
import CardNav from './components/CardNav'
import { GuessMap } from './components/GuessMap'
import { ResultModal } from './components/ResultModal'
import { StreetViewStage } from './components/StreetViewStage'
import { useGameSession } from './hooks/useGameSession'
import { formatWallet } from './lib/formatters'

const ROUND_LOCATION_COUNT = 2

function formatClock(totalSeconds) {
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`
}

function App() {
  const [showLanding, setShowLanding] = useState(true)
  const [mapExpanded, setMapExpanded] = useState(false)
  const {
    session,
    phase,
    activeRound,
    paymentRoundId,
    selectedGuess,
    result,
    error,
    isBusy,
    secondsLeft,
    setSelectedGuess,
    connectWallet,
    beginExperience,
    unlockPaidRound,
    submitGuess,
    resetForNextRound,
  } = useGameSession()

  async function handlePlayEntry() {
    const result = await beginExperience()
    if (result?.status === 'started') {
      setShowLanding(false)
    }
  }

  async function handleLandingPrimaryAction() {
    if (phase === 'quota_blocked' && paymentRoundId) {
      const result = await unlockPaidRound()
      if (result?.status === 'started') {
        setShowLanding(false)
      }
      return
    }

    await handlePlayEntry()
  }

  function handleNextRound() {
    resetForNextRound()
    setShowLanding(true)
    setMapExpanded(false)
  }

  async function handleLandingWalletConnect() {
    await connectWallet()
  }

  const landingNavItems = [
    {
      label: 'Play',
      bgColor: '#111111',
      textColor: '#f7f7ef',
      onClick: handleLandingPrimaryAction,
      links: [
        {
          label: phase === 'quota_blocked' ? 'Unlock round' : 'Start round',
          ariaLabel: phase === 'quota_blocked' ? 'Unlock paid round' : 'Start round',
          href: '#play',
          onClick: handleLandingPrimaryAction,
        },
        { label: 'Open map mode', ariaLabel: 'Open map mode', href: '#play' },
      ],
    },
    {
      label: 'World',
      bgColor: '#23251f',
      textColor: '#f7f7ef',
      links: [
        { label: 'Global drops', ariaLabel: 'Global drops', href: '#play' },
        { label: 'Single viewport', ariaLabel: 'Single viewport', href: '#play' },
      ],
    },
    {
      label: session ? '$1324' : 'Connect',
      bgColor: '#f97316',
      textColor: '#ffffff',
      links: session
        ? [
            { label: 'Balance live', ariaLabel: 'Wallet balance', href: '#play' },
            { label: formatWallet(session.walletAddress), ariaLabel: 'Connected wallet address', href: '#play' },
          ]
        : [
            { label: 'Connect wallet', ariaLabel: 'Connect wallet', href: '#play', onClick: handleLandingWalletConnect },
            { label: 'Phantom or demo', ariaLabel: 'Supported wallet states', href: '#play' },
          ],
    },
  ]

  const elapsedSeconds = 90 - secondsLeft
  const currentLocationIndex = 1
  const completedLocations = phase === 'result' ? 1 : 0

  return (
    <main className="app-shell">
      {showLanding ? (
        <CardNav
          className="landing-card-nav"
          logo={notfoundLogo}
          logoAlt="notfound logo"
          items={landingNavItems}
          baseColor="#f8f8f2"
          menuColor="#111111"
          buttonBgColor={phase === 'quota_blocked' ? '#4f46e5' : session ? '#111111' : '#f97316'}
          buttonTextColor="#ffffff"
          ctaLabel={
            phase === 'quota_blocked'
              ? 'unlock $1 round'
              : session
                ? '$1324'
                : 'connect wallet'
          }
          onCtaClick={
            phase === 'quota_blocked'
              ? handleLandingPrimaryAction
              : session
                ? undefined
                : handleLandingWalletConnect
          }
          ease="power3.out"
        />
      ) : null}

      <section className="viewport-frame" id="play">
        {showLanding ? (
          <div className="landing-screen">
            <div className="landing-left">
              <div className="landing-glow landing-glow-left"></div>
              <div className="landing-copy">
                <h1>
                  Play
                  <span>to win SP</span>
                </h1>
                <button
                  className="landing-play-button"
                  type="button"
                  disabled={isBusy}
                  onClick={handleLandingPrimaryAction}
                >
                  {isBusy
                    ? 'Loading round...'
                    : phase === 'quota_blocked'
                      ? 'Unlock $1 round'
                      : 'Play'}
                </button>
                {error ? <p className="landing-error">{error}</p> : null}
              </div>
            </div>
            <div className="landing-right">
              <div className="landing-code-column">
                <span>module notfound::guess</span>
                <span>/// connect wallet</span>
                <span>/// enter street view</span>
                <span>/// drop one pin</span>
                <span>/// claim SP if close</span>
                <span>return true</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="play-surface">
            <StreetViewStage round={activeRound} />

            <div className="hud-top hud-brand">
              <img className="hud-brand-logo" src={notfoundLogo} alt="notfound logo" />
              <span>notfound</span>
            </div>

            <div className="hud-top hud-scoreboard">
              <div className={`score-cell ${currentLocationIndex === 1 ? 'active' : ''}`}>
                <span>R1</span>
                <strong>{completedLocations >= 1 ? 0 : '-'}</strong>
                <small>{currentLocationIndex === 1 ? formatClock(secondsLeft) : '-'}</small>
              </div>
              <div className="score-cell">
                <span>R2</span>
                <strong>{completedLocations >= 2 ? 0 : '-'}</strong>
                <small>{currentLocationIndex === 2 ? formatClock(secondsLeft) : '-'}</small>
              </div>
              <div className="score-cell total-cell">
                <span>Total</span>
                <strong>{completedLocations}/{ROUND_LOCATION_COUNT}</strong>
                <small>{formatClock(elapsedSeconds)}</small>
              </div>
            </div>

            <div className="timer-pod">
              <strong>{formatClock(secondsLeft)}</strong>
            </div>

            <div className={`guess-overlay ${mapExpanded ? 'expanded' : ''}`}>
              <div className="guess-overlay-toolbar">
                <button
                  className="map-toggle"
                  type="button"
                  onClick={() => setMapExpanded((current) => !current)}
                >
                  {mapExpanded ? 'Minimize map' : 'Expand map'}
                </button>
              </div>

              <GuessMap
                selectedGuess={selectedGuess}
                onSelectGuess={setSelectedGuess}
                disabled={phase !== 'playing'}
              />

              <div className="guess-overlay-footer">
                <div className="pin-readout">
                  <strong>
                    {selectedGuess
                      ? `Pin locked at ${selectedGuess.lat.toFixed(2)}, ${selectedGuess.lng.toFixed(2)}`
                      : 'Place your pin on the map'}
                  </strong>
                </div>
                <button
                  className="submit-button guess-submit"
                  type="button"
                  disabled={!selectedGuess || phase !== 'playing' || isBusy}
                  onClick={submitGuess}
                >
                  Guess
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      <ResultModal result={result} onNextRound={handleNextRound} />
    </main>
  )
}

export default App
