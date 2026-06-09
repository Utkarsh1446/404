import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import notfoundLogo from './assets/notfound-logo.svg'
import worldUvDots from './assets/maps/world-uv-dots.svg'
import CardNav from './components/CardNav'
import { GuessMap } from './components/GuessMap'
import { HoverButton } from './components/HoverButton'
import { RevealMap } from './components/RevealMap'
import { ResultModal } from './components/ResultModal'
import { StreetViewStage } from './components/StreetViewStage'
import { WalletAvatar } from './components/WalletAvatar'
import { useGameSession } from './hooks/useGameSession'
import { formatWallet } from './lib/formatters'

const POLAROID_MIST_TRANSITION_MS = 760
const DROP_INTERVAL_MS = 2 * 60 * 60 * 1000
const DROP_REVEAL_MS = 120 * 1000
const DROP_CYCLE_MS = DROP_INTERVAL_MS + DROP_REVEAL_MS
const TODAYS_REWARDS_TOTAL = 1200
const ESTIMATED_REWARD_PER_PLAYER = TODAYS_REWARDS_TOTAL / 10
const LANDING_LEADERBOARD = [
  { rank: 1, correctGuesses: 10 },
  { rank: 2, correctGuesses: 9 },
  { rank: 3, correctGuesses: 9 },
  { rank: 4, correctGuesses: 8 },
  { rank: 5, correctGuesses: 8 },
  { rank: 6, correctGuesses: 7 },
  { rank: 7, correctGuesses: 7 },
  { rank: 8, correctGuesses: 6 },
  { rank: 9, correctGuesses: 6 },
  { rank: 10, correctGuesses: 5 },
]

const LANDMARK_POLAROIDS = [
  {
    city: 'Beijing',
    lat: 39.9042,
    lng: 116.4074,
    image:
      'https://images.unsplash.com/photo-1508804185872-d7badad00f7d?auto=format&fit=crop&w=420&q=80',
  },
  {
    city: 'Tokyo',
    lat: 35.6762,
    lng: 139.6503,
    image:
      'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?auto=format&fit=crop&w=420&q=80',
  },
  {
    city: 'Singapore',
    lat: 1.3521,
    lng: 103.8198,
    image:
      'https://images.unsplash.com/photo-1525625293386-3f8f99389edd?auto=format&fit=crop&w=420&q=80',
  },
  {
    city: 'Sydney',
    lat: -33.8688,
    lng: 151.2093,
    image:
      'https://images.unsplash.com/photo-1506973035872-a4ec16b8e8d9?auto=format&fit=crop&w=420&q=80',
  },
  {
    city: 'San Francisco',
    lat: 37.7749,
    lng: -122.4194,
    image:
      'https://images.unsplash.com/photo-1501594907352-04cda38ebc29?auto=format&fit=crop&w=420&q=80',
  },
  {
    city: 'Paris',
    lat: 48.8566,
    lng: 2.3522,
    image:
      'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?auto=format&fit=crop&w=420&q=80',
  },
  {
    city: 'Cairo',
    lat: 30.0444,
    lng: 31.2357,
    image:
      'https://images.unsplash.com/photo-1572252009286-268acec5ca0a?auto=format&fit=crop&w=420&q=80',
  },
  {
    city: 'Rio',
    lat: -22.9068,
    lng: -43.1729,
    image:
      'https://images.unsplash.com/photo-1483729558449-99ef09a8c325?auto=format&fit=crop&w=420&q=80',
  },
  {
    city: 'New York',
    lat: 40.7128,
    lng: -74.006,
    image:
      'https://images.unsplash.com/photo-1485871981521-5b1fd3805eee?auto=format&fit=crop&w=420&q=80',
  },
]

