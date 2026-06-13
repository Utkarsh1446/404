import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import nacl from 'tweetnacl'
import { Keypair } from '@solana/web3.js'
import { createApp } from '../server/app.js'
import {
  DROP_ACTIVE_MS,
  DROP_CYCLE_MS,
  DROP_REVEAL_MS,
} from '../server/lib/drop-schedule.js'
import { haversineDistanceKm } from '../server/lib/geo.js'

function createDisabledPayoutClient() {
  return {
    getStatus: () => ({ configured: false }),
    sendReward: async () => ({
      status: 'pending_configuration',
      reason: 'Payouts are disabled in tests.',
    }),
  }
}

function createTestApp(options = {}) {
  const storageFile = path.join(
    os.tmpdir(),
    `sp-guess-${Math.random().toString(36).slice(2)}.json`,
  )
  fs.writeFileSync(
    storageFile,
    JSON.stringify({
      players: [],
      authChallenges: [],
      sessions: [],
      rounds: [],
      guesses: [],
      multiplayerRooms: [],
      dailyAttemptLedger: [],
      rewardEvents: [],
    }),
  )

  return createApp({
    storageFile,
    challengeTtlMs: 60_000,
    rewardThresholdKm: 50,
    livekitUrl: '',
    livekitApiKey: '',
    livekitApiSecret: '',
    payoutClient: options.payoutClient ?? createDisabledPayoutClient(),
  })
}

function createTestAppWithState(initialState, options = {}) {
  const storageFile = path.join(
    os.tmpdir(),
    `sp-guess-${Math.random().toString(36).slice(2)}.json`,
  )
  fs.writeFileSync(storageFile, JSON.stringify(initialState))

  return createApp({
    storageFile,
    challengeTtlMs: 60_000,
    rewardThresholdKm: 50,
    livekitUrl: '',
    livekitApiKey: '',
    livekitApiSecret: '',
    payoutClient: options.payoutClient ?? createDisabledPayoutClient(),
  })
}

async function authenticate(app, keypair = Keypair.generate()) {
  const walletAddress = keypair.publicKey.toBase58()
  const challengeResponse = await request(app)
    .post('/api/auth/wallet/challenge')
    .send({ walletAddress })
    .expect(200)
  const messageBytes = new TextEncoder().encode(challengeResponse.body.message)
  const signature = Buffer.from(
    nacl.sign.detached(messageBytes, keypair.secretKey),
  ).toString('base64')
  const verifyResponse = await request(app)
    .post('/api/auth/wallet/verify')
    .send({
      walletAddress,
      message: challengeResponse.body.message,
      signature,
    })
    .expect(200)

  return {
    walletAddress,
    token: verifyResponse.body.token,
    profile: verifyResponse.body.profile,
  }
}

async function createWalletSignature(app, keypair = Keypair.generate()) {
  const walletAddress = keypair.publicKey.toBase58()
  const challengeResponse = await request(app)
    .post('/api/auth/wallet/challenge')
    .send({ walletAddress })
    .expect(200)
  const messageBytes = new TextEncoder().encode(challengeResponse.body.message)
  const signature = Buffer.from(
    nacl.sign.detached(messageBytes, keypair.secretKey),
  ).toString('base64')

  return {
    walletAddress,
    message: challengeResponse.body.message,
    signature,
  }
}

function useActiveDropClock() {
  const originalNow = Date.now
  const activeDropNow = Math.floor(originalNow() / DROP_CYCLE_MS) * DROP_CYCLE_MS + 1000
  Date.now = () => activeDropNow

  return () => {
    Date.now = originalNow
  }
}

test('invalid signatures are rejected', async () => {
  const app = createTestApp()
  const keypair = Keypair.generate()
  const walletAddress = keypair.publicKey.toBase58()
  const challengeResponse = await request(app)
    .post('/api/auth/wallet/challenge')
    .send({ walletAddress })
    .expect(200)

  await request(app)
    .post('/api/auth/wallet/verify')
    .send({
      walletAddress,
      message: challengeResponse.body.message,
      signature: Buffer.from(new Uint8Array(64)).toString('base64'),
    })
    .expect(401)
})

test('health exposes storage persistence diagnostics', async () => {
  const app = createTestApp()

  const health = await request(app)
    .get('/api/health')
    .expect(200)

  assert.equal(health.body.ok, true)
  assert.equal(typeof health.body.storage.file, 'string')
  assert.equal(health.body.storage.configured, true)
  assert.equal(typeof health.body.storage.usingRenderDisk, 'boolean')
})

