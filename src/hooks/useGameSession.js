import { useCallback, useEffect, useRef, useState } from 'react'
import { apiClient } from '../api/client'
import { getDemoWallet } from '../lib/demoWallet'

const SESSION_STORAGE_KEY = 'sp-guess-session'
const USERNAME_STORAGE_KEY = 'sp-guess-usernames'
const ROUND_LOCATION_COUNT = 2
const REGULAR_REVEAL_AUTO_ADVANCE_MS = 1600

function bytesToBase64(bytes) {
  let binary = ''

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })

  return window.btoa(binary)
}

function loadStoredSession() {
  if (typeof window === 'undefined') return null

  const raw = window.localStorage.getItem(SESSION_STORAGE_KEY)
  if (!raw) return null

  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function loadStoredUsernames() {
  if (typeof window === 'undefined') return {}

  const raw = window.localStorage.getItem(USERNAME_STORAGE_KEY)
  if (!raw) return {}

  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function getStoredUsername(walletAddress) {
  if (!walletAddress) return ''
  const storedUsernames = loadStoredUsernames()
  if (storedUsernames[walletAddress]) return storedUsernames[walletAddress]

  const storedSession = loadStoredSession()
  return storedSession?.walletAddress === walletAddress ? storedSession.username ?? '' : ''
}

function saveStoredUsername(walletAddress, username) {
  if (typeof window === 'undefined' || !walletAddress || !username) return

  const usernames = loadStoredUsernames()
  usernames[walletAddress] = username
  window.localStorage.setItem(USERNAME_STORAGE_KEY, JSON.stringify(usernames))
}

function hasRoundPanorama(round) {
  return Boolean(round?.panorama?.position)
}

function getRoundElapsedSeconds(round) {
  const timeLimitSeconds = round?.meta?.timeLimitSeconds ?? 90
  const activeEndsAt = round?.meta?.activeEndsAt

  if (!activeEndsAt) return timeLimitSeconds

  const remainingSeconds = Math.max(0, Math.ceil((activeEndsAt - Date.now()) / 1000))
  return Math.max(0, timeLimitSeconds - remainingSeconds)
}

function summarizeLocationResults(results, thresholdKm) {
  const totalRewardSp = results.reduce((sum, entry) => sum + entry.rewardSp, 0)
  const totalScore = results.reduce((sum, entry) => sum + entry.score, 0)
  const rewardEligibleCount = results.filter((entry) => entry.rewardEligible).length
  const distanceResults = results.filter((entry) => Number.isFinite(entry.distanceKm))
  const averageDistanceKm =
    distanceResults.length > 0
      ? distanceResults.reduce((sum, entry) => sum + entry.distanceKm, 0) / distanceResults.length
      : null

  return {
    stops: results,
    totalRewardSp,
    totalScore,
    rewardEligibleCount,
    thresholdKm,
    averageDistanceKm: Number.isFinite(averageDistanceKm)
      ? Number(averageDistanceKm.toFixed(2))
      : null,
  }
}

export function useGameSession() {
  const [session, setSession] = useState(loadStoredSession)
  const [phase, setPhase] = useState('disconnected')
  const [quota, setQuota] = useState(null)
  const [profile, setProfile] = useState(null)
  const [activeRound, setActiveRound] = useState(null)
  const [paymentRoundId, setPaymentRoundId] = useState(null)
  const [selectedGuess, setSelectedGuess] = useState(null)
  const [result, setResult] = useState(null)
  const [revealResult, setRevealResult] = useState(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('Connect a Solana wallet to start your first round.')
  const [isBusy, setIsBusy] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(90)
  const [currentLocationIndex, setCurrentLocationIndex] = useState(1)
  const [locationResults, setLocationResults] = useState([])
  const [pendingNextRound, setPendingNextRound] = useState(null)
  const [pendingFinalSummary, setPendingFinalSummary] = useState(null)
  const [pendingRevealRoundId, setPendingRevealRoundId] = useState(null)
  const timerRef = useRef(null)
  const timeoutResultRoundRef = useRef(null)
  const authToken = session?.token
  const activeRoundLocationCount = activeRound?.roundLocationCount ?? ROUND_LOCATION_COUNT

  const resolveProfileUsername = useCallback(async (token, walletAddress, profilePayload) => {
    if (!token || !walletAddress || profilePayload?.hasUsername) {
      if (profilePayload?.username) {
        saveStoredUsername(walletAddress, profilePayload.username)
      }
      return profilePayload
    }

    const storedUsername = getStoredUsername(walletAddress)
    if (!storedUsername) return profilePayload

    try {
      const syncedProfile = await apiClient.updateProfile(token, { username: storedUsername })
      if (syncedProfile?.username) {
        saveStoredUsername(walletAddress, syncedProfile.username)
      }
      return syncedProfile
    } catch {
      return profilePayload
    }
  }, [])

  function activateRound(round, statusMessage = 'Pan the world, read the clues, and place one decisive pin.') {
    if (!hasRoundPanorama(round)) {
      throw new Error('Round payload missing panorama data.')
    }

    setActiveRound(round)
    setSelectedGuess(null)
    setResult(null)
    setRevealResult(null)
    setLocationResults([])
    setCurrentLocationIndex(round.sequenceIndex ?? 1)
    setPaymentRoundId(null)
    setPendingNextRound(null)
    setPendingFinalSummary(null)
    setPendingRevealRoundId(null)
    timeoutResultRoundRef.current = null
    setQuota(round.quota)
    setPhase('playing')
    setSecondsLeft(round.meta?.timeLimitSeconds ?? 90)
    setStatus(statusMessage)
  }

  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (session) {
        window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
      } else {
        window.localStorage.removeItem(SESSION_STORAGE_KEY)
      }
    }
  }, [session])

  useEffect(() => {
    if (!session?.token) return undefined

    apiClient
      .getQuota(session.token)
      .then(async (nextQuota) => {
        const nextProfile = await apiClient.getProfile(session.token)
        const resolvedProfile = await resolveProfileUsername(
          session.token,
          session.walletAddress,
          nextProfile,
        )
        setQuota(nextQuota)
        setProfile(resolvedProfile)
        if (resolvedProfile?.username) {
          setSession((current) =>
            current?.walletAddress === session.walletAddress
              ? { ...current, username: resolvedProfile.username }
              : current,
          )
        }
        setPhase((current) => (current === 'disconnected' ? 'ready' : current))
      })
      .catch(() => {
        setSession(null)
        setProfile(null)
        setPhase('disconnected')
      })

    return undefined
  }, [resolveProfileUsername, session?.token, session?.walletAddress])

  useEffect(() => {
    if (phase !== 'playing' && phase !== 'submitted') {
      window.clearInterval(timerRef.current)
      return undefined
    }

    const deadline =
      phase === 'submitted'
        ? activeRound?.meta?.revealEndsAt
        : activeRound?.meta?.activeEndsAt

    if (!deadline) {
      return undefined
    }

    const syncSecondsLeft = () => {
      const nextSecondsLeft = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
      setSecondsLeft(nextSecondsLeft)

      if (nextSecondsLeft <= 0) {
        window.clearInterval(timerRef.current)
      }
    }

    syncSecondsLeft()
    timerRef.current = window.setInterval(() => {
      syncSecondsLeft()
    }, 1000)

    return () => window.clearInterval(timerRef.current)
  }, [activeRound?.meta?.activeEndsAt, activeRound?.meta?.revealEndsAt, phase])

  const loadRevealResult = useCallback(async (roundId, options = {}) => {
    if (!authToken) return

    setIsBusy(true)
    setError('')

    try {
      const payload = await apiClient.getResult(authToken, roundId)
      const revealedResult = {
        ...payload.result,
        timedOut: Boolean(payload.result.timedOut || options.timedOut),
        elapsedSeconds: getRoundElapsedSeconds(activeRound),
      }
      const nextResults = [...locationResults, revealedResult]
      const isRegularRound = activeRound?.meta?.gameMode !== 'drop'
      const hasMoreRegularStops =
        isRegularRound && currentLocationIndex < activeRoundLocationCount

      setQuota(payload.quota)
      if (payload.profile) setProfile(payload.profile)
      setLocationResults(nextResults)
      setPendingRevealRoundId(null)
      setRevealResult({
        ...revealedResult,
        stopIndex: currentLocationIndex,
        stopCount: activeRoundLocationCount,
      })
      setPendingNextRound(hasMoreRegularStops ? { needsFetch: true } : null)
      setPendingFinalSummary(
        hasMoreRegularStops
          ? null
          : summarizeLocationResults(nextResults, revealedResult.thresholdKm),
      )
      setPhase('reveal')
      setStatus(
        revealedResult.timedOut
          ? 'Times Up.'
          : activeRound?.meta?.gameMode === 'drop'
          ? payload.result.winner
            ? `Reveal live. Winner: ${payload.result.winner.walletAddress.slice(0, 4)}...${payload.result.winner.walletAddress.slice(-4)}.`
            : 'Reveal live. No correct winner for this drop.'
          : `Reveal live. Distance: ${revealedResult.distanceKm.toFixed(1)} km.`,
      )
    } catch (caughtError) {
      if (caughtError.status === 425 && caughtError.payload?.secondsUntilReveal) {
        setPendingRevealRoundId(roundId)
        setSecondsLeft(caughtError.payload.secondsUntilReveal)
        setPhase('submitted')
        setStatus(options.timedOut ? 'Times Up. Reveal countdown is live.' : 'Guess submitted. Reveal is still counting down.')
      } else {
        setError(caughtError.message)
      }
    } finally {
      setIsBusy(false)
    }
  }, [activeRound, activeRoundLocationCount, authToken, currentLocationIndex, locationResults])

  useEffect(() => {
    if (phase !== 'playing' || secondsLeft !== 0 || !activeRound?.roundId) {
      return
    }

    if (timeoutResultRoundRef.current === activeRound.roundId) {
      return
    }

    timeoutResultRoundRef.current = activeRound.roundId
    setSelectedGuess(null)
    setStatus('Times Up.')
    void loadRevealResult(activeRound.roundId, { timedOut: true })
  }, [activeRound?.roundId, loadRevealResult, phase, secondsLeft])

  useEffect(() => {
    if (phase !== 'submitted' || secondsLeft !== 0 || !pendingRevealRoundId) {
      return undefined
    }

    const timeoutId = window.setTimeout(() => {
      void loadRevealResult(pendingRevealRoundId)
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [loadRevealResult, pendingRevealRoundId, phase, secondsLeft])

  async function connectWallet() {
    setIsBusy(true)
    setError('')

    try {
      const provider = window.solana?.isPhantom ? window.solana : null
      let signerLabel = 'Demo signer'
      let walletAddress
      let signMessage

      if (provider) {
        try {
          const wallet = await provider.connect()
          walletAddress = wallet.publicKey.toBase58()
          signMessage = async (messageBytes) => {
            const signatureBytes = await provider.signMessage(messageBytes, 'utf8')
            return signatureBytes.signature
          }
          signerLabel = 'Phantom'
        } catch {
          const demoWallet = getDemoWallet()
          walletAddress = demoWallet.walletAddress
          signMessage = demoWallet.signMessage
        }
      } else {
        const demoWallet = getDemoWallet()
        walletAddress = demoWallet.walletAddress
        signMessage = demoWallet.signMessage
      }

      const challenge = await apiClient.createChallenge(walletAddress)
      const messageBytes = new TextEncoder().encode(challenge.message)
      const signatureBytes = await signMessage(messageBytes)
      const signature = bytesToBase64(signatureBytes)
      const storedUsername = getStoredUsername(walletAddress)
      const verified = await apiClient.verifyWallet({
        walletAddress,
        message: challenge.message,
        signature,
        username: storedUsername || undefined,
      })
      const verifiedProfile = await resolveProfileUsername(
        verified.token,
        walletAddress,
        verified.profile,
      )

      setSession({
        token: verified.token,
        walletAddress,
        signerLabel,
        username: verifiedProfile?.username || storedUsername || '',
      })
      setQuota(verified.quota)
      setProfile(verifiedProfile)
      setPhase('ready')
      setStatus(
        signerLabel === 'Phantom'
          ? 'Wallet verified. Start a round and pin the map.'
          : 'Demo wallet verified. Add your Google Maps key to enable the full panorama flow.',
      )
      return {
        token: verified.token,
        walletAddress,
      }
    } catch (caughtError) {
      setError(caughtError.message)
      setStatus('Wallet verification failed. Try connecting again.')
      return null
    } finally {
      setIsBusy(false)
    }
  }

  async function updateUsername(username) {
    if (!session?.token) return null

    setIsBusy(true)
    setError('')

    try {
      const nextProfile = await apiClient.updateProfile(session.token, { username })
      if (nextProfile?.username) {
        saveStoredUsername(session.walletAddress, nextProfile.username)
      }
      setSession((current) =>
        current
          ? {
              ...current,
              username: nextProfile?.username ?? current.username ?? '',
            }
          : current,
      )
      setProfile(nextProfile)
      setStatus(`Signed in as ${nextProfile.username}.`)
      return nextProfile
    } catch (caughtError) {
      setError(caughtError.message)
      throw caughtError
    } finally {
      setIsBusy(false)
    }
  }

  async function startRound(tokenOverride) {
    const authToken = tokenOverride ?? session?.token

    if (!authToken) return { status: 'missing_token' }

    setIsBusy(true)
    setError('')

    try {
      const round = await apiClient.startRound(authToken)
      activateRound(round)
      return {
        status: 'started',
        round,
      }
    } catch (caughtError) {
      if (caughtError.status === 402 && caughtError.payload?.roundId) {
        setPaymentRoundId(caughtError.payload.roundId)
        setQuota(caughtError.payload.quota)
        setPhase('quota_blocked')
        setStatus('Free quota exhausted. Each extra game costs 10 NOTF.')
        return {
          status: 'quota_blocked',
          roundId: caughtError.payload.roundId,
        }
      } else {
        setError(caughtError.message)
      }
      return {
        status: 'error',
      }
    } finally {
      setIsBusy(false)
    }
  }

  async function startDrop(tokenOverride) {
    const authToken = tokenOverride ?? session?.token

    if (!authToken) return { status: 'missing_token' }

    setIsBusy(true)
    setError('')

    try {
      const round = await apiClient.startDrop(authToken)
      activateRound(round, 'Active drop is live. Submit before the drop window ends.')
      return {
        status: 'started',
        round,
      }
    } catch (caughtError) {
      setError(caughtError.message)
      return {
        status: 'error',
      }
    } finally {
      setIsBusy(false)
    }
  }

  async function beginExperience() {
    const nextSession = session ?? (await connectWallet())
    if (!nextSession?.token) return { status: 'error' }
    return startRound(nextSession.token)
  }

  async function beginDropExperience() {
    const nextSession = session ?? (await connectWallet())
    if (!nextSession?.token) return { status: 'error' }
    return startDrop(nextSession.token)
  }

  async function unlockPaidRound() {
    if (!session?.token || !paymentRoundId) return { status: 'missing_payment_round' }
    setStatus('Starting paid NOTF game.')
    return startRound()
  }

  async function submitGuess() {
    if (!session?.token || !activeRound || !selectedGuess) return

    setIsBusy(true)
    setError('')
    setPhase('submitted')

    try {
      const payload = await apiClient.submitGuess(
        session.token,
        activeRound.roundId,
        selectedGuess,
      )

      if (payload.pendingReveal) {
        const secondsUntilReveal = Math.max(
          0,
          Math.ceil((payload.pendingReveal.revealEndsAt - Date.now()) / 1000),
        )

        setQuota(payload.quota)
        if (payload.profile) setProfile(payload.profile)
        setSelectedGuess(null)
        setPendingRevealRoundId(activeRound.roundId)
        setSecondsLeft(secondsUntilReveal)
        setStatus(
          secondsUntilReveal > 120
            ? 'Guess submitted. Waiting for the active drop to end.'
            : 'Guess submitted. Reveal countdown is live.',
        )
        setPhase('submitted')
        return {
          status: 'pending_reveal',
          pendingReveal: payload.pendingReveal,
          round: activeRound,
        }
      }

      const revealedResult = {
        ...payload.result,
        elapsedSeconds: getRoundElapsedSeconds(activeRound),
      }
      const nextResults = [...locationResults, revealedResult]
      const finalSummary = summarizeLocationResults(nextResults, revealedResult.thresholdKm)
      setQuota(payload.quota)
      if (payload.profile) setProfile(payload.profile)
      setLocationResults(nextResults)
      setSelectedGuess(null)

      if (currentLocationIndex < activeRoundLocationCount) {
        setPendingNextRound({ needsFetch: true })
        setPendingFinalSummary(null)
        setRevealResult({
          ...revealedResult,
          stopIndex: currentLocationIndex,
          stopCount: activeRoundLocationCount,
        })
        setPhase('reveal')
        setStatus(`R${currentLocationIndex} revealed. R${currentLocationIndex + 1} starts automatically.`)
        return
      }

      setRevealResult({
        ...revealedResult,
        stopIndex: currentLocationIndex,
        stopCount: activeRoundLocationCount,
      })
      setPendingFinalSummary(finalSummary)
      setPhase('reveal')
      setStatus(
        finalSummary.totalRewardSp > 0
          ? `Round complete. ${finalSummary.totalRewardSp} NOTF queued across ${finalSummary.rewardEligibleCount} correct locations.`
          : 'Round complete. No NOTF this time, but the reveal is live.',
      )
      return {
        status: 'revealed',
        result: revealedResult,
      }
    } catch (caughtError) {
      if (
        caughtError.status === 409 &&
        (caughtError.payload?.code === 'ROUND_CLOSED' || caughtError.payload?.code === 'DROP_CLOSED')
      ) {
        setSelectedGuess(null)
        setStatus('Times Up.')
        void loadRevealResult(activeRound.roundId, { timedOut: true })
        return { status: 'timed_out' }
      }

      setPhase('playing')
      setError(caughtError.message)
      return { status: 'error' }
    } finally {
      setIsBusy(false)
    }
  }

  function resetForNextRound() {
    setActiveRound(null)
    setSelectedGuess(null)
    setResult(null)
    setRevealResult(null)
    setLocationResults([])
    setCurrentLocationIndex(1)
    setPaymentRoundId(null)
    setPendingNextRound(null)
    setPendingFinalSummary(null)
    setPendingRevealRoundId(null)
    setSecondsLeft(90)
    setPhase('ready')
  }

  const continueAfterReveal = useCallback(async () => {
    if (pendingNextRound) {
      if (!session?.token) return

      setIsBusy(true)
      setError('')

      try {
        const nextRound = await apiClient.continueRound(session.token, activeRound.roundId)
        if (!hasRoundPanorama(nextRound)) {
          throw new Error('Next round payload missing panorama data.')
        }
        setActiveRound(nextRound)
        setPendingNextRound(null)
        setRevealResult(null)
        setCurrentLocationIndex(nextRound.sequenceIndex ?? currentLocationIndex + 1)
        setPhase('playing')
        setSecondsLeft(nextRound.meta?.timeLimitSeconds ?? 90)
        setStatus(`R${nextRound.sequenceIndex ?? currentLocationIndex + 1} is live.`)
      } catch (caughtError) {
        setError(caughtError.message)
      } finally {
        setIsBusy(false)
      }
      return
    }

    if (pendingFinalSummary) {
      setResult(pendingFinalSummary)
      setPendingFinalSummary(null)
      setRevealResult(null)
      setPhase('result')
    }
  }, [
    activeRound,
    currentLocationIndex,
    pendingFinalSummary,
    pendingNextRound,
    session,
  ])

  useEffect(() => {
    if (
      phase !== 'reveal' ||
      !revealResult ||
      activeRound?.meta?.gameMode === 'drop' ||
      (!pendingNextRound && !pendingFinalSummary)
    ) {
      return undefined
    }

    const timeoutId = window.setTimeout(() => {
      void continueAfterReveal()
    }, REGULAR_REVEAL_AUTO_ADVANCE_MS)

    return () => window.clearTimeout(timeoutId)
  }, [
    activeRound?.meta?.gameMode,
    continueAfterReveal,
    pendingFinalSummary,
    pendingNextRound,
    phase,
    revealResult,
  ])

  return {
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
    status,
    isBusy,
    secondsLeft,
    currentLocationIndex,
    locationResults,
    roundLocationCount: activeRoundLocationCount,
    setSelectedGuess,
    connectWallet,
    updateUsername,
    startRound,
    startDrop,
    beginExperience,
    beginDropExperience,
    unlockPaidRound,
    submitGuess,
    continueAfterReveal,
    resetForNextRound,
  }
}
