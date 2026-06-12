import crypto from 'node:crypto'
import cors from 'cors'
import express from 'express'
import { createChallenge, verifyWalletSignature } from './lib/auth.js'
import { createFileStore } from './lib/file-store.js'
import { createGameService } from './lib/game-service.js'
import { createPostgresStore } from './lib/postgres-store.js'
import { serverConfig } from './config.js'

function authMiddleware(store) {
  return async (req, res, next) => {
    const authorization = req.headers.authorization ?? ''
    const token = authorization.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : ''

    if (!token) {
      res.status(401).json({ error: 'Missing auth token.' })
      return
    }

    try {
      const session = await store.update((state) =>
        state.sessions.find((entry) => entry.token === token),
      )

      if (!session) {
        res.status(401).json({ error: 'Invalid auth token.' })
        return
      }

      req.auth = session
      next()
    } catch (error) {
      next(error)
    }
  }
}

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next)
  }
}

export function createApp(options = {}) {
  const config = {
    ...serverConfig,
    ...options,
    databaseUrl:
      options.storageFile && !Object.hasOwn(options, 'databaseUrl')
        ? ''
        : options.databaseUrl ?? serverConfig.databaseUrl,
    storageFileConfigured: Boolean(options.storageFile) || serverConfig.storageFileConfigured,
  }
  const store = config.databaseUrl
    ? createPostgresStore(config.databaseUrl)
    : createFileStore(config.storageFile)
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
    const usingRenderDisk = config.storageFile.startsWith('/var/data/')

    res.json({
      ok: true,
      storage: {
        provider: store.provider ?? 'file',
        file: config.storageFile,
        configured: Boolean(config.storageFileConfigured),
        databaseConfigured: Boolean(config.databaseUrl),
        usingRenderDisk,
        warning:
          !config.databaseUrl && process.env.RENDER && !usingRenderDisk
            ? 'Render deploys need STORAGE_FILE on a persistent disk, for example /var/data/runtime-store.json.'
            : null,
      },
    })
  })

  app.get('/api/drops/:cycleNumber', asyncRoute(async (req, res) => {
    res.json(await gameService.getDropDetails(req.params.cycleNumber))
  }))

  app.post('/api/auth/wallet/challenge', asyncRoute(async (req, res) => {
    const { walletAddress } = req.body ?? {}

    const challenge = await store.update((state) => createChallenge(state, walletAddress))
    res.json(challenge)
  }))

  app.post('/api/auth/wallet/verify', asyncRoute(async (req, res) => {
    const { walletAddress, message, signature, username } = req.body ?? {}

    const payload = await store.update((state) => {
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

    let profile = await gameService.getProfile(walletAddress)

    if (username && !profile.hasUsername) {
      try {
        profile = await gameService.updateProfile(walletAddress, { username })
      } catch {
        profile = await gameService.getProfile(walletAddress)
      }
    }

    res.json({
      token: payload.token,
      walletAddress,
      quota: await gameService.getQuota(walletAddress),
      profile,
    })
  }))

  const requireAuth = authMiddleware(store)

  app.get('/api/me/quota', requireAuth, asyncRoute(async (req, res) => {
    res.json(await gameService.getQuota(req.auth.walletAddress))
  }))

  app.get('/api/me/profile', requireAuth, asyncRoute(async (req, res) => {
    res.json(await gameService.getProfile(req.auth.walletAddress))
  }))

  app.patch('/api/me/profile', requireAuth, asyncRoute(async (req, res) => {
    res.json(await gameService.updateProfile(req.auth.walletAddress, req.body ?? {}))
  }))

  app.post('/api/rounds/start', requireAuth, asyncRoute(async (req, res) => {
    res.json(await gameService.startRound(req.auth.walletAddress))
  }))

  app.post('/api/drops/start', requireAuth, asyncRoute(async (req, res) => {
    res.json(await gameService.startDropRound(req.auth.walletAddress))
  }))

  app.post('/api/multiplayer/rooms', requireAuth, asyncRoute(async (req, res) => {
    res.json(await gameService.createMultiplayerRoom(req.auth.walletAddress))
  }))

  app.post('/api/multiplayer/rooms/:code/join', requireAuth, asyncRoute(async (req, res) => {
    res.json(
      await gameService.joinMultiplayerRoom(req.auth.walletAddress, req.params.code),
    )
  }))

  app.get('/api/multiplayer/rooms/:code', requireAuth, asyncRoute(async (req, res) => {
    res.json(
      await gameService.getMultiplayerRoom(req.auth.walletAddress, req.params.code),
    )
  }))

  app.post('/api/multiplayer/rooms/:code/ready', requireAuth, asyncRoute(async (req, res) => {
    res.json(
      await gameService.setMultiplayerReady(req.auth.walletAddress, req.params.code),
    )
  }))

  app.post('/api/multiplayer/rooms/:code/start', requireAuth, asyncRoute(async (req, res) => {
    res.json(
      await gameService.startMultiplayerRoom(req.auth.walletAddress, req.params.code),
    )
  }))

  app.post('/api/multiplayer/rooms/:code/guess', requireAuth, asyncRoute(async (req, res) => {
    const { guessLat, guessLng } = req.body ?? {}

    if (!Number.isFinite(guessLat) || !Number.isFinite(guessLng)) {
      const error = new Error('Guess coordinates are required.')
      error.statusCode = 400
      throw error
    }

    res.json(
      await gameService.submitMultiplayerGuess(
        req.auth.walletAddress,
        req.params.code,
        {
          lat: guessLat,
          lng: guessLng,
        },
      ),
    )
  }))

  app.post('/api/multiplayer/rooms/:code/voice-token', requireAuth, asyncRoute(async (req, res) => {
    res.json(
      await gameService.createMultiplayerVoiceToken(
        req.auth.walletAddress,
        req.params.code,
      ),
    )
  }))

  app.post('/api/attempts/:roundId/checkout-intent', requireAuth, asyncRoute(async (req, res) => {
    res.json(
      await gameService.checkoutAttempt(req.auth.walletAddress, req.params.roundId),
    )
  }))

  app.post('/api/rounds/:roundId/continue', requireAuth, asyncRoute(async (req, res) => {
    res.json(
      await gameService.continueRound(req.auth.walletAddress, req.params.roundId),
    )
  }))

  app.post('/api/rounds/:roundId/guess', requireAuth, asyncRoute(async (req, res) => {
    const { guessLat, guessLng } = req.body ?? {}

    if (!Number.isFinite(guessLat) || !Number.isFinite(guessLng)) {
      const error = new Error('Guess coordinates are required.')
      error.statusCode = 400
      throw error
    }

    res.json(
      await gameService.submitGuess(req.auth.walletAddress, req.params.roundId, {
        lat: guessLat,
        lng: guessLng,
      })
    )
  }))

  app.get('/api/rounds/:roundId/result', requireAuth, asyncRoute(async (req, res) => {
    res.json(
      await gameService.getRoundResult(req.auth.walletAddress, req.params.roundId),
    )
  }))

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
