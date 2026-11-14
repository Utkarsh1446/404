import { placeById, places } from '../../shared/places.js'
import { commitmentHex, toE6 } from '../../shared/rules.js'

const GUEST_LIMIT = 15
const GUEST_NEAR = '0.03'

export function rpcUrl(env) {
  const rpc = env?.NEAR_RPC_URL || 'https://rpc.testnet.near.org'
  if (!rpc.includes('testnet') || rpc.includes('mainnet')) {
    throw new Error('Relayer refuses a non-testnet RPC.')
  }
  return rpc
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
  })
}

function publicError(error, env) {
  let message = error?.message || 'Request failed.'
  const secret = env?.RELAYER_PRIVATE_KEY
  if (secret && message.includes(secret)) message = 'Relayer request failed.'
  return message.slice(0, 300)
}

function nearToYocto(nearAmount) {
  const [whole, fraction = ''] = String(nearAmount).split('.')
  const frac = `${fraction}000000000000000000000000`.slice(0, 24)
  return BigInt(whole) * 10n ** 24n + BigInt(frac)
}

function txHash(result) {
  return (
    result?.transaction?.hash
    || result?.transaction_outcome?.id
    || result?.final_execution_outcome?.transaction?.hash
    || null
  )
}

function randomSalt() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function signerFor(env) {
  const { Account } = await import('near-api-js')
  return new Account(env.RELAYER_ACCOUNT_ID, rpcUrl(env), env.RELAYER_PRIVATE_KEY)
}

async function viewFunction(env, contractId, method, args) {
  const { JsonRpcProvider } = await import('near-api-js')
  const provider = new JsonRpcProvider({ url: rpcUrl(env) })
  return provider.callFunction({
    contractId,
    method,
    args,
    blockQuery: { finality: 'final' },
  })
}

async function waitForAccount(env, accountId) {
  const started = Date.now()
  while (Date.now() - started < 20_000) {
    if (await accountExists(env, accountId)) return
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }
  throw new Error(`Account ${accountId} was not visible on RPC.`)
}

async function accountExists(env, accountId) {
  const { JsonRpcProvider } = await import('near-api-js')
  const provider = new JsonRpcProvider({ url: rpcUrl(env) })
  try {
    await provider.viewAccount({ accountId })
    return true
  } catch {
    return false
  }
}

async function send(env, contractId, methodName, args, gasTera = 80) {
  const { teraToGas } = await import('near-api-js')
  const signer = await signerFor(env)
  const result = await signer.callFunctionRaw({
    contractId,
    methodName,
    args,
    gas: teraToGas(gasTera),
    deposit: 0n,
    waitUntil: 'FINAL',
  })
  return { result, hash: txHash(result) }
}

function requireReady(env) {
  if (!env?.RELAYER_PRIVATE_KEY || !env?.RELAYER_ACCOUNT_ID) {
    const error = new Error('RELAYER_PRIVATE_KEY is not configured.')
    error.status = 503
    throw error
  }
  if (!env.ROUNDS) {
    const error = new Error('ROUNDS KV binding is not configured.')
    error.status = 503
    throw error
  }
  rpcUrl(env)
}

export async function handle(request, env) {
  const url = new URL(request.url)
  if (request.method === 'OPTIONS') return json({ ok: true })

  try {
    if (request.method === 'GET' && url.pathname === '/health') {
      return json({
        ok: true,
        network: 'testnet',
        ready: Boolean(env?.RELAYER_PRIVATE_KEY && env?.RELAYER_ACCOUNT_ID && env?.ROUNDS),
        gameContract: env?.GAME_CONTRACT || null,
        tokenContract: env?.TOKEN_CONTRACT || null,
        poolContract: env?.POOL_CONTRACT || null,
        relayerAccount: env?.RELAYER_ACCOUNT_ID || null,
      })
    }

    if (request.method === 'POST' && url.pathname === '/session') {
      requireReady(env)
      const body = await request.json().catch(() => ({}))
      return json(await openSession(env, body?.publicKey))
    }

    if (request.method === 'POST' && url.pathname === '/rounds/start') {
      requireReady(env)
      const body = await request.json().catch(() => ({}))
      return json(await startRound(env, body?.accountId))
    }

    if (request.method === 'POST' && url.pathname === '/relay') {
      requireReady(env)
      const body = await request.json().catch(() => ({}))
      return json(await relayGuess(env, body?.signedDelegate))
    }

    const revealMatch = url.pathname.match(/^\/rounds\/([^/]+)\/reveal$/)
    if (request.method === 'POST' && revealMatch) {
      requireReady(env)
      return json(await revealRound(env, decodeURIComponent(revealMatch[1])))
    }

    return json({ error: 'Not found.' }, 404)
  } catch (error) {
    return json({ error: publicError(error, env) }, error.status || 400)
  }
}

