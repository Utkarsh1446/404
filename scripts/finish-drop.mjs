import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { JsonRpcProvider, KeyPair } from 'near-api-js'
import { places } from '../shared/places.js'
import { commitmentHex, toE6, wholeToRaw } from '../shared/rules.js'
import {
  account,
  accountExists,
  explorerAccount,
  explorerTx,
  implicitAccountId,
  nearToYocto,
  randomSalt,
  relayMetaTransaction,
  send,
  signMetaTransaction,
  txHash,
  viewFunction,
  waitForAccount,
  actions,
} from './near-client.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const creds = JSON.parse(readFileSync(path.join(root, '.near/credentials.json'), 'utf8'))
const operator = account(creds.operator.accountId, creds.operator.privateKey, creds.rpcUrl)
const token = 'notf-token-726a52e4.testnet'
const game = 'notf-game-38b8e817.testnet'
const pool = 'notf-pool-798fba54.testnet'

const prior = [
  ['deploy token', 'EHKTjes5dh7zFYrnU25UvPMFGQ7jgS34mxkmif1ojGr6', token],
  ['deploy game', '5QNfZnkLQN1eFhmVfHBV4HkMWVigHzWaBs1BXpod6NjT', game],
  ['deploy pool', 'BhfXdqS9MdA4njZNpvN1cgRMBwkFc7tg5kkkHesDxs3d', pool],
  ['init token', 'EgCQzVbr1WcrfbSuLbauTjEbbRmjHESsLUPgJZ19r1S', token],
  ['init game', 'H7Jn9sgq4UZsickCq3aKMCPmgvPmR4gb1WHHfb3Qm57K', game],
  ['init pool', 'GFwdRCVMRdp779hb5RYzt9sJHC11VnsjzRd5HuDsWVGC', pool],
  ['fund drop pool', '81echne13U5nMf3ejNo9XdncEytYz9kpWCPy7EdK5MqS', token],
  ['fund guest', '2svpT9FKKpe1NmgcKo533bTuVyhcR21Q2yhiDGy9DHFE', 'f1f02b5b70c1afee052082bf8e0636f6f8b92011353d00bc07214a8a95250c2f'],
  ['claim starter', '2TGyvwM7DnWq9ZrifQzTeRwhB3dh4FEVhe997RE2rSgx', game],
  ['commit round', 'EcpeQcZ6rxaRUDaVoEKViHXX9BrWgQ3iePJWi1brpV4v', game],
  ['gasless guess', '8evrmdNe7CNS2vmjW2xyDGQMJNcyhQJanXZBFnnfb24k', 'f1f02b5b70c1afee052082bf8e0636f6f8b92011353d00bc07214a8a95250c2f'],
  ['reveal round', 'HQKG8AwbdcUcw2gcuAhN17TiPAZagmMVo7A4SYUeQXTK', game],
  ['lock token', 'H9bwDFoTxGRAq3vRb6Rz3qx5BMBZ1PAcEUUYwVz9xco8', token],
  ['lock game', 'Fq1CEyNZdfnTSkh1RdcUHWzsMqCcNP48nWAb3N8nnvEX', game],
  ['lock pool', '8tXMxy6s61Zv5M6SuJT2zyRTQKZd4SRu9hV1pWcR4aCj', pool],
]

function record(list, label, hash, accountId) {
  list.push({ label, hash, accountId, explorer: explorerTx(hash) })
  console.log(`${label}: ${hash}`)
}

const transactions = prior.map(([label, hash, accountId]) => ({
  label,
  hash,
  accountId,
  explorer: explorerTx(hash),
}))

const provider = new JsonRpcProvider({ url: creds.rpcUrl })
const block = await provider.viewBlock({ finality: 'final' })
const chainMs = Math.floor(Number(BigInt(block.header.timestamp) / 1_000_000n))
const place = places[2]
const salt = randomSalt()
const latE6 = toE6(place.lat)
const lngE6 = toE6(place.lng)
const commitment = await commitmentHex(place.id, latE6, lngE6, salt)
const dropId = `drop-${Date.now()}`
const closesAt = chainMs + 90_000

