import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import nacl from 'tweetnacl'
import { Keypair } from '@solana/web3.js'
import { createApp } from '../server/app.js'
import { haversineDistanceKm } from '../server/lib/geo.js'

function createTestApp() {
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
      dailyAttemptLedger: [],
      rewardEvents: [],
    }),
  )

  return createApp({ storageFile, challengeTtlMs: 60_000, rewardThresholdKm: 50 })
}

function createTestAppWithState(initialState) {
  const storageFile = path.join(
    os.tmpdir(),
    `sp-guess-${Math.random().toString(36).slice(2)}.json`,
  )
  fs.writeFileSync(storageFile, JSON.stringify(initialState))

  return createApp({ storageFile, challengeTtlMs: 60_000, rewardThresholdKm: 50 })
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

test('quota is wallet-specific and starts with three free rounds', async () => {
  const app = createTestApp()
  const first = await authenticate(app)
  const second = await authenticate(app)

  const firstQuota = await request(app)
    .get('/api/me/quota')
    .set('Authorization', `Bearer ${first.token}`)
    .expect(200)

  const secondQuota = await request(app)
    .get('/api/me/quota')
    .set('Authorization', `Bearer ${second.token}`)
    .expect(200)

  assert.equal(firstQuota.body.freeRemaining, 3)
  assert.equal(secondQuota.body.freeRemaining, 3)
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
        activeEndsAt: Date.now() + 2 * 60 * 60 * 1000,
        revealEndsAt: Date.now() + 2 * 60 * 60 * 1000 + 120 * 1000,
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

test('fourth round requires payment and mocked checkout unlocks one paid attempt', async () => {
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
        guessLat: round.body.panorama.position.lat,
        guessLng: round.body.panorama.position.lng,
      })
      .expect(200)
  }

  const blocked = await request(app)
    .post('/api/rounds/start')
    .set('Authorization', `Bearer ${auth.token}`)
    .expect(402)

  await request(app)
    .post(`/api/attempts/${blocked.body.payload.roundId}/checkout-intent`)
    .set('Authorization', `Bearer ${auth.token}`)
    .expect(200)

  const unlocked = await request(app)
    .post('/api/rounds/start')
    .set('Authorization', `Bearer ${auth.token}`)
    .expect(200)

  assert.equal(unlocked.body.attemptType, 'paid')
  assert.equal(unlocked.body.meta.timeLimitSeconds, 90)
})

test('haversine distance is accurate enough for known coordinates', () => {
  const distance = haversineDistanceKm(
    { lat: 48.8584, lng: 2.2945 },
    { lat: 51.5072, lng: -0.1276 },
  )

  assert.ok(distance > 330)
  assert.ok(distance < 360)
})