test('quota is wallet-specific and starts with three free rounds', async () => {
  const app = createTestApp()
  const first = await authenticate(app)
  const second = await authenticate(app)

  const firstQuota = await request(app)
    .get('/api/me/quota')
    .set('Authorization', `Bearer ${first.token}`)
    .expect(200)
  const firstProfile = await request(app)
    .get('/api/me/profile')
    .set('Authorization', `Bearer ${first.token}`)
    .expect(200)

  const secondQuota = await request(app)
    .get('/api/me/quota')
    .set('Authorization', `Bearer ${second.token}`)
    .expect(200)

  assert.equal(firstQuota.body.freeRemaining, 3)
  assert.equal(firstProfile.body.walletAddress, first.walletAddress)
  assert.equal(firstProfile.body.tokenBalance, 100)
  assert.equal(firstProfile.body.spBalance, 0)
  assert.equal(secondQuota.body.freeRemaining, 3)
})

test('profile username can be set once signed in and must be unique', async () => {
  const app = createTestApp()
  const firstKeypair = Keypair.generate()
  const first = await authenticate(app, firstKeypair)
  const second = await authenticate(app)

  const missingUsername = await request(app)
    .get('/api/me/profile')
    .set('Authorization', `Bearer ${first.token}`)
    .expect(200)

  assert.equal(missingUsername.body.hasUsername, false)
  assert.equal(missingUsername.body.username, '')

  const updated = await request(app)
    .patch('/api/me/profile')
    .set('Authorization', `Bearer ${first.token}`)
    .send({ username: 'Geo_Player' })
    .expect(200)

  assert.equal(updated.body.hasUsername, true)
  assert.equal(updated.body.username, 'Geo_Player')

  const duplicate = await request(app)
    .patch('/api/me/profile')
    .set('Authorization', `Bearer ${second.token}`)
    .send({ username: 'geo_player' })
    .expect(409)

  assert.equal(duplicate.body.payload.code, 'USERNAME_TAKEN')

  const invalid = await request(app)
    .patch('/api/me/profile')
    .set('Authorization', `Bearer ${second.token}`)
    .send({ username: 'no' })
    .expect(400)

  assert.equal(invalid.body.payload.code, 'INVALID_USERNAME')

  const reauthenticated = await authenticate(app, firstKeypair)
  assert.equal(reauthenticated.profile.hasUsername, true)
  assert.equal(reauthenticated.profile.username, 'Geo_Player')
})

test('wallet verify can restore cached username after profile loss', async () => {
  const wallet = Keypair.generate()
  const walletAddress = wallet.publicKey.toBase58()
  const app = createTestAppWithState({
    players: [{ walletAddress, createdAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() }],
    authChallenges: [],
    sessions: [],
    rounds: [],
    guesses: [],
    multiplayerRooms: [],
    dailyAttemptLedger: [],
    rewardEvents: [],
  })
  const signed = await createWalletSignature(app, wallet)

  const restored = await request(app)
    .post('/api/auth/wallet/verify')
    .send({
      ...signed,
      username: 'Cached_Player',
    })
    .expect(200)

  assert.equal(restored.body.profile.hasUsername, true)
  assert.equal(restored.body.profile.username, 'Cached_Player')
  assert.equal(restored.body.profile.tokenBalance, 100)
})

test('starter NOTF grant is not re-applied to persisted players', async () => {
  const wallet = Keypair.generate()
  const walletAddress = wallet.publicKey.toBase58()
  const now = new Date().toISOString()
  const app = createTestAppWithState({
    players: [
      {
        walletAddress,
        tokenBalance: 100,
        spBalance: 0,
        notfStarterGrantApplied: false,
        createdAt: now,
        lastSeenAt: now,
        updatedAt: now,
      },
    ],
    authChallenges: [],
    sessions: [],
    rounds: [],
    guesses: [],
    multiplayerRooms: [],
    dropParticipations: [],
    dropSettlements: [],
    dailyAttemptLedger: [],
    rewardEvents: [],
  })
  const auth = await authenticate(app, wallet)

  assert.equal(auth.profile.tokenBalance, 100)

  const firstProfile = await request(app)
    .get('/api/me/profile')
    .set('Authorization', `Bearer ${auth.token}`)
    .expect(200)
  const secondProfile = await request(app)
    .get('/api/me/profile')
    .set('Authorization', `Bearer ${auth.token}`)
    .expect(200)

  assert.equal(firstProfile.body.tokenBalance, 100)
  assert.equal(secondProfile.body.tokenBalance, 100)

  const state = JSON.parse(fs.readFileSync(app.locals.config.storageFile, 'utf8'))
  const storedPlayer = state.players.find((entry) => entry.walletAddress === walletAddress)
  assert.equal(storedPlayer.notfStarterGrantApplied, true)
  assert.equal(storedPlayer.tokenBalance, 100)
})

