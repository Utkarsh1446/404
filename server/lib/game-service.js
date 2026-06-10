import crypto from 'node:crypto'
import { AccessToken } from 'livekit-server-sdk'
import { curatedLocations, regularGameLocations } from '../data/locations.js'
import {
  DROP_ACTIVE_MS,
  DROP_CYCLE_MS,
  DROP_REVEAL_MS,
  getScheduledDrop,
  pickDropLocation,
} from './drop-schedule.js'
import { distanceToScore, haversineDistanceKm } from './geo.js'
import {
  ensureLedgerEntry,
  getDayKey,
  summarizeQuota,
} from './quota.js'

const REGULAR_ROUND_LOCATION_COUNT = 2
const REGULAR_ROUND_TIME_LIMIT_MS = 90 * 1000
const MULTIPLAYER_ROUND_LOCATION_COUNT = 5
const MULTIPLAYER_MIN_PLAYERS = 2
const MULTIPLAYER_MAX_PLAYERS = 20
const MULTIPLAYER_COUNTDOWN_MS = 5 * 1000
const MULTIPLAYER_REVEAL_MS = 7 * 1000
const DEFAULT_TOKEN_BALANCE = 300
const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,16}$/

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

function getActiveDropLocations() {
  return getActiveLocations(curatedLocations, 'drop')
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

function ensureStateCollections(state) {
  state.multiplayerRooms ??= []
  state.dropParticipations ??= []
  state.dropSettlements ??= []
  state.rewardEvents ??= []
}

function generateRoomCode(state) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

  for (let attempt = 0; attempt < 20; attempt += 1) {
    let code = ''
    for (let index = 0; index < 5; index += 1) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)]
    }

    if (!state.multiplayerRooms.some((room) => room.code === code)) {
      return code
    }
  }

  return crypto.randomUUID().slice(0, 5).toUpperCase()
}

function pickMultiplayerLocations(state) {
  const locations = getActiveRegularLocations()
  const offset = state.multiplayerRooms.length % locations.length

  return Array.from({ length: MULTIPLAYER_ROUND_LOCATION_COUNT }, (_entry, index) =>
    locations[(offset + index) % locations.length].id,
  )
}

function ensurePlayerAccount(player) {
  player.tokenBalance ??= DEFAULT_TOKEN_BALANCE
  player.spBalance ??= 0
  player.dropWins ??= 0
  if (typeof player.username === 'string') {
    player.username = normalizeUsername(player.username)
  }
  player.updatedAt ??= player.lastSeenAt ?? new Date().toISOString()
  return player
}

function normalizeUsername(username) {
  return String(username ?? '').trim().replace(/\s+/g, '_').slice(0, 16)
}

function assertValidUsername(username) {
  const normalized = normalizeUsername(username)

  if (!USERNAME_PATTERN.test(normalized)) {
    const error = new Error('Username must be 3-16 letters, numbers, or underscores.')
    error.statusCode = 400
    error.payload = { code: 'INVALID_USERNAME' }
    throw error
  }

  return normalized
}

function summarizePlayerProfile(state, walletAddress) {
  ensureStateCollections(state)
  const player = state.players.find((entry) => entry.walletAddress === walletAddress)
  if (!player) {
    return {
      walletAddress,
      username: '',
      hasUsername: false,
      tokenBalance: 0,
      spBalance: 0,
      dropsParticipated: 0,
      dropsWon: 0,
    }
  }
  ensurePlayerAccount(player)
  const dropsParticipated = state.dropParticipations.filter(
    (entry) => entry.walletAddress === walletAddress,
  ).length

  return {
    walletAddress,
    username: player.username ?? '',
    hasUsername: Boolean(player.username),
    tokenBalance: player.tokenBalance,
    spBalance: player.spBalance,
    dropsParticipated,
    dropsWon: player.dropWins ?? 0,
  }
}

