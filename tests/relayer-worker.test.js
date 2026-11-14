import test from 'node:test'
import assert from 'node:assert/strict'
import { handle, rpcUrl } from '../relayer-worker/src/index.js'

test('worker health is testnet and not ready without a secret', async () => {
  const response = await handle(new Request('https://relayer.test/health'), {
    NEAR_RPC_URL: 'https://rpc.testnet.near.org',
    GAME_CONTRACT: 'notf-game-38b8e817.testnet',
  })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.ok, true)
  assert.equal(body.network, 'testnet')
  assert.equal(body.ready, false)
  assert.equal(response.headers.get('access-control-allow-origin'), '*')
})

test('worker session refuses mainnet and a missing key', async () => {
  assert.throws(() => rpcUrl({ NEAR_RPC_URL: 'https://rpc.mainnet.near.org' }), /non-testnet/)
  assert.equal(rpcUrl({}), 'https://rpc.testnet.near.org')

  const missing = await handle(new Request('https://relayer.test/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }), {
    NEAR_RPC_URL: 'https://rpc.testnet.near.org',
    RELAYER_ACCOUNT_ID: 'notf-relay-87a84acb.testnet',
  })
  assert.equal(missing.status, 503)
  const missingBody = await missing.json()
  assert.match(missingBody.error, /RELAYER_PRIVATE_KEY/)

  const mainnet = await handle(new Request('https://relayer.test/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }), {
    NEAR_RPC_URL: 'https://rpc.mainnet.near.org',
    RELAYER_PRIVATE_KEY: 'ed25519:not-a-real-key',
    RELAYER_ACCOUNT_ID: 'notf-relay-87a84acb.testnet',
    ROUNDS: { get: async () => null, put: async () => {} },
  })
  assert.equal(mainnet.status, 400)
  const mainnetBody = await mainnet.json()
  assert.match(mainnetBody.error, /non-testnet/)
  assert.equal(mainnetBody.error.includes('ed25519:not-a-real-key'), false)
})