test('starting and guessing a regular round reveals immediately', async () => {
  const app = createTestApp()
  const auth = await authenticate(app)

  const round = await request(app)
    .post('/api/rounds/start')
    .set('Authorization', `Bearer ${auth.token}`)
    .expect(200)

  assert.equal(round.body.roundLocationCount, 2)
  assert.equal(round.body.meta.gameMode, 'regular')
  assert.equal(round.body.meta.timeLimitSeconds, 90)

  const guess = await request(app)
    .post(`/api/rounds/${round.body.roundId}/guess`)
    .set('Authorization', `Bearer ${auth.token}`)
    .send({
      guessLat: round.body.panorama.position.lat,
      guessLng: round.body.panorama.position.lng,
    })
    .expect(200)

  assert.equal(guess.body.result.rewardEligible, true)
  assert.equal(guess.body.result.winner, null)
  assert.equal(guess.body.pendingReveal, undefined)
  assert.equal(guess.body.profile.spBalance, guess.body.result.rewardSp)
  assert.equal(guess.body.profile.tokenBalance, 100 + guess.body.result.rewardSp)

  await request(app)
    .post(`/api/rounds/${round.body.roundId}/guess`)
    .set('Authorization', `Bearer ${auth.token}`)
    .send({
      guessLat: round.body.panorama.position.lat,
      guessLng: round.body.panorama.position.lng,
    })
    .expect(409)

  const result = await request(app)
    .get(`/api/rounds/${round.body.roundId}/result`)
    .set('Authorization', `Bearer ${auth.token}`)
    .expect(200)

  assert.equal(result.body.result.rewardEligible, true)
  assert.equal(result.body.result.winner, null)
})

test('timed out regular rounds return a Times Up result', async () => {
  const app = createTestApp()
  const auth = await authenticate(app)

  const round = await request(app)
    .post('/api/rounds/start')
    .set('Authorization', `Bearer ${auth.token}`)
    .expect(200)

  const storageFile = app.locals.config.storageFile
  const state = JSON.parse(fs.readFileSync(storageFile, 'utf8'))
  const storedRound = state.rounds.find((entry) => entry.id === round.body.roundId)
  storedRound.activeEndsAt = Date.now() - 1
  storedRound.revealEndsAt = Date.now() - 1
  fs.writeFileSync(storageFile, JSON.stringify(state, null, 2))

  const result = await request(app)
    .get(`/api/rounds/${round.body.roundId}/result`)
    .set('Authorization', `Bearer ${auth.token}`)
    .expect(200)

  assert.equal(result.body.result.timedOut, true)
  assert.equal(result.body.result.score, 0)
  assert.equal(result.body.result.distanceKm, null)
  assert.equal(result.body.result.rewardEligible, false)
})

test('drop settlement credits only the first correct wallet', async () => {
  const restoreNow = useActiveDropClock()
  const app = createTestApp()
  const first = await authenticate(app)
  const second = await authenticate(app)

  try {
    const firstRound = await request(app)
      .post('/api/drops/start')
      .set('Authorization', `Bearer ${first.token}`)
      .expect(200)
    const secondRound = await request(app)
      .post('/api/drops/start')
      .set('Authorization', `Bearer ${second.token}`)
      .expect(200)

    assert.equal(
      firstRound.body.meta.activeEndsAt - firstRound.body.meta.dropCycleNumber * DROP_CYCLE_MS,
      DROP_ACTIVE_MS,
    )
    assert.equal(
      firstRound.body.meta.revealEndsAt - firstRound.body.meta.activeEndsAt,
      DROP_REVEAL_MS,
    )

    await request(app)
      .post(`/api/rounds/${firstRound.body.roundId}/guess`)
      .set('Authorization', `Bearer ${first.token}`)
      .send({
        guessLat: firstRound.body.panorama.position.lat,
        guessLng: firstRound.body.panorama.position.lng,
      })
      .expect(200)

    await request(app)
      .post(`/api/rounds/${secondRound.body.roundId}/guess`)
      .set('Authorization', `Bearer ${second.token}`)
      .send({
        guessLat: secondRound.body.panorama.position.lat,
        guessLng: secondRound.body.panorama.position.lng,
      })
      .expect(200)

    const storageFile = app.locals.config.storageFile
    const state = JSON.parse(fs.readFileSync(storageFile, 'utf8'))
    state.rounds
      .filter((round) => round.dropCycleNumber === firstRound.body.meta.dropCycleNumber)
      .forEach((round) => {
        round.revealEndsAt = Date.now() - 1
      })
    fs.writeFileSync(storageFile, JSON.stringify(state, null, 2))

    const firstResult = await request(app)
      .get(`/api/rounds/${firstRound.body.roundId}/result`)
      .set('Authorization', `Bearer ${first.token}`)
      .expect(200)

    assert.equal(firstResult.body.result.winner.walletAddress, first.walletAddress)
    assert.equal(firstResult.body.result.rewardSp, 1)
    assert.equal(firstResult.body.profile.spBalance, firstResult.body.result.rewardSp)
    assert.equal(firstResult.body.profile.tokenBalance, 100 + firstResult.body.result.rewardSp)

    const secondProfile = await request(app)
      .get('/api/me/profile')
      .set('Authorization', `Bearer ${second.token}`)
      .expect(200)

    assert.equal(secondProfile.body.spBalance, 0)
    assert.equal(secondProfile.body.dropsParticipated, 1)
  } finally {
    restoreNow()
  }
})

