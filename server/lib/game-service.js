import crypto from 'node:crypto'
import { curatedLocations } from '../data/locations.js'
import { distanceToScore, haversineDistanceKm } from './geo.js'
import {
  ensureLedgerEntry,
  getDayKey,
  summarizeQuota,
} from './quota.js'

const ROUND_LOCATION_COUNT = 2

function pickNextLocation(state, walletAddress) {
  const activeLocations = curatedLocations.filter((location) => location.active)
  const walletRounds = state.rounds.filter(
    (round) => round.walletAddress === walletAddress,
  )
  const seenLocationIds = new Set(walletRounds.map((round) => round.locationId))

  const unseenLocations = activeLocations.filter(
    (location) => !seenLocationIds.has(location.id),
  )

  if (unseenLocations.length > 0) {
    return unseenLocations[Math.floor(Math.random() * unseenLocations.length)]
  }

  const recentLocationIds = walletRounds
    .slice(-4)
    .map((round) => round.locationId)

  const candidates = activeLocations.filter(
    (location) => !recentLocationIds.includes(location.id),
  )

  const pool = candidates.length > 0 ? candidates : activeLocations
  return pool[Math.floor(Math.random() * pool.length)]
}

function makeRoundPayload(round, location, quota) {
  return {
    roundId: round.id,
    status: round.status,
    sequenceIndex: round.sequenceIndex ?? 1,
    roundLocationCount: ROUND_LOCATION_COUNT,
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
      worldMode: true,
      movingAllowed: true,
      timeLimitSeconds: 90,
    },
  }
}

function getLocationById(locationId) {
  return curatedLocations.find((location) => location.id === locationId)
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
      const existingRound = state.rounds.find(
        (round) =>
          round.walletAddress === walletAddress &&
          (round.status === 'active' || round.status === 'awaiting_payment'),
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
        )
      }

      if (quota.freeRemaining <= 0 && quota.paidCredits <= 0) {
        const location = pickNextLocation(state, walletAddress)
        const awaitingPaymentRound = {
          id: crypto.randomUUID(),
          walletAddress,
          locationId: location.id,
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

      const location = pickNextLocation(state, walletAddress)
      const round = {
        id: crypto.randomUUID(),
        walletAddress,
        locationId: location.id,
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

      return makeRoundPayload(round, location, quota)
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

      if ((sourceRound.sequenceIndex ?? 1) >= ROUND_LOCATION_COUNT) {
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

      const location = pickNextLocation(state, walletAddress)
      const nextRound = {
        id: crypto.randomUUID(),
        walletAddress,
        locationId: location.id,
        sessionRootId: rootId,
        sequenceIndex: (sourceRound.sequenceIndex ?? 1) + 1,
        attemptType: sourceRound.attemptType,
        consumeQuotaOnSubmit: false,
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      state.rounds.push(nextRound)

      return makeRoundPayload(nextRound, location, quota)
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
      round.status = 'active'
      round.updatedAt = new Date().toISOString()
      round.paymentUnlockedAt = new Date().toISOString()

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
      round.status = 'completed'
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
      }

      state.guesses.push({
        id: crypto.randomUUID(),
        roundId,
        walletAddress,
        guessLat: guess.lat,
        guessLng: guess.lng,
        distanceKm: round.result.distanceKm,
        score,
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
        result: round.result,
      }
    })
  }

  function getRoundResult(walletAddress, roundId) {
    return store.update((state) => {
      pruneInvalidOpenRounds(state, walletAddress)
      const round = state.rounds.find(
        (entry) => entry.id === roundId && entry.walletAddress === walletAddress,
      )

      if (!round || round.status !== 'completed' || !round.result) {
        const error = new Error('Round result is not ready.')
        error.statusCode = 404
        throw error
      }

      const ledger = ensureLedgerEntry(state, walletAddress, getDayKey())

      return {
        roundId: round.id,
        attemptType: round.attemptType,
        quota: summarizeQuota(ledger),
        result: round.result,
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