function upsertDropParticipation(state, round, updates = {}) {
  ensureStateCollections(state)
  let participation = state.dropParticipations.find(
    (entry) =>
      entry.walletAddress === round.walletAddress &&
      entry.dropCycleNumber === round.dropCycleNumber,
  )

  if (!participation) {
    participation = {
      id: crypto.randomUUID(),
      walletAddress: round.walletAddress,
      roundId: round.id,
      dropCycleNumber: round.dropCycleNumber,
      locationId: round.locationId,
      status: 'active',
      joinedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    state.dropParticipations.push(participation)
  }

  Object.assign(participation, updates, {
    roundId: round.id,
    locationId: round.locationId,
    updatedAt: new Date().toISOString(),
  })

  return participation
}

function creditPlayerSp(state, walletAddress, rewardSp) {
  if (!rewardSp) return
  const player = ensurePlayerAccount(
    state.players.find((entry) => entry.walletAddress === walletAddress),
  )
  player.spBalance += rewardSp
  player.updatedAt = new Date().toISOString()
}

function settleDropWinner(state, dropCycleNumber, timestamp = Date.now()) {
  ensureStateCollections(state)
  const existingSettlement = state.dropSettlements.find(
    (entry) => entry.dropCycleNumber === dropCycleNumber,
  )

  if (existingSettlement) return existingSettlement

  const winner = getWinnerForDrop(state, dropCycleNumber)
  const winningRound = winner
    ? state.rounds.find(
        (round) =>
          round.walletAddress === winner.walletAddress &&
          round.dropCycleNumber === dropCycleNumber,
      )
    : null
  const rewardSp = winningRound?.result?.rewardSp ?? 0
  const settlement = {
    id: crypto.randomUUID(),
    dropCycleNumber,
    locationId: winningRound?.locationId ?? null,
    winningRoundId: winningRound?.id ?? null,
    winnerWalletAddress: winner?.walletAddress ?? null,
    rewardSp,
    settledAt: new Date(timestamp).toISOString(),
  }

  state.dropSettlements.push(settlement)

  state.dropParticipations
    .filter((entry) => entry.dropCycleNumber === dropCycleNumber)
    .forEach((entry) => {
      entry.status = winner && entry.walletAddress === winner.walletAddress ? 'won' : 'lost'
      entry.settledAt = settlement.settledAt
      entry.updatedAt = settlement.settledAt
    })

  if (winner?.walletAddress && rewardSp > 0) {
    const winnerPlayer = ensurePlayerAccount(
      state.players.find((entry) => entry.walletAddress === winner.walletAddress),
    )
    winnerPlayer.spBalance += rewardSp
    winnerPlayer.dropWins = (winnerPlayer.dropWins ?? 0) + 1
    winnerPlayer.updatedAt = settlement.settledAt
    state.rewardEvents.push({
      id: crypto.randomUUID(),
      roundId: winningRound.id,
      walletAddress: winner.walletAddress,
      rewardSp,
      rewardEligible: true,
      type: 'drop_win',
      dropCycleNumber,
      settlementId: settlement.id,
      createdAt: settlement.settledAt,
    })
  }

  return settlement
}

function makeRoundPayload(round, location, quota, timestamp = Date.now()) {
  const activeEndsAt = round.activeEndsAt ?? timestamp + REGULAR_ROUND_TIME_LIMIT_MS
  const revealEndsAt = round.revealEndsAt ?? timestamp
  const timeLimitSeconds = Math.max(0, Math.ceil((activeEndsAt - timestamp) / 1000))

  return {
    roundId: round.id,
    status: round.status,
    sequenceIndex: round.sequenceIndex ?? 1,
    roundLocationCount: round.roundLocationCount ?? REGULAR_ROUND_LOCATION_COUNT,
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

function makeMultiplayerRoundPayload(room, timestamp = Date.now()) {
  if (room.status !== 'playing' && room.status !== 'reveal') return null

  const location = getLocationById(room.locationIds[(room.roundIndex ?? 1) - 1])
  if (!location) return null

  const activeEndsAt = room.activeEndsAt ?? timestamp + REGULAR_ROUND_TIME_LIMIT_MS

  return {
    roundId: `${room.id}:${room.roundIndex}`,
    status: room.status,
    sequenceIndex: room.roundIndex,
    roundLocationCount: room.roundCount,
    attemptType: 'multiplayer',
    quota: null,
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
      gameMode: 'multiplayer',
      roomCode: room.code,
      worldMode: true,
      movingAllowed: true,
      timeLimitSeconds: Math.max(0, Math.ceil((activeEndsAt - timestamp) / 1000)),
      activeEndsAt,
      revealEndsAt: room.revealEndsAt ?? activeEndsAt,
    },
  }
}

function getLocationById(locationId) {
  return [...regularGameLocations, ...curatedLocations].find((location) => location.id === locationId)
}

function summarizeDropLocation(location) {
  return {
    id: location.id,
    country: location.country,
    region: location.region,
    rewardSp: location.rewardSp,
    difficulty: location.difficulty,
    panorama: {
      lat: location.panorama.lat,
      lng: location.panorama.lng,
    },
  }
}

function summarizeMultiplayerPlayer(player) {
  if (!player) return null

  return {
    walletAddress: player.walletAddress,
    ready: Boolean(player.ready),
    score: player.score ?? 0,
    roundsCompleted: player.roundsCompleted ?? 0,
    totalDistanceKm: Number((player.totalDistanceKm ?? 0).toFixed(2)),
  }
}

function getRoomCurrentGuess(room, walletAddress) {
  return room.guesses.find(
    (guess) =>
      guess.walletAddress === walletAddress &&
      guess.roundIndex === room.roundIndex,
  )
}

function getRoomRoundResults(room) {
  return room.guesses
    .filter((guess) => guess.roundIndex === room.roundIndex)
    .sort((first, second) => second.score - first.score || first.distanceKm - second.distanceKm)
}

function getRoomLeaderboard(room) {
  return room.players
    .map(summarizeMultiplayerPlayer)
    .sort((first, second) => second.score - first.score || first.totalDistanceKm - second.totalDistanceKm)
    .map((player, index) => ({
      ...player,
      rank: index + 1,
    }))
}

function shouldRevealMultiplayerRound(room, timestamp) {
  if (timestamp >= room.activeEndsAt) return true
  return room.players.every((player) => Boolean(getRoomCurrentGuess(room, player.walletAddress)))
}

function startMultiplayerRound(room, timestamp) {
  room.status = 'playing'
  room.currentRoundStartedAt = timestamp
  room.activeEndsAt = timestamp + REGULAR_ROUND_TIME_LIMIT_MS
  room.revealEndsAt = null
  room.updatedAt = new Date(timestamp).toISOString()
}

function revealMultiplayerRound(room, timestamp) {
  room.status = 'reveal'
  room.revealEndsAt = timestamp + MULTIPLAYER_REVEAL_MS
  room.updatedAt = new Date(timestamp).toISOString()
}

function progressMultiplayerRoom(room, timestamp = Date.now()) {
  if (room.status === 'countdown' && timestamp >= room.countdownEndsAt) {
    startMultiplayerRound(room, timestamp)
  }

  if (room.status === 'playing' && shouldRevealMultiplayerRound(room, timestamp)) {
    revealMultiplayerRound(room, timestamp)
  }

  if (room.status === 'reveal' && timestamp >= room.revealEndsAt) {
    if (room.roundIndex >= room.roundCount) {
      room.status = 'finished'
      room.finishedAt = new Date(timestamp).toISOString()
      room.updatedAt = room.finishedAt
    } else {
      room.roundIndex += 1
      startMultiplayerRound(room, timestamp)
    }
  }

  return room
}

function summarizeMultiplayerRoom(room, walletAddress, timestamp = Date.now()) {
  progressMultiplayerRoom(room, timestamp)

  const currentGuess = getRoomCurrentGuess(room, walletAddress)
  const currentRound = makeMultiplayerRoundPayload(room, timestamp)
  const location =
    room.status === 'reveal' || room.status === 'finished'
      ? getLocationById(room.locationIds[(room.roundIndex ?? 1) - 1])
      : null

  return {
    id: room.id,
    code: room.code,
    status: room.status,
    hostWalletAddress: room.hostWalletAddress,
    minPlayers: MULTIPLAYER_MIN_PLAYERS,
    maxPlayers: room.maxPlayers,
    roundIndex: room.roundIndex,
    roundCount: room.roundCount,
    playerCount: room.players.length,
    countdownEndsAt: room.countdownEndsAt ?? null,
    activeEndsAt: room.activeEndsAt ?? null,
    revealEndsAt: room.revealEndsAt ?? null,
    currentPlayer: summarizeMultiplayerPlayer(
      room.players.find((player) => player.walletAddress === walletAddress),
    ),
    players: room.players.map(summarizeMultiplayerPlayer),
    leaderboard: getRoomLeaderboard(room),
    currentRound,
    currentGuess: currentGuess ?? null,
    roundResults: room.status === 'reveal' || room.status === 'finished'
      ? getRoomRoundResults(room)
      : [],
    revealLocation: location
      ? {
          country: location.country,
          region: location.region,
          answer: {
            lat: location.panorama.lat,
            lng: location.panorama.lng,
          },
        }
      : null,
  }
}

function pruneInvalidOpenRounds(state, walletAddress) {
  const now = Date.now()

  state.rounds = state.rounds.filter((round) => {
    if (round.walletAddress !== walletAddress) return true
    if (round.status !== 'active' && round.status !== 'awaiting_payment') return true
    if (round.status === 'active' && round.gameMode === 'regular' && round.activeEndsAt <= now) return false
    return Boolean(getLocationById(round.locationId))
  })
}

export function createGameService({ store, rewardThresholdKm, livekit }) {
  function getOrCreatePlayer(state, walletAddress) {
    let player = state.players.find((entry) => entry.walletAddress === walletAddress)

    if (!player) {
      player = {
        walletAddress,
        tokenBalance: DEFAULT_TOKEN_BALANCE,
        spBalance: 0,
        dropWins: 0,
        createdAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      state.players.push(player)
    } else {
      player.lastSeenAt = new Date().toISOString()
      player.updatedAt = player.lastSeenAt
    }

    return ensurePlayerAccount(player)
  }

  function getProfile(walletAddress) {
    return store.update((state) => {
      ensureStateCollections(state)
      getOrCreatePlayer(state, walletAddress)
      return summarizePlayerProfile(state, walletAddress)
    })
  }

  function updateProfile(walletAddress, updates = {}) {
    return store.update((state) => {
      ensureStateCollections(state)
      const player = getOrCreatePlayer(state, walletAddress)

      if (Object.hasOwn(updates, 'username')) {
        const username = assertValidUsername(updates.username)
        const usernameTaken = state.players.some(
          (entry) =>
            entry.walletAddress !== walletAddress &&
            normalizeUsername(entry.username).toLowerCase() === username.toLowerCase(),
        )

        if (usernameTaken) {
          const error = new Error('Username is already taken.')
          error.statusCode = 409
          error.payload = { code: 'USERNAME_TAKEN' }
          throw error
        }

        player.username = username
        player.updatedAt = new Date().toISOString()
      }

      return summarizePlayerProfile(state, walletAddress)
    })
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
          round.gameMode === 'regular' &&
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

  function startDropRound(walletAddress) {
    return store.update((state) => {
      getOrCreatePlayer(state, walletAddress)
      pruneInvalidOpenRounds(state, walletAddress)

      const now = Date.now()
      const scheduledDrop = getScheduledDrop(getActiveDropLocations(), now)
      const ledger = ensureLedgerEntry(state, walletAddress, getDayKey())
      const quota = summarizeQuota(ledger)

      if (scheduledDrop.phase !== 'active') {
        const error = new Error('The active drop is in reveal. Wait for the next drop.')
        error.statusCode = 409
        error.payload = {
          code: 'DROP_REVEAL_ACTIVE',
          activeEndsAt: scheduledDrop.activeEndsAt,
          revealEndsAt: scheduledDrop.revealEndsAt,
        }
        throw error
      }

      const existingRound = state.rounds.find(
        (round) =>
          round.walletAddress === walletAddress &&
          round.gameMode === 'drop' &&
          round.dropCycleNumber === scheduledDrop.cycleNumber &&
          round.status === 'active',
      )

      if (existingRound) {
        upsertDropParticipation(state, existingRound)
        return makeRoundPayload(
          existingRound,
          getLocationById(existingRound.locationId),
          quota,
          now,
        )
      }

      const playedRound = state.rounds.find(
        (round) =>
          round.walletAddress === walletAddress &&
          round.gameMode === 'drop' &&
          round.dropCycleNumber === scheduledDrop.cycleNumber &&
          (round.status === 'submitted' ||
            round.status === 'completed' ||
            round.status === 'closed'),
      )

      if (playedRound) {
        const error = new Error('You already played this active drop.')
        error.statusCode = 409
        error.payload = {
          code: 'DROP_ALREADY_PLAYED',
          activeEndsAt: scheduledDrop.activeEndsAt,
          revealEndsAt: scheduledDrop.revealEndsAt,
        }
        throw error
      }

      const round = {
        id: crypto.randomUUID(),
        walletAddress,
        gameMode: 'drop',
        locationId: scheduledDrop.location.id,
        dropCycleNumber: scheduledDrop.cycleNumber,
        activeEndsAt: scheduledDrop.activeEndsAt,
        revealEndsAt: scheduledDrop.revealEndsAt,
        sessionRootId: null,
        sequenceIndex: 1,
        roundLocationCount: 1,
        attemptType: 'drop',
        consumeQuotaOnSubmit: false,
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      round.sessionRootId = round.id
      state.rounds.push(round)
      upsertDropParticipation(state, round)

      return makeRoundPayload(round, scheduledDrop.location, quota, now)
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

      if (round.gameMode === 'drop') {
        upsertDropParticipation(state, round, {
          status: 'submitted',
          guessedAt: round.guessedAt,
          distanceKm: round.result.distanceKm,
          score,
          rewardEligible,
        })
      } else {
        if (rewardEligible && rewardSp > 0) {
          creditPlayerSp(state, walletAddress, rewardSp)
        }

        state.rewardEvents.push({
          id: crypto.randomUUID(),
          roundId,
          walletAddress,
          rewardSp,
          rewardEligible,
          type: 'regular_round',
          createdAt: round.guessedAt,
        })
      }

      return {
        roundId: round.id,
        attemptType: round.attemptType,
        quota: summarizeQuota(ledger),
        profile: summarizePlayerProfile(state, walletAddress),
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
      const dropSettlement =
        round.gameMode === 'drop'
          ? settleDropWinner(state, round.dropCycleNumber, now)
          : null
      const winner =
        round.gameMode === 'drop' && dropSettlement?.winnerWalletAddress
          ? {
              walletAddress: dropSettlement.winnerWalletAddress,
              rewardSp: dropSettlement.rewardSp,
              guessedAt: getWinnerForDrop(state, round.dropCycleNumber)?.guessedAt,
              distanceKm: getWinnerForDrop(state, round.dropCycleNumber)?.distanceKm,
              score: getWinnerForDrop(state, round.dropCycleNumber)?.score,
            }
          : null

      round.status = 'completed'
      round.updatedAt = new Date(now).toISOString()

      return {
        roundId: round.id,
        attemptType: round.attemptType,
        quota: summarizeQuota(ledger),
        profile: summarizePlayerProfile(state, walletAddress),
        result: {
          ...round.result,
          country: location.country,
          region: location.region,
          winner,
        },
      }
    })
  }

  function getDropDetails(dropCycleNumber) {
    return store.update((state) => {
      ensureStateCollections(state)

      const cycleNumber = Number(dropCycleNumber)
      if (!Number.isInteger(cycleNumber) || cycleNumber < 0) {
        const error = new Error('Drop cycle number is invalid.')
        error.statusCode = 400
        throw error
      }

      const now = Date.now()
      const cycleStartAt = cycleNumber * DROP_CYCLE_MS
      const activeEndsAt = cycleStartAt + DROP_ACTIVE_MS
      const revealEndsAt = activeEndsAt + DROP_REVEAL_MS
      const location = pickDropLocation(getActiveDropLocations(), cycleNumber)
      const status =
        now < activeEndsAt
          ? 'active'
          : now < revealEndsAt
            ? 'reveal'
            : 'completed'
      const settlement =
        status === 'completed'
          ? settleDropWinner(state, cycleNumber, now)
          : state.dropSettlements.find(
              (entry) => entry.dropCycleNumber === cycleNumber,
            )
      const winner =
        settlement?.winnerWalletAddress
          ? {
              walletAddress: settlement.winnerWalletAddress,
              rewardSp: settlement.rewardSp,
              guessedAt: getWinnerForDrop(state, cycleNumber)?.guessedAt ?? null,
              distanceKm: getWinnerForDrop(state, cycleNumber)?.distanceKm ?? null,
              score: getWinnerForDrop(state, cycleNumber)?.score ?? null,
            }
          : null
      const participantsCount = state.dropParticipations.filter(
        (entry) => entry.dropCycleNumber === cycleNumber,
      ).length

      return {
        dropCycleNumber: cycleNumber,
        status,
        startsAt: cycleStartAt,
        activeEndsAt,
        revealEndsAt,
        location: summarizeDropLocation(location),
        rewardSp: settlement?.rewardSp ?? location.rewardSp,
        participantsCount,
        winner,
      }
    })
  }

  function createMultiplayerRoom(walletAddress) {
    return store.update((state) => {
      ensureStateCollections(state)
      getOrCreatePlayer(state, walletAddress)

      const now = Date.now()
      const room = {
        id: crypto.randomUUID(),
        code: generateRoomCode(state),
        hostWalletAddress: walletAddress,
        status: 'waiting',
        minPlayers: MULTIPLAYER_MIN_PLAYERS,
        maxPlayers: MULTIPLAYER_MAX_PLAYERS,
        roundCount: MULTIPLAYER_ROUND_LOCATION_COUNT,
        roundIndex: 0,
        locationIds: [],
        guesses: [],
        players: [
          {
            walletAddress,
            ready: true,
            score: 0,
            totalDistanceKm: 0,
            roundsCompleted: 0,
            joinedAt: new Date(now).toISOString(),
          },
        ],
        createdAt: new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString(),
      }

      state.multiplayerRooms.push(room)

      return summarizeMultiplayerRoom(room, walletAddress, now)
    })
  }

  function joinMultiplayerRoom(walletAddress, rawCode) {
    return store.update((state) => {
      ensureStateCollections(state)
      getOrCreatePlayer(state, walletAddress)

      const code = String(rawCode ?? '').trim().toUpperCase()
      const room = state.multiplayerRooms.find((entry) => entry.code === code)

      if (!room) {
        const error = new Error('Room code not found.')
        error.statusCode = 404
        throw error
      }

      progressMultiplayerRoom(room)

      if (room.status !== 'waiting') {
        const error = new Error('This room has already started.')
        error.statusCode = 409
        throw error
      }

      if (room.players.length >= room.maxPlayers) {
        const error = new Error('This room is full.')
        error.statusCode = 409
        throw error
      }

      const existingPlayer = room.players.find((player) => player.walletAddress === walletAddress)
      if (!existingPlayer) {
        room.players.push({
          walletAddress,
          ready: false,
          score: 0,
          totalDistanceKm: 0,
          roundsCompleted: 0,
          joinedAt: new Date().toISOString(),
        })
        room.updatedAt = new Date().toISOString()
      }

      return summarizeMultiplayerRoom(room, walletAddress)
    })
  }

  function getMultiplayerRoom(walletAddress, rawCode) {
    return store.update((state) => {
      ensureStateCollections(state)

      const code = String(rawCode ?? '').trim().toUpperCase()
      const room = state.multiplayerRooms.find((entry) => entry.code === code)

      if (!room) {
        const error = new Error('Room code not found.')
        error.statusCode = 404
        throw error
      }

      const player = room.players.find((entry) => entry.walletAddress === walletAddress)
      if (!player) {
        const error = new Error('You are not in this room.')
        error.statusCode = 403
        throw error
      }

      return summarizeMultiplayerRoom(room, walletAddress)
    })
  }

  function setMultiplayerReady(walletAddress, rawCode) {
    return store.update((state) => {
      ensureStateCollections(state)

      const code = String(rawCode ?? '').trim().toUpperCase()
      const room = state.multiplayerRooms.find((entry) => entry.code === code)

      if (!room) {
        const error = new Error('Room code not found.')
        error.statusCode = 404
        throw error
      }

      progressMultiplayerRoom(room)

      if (room.status !== 'waiting') {
        return summarizeMultiplayerRoom(room, walletAddress)
      }

      const player = room.players.find((entry) => entry.walletAddress === walletAddress)
      if (!player) {
        const error = new Error('You are not in this room.')
        error.statusCode = 403
        throw error
      }

      player.ready = true
      room.updatedAt = new Date().toISOString()

      return summarizeMultiplayerRoom(room, walletAddress)
    })
  }

  function startMultiplayerRoom(walletAddress, rawCode) {
    return store.update((state) => {
      ensureStateCollections(state)

      const code = String(rawCode ?? '').trim().toUpperCase()
      const room = state.multiplayerRooms.find((entry) => entry.code === code)

      if (!room) {
        const error = new Error('Room code not found.')
        error.statusCode = 404
        throw error
      }

      progressMultiplayerRoom(room)

      if (room.hostWalletAddress !== walletAddress) {
        const error = new Error('Only the room creator can start this game.')
        error.statusCode = 403
        throw error
      }

      if (room.status !== 'waiting') {
        return summarizeMultiplayerRoom(room, walletAddress)
      }

      if (room.players.length < MULTIPLAYER_MIN_PLAYERS) {
        const error = new Error('At least two players are required to start.')
        error.statusCode = 409
        error.payload = {
          code: 'NOT_ENOUGH_PLAYERS',
          minPlayers: MULTIPLAYER_MIN_PLAYERS,
        }
        throw error
      }

      const notReadyPlayers = room.players.filter((player) => !player.ready)
      if (notReadyPlayers.length > 0) {
        const error = new Error('Some players are not ready.')
        error.statusCode = 409
        error.payload = {
          code: 'PLAYERS_NOT_READY',
          notReadyWalletAddresses: notReadyPlayers.map((player) => player.walletAddress),
        }
        throw error
      }

      const now = Date.now()
      room.status = 'countdown'
      room.countdownEndsAt = now + MULTIPLAYER_COUNTDOWN_MS
      room.roundIndex = 1
      room.locationIds = pickMultiplayerLocations(state)
      room.updatedAt = new Date(now).toISOString()

      return summarizeMultiplayerRoom(room, walletAddress, now)
    })
  }

  function submitMultiplayerGuess(walletAddress, rawCode, guess) {
    return store.update((state) => {
      ensureStateCollections(state)

      const code = String(rawCode ?? '').trim().toUpperCase()
      const room = state.multiplayerRooms.find((entry) => entry.code === code)

      if (!room) {
        const error = new Error('Room code not found.')
        error.statusCode = 404
        throw error
      }

      progressMultiplayerRoom(room)

      if (room.status !== 'playing') {
        const error = new Error('Room is not accepting guesses.')
        error.statusCode = 409
        throw error
      }

      const player = room.players.find((entry) => entry.walletAddress === walletAddress)
      if (!player) {
        const error = new Error('You are not in this room.')
        error.statusCode = 403
        throw error
      }

      if (getRoomCurrentGuess(room, walletAddress)) {
        return summarizeMultiplayerRoom(room, walletAddress)
      }

      const location = getLocationById(room.locationIds[room.roundIndex - 1])
      const answer = { lat: location.panorama.lat, lng: location.panorama.lng }
      const distanceKm = haversineDistanceKm(answer, guess)
      const score = distanceToScore(distanceKm)
      const now = Date.now()
      const result = {
        id: crypto.randomUUID(),
        walletAddress,
        roundIndex: room.roundIndex,
        guess,
        answer,
        distanceKm: Number(distanceKm.toFixed(2)),
        score,
        country: location.country,
        region: location.region,
        createdAt: new Date(now).toISOString(),
      }

      room.guesses.push(result)
      player.score = (player.score ?? 0) + score
      player.totalDistanceKm = (player.totalDistanceKm ?? 0) + result.distanceKm
      player.roundsCompleted = (player.roundsCompleted ?? 0) + 1
      room.updatedAt = result.createdAt

      if (shouldRevealMultiplayerRound(room, now)) {
        revealMultiplayerRound(room, now)
      }

      return summarizeMultiplayerRoom(room, walletAddress, now)
    })
  }

  async function createMultiplayerVoiceToken(walletAddress, rawCode) {
    const roomName = store.update((state) => {
      ensureStateCollections(state)

      const code = String(rawCode ?? '').trim().toUpperCase()
      const room = state.multiplayerRooms.find((entry) => entry.code === code)

      if (!room) {
        const error = new Error('Room code not found.')
        error.statusCode = 404
        throw error
      }

      const player = room.players.find((entry) => entry.walletAddress === walletAddress)
      if (!player) {
        const error = new Error('You are not in this room.')
        error.statusCode = 403
        throw error
      }

      return `notfound-${room.code}`
    })

    if (!livekit?.url || !livekit?.apiKey || !livekit?.apiSecret) {
      const error = new Error('Voice chat is not configured yet.')
      error.statusCode = 503
      error.payload = { code: 'LIVEKIT_NOT_CONFIGURED' }
      throw error
    }

    const accessToken = new AccessToken(livekit.apiKey, livekit.apiSecret, {
      identity: walletAddress,
      name: walletAddress,
      ttl: '2h',
    })

    accessToken.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canPublishData: true,
      canSubscribe: true,
    })

    return {
      url: livekit.url,
      token: await accessToken.toJwt(),
      roomName,
    }
  }

  return {
    continueRound,
    createMultiplayerRoom,
    createMultiplayerVoiceToken,
    getDropDetails,
    getMultiplayerRoom,
    getProfile,
    getQuota,
    updateProfile,
    joinMultiplayerRoom,
    setMultiplayerReady,
    startMultiplayerRoom,
    startDropRound,
    startRound,
    checkoutAttempt,
    submitMultiplayerGuess,
    submitGuess,
    getRoundResult,
  }
}