const HARD_DROP_LOCATIONS = [
  {
    city: 'Namib Desert',
    lat: -24.7508,
    lng: 15.2886,
    image:
      'https://images.unsplash.com/photo-1516026672322-bc52d61a55d5?auto=format&fit=crop&w=420&q=80',
  },
  {
    city: 'Salar de Uyuni',
    lat: -20.1338,
    lng: -67.4891,
    image:
      'https://images.unsplash.com/photo-1535551951406-a19828b0a76b?auto=format&fit=crop&w=420&q=80',
  },
  {
    city: 'Zhangjiajie',
    lat: 29.3457,
    lng: 110.5446,
    image:
      'https://images.unsplash.com/photo-1508804185872-d7badad00f7d?auto=format&fit=crop&w=420&q=80',
  },
  {
    city: 'Cano Cristales',
    lat: 2.2642,
    lng: -73.7947,
    image:
      'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=420&q=80',
  },
  {
    city: 'Colca Canyon',
    lat: -15.6094,
    lng: -71.9793,
    image:
      'https://images.unsplash.com/photo-1526392060635-9d6019884377?auto=format&fit=crop&w=420&q=80',
  },
  {
    city: 'Landmannalaugar',
    lat: 63.9912,
    lng: -19.0607,
    image:
      'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=420&q=80',
  },
  {
    city: 'Tsingy',
    lat: -18.6667,
    lng: 44.75,
    image:
      'https://images.unsplash.com/photo-1516426122078-c23e76319801?auto=format&fit=crop&w=420&q=80',
  },
  {
    city: 'Raja Ampat',
    lat: -0.2346,
    lng: 130.523,
    image:
      'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=420&q=80',
  },
  {
    city: 'Nahanni River',
    lat: 61.5976,
    lng: -125.735,
    image:
      'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=420&q=80',
  },
  {
    city: 'Annapurna',
    lat: 28.596,
    lng: 83.8203,
    image:
      'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?auto=format&fit=crop&w=420&q=80',
  },
]

function normalizeLongitude(value) {
  return ((((value + 180) % 360) + 360) % 360) - 180
}

function clampLatitude(value) {
  return Math.max(-62, Math.min(62, value))
}
function formatClock(totalSeconds) {
  if (totalSeconds >= 3600) {
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }

  return `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`
}

function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function hashDropCycle(cycleNumber) {
  let hash = 2166136261
  const input = `notfound-drop-${cycleNumber}`

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return hash >>> 0
}

