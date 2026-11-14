import cors from 'cors'
import express from 'express'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { placeById, places } from '../shared/places.js'
import { commitmentHex, toE6 } from '../shared/rules.js'
import {
  account,
  accountExists,
  actions,
  implicitAccountId,
  nearToYocto,
  randomSalt,
  relayMetaTransaction,
  send,
  txHash,
  viewFunction,
  waitForAccount,
} from '../scripts/near-client.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const credentials = JSON.parse(readFileSync(path.join(root, '.near/credentials.json'), 'utf8'))
const publication = JSON.parse(readFileSync(path.join(root, 'docs/testnet-deploy.json'), 'utf8'))
const operator = account(credentials.operator.accountId, credentials.operator.privateKey, credentials.rpcUrl)
const pending = new Map()
const fundedGuests = new Set()
const GUEST_LIMIT = 15

const app = express()
app.use(cors())
app.use(express.json({ limit: '1mb' }))

app.get('/health', (_request, response) => {
  response.json({
    ok: true,
    network: 'testnet',
    gameContract: publication.gameContract,
    tokenContract: publication.tokenContract,
    poolContract: publication.poolContract,
    relayerAccount: publication.relayerAccount,
    ready: true,
  })
})

app.post('/session', async (request, response) => {
  try {
    const publicKey = request.body?.publicKey
    if (!publicKey?.startsWith('ed25519:')) {
      response.status(400).json({ error: 'publicKey must be an ed25519 key.' })
      return
    }
    const accountId = implicitAccountId(publicKey)
    let fundTx = null
    if (!(await accountExists(accountId, credentials.rpcUrl))) {
      if (fundedGuests.size >= GUEST_LIMIT) {
        response.status(429).json({ error: 'Relayer guest limit reached. Restart the relayer with a funded operator.' })
        return
      }
      const funded = await operator.signAndSendTransaction({
        receiverId: accountId,
        actions: [actions.transfer(nearToYocto('0.03'))],
        waitUntil: 'FINAL',
      })
      fundTx = txHash(funded)
      await waitForAccount(accountId, credentials.rpcUrl)
      fundedGuests.add(accountId)
    }
    const claimed = await viewFunction(
      publication.gameContract,
      'starter_claimed',
      { player: accountId },
      credentials.rpcUrl,
    )
    let starterTx = null
    if (!claimed) {
      starterTx = (await send(operator, publication.gameContract, 'claim_starter', { player: accountId })).hash
    }
    response.json({ accountId, created: Boolean(fundTx), fundTx, starterTx })
  } catch (error) {
    response.status(400).json({ error: error.message })
  }
})

app.post('/rounds/start', async (request, response) => {
  try {
    const player = request.body?.accountId
    if (!player) {
      response.status(400).json({ error: 'accountId is required.' })
      return
    }
    const place = places[Math.floor(Math.random() * places.length)]
    const salt = randomSalt()
    const roundId = `round-${Date.now()}-${salt.slice(0, 6)}`
    const commitment = await commitmentHex(place.id, toE6(place.lat), toE6(place.lng), salt)
    const committed = await send(operator, publication.gameContract, 'commit_round', {
      round_id: roundId,
      player,
      location_id: place.id,
      commitment,
    })
    pending.set(roundId, { salt, placeId: place.id, player })
    response.json({
      roundId,
      placeId: place.id,
      commitment,
      commitTx: committed.hash,
    })
  } catch (error) {
    response.status(400).json({ error: error.message })
  }
})

app.post('/relay', async (request, response) => {
  try {
    const signedDelegate = request.body?.signedDelegate
    if (!signedDelegate) {
      response.status(400).json({ error: 'signedDelegate is required.' })
      return
    }
    const relayed = await relayMetaTransaction(operator, signedDelegate, [
      publication.gameContract,
      publication.poolContract,
    ])
    response.json({ txHash: relayed.hash, method: relayed.methodName })
  } catch (error) {
    response.status(400).json({ error: error.message })
  }
})

app.post('/rounds/:roundId/reveal', async (request, response) => {
  try {
    const round = pending.get(request.params.roundId)
    if (!round) {
      response.status(404).json({ error: 'This relayer does not have the salt for that round.' })
      return
    }
    const place = placeById(round.placeId)
    const revealed = await send(operator, publication.gameContract, 'reveal_and_settle', {
      round_id: request.params.roundId,
      lat_e6: toE6(place.lat),
      lng_e6: toE6(place.lng),
      salt_hex: round.salt,
    })
    const onChain = await viewFunction(
      publication.gameContract,
      'get_round',
      { round_id: request.params.roundId },
      credentials.rpcUrl,
    )
    response.json({
      revealTx: revealed.hash,
      city: place.city,
      country: place.country,
      lat: place.lat,
      lng: place.lng,
      round: onChain,
    })
  } catch (error) {
    response.status(400).json({ error: error.message })
  }
})

const port = Number(process.env.RELAYER_PORT || 8788)
app.listen(port, '0.0.0.0', () => {
  console.log(`relayer listening on 0.0.0.0:${port}`)
})
