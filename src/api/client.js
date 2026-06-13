import { clientConfig } from '../config'

async function apiFetch(path, options = {}) {
  const response = await fetch(`${clientConfig.apiBaseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...options.headers,
    },
  })

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    const error = new Error(payload.error ?? 'Request failed.')
    error.status = response.status
    error.payload = payload.payload
    throw error
  }

  return payload
}

export const apiClient = {
  createChallenge(walletAddress) {
    return apiFetch('/api/auth/wallet/challenge', {
      method: 'POST',
      body: JSON.stringify({ walletAddress }),
    })
  },
  verifyWallet({ walletAddress, message, signature, username }) {
    return apiFetch('/api/auth/wallet/verify', {
      method: 'POST',
      body: JSON.stringify({ walletAddress, message, signature, username }),
    })
  },
  getQuota(token) {
    return apiFetch('/api/me/quota', { token })
  },
  getProfile(token) {
    return apiFetch('/api/me/profile', { token })
  },
  updateProfile(token, updates) {
    return apiFetch('/api/me/profile', {
      method: 'PATCH',
      token,
      body: JSON.stringify(updates),
    })
  },
  getDrops() {
    return apiFetch('/api/drops')
  },
  getDropDetails(dropCycleNumber) {
    return apiFetch(`/api/drops/${dropCycleNumber}`)
  },
  startRound(token) {
    return apiFetch('/api/rounds/start', { method: 'POST', token })
  },
  startDrop(token) {
    return apiFetch('/api/drops/start', { method: 'POST', token })
  },
  createMultiplayerRoom(token) {
    return apiFetch('/api/multiplayer/rooms', { method: 'POST', token })
  },
  joinMultiplayerRoom(token, code) {
    return apiFetch(`/api/multiplayer/rooms/${code}/join`, {
      method: 'POST',
      token,
    })
  },
  getMultiplayerRoom(token, code) {
    return apiFetch(`/api/multiplayer/rooms/${code}`, { token })
  },
  readyMultiplayerRoom(token, code) {
    return apiFetch(`/api/multiplayer/rooms/${code}/ready`, {
      method: 'POST',
      token,
    })
  },
  startMultiplayerRoom(token, code) {
    return apiFetch(`/api/multiplayer/rooms/${code}/start`, {
      method: 'POST',
      token,
    })
  },
  submitMultiplayerGuess(token, code, guess) {
    return apiFetch(`/api/multiplayer/rooms/${code}/guess`, {
      method: 'POST',
      token,
      body: JSON.stringify({
        guessLat: guess.lat,
        guessLng: guess.lng,
      }),
    })
  },
  getMultiplayerVoiceToken(token, code) {
    return apiFetch(`/api/multiplayer/rooms/${code}/voice-token`, {
      method: 'POST',
      token,
    })
  },
  continueRound(token, roundId) {
    return apiFetch(`/api/rounds/${roundId}/continue`, {
      method: 'POST',
      token,
    })
  },
  checkoutIntent(token, roundId) {
    return apiFetch(`/api/attempts/${roundId}/checkout-intent`, {
      method: 'POST',
      token,
    })
  },
  submitGuess(token, roundId, guess) {
    return apiFetch(`/api/rounds/${roundId}/guess`, {
      method: 'POST',
      token,
      body: JSON.stringify({
        guessLat: guess.lat,
        guessLng: guess.lng,
      }),
    })
  },
  getResult(token, roundId) {
    return apiFetch(`/api/rounds/${roundId}/result`, { token })
  },
}
