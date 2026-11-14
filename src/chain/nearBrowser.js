const SESSION_KEY = 'notfound-near-session'

export function loadNearSession() {
  try {
    return JSON.parse(window.localStorage.getItem(SESSION_KEY) || 'null')
  } catch {
    return null
  }
}

export function saveNearSession(session) {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

export async function createNearSession() {
  const { KeyPair } = await import('near-api-js')
  const key = KeyPair.fromRandom('ed25519')
  const session = {
    publicKey: key.getPublicKey().toString(),
    secretKey: key.toString(),
    accountId: '',
  }
  saveNearSession(session)
  return session
}

export async function signSubmitGuess({ accountId, secretKey, receiverId, args, rpcUrl }) {
  const { Account, actions, encodeSignedDelegate, teraToGas } = await import('near-api-js')
  const player = new Account(accountId, rpcUrl, secretKey)
  const { signedDelegate } = await player.createSignedMetaTransaction({
    receiverId,
    actions: [actions.functionCall('submit_guess', args, teraToGas(120), 0n)],
    blockHeightTtl: 250,
  })
  const bytes = encodeSignedDelegate(signedDelegate)
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary)
}

export async function viewCall(rpcUrl, contractId, method, args = {}) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'notfound',
      method: 'query',
      params: {
        request_type: 'call_function',
        finality: 'final',
        account_id: contractId,
        method_name: method,
        args_base64: btoa(JSON.stringify(args)),
      },
    }),
  })
  const payload = await response.json()
  if (payload.error) {
    throw new Error(payload.error.message || 'NEAR RPC error')
  }
  const text = new TextDecoder().decode(new Uint8Array(payload.result.result))
  return text ? JSON.parse(text) : null
}