test('drop settlement sends one USDC payout once', async () => {
  const restoreNow = useActiveDropClock()
  const payoutCalls = []
  const app = createTestApp({
    payoutClient: {
      getStatus: () => ({
        configured: true,
        operatorWalletAddress: 'operator-wallet',
        mintAddress: 'test-usdc-mint',
        decimals: 6,
      }),
      sendReward: async (payload) => {
        payoutCalls.push(payload)
        return {
          status: 'sent',
          signature: `mock-signature-${payoutCalls.length}`,
          operatorWalletAddress: 'operator-wallet',
          recipientWalletAddress: payload.recipientWalletAddress,
          mintAddress: 'test-usdc-mint',
          amountUsd: payload.amountUsd,
          amountRaw: '1000000',
        }
      },
    },
  })
  const winner = await authenticate(app)

  try {
    const dropRound = await request(app)
      .post('/api/drops/start')
      .set('Authorization', `Bearer ${winner.token}`)
      .expect(200)

    await request(app)
      .post(`/api/rounds/${dropRound.body.roundId}/guess`)
      .set('Authorization', `Bearer ${winner.token}`)
      .send({
        guessLat: dropRound.body.panorama.position.lat,
        guessLng: dropRound.body.panorama.position.lng,
      })
      .expect(200)

    const storageFile = app.locals.config.storageFile
    const state = JSON.parse(fs.readFileSync(storageFile, 'utf8'))
    const storedRound = state.rounds.find((round) => round.id === dropRound.body.roundId)
    storedRound.revealEndsAt = Date.now() - 1
    fs.writeFileSync(storageFile, JSON.stringify(state, null, 2))

    const result = await request(app)
      .get(`/api/rounds/${dropRound.body.roundId}/result`)
      .set('Authorization', `Bearer ${winner.token}`)
      .expect(200)

    assert.equal(payoutCalls.length, 1)
    assert.equal(payoutCalls[0].recipientWalletAddress, winner.walletAddress)
    assert.equal(payoutCalls[0].amountUsd, 1)
    assert.equal(result.body.result.winner.payout.status, 'sent')
    assert.equal(result.body.result.winner.payout.signature, 'mock-signature-1')

    await request(app)
      .get(`/api/rounds/${dropRound.body.roundId}/result`)
      .set('Authorization', `Bearer ${winner.token}`)
      .expect(200)

    assert.equal(payoutCalls.length, 1)
  } finally {
    restoreNow()
  }
})

test('drop automation settles due drops and pays the winner without result clicks', async () => {
  const restoreNow = useActiveDropClock()
  const payoutCalls = []
  const app = createTestApp({
    payoutClient: {
      getStatus: () => ({ configured: true }),
      sendReward: async (payload) => {
        payoutCalls.push(payload)
        return {
          status: 'sent',
          signature: 'automation-signature',
          operatorWalletAddress: 'operator-wallet',
          recipientWalletAddress: payload.recipientWalletAddress,
          mintAddress: 'test-usdc-mint',
          amountUsd: payload.amountUsd,
          amountRaw: '1000000',
        }
      },
    },
  })
  const winner = await authenticate(app)

  try {
    const dropRound = await request(app)
      .post('/api/drops/start')
      .set('Authorization', `Bearer ${winner.token}`)
      .expect(200)

    await request(app)
      .post(`/api/rounds/${dropRound.body.roundId}/guess`)
      .set('Authorization', `Bearer ${winner.token}`)
      .send({
        guessLat: dropRound.body.panorama.position.lat,
        guessLng: dropRound.body.panorama.position.lng,
      })
      .expect(200)

    const automation = await app.locals.gameService.runDropAutomation(
      Date.now() + DROP_ACTIVE_MS + DROP_REVEAL_MS + 1000,
    )

    assert.deepEqual(automation.settledDropCycleNumbers, [
      dropRound.body.meta.dropCycleNumber,
    ])
    assert.equal(payoutCalls.length, 1)
    assert.equal(payoutCalls[0].recipientWalletAddress, winner.walletAddress)

    const profile = await request(app)
      .get('/api/me/profile')
      .set('Authorization', `Bearer ${winner.token}`)
      .expect(200)

    assert.equal(profile.body.dropsWon, 1)
    assert.equal(profile.body.spBalance, 1)
  } finally {
    restoreNow()
  }
})

