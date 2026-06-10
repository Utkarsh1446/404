import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Room, RoomEvent, Track } from 'livekit-client'
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
import { apiClient } from './api/client'
import { useGameSession } from './hooks/useGameSession'
import { formatDistance, formatWallet } from './lib/formatters'

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

function formatPlayerName(player) {
  return player?.username || formatWallet(player?.walletAddress ?? '')
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
function WalletPage({ profile, session, onConnectWallet }) {
  const tokenBalance = profile?.tokenBalance ?? 0
  const spBalance = profile?.spBalance ?? 0
  const dropsParticipated = profile?.dropsParticipated ?? 0
  const dropsWon = profile?.dropsWon ?? 0
  const walletTitle = profile?.username
    ? `${profile.username}'s wallet`
    : 'Your wallet'

  return (
    <div className="wallet-page">
      <div className="wallet-page-shell">
        <div className="wallet-page-heading">
          <p className="wallet-page-kicker">Wallet</p>
          <h1>{session ? walletTitle : 'Connect your wallet'}</h1>
        </div>

        {session ? (
          <div className="wallet-bento-grid">
            <section className="wallet-bento wallet-bento-balance">
              <span>Token balance</span>
              <strong>{tokenBalance.toLocaleString()}</strong>
              <p>Available for paid plays and future token actions.</p>
            </section>

            <section className="wallet-bento wallet-bento-address">
              <span>Address</span>
              <strong>{formatWallet(session.walletAddress)}</strong>
              <p>Connected via verified Solana wallet session.</p>
            </section>

            <section className="wallet-bento wallet-bento-earnings">
              <span>SP earned</span>
              <strong>{spBalance.toLocaleString()} SP</strong>
              <p>{dropsParticipated} drops played, {dropsWon} wins recorded.</p>
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

function DropDetailModal({ detailState, error, isLoading, onClose }) {
  if (!detailState) return null

  const drop = detailState.drop
  const details = detailState.details
  const placeName = details?.location?.region ?? drop.location?.city ?? 'Drop location'
  const rewardSp = details?.winner?.rewardSp ?? details?.rewardSp ?? drop.location?.rewardSp ?? 20
  const winnerLabel = details?.winner?.walletAddress
    ? formatWallet(details.winner.walletAddress)
    : details?.status === 'completed'
      ? 'No winner'
      : 'Reveal pending'
  const participantLabel = details?.participantsCount === 1 ? '1 player' : `${details?.participantsCount ?? 0} players`

  return (
    <div className="drop-detail-backdrop" role="dialog" aria-modal="true" aria-label="Drop result">
      <div className="drop-detail-modal">
        <button className="drop-detail-close" type="button" aria-label="Close drop details" onClick={onClose}>
          &times;
        </button>

        <div className="drop-detail-postcard">
          <img alt={placeName} src={drop.location?.image} />
          <span>{placeName}</span>
        </div>

        <div className="drop-detail-copy">
          <h2>{isLoading ? 'Loading drop...' : placeName}</h2>
          {error ? <p className="drop-detail-error">{error}</p> : null}

          <div className="drop-detail-grid">
            <div>
              <span>Place</span>
              <strong>{placeName}</strong>
            </div>
            <div>
              <span>Winner</span>
              <strong>{isLoading ? '-' : winnerLabel}</strong>
            </div>
            <div>
              <span>Winning amount</span>
              <strong>{isLoading ? '-' : `${rewardSp} SP`}</strong>
            </div>
            <div>
              <span>Players</span>
              <strong>{isLoading ? '-' : participantLabel}</strong>
            </div>
          </div>

          <HoverButton className="submit-button" type="button" onClick={onClose}>
            Back to drops
          </HoverButton>
        </div>
      </div>
    </div>
  )
}

function MultiplayerJoinModal({
  code,
  error,
  isBusy,
  onChangeCode,
  onClose,
  onJoin,
}) {
  return (
    <div className="multiplayer-modal-backdrop" role="dialog" aria-modal="true" aria-label="Join room">
      <form className="multiplayer-join-modal" onSubmit={onJoin}>
        <button className="drop-detail-close" type="button" aria-label="Close join room" onClick={onClose}>
          &times;
        </button>
        <h2>Join Room</h2>
        <label>
          <span>Room code</span>
          <input
            autoFocus
            maxLength={5}
            value={code}
            onChange={(event) => onChangeCode(event.target.value.toUpperCase())}
            placeholder="ABCDE"
          />
        </label>
        {error ? <p className="multiplayer-error">{error}</p> : null}
        <HoverButton className="submit-button" type="submit" disabled={isBusy || code.trim().length < 5}>
          {isBusy ? 'Joining...' : 'Join Room'}
        </HoverButton>
      </form>
    </div>
  )
}

function UsernameModal({
  error,
  isBusy,
  username,
  onChangeUsername,
  onSubmit,
}) {
  return (
    <div className="multiplayer-modal-backdrop" role="dialog" aria-modal="true" aria-label="Choose username">
      <form className="multiplayer-join-modal username-modal" onSubmit={onSubmit}>
        <h2>Pick Username</h2>
        <label>
          <span>Username</span>
          <input
            autoFocus
            maxLength={16}
            value={username}
            onChange={(event) => onChangeUsername(event.target.value)}
            placeholder="notfound_player"
          />
        </label>
        <p className="username-hint">3-16 letters, numbers, or underscores.</p>
        {error ? <p className="multiplayer-error">{error}</p> : null}
        <HoverButton className="submit-button" type="submit" disabled={isBusy || username.trim().length < 3}>
          {isBusy ? 'Saving...' : 'Save Username'}
        </HoverButton>
      </form>
    </div>
  )
}

function getMultiplayerVoiceAudioRoot() {
  if (typeof document === 'undefined') return null
  return document.getElementById('multiplayer-voice-audio-root')
}

function useMultiplayerVoice(roomCode, session) {
  const sessionToken = session?.token
  const livekitRoomRef = useRef(null)
  const connectedRoomCodeRef = useRef(null)
  const [isConnected, setIsConnected] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [participantCount, setParticipantCount] = useState(1)
  const [voiceError, setVoiceError] = useState('')
  const [isConnecting, setIsConnecting] = useState(false)

  const disconnectVoice = useCallback(() => {
    livekitRoomRef.current?.disconnect()
    livekitRoomRef.current = null
    connectedRoomCodeRef.current = null
    getMultiplayerVoiceAudioRoot()?.replaceChildren()
    setIsConnected(false)
    setParticipantCount(1)
  }, [])

  useEffect(() => () => {
    disconnectVoice()
  }, [disconnectVoice])

  const joinVoice = useCallback(async () => {
    if (!sessionToken || !roomCode || isConnecting) return
    if (livekitRoomRef.current && connectedRoomCodeRef.current === roomCode) {
      setIsConnected(true)
      return
    }

    setVoiceError('')
    setIsConnecting(true)

    try {
      const voice = await apiClient.getMultiplayerVoiceToken(sessionToken, roomCode)
      const nextRoom = new Room({
        adaptiveStream: true,
        dynacast: true,
      })

      const syncParticipants = () => {
        setParticipantCount(nextRoom.remoteParticipants.size + 1)
        setIsMuted(!nextRoom.localParticipant.isMicrophoneEnabled)
      }
      const attachRemoteAudioTrack = (track) => {
        const remoteAudioRoot = getMultiplayerVoiceAudioRoot()
        if (track.kind !== Track.Kind.Audio || !remoteAudioRoot) return

        const element = track.attach()
        element.autoplay = true
        element.dataset.livekitRemoteAudio = 'true'
        remoteAudioRoot.appendChild(element)
      }
      const detachRemoteAudioTrack = (track) => {
        if (track.kind !== Track.Kind.Audio) return

        track.detach().forEach((element) => element.remove())
      }
      const attachExistingRemoteAudio = () => {
        nextRoom.remoteParticipants.forEach((participant) => {
          participant.trackPublications.forEach((publication) => {
            if (publication.track) {
              attachRemoteAudioTrack(publication.track)
            }
          })
        })
      }

      nextRoom.on(RoomEvent.ParticipantConnected, syncParticipants)
      nextRoom.on(RoomEvent.ParticipantDisconnected, syncParticipants)
      nextRoom.on(RoomEvent.TrackSubscribed, attachRemoteAudioTrack)
      nextRoom.on(RoomEvent.TrackUnsubscribed, detachRemoteAudioTrack)
      nextRoom.on(RoomEvent.LocalTrackPublished, syncParticipants)
      nextRoom.on(RoomEvent.LocalTrackUnpublished, syncParticipants)
      nextRoom.on(RoomEvent.Disconnected, () => {
        connectedRoomCodeRef.current = null
        setIsConnected(false)
        setParticipantCount(1)
        getMultiplayerVoiceAudioRoot()?.replaceChildren()
      })

      await nextRoom.connect(voice.url, voice.token)
      attachExistingRemoteAudio()
      await nextRoom.startAudio()
      await nextRoom.localParticipant.setMicrophoneEnabled(true)
      livekitRoomRef.current = nextRoom
      connectedRoomCodeRef.current = roomCode
      syncParticipants()
      setIsConnected(true)
    } catch (caughtError) {
      setVoiceError(caughtError.message ?? 'Could not join voice.')
    } finally {
      setIsConnecting(false)
    }
  }, [isConnecting, roomCode, sessionToken])

  const toggleMute = useCallback(async () => {
    const livekitRoom = livekitRoomRef.current
    if (!livekitRoom) return

    const nextMuted = !isMuted
    await livekitRoom.localParticipant.setMicrophoneEnabled(!nextMuted)
    setIsMuted(nextMuted)
  }, [isMuted])

  return {
    isConnected,
    isMuted,
    participantCount,
    voiceError,
    isConnecting,
    joinVoice,
    toggleMute,
    leaveVoice: disconnectVoice,
  }
}

function MultiplayerVoicePanel({ voice }) {
  return (
    <div className="multiplayer-voice-panel">
      <div>
        <span>Voice</span>
        <strong>{voice.isConnected ? `${voice.participantCount} connected` : 'Not connected'}</strong>
      </div>

      {voice.isConnected ? (
        <>
          <HoverButton className="landing-play-button" type="button" onClick={voice.toggleMute}>
            {voice.isMuted ? 'Unmute' : 'Mute'}
          </HoverButton>
          <HoverButton className="landing-play-button" type="button" onClick={voice.leaveVoice}>
            Leave Voice
          </HoverButton>
        </>
      ) : (
        <HoverButton className="landing-play-button" type="button" onClick={voice.joinVoice} disabled={voice.isConnecting}>
          {voice.isConnecting ? 'Joining...' : 'Join Voice'}
        </HoverButton>
      )}

      {voice.voiceError ? <p className="multiplayer-error">{voice.voiceError}</p> : null}
    </div>
  )
}

function MultiplayerGameVoiceControls({ voice }) {
  const label = voice.isConnected
    ? voice.isMuted
      ? 'Unmute'
      : 'Mute'
    : voice.isConnecting
      ? 'Joining...'
      : 'Join Voice'

  return (
    <div className="multiplayer-game-voice">
      <HoverButton
        className="landing-play-button multiplayer-game-voice-button"
        type="button"
        onClick={voice.isConnected ? voice.toggleMute : voice.joinVoice}
        disabled={voice.isConnecting}
      >
        {label}
      </HoverButton>
      {voice.voiceError ? <p className="multiplayer-error">{voice.voiceError}</p> : null}
    </div>
  )
}

function MultiplayerPlayersTray({ room, isExpanded, onToggle }) {
  const rankedPlayers = [...room.players].sort(
    (first, second) => second.score - first.score || formatPlayerName(first).localeCompare(formatPlayerName(second)),
  )

  return (
    <section
      className={`multiplayer-player-tray ${isExpanded ? 'is-expanded' : ''}`}
      style={{ '--tray-map': `url(${worldUvDots})` }}
    >
      <button
        className="multiplayer-player-tray-toggle"
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
      >
        <div className="multiplayer-player-tray-avatars" aria-hidden="true">
          {rankedPlayers.slice(0, 8).map((player) => (
            <WalletAvatar key={player.walletAddress} value={player.walletAddress} />
          ))}
        </div>
        <span>{isExpanded ? 'Hide players' : `${room.playerCount} players`}</span>
      </button>

      {isExpanded ? (
        <div className="multiplayer-player-tray-board">
          {rankedPlayers.map((player, index) => (
            <div className="multiplayer-player-score-row" key={player.walletAddress}>
              <strong>#{index + 1}</strong>
              <WalletAvatar value={player.walletAddress} />
              <span>{formatPlayerName(player)}</span>
              <em>{player.score.toLocaleString()} pts</em>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}

function MultiplayerLobby({
  room,
  error,
  isBusy,
  now,
  notReadyWallets,
  onReady,
  onStart,
  onLeave,
  voice,
}) {
  const secondsUntilStart = room?.countdownEndsAt
    ? Math.max(0, Math.ceil((room.countdownEndsAt - now) / 1000))
    : 0
  const allReady = room.players.length >= room.minPlayers && room.players.every((player) => player.ready)
  const isHost = room.hostWalletAddress === room.currentPlayer?.walletAddress
  const notReadySet = new Set(notReadyWallets)

  return (
    <div className="multiplayer-lobby">
      <button className="hud-top hud-brand" type="button" aria-label="Go to homepage" onClick={onLeave}>
        <span className="hud-brand-logo-frame">
          <img className="hud-brand-logo" src={notfoundLogo} alt="notfound logo" />
        </span>
      </button>

      <div className="multiplayer-lobby-panel">
        <div className="multiplayer-lobby-heading">
          <span>Room Code</span>
          <strong>{room.code}</strong>
        </div>

        <div className="multiplayer-lobby-meta">
          <span>{room.playerCount}/{room.maxPlayers} players</span>
          <span>5 rounds</span>
          <span>{room.status === 'countdown' ? `Starting in ${secondsUntilStart}s` : allReady ? 'Ready to start' : 'Waiting for ready'}</span>
        </div>

        <div className="multiplayer-player-list">
          {room.players.map((player) => (
            <div className="multiplayer-player-row" key={player.walletAddress}>
              <WalletAvatar value={player.walletAddress} />
              <span>{formatPlayerName(player)}</span>
              <strong className={notReadySet.has(player.walletAddress) ? 'is-not-ready' : ''}>
                {notReadySet.has(player.walletAddress)
                  ? `${formatPlayerName(player)} not ready`
                  : player.ready
                    ? 'Ready'
                    : 'Waiting'}
              </strong>
            </div>
          ))}
        </div>

        {error ? <p className="multiplayer-error">{error}</p> : null}

        <div className="multiplayer-lobby-actions">
          {isHost ? (
            <HoverButton className="landing-play-button" type="button" onClick={onStart} disabled={isBusy || room.status !== 'waiting'}>
              Start
            </HoverButton>
          ) : (
            <HoverButton className="landing-play-button" type="button" onClick={onReady} disabled={isBusy || room.currentPlayer?.ready || room.status !== 'waiting'}>
              {room.currentPlayer?.ready ? 'Ready' : 'Ready'}
            </HoverButton>
          )}
          <HoverButton className="landing-play-button" type="button" onClick={onLeave}>
            Leave
          </HoverButton>
        </div>

        <MultiplayerVoicePanel voice={voice} />
      </div>
    </div>
  )
}

function MultiplayerLeaderboard({ room, onLeave }) {
  return (
    <div className="multiplayer-lobby multiplayer-results">
      <button className="hud-top hud-brand" type="button" aria-label="Go to homepage" onClick={onLeave}>
        <span className="hud-brand-logo-frame">
          <img className="hud-brand-logo" src={notfoundLogo} alt="notfound logo" />
        </span>
      </button>

      <div className="multiplayer-lobby-panel multiplayer-results-panel">
        <div className="multiplayer-lobby-heading">
          <span>Game Over</span>
          <strong>Leaderboard</strong>
        </div>

        <div className="multiplayer-leaderboard">
          {room.leaderboard.map((player) => (
            <div className="multiplayer-leaderboard-row" key={player.walletAddress}>
              <strong>#{player.rank}</strong>
              <WalletAvatar value={player.walletAddress} />
              <span>{formatPlayerName(player)}</span>
              <span>{player.score.toLocaleString()} pts</span>
              <span>{formatDistance(player.totalDistanceKm)}</span>
            </div>
          ))}
        </div>

        <HoverButton className="submit-button" type="button" onClick={onLeave}>
          Back Home
        </HoverButton>
      </div>
    </div>
  )
}

function MultiplayerGame({
  room,
  selectedGuess,
  mapExpanded,
  error,
  isBusy,
  now,
  playersExpanded,
  onSelectGuess,
  onSubmitGuess,
  onToggleMap,
  onTogglePlayers,
  onLeave,
  voice,
}) {
  const currentGuess = room.currentGuess
  const roundResults = room.roundResults ?? []
  const ownRoundResult = currentGuess ?? roundResults.find(
    (entry) => entry.walletAddress === room.currentPlayer?.walletAddress,
  )
  const revealResult = ownRoundResult && room.revealLocation
    ? {
        ...ownRoundResult,
        country: room.revealLocation.country,
        region: room.revealLocation.region,
        answer: room.revealLocation.answer,
      }
    : null
  const secondsLeft = room.activeEndsAt
    ? Math.max(0, Math.ceil((room.activeEndsAt - now) / 1000))
    : 0
  const revealSecondsLeft = room.revealEndsAt
    ? Math.max(0, Math.ceil((room.revealEndsAt - now) / 1000))
    : 0
  const scoreSlots = Array.from({ length: room.roundCount }, (_entry, index) => index + 1)
  const scoreboardStyle = {
    gridTemplateColumns: `repeat(${scoreSlots.length + 1}, minmax(104px, 1fr))`,
  }

  if (room.status === 'reveal' && revealResult) {
    return (
      <div className="reveal-surface">
        <RevealMap revealResult={revealResult} />
        <button className="hud-top hud-brand" type="button" aria-label="Go to homepage" onClick={onLeave}>
          <span className="hud-brand-logo-frame">
            <img className="hud-brand-logo" src={notfoundLogo} alt="notfound logo" />
          </span>
        </button>
        <div className="hud-top hud-scoreboard multiplayer-scoreboard" style={scoreboardStyle}>
          {scoreSlots.map((slot) => (
            <div className={`score-cell ${room.roundIndex === slot ? 'active' : ''}`} key={slot}>
              <span>R{slot}</span>
              <strong>{slot < room.roundIndex ? 'Done' : slot === room.roundIndex ? 'Reveal' : '-'}</strong>
              <small>{slot === room.roundIndex ? formatClock(revealSecondsLeft) : '-'}</small>
            </div>
          ))}
          <div className="score-cell total-cell">
            <span>Total</span>
            <strong>{room.currentPlayer?.score?.toLocaleString() ?? 0}</strong>
            <small>{room.playerCount} players</small>
          </div>
        </div>
        <div className="reveal-bottom-bar">
          <div className="reveal-metric">
            <strong>{formatDistance(revealResult.distanceKm)}</strong>
            <span>distance</span>
          </div>
          <div className="multiplayer-reveal-note">Next round starts automatically</div>
          <div className="reveal-metric reveal-score">
            <strong>{revealResult.score.toLocaleString()}</strong>
            <span>score</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="play-surface">
      <StreetViewStage round={room.currentRound} />
      <button className="hud-top hud-brand" type="button" aria-label="Go to homepage" onClick={onLeave}>
        <span className="hud-brand-logo-frame">
          <img className="hud-brand-logo" src={notfoundLogo} alt="notfound logo" />
        </span>
      </button>
      <div className="hud-top hud-scoreboard multiplayer-scoreboard" style={scoreboardStyle}>
        {scoreSlots.map((slot) => (
          <div className={`score-cell ${room.roundIndex === slot ? 'active' : ''}`} key={slot}>
            <span>R{slot}</span>
            <strong>{slot < room.roundIndex ? 'Done' : slot === room.roundIndex ? 'Live' : '-'}</strong>
            <small>{slot === room.roundIndex ? formatClock(secondsLeft) : '-'}</small>
          </div>
        ))}
        <div className="score-cell total-cell">
          <span>Total</span>
          <strong>{room.currentPlayer?.score?.toLocaleString() ?? 0}</strong>
          <small>{room.playerCount} players</small>
        </div>
      </div>
      <div className="timer-pod">
        <span>Round {room.roundIndex}/5</span>
        <strong>{formatClock(secondsLeft)}</strong>
      </div>
      <MultiplayerGameVoiceControls voice={voice} />
      <MultiplayerPlayersTray
        room={room}
        isExpanded={playersExpanded}
        onToggle={onTogglePlayers}
      />
      <div className={`guess-overlay ${mapExpanded ? 'expanded' : ''}`}>
        <div className="guess-overlay-toolbar">
          <HoverButton className="map-toggle" type="button" onClick={onToggleMap}>
            {mapExpanded ? 'Minimize map' : 'Expand map'}
          </HoverButton>
        </div>
        <GuessMap
          selectedGuess={selectedGuess}
          onSelectGuess={onSelectGuess}
          disabled={Boolean(currentGuess) || room.status !== 'playing'}
          isExpanded={mapExpanded}
          onRequestExpand={onToggleMap}
        />
        <div className="guess-overlay-footer">
          <HoverButton
            className="submit-button guess-submit guess-submit-full"
            type="button"
            disabled={!selectedGuess || Boolean(currentGuess) || room.status !== 'playing' || isBusy}
            onClick={onSubmitGuess}
          >
            {currentGuess ? 'Waiting for players' : selectedGuess ? 'Guess' : 'Place your pin on the map'}
          </HoverButton>
        </div>
        {error ? <p className="multiplayer-error">{error}</p> : null}
      </div>
    </div>
  )
}

function App() {
  const [showLanding, setShowLanding] = useState(true)
  const [mapExpanded, setMapExpanded] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [selectedDropDetail, setSelectedDropDetail] = useState(null)
  const [dropDetailError, setDropDetailError] = useState('')
  const [isDropDetailLoading, setIsDropDetailLoading] = useState(false)
  const [multiplayerRoom, setMultiplayerRoom] = useState(null)
  const [multiplayerJoinCode, setMultiplayerJoinCode] = useState('')
  const [isJoinModalOpen, setIsJoinModalOpen] = useState(false)
  const [multiplayerError, setMultiplayerError] = useState('')
  const [multiplayerNotReadyWallets, setMultiplayerNotReadyWallets] = useState([])
  const [isMultiplayerBusy, setIsMultiplayerBusy] = useState(false)
  const [multiplayerGuess, setMultiplayerGuess] = useState(null)
  const [multiplayerMapExpanded, setMultiplayerMapExpanded] = useState(false)
  const [multiplayerPlayersExpanded, setMultiplayerPlayersExpanded] = useState(false)
  const multiplayerGuessRef = useRef(null)
  const [usernameDraft, setUsernameDraft] = useState('')
  const [usernameError, setUsernameError] = useState('')
  const [isUsernameSaving, setIsUsernameSaving] = useState(false)
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
    profile,
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
    updateUsername,
    beginExperience,
    beginDropExperience,
    unlockPaidRound,
    submitGuess,
    continueAfterReveal,
    resetForNextRound,
  } = useGameSession()
  const multiplayerVoice = useMultiplayerVoice(multiplayerRoom?.code, session)

  function setNextMultiplayerGuess(guess) {
    multiplayerGuessRef.current = guess
    setMultiplayerGuess(guess)
  }

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

  useEffect(() => {
    if (!session?.token || !multiplayerRoom?.code) return undefined

    const syncRoom = async () => {
      try {
        const nextRoom = await apiClient.getMultiplayerRoom(session.token, multiplayerRoom.code)
        setMultiplayerRoom(nextRoom)
        setMultiplayerError('')
        setMultiplayerNotReadyWallets((current) =>
          current.filter((walletAddress) =>
            nextRoom.players.some((player) => player.walletAddress === walletAddress && !player.ready),
          ),
        )
      } catch (caughtError) {
        setMultiplayerError(caughtError.message)
      }
    }

    const intervalId = window.setInterval(syncRoom, 1000)
    return () => window.clearInterval(intervalId)
  }, [multiplayerRoom?.code, session?.token])

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

  async function handleDropEntry() {
    if (isBusy) return

    navigateTo('/')
    const result = await beginDropExperience()
    if (result?.status === 'started') {
      setShowLanding(false)
    }
  }

  async function handleDropDetailOpen(drop) {
    if (!Number.isFinite(drop?.cycleNumber) || isBusy) return

    setDropDetailError('')
    setSelectedDropDetail({ drop, details: null })
    setIsDropDetailLoading(true)

    try {
      const details = await apiClient.getDropDetails(drop.cycleNumber)
      setSelectedDropDetail({ drop, details })
    } catch (detailError) {
      setDropDetailError(detailError.message ?? 'Could not load drop details.')
    } finally {
      setIsDropDetailLoading(false)
    }
  }

  function handleDropDetailClose() {
    setSelectedDropDetail(null)
    setDropDetailError('')
    setIsDropDetailLoading(false)
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
    multiplayerVoice.leaveVoice()
    setMultiplayerRoom(null)
    setNextMultiplayerGuess(null)
    setMultiplayerError('')
    setMultiplayerNotReadyWallets([])
    setMultiplayerMapExpanded(false)
    setMultiplayerPlayersExpanded(false)
    setShowLanding(true)
    setMapExpanded(false)
    navigateTo('/')
  }

  async function handleLandingWalletConnect() {
    await connectWallet()
  }

  async function handleUsernameSubmit(event) {
    event.preventDefault()
    setUsernameError('')
    setIsUsernameSaving(true)

    try {
      await updateUsername(usernameDraft)
      setUsernameDraft('')
    } catch (caughtError) {
      setUsernameError(caughtError.message)
    } finally {
      setIsUsernameSaving(false)
    }
  }

  async function getMultiplayerSession() {
    const nextSession = session ?? (await connectWallet())
    return nextSession?.token ? nextSession : null
  }

  async function handleCreateRoom() {
    setMultiplayerError('')
    setIsMultiplayerBusy(true)

    try {
      const nextSession = await getMultiplayerSession()
      if (!nextSession?.token) return
      const room = await apiClient.createMultiplayerRoom(nextSession.token)
      setMultiplayerRoom(room)
      setNextMultiplayerGuess(null)
      setMultiplayerNotReadyWallets([])
      setMultiplayerPlayersExpanded(false)
      setShowLanding(false)
      navigateTo('/')
    } catch (caughtError) {
      setMultiplayerError(caughtError.message)
    } finally {
      setIsMultiplayerBusy(false)
    }
  }

  async function handleJoinRoomSubmit(event) {
    event.preventDefault()
    setMultiplayerError('')
    setIsMultiplayerBusy(true)

    try {
      const nextSession = await getMultiplayerSession()
      if (!nextSession?.token) return
      const room = await apiClient.joinMultiplayerRoom(
        nextSession.token,
        multiplayerJoinCode.trim().toUpperCase(),
      )
      setMultiplayerRoom(room)
      setNextMultiplayerGuess(null)
      setMultiplayerNotReadyWallets([])
      setMultiplayerPlayersExpanded(false)
      setIsJoinModalOpen(false)
      setShowLanding(false)
      navigateTo('/')
    } catch (caughtError) {
      setMultiplayerError(caughtError.message)
    } finally {
      setIsMultiplayerBusy(false)
    }
  }

  async function handleMultiplayerReady() {
    if (!session?.token || !multiplayerRoom?.code) return

    setMultiplayerError('')
    setIsMultiplayerBusy(true)

    try {
      const room = await apiClient.readyMultiplayerRoom(session.token, multiplayerRoom.code)
      setMultiplayerRoom(room)
      setMultiplayerNotReadyWallets([])
    } catch (caughtError) {
      setMultiplayerError(caughtError.message)
    } finally {
      setIsMultiplayerBusy(false)
    }
  }

  async function handleMultiplayerStart() {
    if (!session?.token || !multiplayerRoom?.code) return

    setMultiplayerError('')
    setMultiplayerNotReadyWallets([])
    setIsMultiplayerBusy(true)

    try {
      const room = await apiClient.startMultiplayerRoom(session.token, multiplayerRoom.code)
      setMultiplayerRoom(room)
    } catch (caughtError) {
      if (caughtError.payload?.code === 'PLAYERS_NOT_READY') {
        setMultiplayerNotReadyWallets(caughtError.payload.notReadyWalletAddresses ?? [])
      }
      setMultiplayerError(caughtError.message)
    } finally {
      setIsMultiplayerBusy(false)
    }
  }

  async function handleMultiplayerGuessSubmit() {
    const guess = multiplayerGuessRef.current
    if (!session?.token || !multiplayerRoom?.code || !guess) return

    setMultiplayerError('')
    setIsMultiplayerBusy(true)

    try {
      const room = await apiClient.submitMultiplayerGuess(
        session.token,
        multiplayerRoom.code,
        guess,
      )
      setMultiplayerRoom(room)
      setNextMultiplayerGuess(null)
      setMultiplayerMapExpanded(false)
    } catch (caughtError) {
      setMultiplayerError(caughtError.message)
    } finally {
      setIsMultiplayerBusy(false)
    }
  }

  function handleLeaveMultiplayer() {
    multiplayerVoice.leaveVoice()
    setMultiplayerRoom(null)
    setNextMultiplayerGuess(null)
    setMultiplayerError('')
    setMultiplayerNotReadyWallets([])
    setMultiplayerMapExpanded(false)
    setMultiplayerPlayersExpanded(false)
    setShowLanding(true)
    navigateTo('/')
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

  const currentRoundElapsedSeconds = Math.max(
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
          cycleNumber,
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
          cycleNumber,
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
          cycleNumber,
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
        cycleNumber,
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
  const isDropReveal = activeRound?.meta?.gameMode === 'drop'
  const completedElapsedSeconds = locationResults.reduce(
    (sum, entry) => sum + (entry.elapsedSeconds ?? 0),
    0,
  )
  const totalElapsedSeconds =
    phase === 'playing' || phase === 'submitted'
      ? completedElapsedSeconds + currentRoundElapsedSeconds
      : completedElapsedSeconds
  const getScoreSlotTime = (slot) => {
    const resultForSlot = locationResults[slot - 1]

    if (resultForSlot?.elapsedSeconds !== undefined) {
      return formatClock(resultForSlot.elapsedSeconds)
    }

    if (currentLocationIndex === slot && (phase === 'playing' || phase === 'submitted')) {
      return formatClock(secondsLeft)
    }

    return '-'
  }
  const scoreSlots = Array.from({ length: roundLocationCount }, (_entry, index) => index + 1)
  const scoreboardStyle = {
    gridTemplateColumns: `repeat(${scoreSlots.length + 1}, minmax(126px, 1fr))`,
  }
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
  const shouldShowUsernameModal = Boolean(session && profile && !profile.hasUsername)
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
          ctaClassName={session && phase !== 'quota_blocked' ? 'is-connected-wallet is-avatar' : ''}
          onLogoClick={handleHomeClick}
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
        {multiplayerRoom ? (
          multiplayerRoom.status === 'waiting' || multiplayerRoom.status === 'countdown' ? (
            <MultiplayerLobby
              room={multiplayerRoom}
              error={multiplayerError}
              isBusy={isMultiplayerBusy}
              now={now}
              notReadyWallets={multiplayerNotReadyWallets}
              onReady={handleMultiplayerReady}
              onStart={handleMultiplayerStart}
              onLeave={handleLeaveMultiplayer}
              voice={multiplayerVoice}
            />
          ) : multiplayerRoom.status === 'finished' ? (
            <MultiplayerLeaderboard
              room={multiplayerRoom}
              onLeave={handleLeaveMultiplayer}
            />
          ) : (
            <MultiplayerGame
              room={multiplayerRoom}
              selectedGuess={multiplayerGuess}
              mapExpanded={multiplayerMapExpanded}
              error={multiplayerError}
              isBusy={isMultiplayerBusy}
              now={now}
              playersExpanded={multiplayerPlayersExpanded}
              onSelectGuess={setNextMultiplayerGuess}
              onSubmitGuess={handleMultiplayerGuessSubmit}
              onToggleMap={() => setMultiplayerMapExpanded((current) => !current)}
              onTogglePlayers={() => setMultiplayerPlayersExpanded((current) => !current)}
              onLeave={handleLeaveMultiplayer}
              voice={multiplayerVoice}
            />
          )
        ) : showLanding && route === '/wallet' ? (
          <WalletPage profile={profile} session={session} onConnectWallet={handleLandingWalletConnect} />
        ) : showLanding ? (
          <div className="landing-screen">
            <div className="landing-drops-band">
              <div className="landing-drops-grid">
                {landingDrops.map((drop) => {
                  const canPlayDrop = drop.state === 'live'
                  const canViewDrop = drop.state === 'past' || drop.state === 'reveal'
                  const clickHandler = canPlayDrop
                    ? handleDropEntry
                    : canViewDrop
                      ? () => handleDropDetailOpen(drop)
                      : undefined

                  return (
                    <button
                      aria-label={
                        canPlayDrop
                          ? `Play active ${drop.location.city} drop`
                          : canViewDrop
                            ? `View ${drop.location.city} drop details`
                            : undefined
                      }
                      className={`landing-drop-card is-${drop.state}`}
                      disabled={(!canPlayDrop && !canViewDrop) || isBusy}
                      key={drop.key}
                      onClick={clickHandler}
                      type="button"
                    >
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
                    </button>
                  )
                })}
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
                      <HoverButton
                        className="landing-play-button"
                        type="button"
                        disabled={isMultiplayerBusy}
                        onClick={handleCreateRoom}
                      >
                        CREATE ROOM
                      </HoverButton>
                      <HoverButton
                        className="landing-play-button"
                        type="button"
                        disabled={isMultiplayerBusy}
                        onClick={() => {
                          setMultiplayerError('')
                          setIsJoinModalOpen(true)
                        }}
                      >
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
                      <div className="landing-leaderboard-body" role="rowgroup">
                        {LANDING_LEADERBOARD.map((player) => (
                          <div className="landing-leaderboard-row" role="row" key={player.rank}>
                            <span className="landing-leaderboard-rank" role="cell">
                              {player.rank}
                            </span>
                            <span className="landing-leaderboard-avatar" role="cell">
                              <WalletAvatar value={`landing-${player.rank}`} />
                            </span>
                            <span role="cell">{player.correctGuesses}</span>
                            <span role="cell">${ESTIMATED_REWARD_PER_PLAYER}</span>
                          </div>
                        ))}
                      </div>
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

            <div className="hud-top hud-scoreboard" style={scoreboardStyle}>
              {scoreSlots.map((slot) => (
                <div className={`score-cell ${currentLocationIndex === slot ? 'active' : ''}`} key={slot}>
                  <span>R{slot}</span>
                  <strong>{locationResults[slot - 1] ? locationResults[slot - 1].score : '-'}</strong>
                  <small>{getScoreSlotTime(slot)}</small>
                </div>
              ))}
              <div className="score-cell total-cell">
                <span>Total</span>
                <strong>{completedLocations}/{roundLocationCount}</strong>
                <small>{formatClock(totalElapsedSeconds)}</small>
              </div>
            </div>

            <div className="reveal-bottom-bar">
              <div className="reveal-metric">
                <strong>
                  {isDropReveal
                    ? revealResult.winner
                      ? formatWallet(revealResult.winner.walletAddress)
                      : 'No winner'
                    : formatDistance(revealResult.distanceKm)}
                </strong>
                <span>{isDropReveal ? 'winner' : 'distance'}</span>
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

            <div className="hud-top hud-scoreboard" style={scoreboardStyle}>
              {scoreSlots.map((slot) => (
                <div className={`score-cell ${currentLocationIndex === slot ? 'active' : ''}`} key={slot}>
                  <span>R{slot}</span>
                  <strong>{locationResults[slot - 1] ? locationResults[slot - 1].score : '-'}</strong>
                  <small>{getScoreSlotTime(slot)}</small>
                </div>
              ))}
              <div className="score-cell total-cell">
                <span>Total</span>
                <strong>{completedLocations}/{roundLocationCount}</strong>
                <small>{formatClock(totalElapsedSeconds)}</small>
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
      <div
        id="multiplayer-voice-audio-root"
        className="multiplayer-voice-audio"
        aria-hidden="true"
      />

      <DropDetailModal
        detailState={selectedDropDetail}
        error={dropDetailError}
        isLoading={isDropDetailLoading}
        onClose={handleDropDetailClose}
      />
      {isJoinModalOpen ? (
        <MultiplayerJoinModal
          code={multiplayerJoinCode}
          error={multiplayerError}
          isBusy={isMultiplayerBusy}
          onChangeCode={setMultiplayerJoinCode}
          onClose={() => {
            setIsJoinModalOpen(false)
            setMultiplayerError('')
          }}
          onJoin={handleJoinRoomSubmit}
        />
      ) : null}
      {shouldShowUsernameModal ? (
        <UsernameModal
          error={usernameError}
          isBusy={isUsernameSaving}
          username={usernameDraft}
          onChangeUsername={setUsernameDraft}
          onSubmit={handleUsernameSubmit}
        />
      ) : null}
      <ResultModal result={result} onNextRound={handleNextRound} />
    </main>
  )
}

export default App
