import { useCallback, useEffect, useRef, useState } from 'react'
import { apiClient } from '../api/client'
import { getDemoWallet } from '../lib/demoWallet'

const SESSION_STORAGE_KEY = 'sp-guess-session'
const ROUND_LOCATION_COUNT = 2

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
  const authToken = session?.token
  const activeRoundLocationCount = activeRound?.roundLocationCount ?? ROUND_LOCATION_COUNT

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
        setQuota(nextQuota)
        setProfile(await apiClient.getProfile(session.token))
        setPhase((current) => (current === 'disconnected' ? 'ready' : current))
      })
      .catch(() => {
        setSession(null)
        setProfile(null)
        setPhase('disconnected')
      })

    return undefined
  }, [session?.token])

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

  const loadRevealResult = useCallback(async (roundId) => {
    if (!authToken) return

    setIsBusy(true)
    setError('')

    try {
      const payload = await apiClient.getResult(authToken, roundId)
      const revealedResult = {
        ...payload.result,
        elapsedSeconds: getRoundElapsedSeconds(activeRound),
      }
      const nextResults = [...locationResults, revealedResult]
      const totalRewardSp = nextResults.reduce((sum, entry) => sum + entry.rewardSp, 0)
      const totalScore = nextResults.reduce((sum, entry) => sum + entry.score, 0)
      const rewardEligibleCount = nextResults.filter((entry) => entry.rewardEligible).length
      const averageDistanceKm =
        nextResults.reduce((sum, entry) => sum + entry.distanceKm, 0) / nextResults.length

      setQuota(payload.quota)
      if (payload.profile) setProfile(payload.profile)
      setLocationResults(nextResults)
      setPendingRevealRoundId(null)
      setRevealResult({
        ...revealedResult,
        stopIndex: currentLocationIndex,
        stopCount: activeRoundLocationCount,
      })
      setPendingFinalSummary({
        stops: nextResults,
        totalRewardSp,
        totalScore,
        rewardEligibleCount,
        thresholdKm: revealedResult.thresholdKm,
        averageDistanceKm: Number(averageDistanceKm.toFixed(2)),
      })
      setPhase('reveal')
      setStatus(
        activeRound?.meta?.gameMode === 'drop'
          ? payload.result.winner
            ? `Reveal live. Winner: ${payload.result.winner.walletAddress.slice(0, 4)}...${payload.result.winner.walletAddress.slice(-4)}.`
            : 'Reveal live. No correct winner for this drop.'
          : `Reveal live. Distance: ${revealedResult.distanceKm.toFixed(1)} km.`,
      )
    } catch (caughtError) {
      if (caughtError.status === 425 && caughtError.payload?.secondsUntilReveal) {
        setSecondsLeft(caughtError.payload.secondsUntilReveal)
        setStatus('Guess submitted. Reveal is still counting down.')
      } else {
        setError(caughtError.message)
      }
    } finally {
      setIsBusy(false)
    }
  }, [activeRound, activeRoundLocationCount, authToken, currentLocationIndex, locationResults])

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
      const verified = await apiClient.verifyWallet({
        walletAddress,
        message: challenge.message,
        signature,
      })

      setSession({
        token: verified.token,
        walletAddress,
        signerLabel,
      })
      setQuota(verified.quota)
      setProfile(verified.profile)
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
        setStatus('Free quota exhausted. Unlock one extra round for $1.')
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

    setIsBusy(true)
    setError('')

    try {
      const checkout = await apiClient.checkoutIntent(session.token, paymentRoundId)
      setQuota(checkout.quota)
      setStatus('Paid attempt unlocked. Your round is ready.')
      return await startRound()
    } catch (caughtError) {
      setError(caughtError.message)
      return { status: 'error' }
    } finally {
      setIsBusy(false)
    }
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
        return
      }

      const revealedResult = {
        ...payload.result,
        elapsedSeconds: getRoundElapsedSeconds(activeRound),
      }
      const nextResults = [...locationResults, revealedResult]
      setQuota(payload.quota)
      if (payload.profile) setProfile(payload.profile)
      setLocationResults(nextResults)
      setSelectedGuess(null)

      if (currentLocationIndex < activeRoundLocationCount) {
        setPendingNextRound({ needsFetch: true })
        setRevealResult({
          ...revealedResult,
          stopIndex: currentLocationIndex,
          stopCount: activeRoundLocationCount,
        })
        setPhase('reveal')
        setStatus(`R${currentLocationIndex} revealed. Continue when ready for R${currentLocationIndex + 1}.`)
        return
      }

      const totalRewardSp = nextResults.reduce((sum, entry) => sum + entry.rewardSp, 0)
      const totalScore = nextResults.reduce((sum, entry) => sum + entry.score, 0)
      const rewardEligibleCount = nextResults.filter((entry) => entry.rewardEligible).length
      const averageDistanceKm =
        nextResults.reduce((sum, entry) => sum + entry.distanceKm, 0) / nextResults.length

      setRevealResult({
        ...revealedResult,
        stopIndex: currentLocationIndex,
        stopCount: activeRoundLocationCount,
      })
      setPendingFinalSummary({
        stops: nextResults,
        totalRewardSp,
        totalScore,
        rewardEligibleCount,
        thresholdKm: revealedResult.thresholdKm,
        averageDistanceKm: Number(averageDistanceKm.toFixed(2)),
      })
      setPhase('reveal')
      setStatus(
        totalRewardSp > 0
          ? `Round complete. ${totalRewardSp} SP queued across ${rewardEligibleCount} correct locations.`
          : 'Round complete. No SP this time, but the reveal is live.',
      )
    } catch (caughtError) {
      setPhase('playing')
      setError(caughtError.message)
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

  async function continueAfterReveal() {
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
  }

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