test('equal-time drop guesses are settled by closest distance', async () => {
  const restoreNow = useActiveDropClock()
  const app = createTestApp()
  const first = await authenticate(app)
  const second = await authenticate(app)

  try {
    const firstRound = await request(app)
      .post('/api/drops/start')
      .set('Authorization', `Bearer ${first.token}`)
      .expect(200)
    const secondRound = await request(app)
      .post('/api/drops/start')
      .set('Authorization', `Bearer ${second.token}`)
      .expect(200)

    await request(app)
      .post(`/api/rounds/${firstRound.body.roundId}/guess`)
      .set('Authorization', `Bearer ${first.token}`)
      .send({
        guessLat: firstRound.body.panorama.position.lat + 0.1,
        guessLng: firstRound.body.panorama.position.lng,
      })
      .expect(200)

    await request(app)
      .post(`/api/rounds/${secondRound.body.roundId}/guess`)
      .set('Authorization', `Bearer ${second.token}`)
      .send({
        guessLat: secondRound.body.panorama.position.lat,
        guessLng: secondRound.body.panorama.position.lng,
      })
      .expect(200)

    const storageFile = app.locals.config.storageFile
    const state = JSON.parse(fs.readFileSync(storageFile, 'utf8'))
    state.rounds
      .filter((round) => round.dropCycleNumber === firstRound.body.meta.dropCycleNumber)
      .forEach((round) => {
        round.revealEndsAt = Date.now() - 1
      })
    fs.writeFileSync(storageFile, JSON.stringify(state, null, 2))

    const result = await request(app)
      .get(`/api/rounds/${firstRound.body.roundId}/result`)
      .set('Authorization', `Bearer ${first.token}`)
      .expect(200)

    assert.equal(result.body.result.winner.walletAddress, second.walletAddress)
    assert.equal(result.body.result.winner.responseTimeMs, 1000)
    assert.equal(result.body.result.winner.distanceKm, 0)
  } finally {
    restoreNow()
  }
})

test('ended drop details reveal the place, winner, and amount publicly', async () => {
  const restoreNow = useActiveDropClock()
  const app = createTestApp()
  const first = await authenticate(app)
  const second = await authenticate(app)

  try {
    const firstRound = await request(app)
      .post('/api/drops/start')
      .set('Authorization', `Bearer ${first.token}`)
      .expect(200)
    const secondRound = await request(app)
      .post('/api/drops/start')
      .set('Authorization', `Bearer ${second.token}`)
      .expect(200)

    await request(app)
      .post(`/api/rounds/${firstRound.body.roundId}/guess`)
      .set('Authorization', `Bearer ${first.token}`)
      .send({
        guessLat: firstRound.body.panorama.position.lat,
        guessLng: firstRound.body.panorama.position.lng,
      })
      .expect(200)

    await request(app)
      .post(`/api/rounds/${secondRound.body.roundId}/guess`)
      .set('Authorization', `Bearer ${second.token}`)
      .send({
        guessLat: secondRound.body.panorama.position.lat,
        guessLng: secondRound.body.panorama.position.lng,
      })
      .expect(200)

    const originalCycle = firstRound.body.meta.dropCycleNumber
    const endedCycle = Math.floor(Date.now() / DROP_CYCLE_MS) - 1
    const storageFile = app.locals.config.storageFile
    const state = JSON.parse(fs.readFileSync(storageFile, 'utf8'))

    state.rounds
      .filter((round) => round.dropCycleNumber === originalCycle)
      .forEach((round) => {
        round.dropCycleNumber = endedCycle
        round.activeEndsAt = Date.now() - 130_000
        round.revealEndsAt = Date.now() - 1
      })
    state.guesses
      .filter((guess) => guess.dropCycleNumber === originalCycle)
      .forEach((guess) => {
        guess.dropCycleNumber = endedCycle
      })
    state.dropParticipations
      .filter((participation) => participation.dropCycleNumber === originalCycle)
      .forEach((participation) => {
        participation.dropCycleNumber = endedCycle
      })
    fs.writeFileSync(storageFile, JSON.stringify(state, null, 2))

    const details = await request(app)
      .get(`/api/drops/${endedCycle}`)
      .expect(200)

    assert.equal(details.body.status, 'completed')
    assert.equal(details.body.winner.walletAddress, first.walletAddress)
    assert.equal(details.body.participantsCount, 2)
    assert.ok(details.body.location.region)
    assert.equal(details.body.winner.rewardSp, 1)

    const firstProfile = await request(app)
      .get('/api/me/profile')
      .set('Authorization', `Bearer ${first.token}`)
      .expect(200)

    assert.equal(firstProfile.body.spBalance, details.body.winner.rewardSp)
    assert.equal(firstProfile.body.tokenBalance, 100 + details.body.winner.rewardSp)
    assert.equal(firstProfile.body.dropsWon, 1)
  } finally {
    restoreNow()
  }
})

