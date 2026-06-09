import crypto from 'node:crypto'
import { curatedLocations, regularGameLocations } from '../data/locations.js'
import { distanceToScore, haversineDistanceKm } from './geo.js'
import {
  ensureLedgerEntry,
  getDayKey,
  summarizeQuota,
} from './quota.js'

const REGULAR_ROUND_LOCATION_COUNT = 2
const REGULAR_ROUND_TIME_LIMIT_MS = 90 * 1000

function getActiveLocations(locations, label) {
  const activeLocations = locations.filter((location) => location.active)

  if (activeLocations.length === 0) {
    const error = new Error(`No active ${label} locations are configured.`)
    error.statusCode = 500
    throw error
  }

  return activeLocations
}

function getActiveRegularLocations() {
  return getActiveLocations(regularGameLocations, 'regular game')
}

function pickRegularLocation(state, excludedLocationIds = []) {
  const excluded = new Set(excludedLocationIds)
  const availableLocations = getActiveRegularLocations().filter(
    (location) => !excluded.has(location.id),
  )
  const locations = availableLocations.length > 0 ? availableLocations : getActiveRegularLocations()
  const index = (state.rounds.length + state.guesses.length) % locations.length

  return locations[index]
}

function getWinnerForDrop(state, dropCycleNumber) {
  if (dropCycleNumber === null || dropCycleNumber === undefined) return null

  const winningGuess = state.guesses
    .filter(
      (guess) =>
        guess.dropCycleNumber === dropCycleNumber &&
        guess.rewardEligible,
    )
    .sort((first, second) => new Date(first.createdAt) - new Date(second.createdAt))[0]

  if (!winningGuess) return null

  return {
    walletAddress: winningGuess.walletAddress,
    guessedAt: winningGuess.createdAt,
    distanceKm: winningGuess.distanceKm,
    score: winningGuess.score,
  }
}

function makeRoundPayload(round, location, quota, timestamp = Date.now()) {
  const activeEndsAt = round.activeEndsAt ?? timestamp + REGULAR_ROUND_TIME_LIMIT_MS
  const revealEndsAt = round.revealEndsAt ?? timestamp
  const timeLimitSeconds = Math.max(0, Math.ceil((activeEndsAt - timestamp) / 1000))

  return {
    roundId: round.id,
    status: round.status,
    sequenceIndex: round.sequenceIndex ?? 1,
    roundLocationCount: REGULAR_ROUND_LOCATION_COUNT,
    attemptType: round.attemptType,
    quota,
    panorama: {
      position: {
        lat: location.panorama.lat,
        lng: location.panorama.lng,
      },
      panoId: location.panorama.panoId,
      pov: location.panorama.pov,
      zoom: location.panorama.zoom,
    },
    meta: {
      gameMode: round.gameMode ?? 'regular',
      worldMode: true,
      movingAllowed: true,
      timeLimitSeconds,
      dropCycleNumber: round.dropCycleNumber ?? null,
      activeEndsAt,
      revealEndsAt,
    },
  }
}

function getLocationById(locationId) {
  return [...regularGameLocations, ...curatedLocations].find((location) => location.id === locationId)
}

function pruneInvalidOpenRounds(state, walletAddress) {
  state.rounds = state.rounds.filter((round) => {
    if (round.walletAddress !== walletAddress) return true
    if (round.status !== 'active' && round.status !== 'awaiting_payment') return true
    return Boolean(getLocationById(round.locationId))
  })
}

