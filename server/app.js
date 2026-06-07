import crypto from 'node:crypto'
import cors from 'cors'
import express from 'express'
import { createChallenge, verifyWalletSignature } from './lib/auth.js'
import { createFileStore } from './lib/file-store.js'
import { createGameService } from './lib/game-service.js'
import { serverConfig } from './config.js'

function authMiddleware(store) {
  return (req, res, next) => {
    const authorization = req.headers.authorization ?? ''
    const token = authorization.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : ''

    if (!token) {
      res.status(401).json({ error: 'Missing auth token.' })
      return
    }

    const session = store.update((state) =>
      state.sessions.find((entry) => entry.token === token),
    )

    if (!session) {
      res.status(401).json({ error: 'Invalid auth token.' })
      return
    }

    req.auth = session
    next()
  }
}

export function createApp(options = {}) {
  const config = { ...serverConfig, ...options }
  const store = createFileStore(config.storageFile)
  const gameService = createGameService({
    store,
    rewardThresholdKm: config.rewardThresholdKm,
  })

  const app = express()
  app.use(
    cors({
      origin: true,
      credentials: false,
    }),
  )
  app.use(express.json())

  app.get('/', (_req, res) => {
    res.json({ ok: true, app: 'SuperPumped Guess API' })
  })

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true })
  })

  app.post('/api/auth/wallet/challenge', (req, res, next) => {
    try {
      const { walletAddress } = req.body ?? {}

      const challenge = store.update((state) => createChallenge(state, walletAddress))
      res.json(challenge)
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/auth/wallet/verify', (req, res, next) => {
    try {
      const { walletAddress, message, signature } = req.body ?? {}

      const payload = store.update((state) => {
        const challenge = state.authChallenges.find(
          (entry) => entry.walletAddress === walletAddress,
        )

        if (!challenge) {
          const error = new Error('Challenge not found.')
          error.statusCode = 400
          throw error
        }

        const ageMs = Date.now() - new Date(challenge.issuedAt).getTime()
        if (ageMs > config.challengeTtlMs) {
          const error = new Error('Challenge expired.')
          error.statusCode = 400
          throw error
        }

        verifyWalletSignature({
          walletAddress,
          message,
          signature,
          storedChallenge: challenge,
        })

        state.authChallenges = state.authChallenges.filter(
          (entry) => entry.walletAddress !== walletAddress,
        )

        state.sessions = state.sessions.filter(
          (entry) => entry.walletAddress !== walletAddress,
        )

        const token = crypto.randomUUID()
        state.sessions.push({
          token,
          walletAddress,
          createdAt: new Date().toISOString(),
        })

        return { token }
      })

      res.json({
        token: payload.token,
        walletAddress,
        quota: gameService.getQuota(walletAddress),
      })
    } catch (error) {
      next(error)
    }
  })

  const requireAuth = authMiddleware(store)

  app.get('/api/me/quota', requireAuth, (req, res, next) => {
    try {
      res.json(gameService.getQuota(req.auth.walletAddress))
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/rounds/start', requireAuth, (req, res, next) => {
    try {
      res.json(gameService.startRound(req.auth.walletAddress))
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/attempts/:roundId/checkout-intent', requireAuth, (req, res, next) => {
    try {
      res.json(
        gameService.checkoutAttempt(req.auth.walletAddress, req.params.roundId),
      )
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/rounds/:roundId/guess', requireAuth, (req, res, next) => {
    try {
      const { guessLat, guessLng } = req.body ?? {}

      if (!Number.isFinite(guessLat) || !Number.isFinite(guessLng)) {
        const error = new Error('Guess coordinates are required.')
        error.statusCode = 400
        throw error
      }

      res.json(
        gameService.submitGuess(req.auth.walletAddress, req.params.roundId, {
          lat: guessLat,
          lng: guessLng,
        }),
      )
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/rounds/:roundId/result', requireAuth, (req, res, next) => {
    try {
      res.json(
        gameService.getRoundResult(req.auth.walletAddress, req.params.roundId),
      )
    } catch (error) {
      next(error)
    }
  })

  app.use((error, _req, res, next) => {
    void next
    const status = error.statusCode ?? 500
    res.status(status).json({
      error: error.message ?? 'Unexpected server error.',
      ...(error.payload ? { payload: error.payload } : {}),
    })
  })

  return app
}