test('drops overview returns the active drop and the latest twenty past drops', async () => {
  const restoreNow = useActiveDropClock()
  const app = createTestApp()

  try {
    const overview = await request(app)
      .get('/api/drops')
      .expect(200)

    assert.equal(overview.body.activeDrop.status, 'active')
    assert.equal(overview.body.activeDrop.rewardSp, 1)
    assert.equal(overview.body.pastLimit, 20)
    assert.equal(overview.body.pastDrops.length, 20)
    assert.ok(overview.body.activeDrop.location.region)
    assert.ok(overview.body.pastDrops.every((drop) => drop.status === 'completed'))
    assert.deepEqual(
      overview.body.pastDrops.map((drop) => drop.dropCycleNumber),
      Array.from(
        { length: 20 },
        (_entry, index) => overview.body.activeDrop.dropCycleNumber - index - 1,
      ),
    )
  } finally {
    restoreNow()
  }
})

test('drops overview does not process pending payouts', async () => {
  const restoreNow = useActiveDropClock()
  const winnerWalletAddress = Keypair.generate().publicKey.toBase58()
  const endedCycle = Math.floor(Date.now() / DROP_CYCLE_MS) - 1
  let payoutCalls = 0
  const app = createTestAppWithState(
    {
      players: [],
      authChallenges: [],
      sessions: [],
      rounds: [],
      guesses: [],
      multiplayerRooms: [],
      dropParticipations: [],
      dropSettlements: [
        {
          id: 'pending-payout-settlement',
          dropCycleNumber: endedCycle,
          locationId: 'test-location',
          winningRoundId: 'test-round',
          winnerWalletAddress,
          rewardSp: 1,
          settledAt: new Date(Date.now() - DROP_REVEAL_MS).toISOString(),
          payout: {
            status: 'pending',
            amountUsd: 1,
            tokenSymbol: 'USDC',
            recipientWalletAddress: winnerWalletAddress,
            createdAt: new Date(Date.now() - DROP_REVEAL_MS).toISOString(),
            updatedAt: new Date(Date.now() - DROP_REVEAL_MS).toISOString(),
            attemptCount: 0,
          },
        },
      ],
      dailyAttemptLedger: [],
      rewardEvents: [],
    },
    {
      payoutClient: {
        getStatus: () => ({ configured: true }),
        sendReward: async () => {
          payoutCalls += 1
          throw new Error('Overview must not send payouts.')
        },
      },
    },
  )

  try {
    const overview = await request(app)
      .get('/api/drops')
      .expect(200)

    assert.equal(payoutCalls, 0)
    assert.equal(overview.body.pastDrops[0].dropCycleNumber, endedCycle)
    assert.equal(overview.body.pastDrops[0].winner.walletAddress, winnerWalletAddress)
    assert.equal(overview.body.pastDrops[0].winner.payout.status, 'pending')
  } finally {
    restoreNow()
  }
})

test('regular rounds continue to a second 90 second location', async () => {
  const app = createTestApp()
  const auth = await authenticate(app)

  const firstRound = await request(app)
    .post('/api/rounds/start')
    .set('Authorization', `Bearer ${auth.token}`)
    .expect(200)

  await request(app)
    .post(`/api/rounds/${firstRound.body.roundId}/guess`)
    .set('Authorization', `Bearer ${auth.token}`)
    .send({
      guessLat: firstRound.body.panorama.position.lat,
      guessLng: firstRound.body.panorama.position.lng,
    })
    .expect(200)

  const secondRound = await request(app)
    .post(`/api/rounds/${firstRound.body.roundId}/continue`)
    .set('Authorization', `Bearer ${auth.token}`)
    .expect(200)

  assert.equal(secondRound.body.sequenceIndex, 2)
  assert.equal(secondRound.body.roundLocationCount, 2)
  assert.equal(secondRound.body.meta.gameMode, 'regular')
  assert.equal(secondRound.body.meta.timeLimitSeconds, 90)
  assert.notEqual(secondRound.body.roundId, firstRound.body.roundId)
  assert.notDeepEqual(
    secondRound.body.panorama.position,
    firstRound.body.panorama.position,
  )
})

