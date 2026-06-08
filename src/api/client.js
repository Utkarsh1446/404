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
  verifyWallet({ walletAddress, message, signature }) {
    return apiFetch('/api/auth/wallet/verify', {
      method: 'POST',
      body: JSON.stringify({ walletAddress, message, signature }),
    })
  },
  getQuota(token) {
    return apiFetch('/api/me/quota', { token })
  },
  startRound(token) {
    return apiFetch('/api/rounds/start', { method: 'POST', token })
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