async function openSession(env, publicKey) {
  if (!publicKey?.startsWith('ed25519:')) {
    const error = new Error('publicKey must be an ed25519 key.')
    error.status = 400
    throw error
  }
  const { PublicKey, actions } = await import('near-api-js')
  const accountId = Buffer.from(PublicKey.from(publicKey).data).toString('hex')
  let fundTx = null
  if (!(await accountExists(env, accountId))) {
    const raw = await env.ROUNDS.get('funded-guests')
    const guests = raw ? JSON.parse(raw) : []
    if (!guests.includes(accountId)) {
      if (guests.length >= GUEST_LIMIT) {
        const error = new Error('Relayer guest limit reached.')
        error.status = 429
        throw error
      }
      const signer = await signerFor(env)
      const funded = await signer.signAndSendTransaction({
        receiverId: accountId,
        actions: [actions.transfer(nearToYocto(GUEST_NEAR))],
        waitUntil: 'FINAL',
      })
      fundTx = txHash(funded)
      await waitForAccount(env, accountId)
      guests.push(accountId)
      await env.ROUNDS.put('funded-guests', JSON.stringify(guests))
    }
  }

  const claimed = await viewFunction(env, env.GAME_CONTRACT, 'starter_claimed', { player: accountId })
  let starterTx = null
  if (!claimed) {
    starterTx = (await send(env, env.GAME_CONTRACT, 'claim_starter', { player: accountId })).hash
  }
  return { accountId, created: Boolean(fundTx), fundTx, starterTx }
}

async function startRound(env, player) {
  if (!player) {
    const error = new Error('accountId is required.')
    error.status = 400
    throw error
  }
  const place = places[Math.floor(Math.random() * places.length)]
  const salt = randomSalt()
  const roundId = `round-${Date.now()}-${salt.slice(0, 6)}`
  const commitment = await commitmentHex(place.id, toE6(place.lat), toE6(place.lng), salt)
  const committed = await send(env, env.GAME_CONTRACT, 'commit_round', {
    round_id: roundId,
    player,
    location_id: place.id,
    commitment,
  })
  await env.ROUNDS.put(
    `round:${roundId}`,
    JSON.stringify({ salt, placeId: place.id, player }),
    { expirationTtl: 60 * 60 * 2 },
  )
  return { roundId, placeId: place.id, commitment, commitTx: committed.hash }
}

async function relayGuess(env, signedDelegateBase64) {
  if (!signedDelegateBase64) {
    const error = new Error('signedDelegate is required.')
    error.status = 400
    throw error
  }
  const { decodeSignedDelegate, teraToGas } = await import('near-api-js')
  const signedDelegate = decodeSignedDelegate(Buffer.from(signedDelegateBase64, 'base64'))
  const receiverId = signedDelegate.delegateAction.receiverId
  const call = signedDelegate.delegateAction.actions?.[0]?.functionCall
  const methodName = call?.methodName
  const allowed = [env.GAME_CONTRACT, env.POOL_CONTRACT].filter(Boolean)
  if (!call || methodName !== 'submit_guess') {
    throw new Error('Relayer only submits submit_guess meta-transactions.')
  }
  if (allowed.length > 0 && !allowed.includes(receiverId)) {
    throw new Error('Relayer rejected the receiver.')
  }
  if (call.deposit !== 0n) throw new Error('Relayer rejects attached deposits.')
  if (call.gas > teraToGas(150)) throw new Error('Relayer rejects gas above 150 TGas.')
  const signer = await signerFor(env)
  const relayed = await signer.relayMetaTransaction(signedDelegate)
  return { txHash: txHash(relayed), method: methodName }
}

async function revealRound(env, roundId) {
  const raw = await env.ROUNDS.get(`round:${roundId}`)
  if (!raw) {
    const error = new Error('This relayer does not have the salt for that round.')
    error.status = 404
    throw error
  }
  const stored = JSON.parse(raw)
  const place = placeById(stored.placeId)
  const revealed = await send(env, env.GAME_CONTRACT, 'reveal_and_settle', {
    round_id: roundId,
    lat_e6: toE6(place.lat),
    lng_e6: toE6(place.lng),
    salt_hex: stored.salt,
  })
  const onChain = await viewFunction(env, env.GAME_CONTRACT, 'get_round', { round_id: roundId })
  return {
    revealTx: revealed.hash,
    city: place.city,
    country: place.country,
    lat: place.lat,
    lng: place.lng,
    round: onChain,
  }
}

export default {
  fetch(request, env) {
    return handle(request, env)
  },
}