test('legacy active drop-timed rounds are not reused for regular gameplay', async () => {
  const keypair = Keypair.generate()
  const walletAddress = keypair.publicKey.toBase58()
  const app = createTestAppWithState({
    players: [{ walletAddress, createdAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() }],
    authChallenges: [],
    sessions: [],
    rounds: [
      {
        id: 'legacy-active-round',
        walletAddress,
        locationId: 'na-namib-desert-dunes',
        dropCycleNumber: 123,
        activeEndsAt: Date.now() + DROP_ACTIVE_MS,
        revealEndsAt: Date.now() + DROP_ACTIVE_MS + DROP_REVEAL_MS,
        sessionRootId: 'legacy-active-round',
        sequenceIndex: 1,
        attemptType: 'free',
        consumeQuotaOnSubmit: true,
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    guesses: [],
    dailyAttemptLedger: [],
    rewardEvents: [],
  })
  const auth = await authenticate(app, keypair)

  const round = await request(app)
    .post('/api/rounds/start')
    .set('Authorization', `Bearer ${auth.token}`)
    .expect(200)

  assert.notEqual(round.body.roundId, 'legacy-active-round')
  assert.equal(round.body.meta.gameMode, 'regular')
  assert.equal(round.body.meta.timeLimitSeconds, 90)
  assert.equal(round.body.roundLocationCount, 2)
})

test('expired regular active rounds are not reused on fresh start', async () => {
  const keypair = Keypair.generate()
  const walletAddress = keypair.publicKey.toBase58()
  const app = createTestAppWithState({
    players: [{ walletAddress, createdAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() }],
    authChallenges: [],
    sessions: [],
    rounds: [
      {
        id: 'expired-regular-round',
        walletAddress,
        gameMode: 'regular',
        locationId: 'cn-beijing-great-wall',
        dropCycleNumber: null,
        activeEndsAt: Date.now() - 1,
        revealEndsAt: Date.now() - 1,
        sessionRootId: 'expired-regular-round',
        sequenceIndex: 1,
        attemptType: 'free',
        consumeQuotaOnSubmit: true,
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    guesses: [],
    dailyAttemptLedger: [],
    rewardEvents: [],
  })
  const auth = await authenticate(app, keypair)

  const round = await request(app)
    .post('/api/rounds/start')
    .set('Authorization', `Bearer ${auth.token}`)
    .expect(200)

  assert.notEqual(round.body.roundId, 'expired-regular-round')
  assert.equal(round.body.meta.gameMode, 'regular')
  assert.equal(round.body.meta.timeLimitSeconds, 90)
  assert.equal(round.body.roundLocationCount, 2)
})

test('completed active drops cannot be replayed after re-authentication', async () => {
  const restoreNow = useActiveDropClock()
  const app = createTestApp()
  const keypair = Keypair.generate()
  const firstAuth = await authenticate(app, keypair)

  try {
    const dropRound = await request(app)
      .post('/api/drops/start')
      .set('Authorization', `Bearer ${firstAuth.token}`)
      .expect(200)

    assert.equal(dropRound.body.meta.gameMode, 'drop')
    assert.equal(dropRound.body.roundLocationCount, 1)

    await request(app)
      .post(`/api/rounds/${dropRound.body.roundId}/guess`)
      .set('Authorization', `Bearer ${firstAuth.token}`)
      .send({
        guessLat: dropRound.body.panorama.position.lat,
        guessLng: dropRound.body.panorama.position.lng,
      })
      .expect(200)

    const secondAuth = await authenticate(app, keypair)

    const blockedWhileSubmitted = await request(app)
      .post('/api/drops/start')
      .set('Authorization', `Bearer ${secondAuth.token}`)
      .expect(409)

    assert.equal(blockedWhileSubmitted.body.payload.code, 'DROP_ALREADY_PLAYED')

    const storageFile = app.locals.config.storageFile
    const state = JSON.parse(fs.readFileSync(storageFile, 'utf8'))
    const storedRound = state.rounds.find((round) => round.id === dropRound.body.roundId)
    storedRound.revealEndsAt = Date.now() - 1
    fs.writeFileSync(storageFile, JSON.stringify(state, null, 2))

    await request(app)
      .get(`/api/rounds/${dropRound.body.roundId}/result`)
      .set('Authorization', `Bearer ${secondAuth.token}`)
      .expect(200)

    const thirdAuth = await authenticate(app, keypair)

    const blockedAfterCompleted = await request(app)
      .post('/api/drops/start')
      .set('Authorization', `Bearer ${thirdAuth.token}`)
      .expect(409)

    assert.equal(blockedAfterCompleted.body.payload.code, 'DROP_ALREADY_PLAYED')
  } finally {
    restoreNow()
  }
})

test('multiplayer room starts after everyone is ready and accepts guesses', async () => {
  const app = createTestApp()
  const first = await authenticate(app)
  const second = await authenticate(app)

  await request(app)
    .patch('/api/me/profile')
    .set('Authorization', `Bearer ${first.token}`)
    .send({ username: 'Host_Player' })
    .expect(200)

  await request(app)
    .patch('/api/me/profile')
    .set('Authorization', `Bearer ${second.token}`)
    .send({ username: 'Guest_Player' })
    .expect(200)

  const originalNow = Date.now
  let now = originalNow()
  Date.now = () => now

  try {
    const created = await request(app)
      .post('/api/multiplayer/rooms')
      .set('Authorization', `Bearer ${first.token}`)
      .expect(200)

    assert.equal(created.body.status, 'waiting')
    assert.equal(created.body.playerCount, 1)
    assert.equal(created.body.roundCount, 5)

    const joined = await request(app)
      .post(`/api/multiplayer/rooms/${created.body.code}/join`)
      .set('Authorization', `Bearer ${second.token}`)
      .expect(200)

    assert.equal(joined.body.playerCount, 2)
    assert.deepEqual(
      joined.body.players.map((player) => player.username),
      ['Host_Player', 'Guest_Player'],
    )

    const blockedStart = await request(app)
      .post(`/api/multiplayer/rooms/${created.body.code}/start`)
      .set('Authorization', `Bearer ${first.token}`)
      .expect(409)

    assert.equal(blockedStart.body.payload.code, 'PLAYERS_NOT_READY')
    assert.deepEqual(blockedStart.body.payload.notReadyWalletAddresses, [
      second.walletAddress,
    ])

    await request(app)
      .post(`/api/multiplayer/rooms/${created.body.code}/ready`)
      .set('Authorization', `Bearer ${second.token}`)
      .expect(200)

    const countdown = await request(app)
      .post(`/api/multiplayer/rooms/${created.body.code}/start`)
      .set('Authorization', `Bearer ${first.token}`)
      .expect(200)

    assert.equal(countdown.body.status, 'countdown')

    now += 5_100

    const playing = await request(app)
      .get(`/api/multiplayer/rooms/${created.body.code}`)
      .set('Authorization', `Bearer ${first.token}`)
      .expect(200)

    assert.equal(playing.body.status, 'playing')
    assert.equal(playing.body.roundIndex, 1)
    assert.equal(playing.body.currentRound.roundLocationCount, 5)

    await request(app)
      .post(`/api/multiplayer/rooms/${created.body.code}/guess`)
      .set('Authorization', `Bearer ${first.token}`)
      .send({
        guessLat: playing.body.currentRound.panorama.position.lat,
        guessLng: playing.body.currentRound.panorama.position.lng,
      })
      .expect(200)

    const reveal = await request(app)
      .post(`/api/multiplayer/rooms/${created.body.code}/guess`)
      .set('Authorization', `Bearer ${second.token}`)
      .send({
        guessLat: playing.body.currentRound.panorama.position.lat,
        guessLng: playing.body.currentRound.panorama.position.lng,
      })
      .expect(200)

    assert.equal(reveal.body.status, 'reveal')
    assert.equal(reveal.body.roundResults.length, 2)
    assert.equal(reveal.body.leaderboard.length, 2)
    assert.ok(reveal.body.leaderboard[0].score > 0)
  } finally {
    Date.now = originalNow
  }
})

test('multiplayer voice token requires LiveKit configuration and room membership', async () => {
  const app = createTestApp()
  const first = await authenticate(app)
  const outsider = await authenticate(app)

  const created = await request(app)
    .post('/api/multiplayer/rooms')
    .set('Authorization', `Bearer ${first.token}`)
    .expect(200)

  const notConfigured = await request(app)
    .post(`/api/multiplayer/rooms/${created.body.code}/voice-token`)
    .set('Authorization', `Bearer ${first.token}`)
    .expect(503)

  assert.equal(notConfigured.body.payload.code, 'LIVEKIT_NOT_CONFIGURED')

  await request(app)
    .post(`/api/multiplayer/rooms/${created.body.code}/voice-token`)
    .set('Authorization', `Bearer ${outsider.token}`)
    .expect(403)
})

test('fourth regular game costs ten NOTF after free plays', async () => {
  const app = createTestApp()
  const auth = await authenticate(app)

  for (let index = 0; index < 3; index += 1) {
    const round = await request(app)
      .post('/api/rounds/start')
      .set('Authorization', `Bearer ${auth.token}`)
      .expect(200)

    await request(app)
      .post(`/api/rounds/${round.body.roundId}/guess`)
      .set('Authorization', `Bearer ${auth.token}`)
      .send({
        guessLat: 0,
        guessLng: 0,
      })
      .expect(200)
  }

  const paidRound = await request(app)
    .post('/api/rounds/start')
    .set('Authorization', `Bearer ${auth.token}`)
    .expect(200)

  assert.equal(paidRound.body.attemptType, 'paid')
  assert.equal(paidRound.body.meta.timeLimitSeconds, 90)

  const paidGuess = await request(app)
    .post(`/api/rounds/${paidRound.body.roundId}/guess`)
    .set('Authorization', `Bearer ${auth.token}`)
    .send({
      guessLat: 0,
      guessLng: 0,
    })
    .expect(200)

  assert.equal(paidGuess.body.profile.tokenBalance, 90)
  assert.equal(paidGuess.body.quota.paidConsumed, 1)
})

test('haversine distance is accurate enough for known coordinates', () => {
  const distance = haversineDistanceKm(
    { lat: 48.8584, lng: 2.2945 },
    { lat: 51.5072, lng: -0.1276 },
  )

  assert.ok(distance > 330)
  assert.ok(distance < 360)
})