export function createGameService({ store, rewardThresholdKm }) {
  function getOrCreatePlayer(state, walletAddress) {
    let player = state.players.find((entry) => entry.walletAddress === walletAddress)

    if (!player) {
      player = {
        walletAddress,
        createdAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
      }
      state.players.push(player)
    } else {
      player.lastSeenAt = new Date().toISOString()
    }

    return player
  }

  function getQuota(walletAddress) {
    return store.update((state) => {
      getOrCreatePlayer(state, walletAddress)
      pruneInvalidOpenRounds(state, walletAddress)
      const ledger = ensureLedgerEntry(state, walletAddress, getDayKey())
      ledger.updatedAt = new Date().toISOString()
      return summarizeQuota(ledger)
    })
  }

  function startRound(walletAddress) {
    return store.update((state) => {
      getOrCreatePlayer(state, walletAddress)
      pruneInvalidOpenRounds(state, walletAddress)
      const now = Date.now()

      const existingRound = state.rounds.find(
        (round) =>
          round.walletAddress === walletAddress &&
          round.gameMode !== 'drop' &&
          (round.status === 'active' ||
            round.status === 'awaiting_payment'),
      )
      const ledger = ensureLedgerEntry(state, walletAddress, getDayKey())
      const quota = summarizeQuota(ledger)

      if (existingRound) {
        if (existingRound.status === 'awaiting_payment') {
          const error = new Error('Extra attempts require payment.')
          error.statusCode = 402
          error.payload = {
            code: 'PAYMENT_REQUIRED',
            roundId: existingRound.id,
            quota,
          }
          throw error
        }

        return makeRoundPayload(
          existingRound,
          getLocationById(existingRound.locationId),
          quota,
          now,
        )
      }

      if (quota.freeRemaining <= 0 && quota.paidCredits <= 0) {
        const location = pickRegularLocation(state)
        const awaitingPaymentRound = {
          id: crypto.randomUUID(),
          walletAddress,
          gameMode: 'regular',
          locationId: location.id,
          dropCycleNumber: null,
          activeEndsAt: now + REGULAR_ROUND_TIME_LIMIT_MS,
          revealEndsAt: now,
          attemptType: 'paid',
          status: 'awaiting_payment',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
        state.rounds.push(awaitingPaymentRound)

        const error = new Error('Extra attempts require payment.')
        error.statusCode = 402
        error.payload = {
          code: 'PAYMENT_REQUIRED',
          roundId: awaitingPaymentRound.id,
          quota,
        }
        throw error
      }

      const location = pickRegularLocation(state)
      const round = {
        id: crypto.randomUUID(),
        walletAddress,
        gameMode: 'regular',
        locationId: location.id,
        dropCycleNumber: null,
        activeEndsAt: now + REGULAR_ROUND_TIME_LIMIT_MS,
        revealEndsAt: now,
        sessionRootId: null,
        sequenceIndex: 1,
        attemptType: quota.freeRemaining > 0 ? 'free' : 'paid',
        consumeQuotaOnSubmit: true,
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      round.sessionRootId = round.id

      state.rounds.push(round)

      return makeRoundPayload(round, location, quota, now)
    })
  }

  function continueRound(walletAddress, roundId) {
    return store.update((state) => {
      pruneInvalidOpenRounds(state, walletAddress)
      const sourceRound = state.rounds.find(
        (entry) => entry.id === roundId && entry.walletAddress === walletAddress,
      )

      if (!sourceRound || sourceRound.status !== 'completed') {
        const error = new Error('Round is not ready to continue.')
        error.statusCode = 409
        throw error
      }

      if ((sourceRound.sequenceIndex ?? 1) >= REGULAR_ROUND_LOCATION_COUNT) {
        const error = new Error('Round sequence is already complete.')
        error.statusCode = 409
        throw error
      }

      const rootId = sourceRound.sessionRootId ?? sourceRound.id
      const existingContinuation = state.rounds.find(
        (entry) =>
          entry.walletAddress === walletAddress &&
          entry.sessionRootId === rootId &&
          entry.sequenceIndex === (sourceRound.sequenceIndex ?? 1) + 1,
      )
      const ledger = ensureLedgerEntry(state, walletAddress, getDayKey())
      const quota = summarizeQuota(ledger)

      if (existingContinuation) {
        return makeRoundPayload(
          existingContinuation,
          getLocationById(existingContinuation.locationId),
          quota,
        )
      }

      const activeContinuation = state.rounds.find(
        (entry) =>
          entry.walletAddress === walletAddress &&
          entry.status === 'active' &&
          entry.sessionRootId === rootId,
      )

      if (activeContinuation) {
        return makeRoundPayload(
          activeContinuation,
          getLocationById(activeContinuation.locationId),
          quota,
        )
      }

      const location = pickRegularLocation(
        state,
        state.rounds
          .filter((entry) => entry.sessionRootId === rootId || entry.id === rootId)
          .map((entry) => entry.locationId),
      )
      const now = Date.now()
      const nextRound = {
        id: crypto.randomUUID(),
        walletAddress,
        gameMode: 'regular',
        locationId: location.id,
        dropCycleNumber: null,
        activeEndsAt: now + REGULAR_ROUND_TIME_LIMIT_MS,
        revealEndsAt: now,
        sessionRootId: rootId,
        sequenceIndex: (sourceRound.sequenceIndex ?? 1) + 1,
        attemptType: sourceRound.attemptType,
        consumeQuotaOnSubmit: false,
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      state.rounds.push(nextRound)

      return makeRoundPayload(nextRound, location, quota, now)
    })
  }

  function checkoutAttempt(walletAddress, roundId) {
    return store.update((state) => {
      pruneInvalidOpenRounds(state, walletAddress)
      const round = state.rounds.find(
        (entry) => entry.id === roundId && entry.walletAddress === walletAddress,
      )

      if (!round || round.status !== 'awaiting_payment') {
        const error = new Error('Round is not waiting for payment.')
        error.statusCode = 404
        throw error
      }

      const ledger = ensureLedgerEntry(state, walletAddress, getDayKey())
      ledger.paidCredits += 1
      ledger.updatedAt = new Date().toISOString()
      const now = Date.now()
      round.status = 'active'
      round.activeEndsAt = now + REGULAR_ROUND_TIME_LIMIT_MS
      round.revealEndsAt = now
      round.updatedAt = new Date(now).toISOString()
      round.paymentUnlockedAt = new Date(now).toISOString()

      return {
        checkout: {
          provider: 'mock',
          amountUsd: 1,
          status: 'paid',
          roundId,
        },
        quota: summarizeQuota(ledger),
      }
    })
  }

  function submitGuess(walletAddress, roundId, guess) {
    return store.update((state) => {
      pruneInvalidOpenRounds(state, walletAddress)
      const round = state.rounds.find(
        (entry) => entry.id === roundId && entry.walletAddress === walletAddress,
      )

      if (!round) {
        const error = new Error('Round not found.')
        error.statusCode = 404
        throw error
      }

      if (round.status !== 'active') {
        const error = new Error('Round is not accepting guesses.')
        error.statusCode = 409
        throw error
      }

      const now = Date.now()

      if (now > round.activeEndsAt) {
        round.status = 'closed'
        round.updatedAt = new Date(now).toISOString()
        const error = new Error('This round has ended.')
        error.statusCode = 409
        error.payload = {
          code: round.gameMode === 'drop' ? 'DROP_CLOSED' : 'ROUND_CLOSED',
          activeEndsAt: round.activeEndsAt,
          revealEndsAt: round.revealEndsAt,
        }
        throw error
      }

      const ledger = ensureLedgerEntry(state, walletAddress, getDayKey())

      if (round.consumeQuotaOnSubmit && round.attemptType === 'paid' && ledger.paidCredits <= 0) {
        const error = new Error('Paid attempt credit is required before guessing.')
        error.statusCode = 402
        error.payload = {
          code: 'PAYMENT_REQUIRED',
          roundId,
          quota: summarizeQuota(ledger),
        }
        throw error
      }

      const location = getLocationById(round.locationId)
      const answer = { lat: location.panorama.lat, lng: location.panorama.lng }
      const distanceKm = haversineDistanceKm(answer, guess)
      const score = distanceToScore(distanceKm)
      const rewardEligible = distanceKm <= rewardThresholdKm
      const rewardSp = rewardEligible ? location.rewardSp : 0

      if (round.consumeQuotaOnSubmit) {
        if (round.attemptType === 'free') {
          ledger.freeUsed += 1
        } else {
          ledger.paidCredits -= 1
          ledger.paidConsumed += 1
        }
      }

      ledger.updatedAt = new Date().toISOString()
      round.status = round.gameMode === 'drop' ? 'submitted' : 'completed'
      round.updatedAt = new Date().toISOString()
      round.guessedAt = new Date().toISOString()
      round.result = {
        distanceKm: Number(distanceKm.toFixed(2)),
        score,
        rewardEligible,
        rewardSp,
        thresholdKm: rewardThresholdKm,
        guess,
        answer,
        country: location.country,
        region: location.region,
        revealEndsAt: round.revealEndsAt,
      }

      state.guesses.push({
        id: crypto.randomUUID(),
        roundId,
        walletAddress,
        dropCycleNumber: round.dropCycleNumber ?? null,
        locationId: round.locationId,
        guessLat: guess.lat,
        guessLng: guess.lng,
        distanceKm: round.result.distanceKm,
        score,
        rewardEligible,
        createdAt: round.guessedAt,
      })

      state.rewardEvents.push({
        id: crypto.randomUUID(),
        roundId,
        walletAddress,
        rewardSp,
        rewardEligible,
        createdAt: round.guessedAt,
      })

      return {
        roundId: round.id,
        attemptType: round.attemptType,
        quota: summarizeQuota(ledger),
        ...(round.gameMode === 'drop'
          ? {
              pendingReveal: {
                activeEndsAt: round.activeEndsAt,
                revealEndsAt: round.revealEndsAt,
              },
            }
          : {
              result: {
                ...round.result,
                winner: null,
              },
            }),
      }
    })
  }

  function getRoundResult(walletAddress, roundId) {
    return store.update((state) => {
      pruneInvalidOpenRounds(state, walletAddress)
      const round = state.rounds.find(
        (entry) => entry.id === roundId && entry.walletAddress === walletAddress,
      )

      if (!round || (round.status !== 'submitted' && round.status !== 'completed') || !round.result) {
        const error = new Error('Round result is not ready.')
        error.statusCode = 404
        throw error
      }

      const now = Date.now()

      if (now < round.revealEndsAt) {
        const error = new Error('Reveal is still counting down.')
        error.statusCode = 425
        error.payload = {
          code: 'REVEAL_PENDING',
          activeEndsAt: round.activeEndsAt,
          revealEndsAt: round.revealEndsAt,
          secondsUntilReveal: Math.ceil((round.revealEndsAt - now) / 1000),
        }
        throw error
      }

      const ledger = ensureLedgerEntry(state, walletAddress, getDayKey())
      const location = getLocationById(round.locationId)
      const winner = round.gameMode === 'drop' ? getWinnerForDrop(state, round.dropCycleNumber) : null

      round.status = 'completed'
      round.updatedAt = new Date(now).toISOString()

      return {
        roundId: round.id,
        attemptType: round.attemptType,
        quota: summarizeQuota(ledger),
        result: {
          ...round.result,
          country: location.country,
          region: location.region,
          winner,
        },
      }
    })
  }

  return {
    continueRound,
    getQuota,
    startRound,
    checkoutAttempt,
    submitGuess,
    getRoundResult,
  }
}