record(
  transactions,
  'open drop',
  (
    await send(operator, pool, 'open_drop', {
      drop_id: dropId,
      location_id: place.id,
      commitment,
      prize: wholeToRaw(25).toString(),
      closes_at_ms: closesAt,
    })
  ).hash,
  pool,
)

const playerKey = KeyPair.fromRandom('ed25519')
const playerId = implicitAccountId(playerKey.getPublicKey())
if (!(await accountExists(playerId, creds.rpcUrl))) {
  const funded = await operator.signAndSendTransaction({
    receiverId: playerId,
    actions: [actions.transfer(nearToYocto('0.05'))],
    waitUntil: 'FINAL',
  })
  record(transactions, 'fund drop player', txHash(funded), playerId)
  await waitForAccount(playerId, creds.rpcUrl)
}
record(
  transactions,
  'claim starter for drop player',
  (await send(operator, game, 'claim_starter', { player: playerId })).hash,
  game,
)

const signed = await signMetaTransaction({
  accountId: playerId,
  privateKey: playerKey.toString(),
  receiverId: pool,
  methodName: 'submit_guess',
  args: { drop_id: dropId, lat_e6: latE6 + 8_000, lng_e6: lngE6 + 8_000 },
  gasTera: 100,
  rpcUrl: creds.rpcUrl,
})
const relayed = await relayMetaTransaction(operator, signed, [pool])
record(transactions, 'gasless drop guess', relayed.hash, playerId)

const seen = await viewFunction(pool, 'get_drop', { drop_id: dropId }, creds.rpcUrl)
console.log('guesses stored', seen.guesses?.length, 'status', seen.status)

const waitMs = Math.max(0, closesAt - Date.now() + 12_000)
console.log(`waiting ${waitMs}ms`)
await new Promise((resolve) => setTimeout(resolve, waitMs))

record(
  transactions,
  'settle drop',
  (
    await send(
      operator,
      pool,
      'settle',
      { drop_id: dropId, lat_e6: latE6, lng_e6: lngE6, salt_hex: salt },
      120,
    )
  ).hash,
  pool,
)
const settled = await viewFunction(pool, 'get_drop', { drop_id: dropId }, creds.rpcUrl)
console.log('settled', JSON.stringify(settled, null, 2))
const balance = await viewFunction(token, 'ft_balance_of', { account_id: playerId }, creds.rpcUrl)
console.log('player balance', balance)

const round = await viewFunction(game, 'get_round', {
  round_id: 'round-1794626565709',
}, creds.rpcUrl).catch(() => null)

const publication = {
  configured: true,
  network: 'testnet',
  rpcUrl: creds.rpcUrl,
  tokenContract: token,
  gameContract: game,
  poolContract: pool,
  relayerAccount: creds.operator.accountId,
  sampleRoundId: 'round-1794626565709',
  sampleDropId: dropId,
  samplePlayer: 'f1f02b5b70c1afee052082bf8e0636f6f8b92011353d00bc07214a8a95250c2f',
  dropPlayer: playerId,
  dropWinner: settled.winner,
  dropDistanceM: settled.winning_distance_m,
  playerBalance: String(balance),
  contractsLocked: [token, game, pool],
  roundStatus: round?.status ?? 'settled',
  transactions,
  accounts: {
    token: explorerAccount(token),
    game: explorerAccount(game),
    pool: explorerAccount(pool),
    relayer: explorerAccount(creds.operator.accountId),
  },
}

mkdirSync(path.join(root, 'docs'), { recursive: true })
writeFileSync(path.join(root, 'docs/testnet-deploy.json'), JSON.stringify(publication, null, 2))
writeFileSync(path.join(root, 'src/chain/testnet.json'), JSON.stringify(publication, null, 2))
console.log('wrote deployment record')