function getHardDropLocation(cycleNumber) {
  return HARD_DROP_LOCATIONS[hashDropCycle(cycleNumber) % HARD_DROP_LOCATIONS.length]
}
function WalletPage({ session, onConnectWallet }) {
  return (
    <div className="wallet-page">
      <div className="wallet-page-shell">
        <div className="wallet-page-heading">
          <p className="wallet-page-kicker">Wallet</p>
          <h1>{session ? 'Your wallet' : 'Connect your wallet'}</h1>
        </div>

        {session ? (
          <div className="wallet-bento-grid">
            <section className="wallet-bento wallet-bento-balance">
              <span>Actual balance</span>
              <strong>$1324</strong>
              <p>Available for new drops and instant withdrawals.</p>
            </section>

            <section className="wallet-bento wallet-bento-address">
              <span>Address</span>
              <strong>{formatWallet(session.walletAddress)}</strong>
              <p>Connected via verified Solana wallet session.</p>
            </section>

            <section className="wallet-bento wallet-bento-earnings">
              <span>Earnings</span>
              <strong>184 SP</strong>
              <p>Total rewards collected from world drops.</p>
            </section>

            <section className="wallet-bento wallet-bento-actions">
              <span>Actions</span>
              <div className="wallet-action-row">
                <HoverButton className="wallet-action-button wallet-action-deposit" type="button">
                  Deposit
                </HoverButton>
                <HoverButton className="wallet-action-button wallet-action-withdraw" type="button">
                  Withdraw
                </HoverButton>
              </div>
            </section>
          </div>
        ) : (
          <div className="wallet-bento-grid wallet-bento-grid-empty">
            <section className="wallet-bento wallet-bento-balance">
              <span>Status</span>
              <strong>No wallet connected</strong>
              <p>Connect once to view balance, earnings, and wallet actions.</p>
            </section>
            <section className="wallet-bento wallet-bento-actions wallet-bento-connect">
              <span>Actions</span>
              <HoverButton className="wallet-action-button wallet-action-deposit" type="button" onClick={onConnectWallet}>
                Connect wallet
              </HoverButton>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}

function TokenPinIcon({ className = '' }) {
  return (
    <svg
      className={className}
      viewBox="530 200 225 345"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M 635 247 L 659 248 L 672 251 L 692 259 L 707 269 L 720 281 L 734 301 L 742 321 L 745 337 L 745 357 L 742 371 L 737 385 L 723 411 L 688 457 L 644 501 L 640 501 L 591 451 L 569 423 L 549 389 L 540 358 L 540 338 L 545 316 L 551 302 L 561 287 L 579 269 L 596 258 L 617 250 Z M 638 302 L 637 303 L 634 303 L 633 304 L 632 304 L 631 305 L 630 305 L 629 306 L 626 307 L 619 314 L 619 315 L 618 316 L 618 317 L 616 320 L 616 322 L 615 323 L 615 326 L 614 327 L 614 334 L 615 335 L 615 339 L 616 340 L 616 341 L 617 342 L 618 345 L 620 347 L 620 348 L 623 351 L 624 351 L 629 355 L 630 355 L 631 356 L 633 356 L 634 357 L 638 357 L 639 358 L 647 358 L 648 357 L 651 357 L 652 356 L 654 356 L 655 355 L 658 354 L 660 352 L 661 352 L 667 346 L 667 345 L 669 343 L 669 342 L 670 341 L 670 339 L 671 338 L 671 335 L 672 334 L 672 326 L 671 325 L 671 322 L 670 321 L 670 319 L 669 318 L 668 315 L 665 312 L 665 311 L 664 310 L 663 310 L 660 307 L 659 307 L 657 305 L 656 305 L 655 304 L 653 304 L 652 303 L 650 303 L 649 302 Z"
        fill="currentColor"
        fillRule="evenodd"
      />
    </svg>
  )
}

function App() {
  const [showLanding, setShowLanding] = useState(true)
  const [mapExpanded, setMapExpanded] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [route, setRoute] = useState(() =>
    typeof window !== 'undefined' && window.location.pathname === '/wallet' ? '/wallet' : '/',
  )
  const [globeRotation, setGlobeRotation] = useState({ lng: 0, lat: 0 })
  const [renderedPolaroids, setRenderedPolaroids] = useState([])
  const globeDragRef = useRef(null)
  const {
    session,
    phase,
    quota,
    activeRound,
    paymentRoundId,
    selectedGuess,
    result,
    revealResult,
    error,
    isBusy,
    secondsLeft,
    currentLocationIndex,
    locationResults,
    roundLocationCount,
    setSelectedGuess,
    connectWallet,
    beginExperience,
    unlockPaidRound,
    submitGuess,
    continueAfterReveal,
    resetForNextRound,
  } = useGameSession()

  useEffect(() => {
    const handlePopState = () => {
      setRoute(window.location.pathname === '/wallet' ? '/wallet' : '/')
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNow(Date.now())
    }, 1000)

    return () => window.clearInterval(intervalId)
  }, [])

  function navigateTo(path) {
    const nextPath = path === '/wallet' ? '/wallet' : '/'
    window.history.pushState({}, '', nextPath)
    setRoute(nextPath)
  }

  async function handlePlayEntry() {
    navigateTo('/')
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

  async function handleRevealAdvance() {
    if (isBusy) return

    setMapExpanded(false)
    await continueAfterReveal()
  }

  async function handleGuessSubmit() {
    setMapExpanded(false)
    await submitGuess()
  }

  function handleNextRound() {
    resetForNextRound()
    setShowLanding(true)
    setMapExpanded(false)
    navigateTo('/')
  }

  function handleHomeClick() {
    resetForNextRound()
    setShowLanding(true)
    setMapExpanded(false)
    navigateTo('/')
  }

  async function handleLandingWalletConnect() {
    await connectWallet()
  }

  function handleWalletRoute() {
    setShowLanding(true)
    navigateTo('/wallet')
  }

  function handleGlobePointerDown(event) {
    event.currentTarget.setPointerCapture(event.pointerId)
    globeDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startRotation: globeRotation,
    }
  }

  function handleGlobePointerMove(event) {
    const drag = globeDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }

    const longitudeDelta = (event.clientX - drag.startX) * 0.36
    const latitudeDelta = (drag.startY - event.clientY) * 0.27

    setGlobeRotation({
      lng: normalizeLongitude(drag.startRotation.lng + longitudeDelta),
      lat: clampLatitude(drag.startRotation.lat + latitudeDelta),
    })
  }

  function handleGlobePointerEnd(event) {
    if (globeDragRef.current?.pointerId === event.pointerId) {
      globeDragRef.current = null
    }
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
      label: 'Drops',
      bgColor: '#3a196b',
      textColor: '#f7f7ef',
      links: [
        { label: 'City drops', ariaLabel: 'City drops', href: '#play' },
        { label: 'Reward pool', ariaLabel: 'Reward pool', href: '#play' },
      ],
    },
    {
      label: 'Wallet',
      bgColor: '#f97316',
      textColor: '#ffffff',
      onClick: handleWalletRoute,
      links: session
        ? [
            { label: 'Actual balance', ariaLabel: 'Actual balance', href: '/wallet', onClick: handleWalletRoute },
            { label: formatWallet(session.walletAddress), ariaLabel: 'Connected wallet address', href: '/wallet', onClick: handleWalletRoute },
          ]
        : [
            { label: 'Connect wallet', ariaLabel: 'Connect wallet', href: '/wallet', onClick: handleLandingWalletConnect },
            { label: 'Open wallet page', ariaLabel: 'Open wallet page', href: '/wallet', onClick: handleWalletRoute },
          ],
    },
  ]

  const elapsedSeconds = Math.max(
    0,
    (activeRound?.meta?.timeLimitSeconds ?? 90) - secondsLeft,
  )
  const visiblePolaroids = useMemo(() => {
    const centerLatitude = (globeRotation.lat * Math.PI) / 180

    return LANDMARK_POLAROIDS.map((place) => {
      const relativeLongitude = normalizeLongitude(place.lng - globeRotation.lng)
      const longitudeRadians = (relativeLongitude * Math.PI) / 180
      const latitudeRadians = (place.lat * Math.PI) / 180
      const depth =
        Math.sin(centerLatitude) * Math.sin(latitudeRadians) +
        Math.cos(centerLatitude) * Math.cos(latitudeRadians) * Math.cos(longitudeRadians)
      const projectedX = Math.cos(latitudeRadians) * Math.sin(longitudeRadians)
      const projectedY =
        Math.cos(centerLatitude) * Math.sin(latitudeRadians) -
        Math.sin(centerLatitude) * Math.cos(latitudeRadians) * Math.cos(longitudeRadians)
      const x = 50 + projectedX * 40
      const y = 50 - projectedY * 38

      return {
        ...place,
        relativeLongitude,
        depth,
        x,
        y,
        scale: 0.76 + Math.max(depth, 0) * 0.32,
      }
    })
      .filter((place) => place.depth > -0.16)
      .sort((first, second) => second.depth - first.depth)
      .slice(0, 5)
      .sort((first, second) => first.depth - second.depth)
  }, [globeRotation])

  const landingDrops = useMemo(() => {
    const activeCycle = Math.floor(now / DROP_CYCLE_MS)

    const timedDrops = Array.from({ length: 6 }, (_entry, index) => {
      const cycleNumber = activeCycle + index - 2
      const startsAt = cycleNumber * DROP_CYCLE_MS
      const endsAt = startsAt + DROP_INTERVAL_MS
      const revealEndsAt = endsAt + DROP_REVEAL_MS
      const location = getHardDropLocation(cycleNumber)

      if (cycleNumber < activeCycle) {
        return {
          key: `${cycleNumber}-past`,
          state: 'past',
          location,
          startsAt,
          endsAt,
          revealEndsAt,
        }
      }

      if (cycleNumber === activeCycle && now < endsAt) {
        return {
          key: `${cycleNumber}-live`,
          state: 'live',
          location,
          startsAt,
          endsAt,
          countdown: formatCountdown(endsAt - now),
        }
      }

      if (cycleNumber === activeCycle) {
        return {
          key: `${cycleNumber}-reveal`,
          state: 'reveal',
          location,
          startsAt,
          endsAt,
          revealEndsAt,
          countdown: formatCountdown(revealEndsAt - now),
        }
      }

      return {
        key: `${cycleNumber}-upcoming`,
        state: 'upcoming',
        location,
        startsAt,
        endsAt,
        countdown: formatCountdown(startsAt - now),
      }
    })

    return [
      {
        key: 'empty-drop-slot',
        state: 'empty',
      },
      ...timedDrops,
    ]
  }, [now])

  useEffect(() => {
    const visibleByCity = new Map(visiblePolaroids.map((place) => [place.city, place]))

    const syncTimer = window.setTimeout(() => {
      setRenderedPolaroids((current) => {
        const currentCities = new Set(current.map((place) => place.city))
        const next = current.map((place) => {
          const visiblePlace = visibleByCity.get(place.city)
          if (visiblePlace) {
            return {
              ...visiblePlace,
              mistState: place.mistState === 'entering' ? 'entering' : 'visible',
            }
          }

          return {
            ...place,
            mistState: 'exiting',
          }
        })

        visiblePolaroids.forEach((place) => {
          if (!currentCities.has(place.city)) {
            next.push({ ...place, mistState: 'entering' })
          }
        })

        return next.sort((first, second) => first.depth - second.depth)
      })
    }, 0)

    const settleTimer = window.setTimeout(() => {
      setRenderedPolaroids((current) =>
        current.map((place) =>
          place.mistState === 'entering' ? { ...place, mistState: 'visible' } : place,
        ),
      )
    }, 90)

    const removeTimer = window.setTimeout(() => {
      setRenderedPolaroids((current) =>
        current.filter((place) => place.mistState !== 'exiting'),
      )
    }, POLAROID_MIST_TRANSITION_MS)

    return () => {
      window.clearTimeout(syncTimer)
      window.clearTimeout(settleTimer)
      window.clearTimeout(removeTimer)
    }
  }, [visiblePolaroids])

  const completedLocations = locationResults.length
  const isFinalReveal = phase === 'reveal' && currentLocationIndex === roundLocationCount
  const hasFreePlayRemaining = (quota?.freeRemaining ?? 3) > 0
  const shouldShowTokenPlayCost = phase === 'quota_blocked' || !hasFreePlayRemaining
  const landingPlayButtonLabel = isBusy ? (
    'Loading...'
  ) : shouldShowTokenPlayCost ? (
    <span className="landing-token-price" aria-hidden="true">
      <span>100</span>
      <TokenPinIcon className="landing-token-icon" />
    </span>
  ) : (
    'Play for Free'
  )
  const landingPlayButtonAriaLabel = isBusy
    ? 'Loading'
    : shouldShowTokenPlayCost
      ? 'Play for 100 tokens'
      : 'Play for free'

  return (
    <main className="app-shell">
      {showLanding ? (
        <CardNav
          className="landing-card-nav"
          logo={notfoundLogo}
          logoAlt="notfound logo"
          items={landingNavItems}
          baseColor="#ffffff"
          menuColor="#111111"
          buttonBgColor="#ffffff"
          buttonTextColor="#111111"
          ctaLabel={
            phase === 'quota_blocked'
              ? 'unlock $1 round'
              : session
                ? <WalletAvatar value={session.walletAddress} />
                : 'connect wallet'
          }
          ctaClassName={session && phase !== 'quota_blocked' ? 'is-avatar' : ''}
          onCtaClick={
            phase === 'quota_blocked'
              ? handleLandingPrimaryAction
              : session
                ? handleWalletRoute
                : handleLandingWalletConnect
          }
          ease="power3.out"
        />
      ) : null}

      <section className="viewport-frame" id="play">
        {showLanding && route === '/wallet' ? (
          <WalletPage session={session} onConnectWallet={handleLandingWalletConnect} />
        ) : showLanding ? (
          <div className="landing-screen">
            <div className="landing-drops-band">
              <div className="landing-drops-grid">
                {landingDrops.map((drop) => (
                  <article className={`landing-drop-card is-${drop.state}`} key={drop.key}>
                    {drop.state === 'empty' ? (
                      <div className="landing-drop-empty-mark">DROPS</div>
                    ) : (
                      <>
                        <div className="landing-drop-media">
                          {drop.state === 'past' ? (
                            <img alt={drop.location.city} src={drop.location.image} />
                          ) : (
                            <div className="landing-drop-placeholder" aria-hidden="true">
                              ?
                            </div>
                          )}
                        </div>
                        <div className="landing-drop-body">
                          <div className="landing-drop-copy">
                            <span className="landing-drop-state">
                              {drop.state === 'past'
                                ? 'Past'
                                : drop.state === 'reveal'
                                  ? 'Reveal In'
                                  : drop.state === 'live'
                                  ? 'Ends in'
                                  : 'Starts in'}
                            </span>
                            <h2>{drop.state === 'past' ? drop.location.city : drop.countdown}</h2>
                          </div>
                          <div className="landing-drop-reward-block">
                            <span className="landing-drop-state">Win</span>
                            <h2 className="landing-drop-amount">$20</h2>
                          </div>
                        </div>
                      </>
                    )}
                  </article>
                ))}
              </div>
            </div>

            <div className="landing-world">
              <div className="landing-bento-grid">
                <section className="landing-bento landing-bento-copy">
                  <div className="landing-copy">
                    <h1>
                      Guess the world.
                      <span>Earn Coffee Money.</span>
                    </h1>
                    <div className="landing-actions">
                      <HoverButton
                        className="landing-play-button"
                        type="button"
                        aria-label={landingPlayButtonAriaLabel}
                        disabled={isBusy}
                        onClick={handleLandingPrimaryAction}
                      >
                        {landingPlayButtonLabel}
                      </HoverButton>
                    </div>
                    {error ? <p className="landing-error">{error}</p> : null}
                  </div>
                </section>

                <section className="landing-bento landing-bento-feature">
                  <div className="landing-copy landing-copy-feature">
                    <h2 className="landing-bento-title">
                      <span className="landing-bento-title-line">Invite</span>
                      <span className="landing-bento-title-line">&</span>
                      <span className="landing-bento-title-line">Play</span>
                      <span className="landing-bento-title-line">with</span>
                      <span className="landing-bento-title-line">Your</span>
                      <span className="landing-bento-title-line">Friends</span>
                    </h2>
                    <div className="landing-actions landing-bento-feature-actions">
                      <HoverButton className="landing-play-button" type="button">
                        CREATE ROOM
                      </HoverButton>
                      <HoverButton className="landing-play-button" type="button">
                        JOIN ROOM
                      </HoverButton>
                    </div>
                  </div>
                </section>
                <section className="landing-bento landing-bento-rewards">
                  <div className="landing-rewards">
                    <div className="landing-rewards-summary">
                      <h2 className="landing-bento-title landing-rewards-title">
                        Today's Rewards
                      </h2>
                      <div className="landing-rewards-counter">$1200</div>
                    </div>
                    <div
                      className="landing-leaderboard"
                      role="table"
                      aria-label="Today's rewards leaderboard"
                    >
                      <div className="landing-leaderboard-row is-head" role="row">
                        <span role="columnheader">Rank</span>
                        <span role="columnheader">Avatar</span>
                        <span role="columnheader">Correct Guess</span>
                        <span role="columnheader">Est. Rewards</span>
                      </div>
                      {LANDING_LEADERBOARD.map((player) => (
                        <div className="landing-leaderboard-row" role="row" key={player.rank}>
                          <span className="landing-leaderboard-rank" role="cell">
                            {player.rank}
                          </span>
                          <span className="landing-leaderboard-avatar" role="cell">
                            <WalletAvatar />
                          </span>
                          <span role="cell">{player.correctGuesses}</span>
                          <span role="cell">${ESTIMATED_REWARD_PER_PLAYER}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              </div>

              <div
                className="earth-showcase"
                aria-label="Interactive rotating Earth with famous place polaroids"
              >
                <div className="earth-orbit" aria-hidden="true"></div>

                <div
                  className="earth-globe"
                  role="slider"
                  tabIndex={0}
                  aria-label="Rotate Earth"
                  aria-valuemin={-180}
                  aria-valuemax={180}
                  aria-valuenow={Math.round(globeRotation.lng)}
                  aria-valuetext={`Longitude ${Math.round(globeRotation.lng)} degrees, latitude ${Math.round(globeRotation.lat)} degrees`}
                  onPointerDown={handleGlobePointerDown}
                  onPointerMove={handleGlobePointerMove}
                  onPointerUp={handleGlobePointerEnd}
                  onPointerCancel={handleGlobePointerEnd}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowLeft') {
                      event.preventDefault()
                      setGlobeRotation((current) => ({
                        ...current,
                        lng: normalizeLongitude(current.lng - 18),
                      }))
                    }

                    if (event.key === 'ArrowRight') {
                      event.preventDefault()
                      setGlobeRotation((current) => ({
                        ...current,
                        lng: normalizeLongitude(current.lng + 18),
                      }))
                    }

                    if (event.key === 'ArrowUp') {
                      event.preventDefault()
                      setGlobeRotation((current) => ({
                        ...current,
                        lat: clampLatitude(current.lat + 12),
                      }))
                    }

                    if (event.key === 'ArrowDown') {
                      event.preventDefault()
                      setGlobeRotation((current) => ({
                        ...current,
                        lat: clampLatitude(current.lat - 12),
                      }))
                    }
                  }}
                >
                  <div
                    className="earth-map-rotation"
                    style={{
                      '--map-offset-x': `${globeRotation.lng * -3.35}px`,
                      '--map-offset-y': `${globeRotation.lat * 1.18}px`,
                    }}
                  >
                    <div
                      className="earth-map-track"
                      style={{ backgroundImage: `url(${worldUvDots})` }}
                    />
                  </div>
                  <div className="earth-shade"></div>
                </div>

                {renderedPolaroids.map((place, index) => (
                  <article
                    className={`place-polaroid is-${place.mistState}`}
                    key={place.city}
                    style={{
                      '--photo': `url(${place.image})`,
                      '--delay': `${index * -1.8}s`,
                      '--card-x': `${place.x}%`,
                      '--card-y': `${place.y}%`,
                      '--card-scale': place.scale,
                      '--card-opacity': 0.58 + Math.max(place.depth, 0) * 0.42,
                      '--card-tilt': `${Math.sin((place.relativeLongitude * Math.PI) / 180) * 8}deg`,
                    }}
                    aria-label={place.city}
                  >
                    <div className="place-photo"></div>
                    <span>{place.city}</span>
                  </article>
                ))}
              </div>
            </div>
          </div>
        ) : phase === 'reveal' && revealResult ? (
          <div className="reveal-surface">
            <RevealMap revealResult={revealResult} />

            <button
              className="hud-top hud-brand"
              type="button"
              aria-label="Go to homepage"
              onClick={handleHomeClick}
            >
              <span className="hud-brand-logo-frame">
                <img className="hud-brand-logo" src={notfoundLogo} alt="notfound logo" />
              </span>
            </button>

            <div className="hud-top hud-scoreboard">
              <div className={`score-cell ${currentLocationIndex === 1 ? 'active' : ''}`}>
                <span>R1</span>
                <strong>{locationResults[0] ? locationResults[0].score : '-'}</strong>
                <small>{currentLocationIndex === 1 ? formatClock(secondsLeft) : '-'}</small>
              </div>
              <div className={`score-cell ${currentLocationIndex === 2 ? 'active' : ''}`}>
                <span>R2</span>
                <strong>{locationResults[1] ? locationResults[1].score : '-'}</strong>
                <small>{currentLocationIndex === 2 ? formatClock(secondsLeft) : '-'}</small>
              </div>
              <div className="score-cell total-cell">
                <span>Total</span>
                <strong>{completedLocations}/{roundLocationCount}</strong>
                <small>{formatClock(elapsedSeconds)}</small>
              </div>
            </div>

            <div className="reveal-bottom-bar">
              <div className="reveal-metric">
                <strong>
                  {revealResult.winner
                    ? formatWallet(revealResult.winner.walletAddress)
                    : 'No winner'}
                </strong>
                <span>winner</span>
              </div>
              <button
                className="submit-button reveal-next-button"
                type="button"
                disabled={isBusy}
                onPointerDown={(event) => {
                  event.preventDefault()
                  void handleRevealAdvance()
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  void handleRevealAdvance()
                }}
              >
                {isBusy ? 'Loading...' : isFinalReveal ? 'Results' : 'Next'}
              </button>
              <div className="reveal-metric reveal-score">
                <strong>{revealResult.score.toLocaleString()}</strong>
                <span>score</span>
              </div>
              {error ? <p className="reveal-error">{error}</p> : null}
            </div>
          </div>
        ) : (
          <div className="play-surface">
            <StreetViewStage round={activeRound} />

            <button
              className="hud-top hud-brand"
              type="button"
              aria-label="Go to homepage"
              onClick={handleHomeClick}
            >
              <span className="hud-brand-logo-frame">
                <img className="hud-brand-logo" src={notfoundLogo} alt="notfound logo" />
              </span>
            </button>

            <div className="hud-top hud-scoreboard">
              <div className={`score-cell ${currentLocationIndex === 1 ? 'active' : ''}`}>
                <span>R1</span>
                <strong>{locationResults[0] ? locationResults[0].score : '-'}</strong>
                <small>{currentLocationIndex === 1 && phase !== 'result' ? formatClock(secondsLeft) : '-'}</small>
              </div>
              <div className={`score-cell ${currentLocationIndex === 2 ? 'active' : ''}`}>
                <span>R2</span>
                <strong>{locationResults[1] ? locationResults[1].score : '-'}</strong>
                <small>{currentLocationIndex === 2 && phase !== 'result' ? formatClock(secondsLeft) : '-'}</small>
              </div>
              <div className="score-cell total-cell">
                <span>Total</span>
                <strong>{completedLocations}/{roundLocationCount}</strong>
                <small>{formatClock(elapsedSeconds)}</small>
              </div>
            </div>

            <div className="timer-pod">
              {phase === 'submitted' ? <span>Reveal In</span> : null}
              <strong>{formatClock(secondsLeft)}</strong>
            </div>

            <div className={`guess-overlay ${mapExpanded ? 'expanded' : ''}`}>
              <div className="guess-overlay-toolbar">
                <HoverButton
                  className="map-toggle"
                  type="button"
                  onClick={() => setMapExpanded((current) => !current)}
                >
                  {mapExpanded ? 'Minimize map' : 'Expand map'}
                </HoverButton>
              </div>

              <GuessMap
                selectedGuess={selectedGuess}
                onSelectGuess={setSelectedGuess}
                disabled={phase !== 'playing'}
                isExpanded={mapExpanded}
                onRequestExpand={() => setMapExpanded(true)}
              />

              <div className="guess-overlay-footer">
                <HoverButton
                  className="submit-button guess-submit guess-submit-full"
                  type="button"
                  disabled={!selectedGuess || phase !== 'playing' || isBusy}
                  onClick={handleGuessSubmit}
                >
                  {selectedGuess ? 'Guess' : 'Place your pin on the map'}
                </HoverButton>
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
