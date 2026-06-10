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
    livekit: {
      url: config.livekitUrl,
      apiKey: config.livekitApiKey,
      apiSecret: config.livekitApiSecret,
    },
  })

  const app = express()
  app.locals.config = config
  app.use(
    cors({
      origin: true,
      credentials: false,
    }),
  )
  app.use(express.json())

  app.get('/', (_req, res) => {
    res.json({ ok: true, app: 'notfound API' })
  })

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true })
  })

  app.get('/api/drops/:cycleNumber', (req, res, next) => {
    try {
      res.json(gameService.getDropDetails(req.params.cycleNumber))
    } catch (error) {
      next(error)
    }
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
      const { walletAddress, message, signature, username } = req.body ?? {}

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

      let profile = gameService.getProfile(walletAddress)

      if (username && !profile.hasUsername) {
        try {
          profile = gameService.updateProfile(walletAddress, { username })
        } catch {
          profile = gameService.getProfile(walletAddress)
        }
      }

      res.json({
        token: payload.token,
        walletAddress,
        quota: gameService.getQuota(walletAddress),
        profile,
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

  app.get('/api/me/profile', requireAuth, (req, res, next) => {
    try {
      res.json(gameService.getProfile(req.auth.walletAddress))
    } catch (error) {
      next(error)
    }
  })

  app.patch('/api/me/profile', requireAuth, (req, res, next) => {
    try {
      res.json(gameService.updateProfile(req.auth.walletAddress, req.body ?? {}))
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

  app.post('/api/drops/start', requireAuth, (req, res, next) => {
    try {
      res.json(gameService.startDropRound(req.auth.walletAddress))
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/multiplayer/rooms', requireAuth, (req, res, next) => {
    try {
      res.json(gameService.createMultiplayerRoom(req.auth.walletAddress))
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/multiplayer/rooms/:code/join', requireAuth, (req, res, next) => {
    try {
      res.json(
        gameService.joinMultiplayerRoom(req.auth.walletAddress, req.params.code),
      )
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/multiplayer/rooms/:code', requireAuth, (req, res, next) => {
    try {
      res.json(
        gameService.getMultiplayerRoom(req.auth.walletAddress, req.params.code),
      )
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/multiplayer/rooms/:code/ready', requireAuth, (req, res, next) => {
    try {
      res.json(
        gameService.setMultiplayerReady(req.auth.walletAddress, req.params.code),
      )
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/multiplayer/rooms/:code/start', requireAuth, (req, res, next) => {
    try {
      res.json(
        gameService.startMultiplayerRoom(req.auth.walletAddress, req.params.code),
      )
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/multiplayer/rooms/:code/guess', requireAuth, (req, res, next) => {
    try {
      const { guessLat, guessLng } = req.body ?? {}

      if (!Number.isFinite(guessLat) || !Number.isFinite(guessLng)) {
        const error = new Error('Guess coordinates are required.')
        error.statusCode = 400
        throw error
      }

      res.json(
        gameService.submitMultiplayerGuess(
          req.auth.walletAddress,
          req.params.code,
          {
            lat: guessLat,
            lng: guessLng,
          },
        ),
      )
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/multiplayer/rooms/:code/voice-token', requireAuth, async (req, res, next) => {
    try {
      res.json(
        await gameService.createMultiplayerVoiceToken(
          req.auth.walletAddress,
          req.params.code,
        ),
      )
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

  app.post('/api/rounds/:roundId/continue', requireAuth, (req, res, next) => {
    try {
      res.json(
        gameService.continueRound(req.auth.walletAddress, req.params.roundId),
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
