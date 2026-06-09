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
import { DROP_CYCLE_MS } from '../server/lib/drop-schedule.js'

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

async function authenticate(app) {
  const keypair = Keypair.generate()
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

test('starting and guessing a round stores one submitted guess and reveals later', async () => {
  const app = createTestApp()
  const auth = await authenticate(app)

  const round = await request(app)
    .post('/api/rounds/start')
    .set('Authorization', `Bearer ${auth.token}`)
    .expect(200)

  const guess = await request(app)
    .post(`/api/rounds/${round.body.roundId}/guess`)
    .set('Authorization', `Bearer ${auth.token}`)
    .send({
      guessLat: round.body.panorama.position.lat,
      guessLng: round.body.panorama.position.lng,
    })
    .expect(200)

  assert.ok(guess.body.pendingReveal)

  await request(app)
    .post(`/api/rounds/${round.body.roundId}/guess`)
    .set('Authorization', `Bearer ${auth.token}`)
    .send({
      guessLat: round.body.panorama.position.lat,
      guessLng: round.body.panorama.position.lng,
    })
    .expect(409)

  await request(app)
    .get(`/api/rounds/${round.body.roundId}/result`)
    .set('Authorization', `Bearer ${auth.token}`)
    .expect(425)

  const originalNow = Date.now
  Date.now = () => guess.body.pendingReveal.revealEndsAt + 1

  try {
    const result = await request(app)
      .get(`/api/rounds/${round.body.roundId}/result`)
      .set('Authorization', `Bearer ${auth.token}`)
      .expect(200)

    assert.equal(result.body.result.rewardEligible, true)
    assert.equal(result.body.result.winner.walletAddress, auth.walletAddress)
  } finally {
    Date.now = originalNow
  }
})

test('the first correct submitted guess wins after reveal', async () => {
  const app = createTestApp()
  const first = await authenticate(app)
  const second = await authenticate(app)

  const firstRound = await request(app)
    .post('/api/rounds/start')
    .set('Authorization', `Bearer ${first.token}`)
    .expect(200)

  const secondRound = await request(app)
    .post('/api/rounds/start')
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

  const secondGuess = await request(app)
    .post(`/api/rounds/${secondRound.body.roundId}/guess`)
    .set('Authorization', `Bearer ${second.token}`)
    .send({
      guessLat: secondRound.body.panorama.position.lat,
      guessLng: secondRound.body.panorama.position.lng,
    })
    .expect(200)

  const originalNow = Date.now
  Date.now = () => secondGuess.body.pendingReveal.revealEndsAt + 1

  try {
    const result = await request(app)
      .get(`/api/rounds/${secondRound.body.roundId}/result`)
      .set('Authorization', `Bearer ${second.token}`)
      .expect(200)

    assert.equal(result.body.result.winner.walletAddress, first.walletAddress)
  } finally {
    Date.now = originalNow
  }
})

test('fourth round requires payment and mocked checkout unlocks one paid attempt', async () => {
  const app = createTestApp()
  const auth = await authenticate(app)
  const originalNow = Date.now
  const baseNow = Math.floor(originalNow() / DROP_CYCLE_MS) * DROP_CYCLE_MS

  try {
    for (let index = 0; index < 3; index += 1) {
      Date.now = () => baseNow + index * DROP_CYCLE_MS + 1000
      const round = await request(app)
        .post('/api/rounds/start')
        .set('Authorization', `Bearer ${auth.token}`)
        .expect(200)

      const guess = await request(app)
        .post(`/api/rounds/${round.body.roundId}/guess`)
        .set('Authorization', `Bearer ${auth.token}`)
        .send({
          guessLat: round.body.panorama.position.lat,
          guessLng: round.body.panorama.position.lng,
        })
        .expect(200)

      Date.now = () => guess.body.pendingReveal.revealEndsAt + 1
      await request(app)
        .get(`/api/rounds/${round.body.roundId}/result`)
        .set('Authorization', `Bearer ${auth.token}`)
        .expect(200)
    }

    Date.now = () => baseNow + 3 * DROP_CYCLE_MS + 1000

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
  } finally {
    Date.now = originalNow
  }
})

test('haversine distance is accurate enough for known coordinates', () => {
  const distance = haversineDistanceKm(
    { lat: 48.8584, lng: 2.2945 },
    { lat: 51.5072, lng: -0.1276 },
  )

  assert.ok(distance > 330)
  assert.ok(distance < 360)
})
