import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { places } from '../shared/places.js'
import { commitmentHex, toE6, wholeToRaw } from '../shared/rules.js'
import {
  account,
  actions,
  createFundedAccount,
  deployWasm,
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
} from './near-client.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const wasmDir = path.join(root, 'contracts/target/wasm32-unknown-unknown/release')
const transactions = []

function record(label, hash, accountId) {
  const entry = {
    label,
    hash,
    accountId: accountId || null,
    explorer: hash ? explorerTx(hash) : null,
  }
  transactions.push(entry)
  console.log(`${label}: ${hash || 'no-hash'}`)
  return entry
}

function explain(error) {
  const logs = error?.transactionResult?.receipts_outcome?.flatMap(
    (receipt) => receipt?.outcome?.logs || [],
  )
  return [error.message, logs?.length ? logs.join('\n') : '']
    .filter(Boolean)
    .join('\n')
}

async function transferNear(signer, receiverId, nearAmount) {
  const result = await signer.signAndSendTransaction({
    receiverId,
    actions: [actions.transfer(nearToYocto(nearAmount))],
    waitUntil: 'FINAL',
  })
  return { result, hash: txHash(result) }
}

async function main() {
  console.log('Creating four throwaway testnet accounts...')
  const tokenAccount = await createFundedAccount('notf-token')
  const gameAccount = await createFundedAccount('notf-game')
  const poolAccount = await createFundedAccount('notf-pool')
  const operator = await createFundedAccount('notf-relay')
  for (const created of [tokenAccount, gameAccount, poolAccount, operator]) {
    console.log(`${created.accountId} balance yocto ${created.balance}`)
  }

  mkdirSync(path.join(root, '.near'), { recursive: true })
  writeFileSync(
    path.join(root, '.near/credentials.json'),
    JSON.stringify(
      {
        rpcUrl: process.env.NEAR_RPC_URL || 'https://rpc.testnet.near.org',
        operator: { accountId: operator.accountId, privateKey: operator.privateKey },
        token: { accountId: tokenAccount.accountId, privateKey: tokenAccount.privateKey },
        game: { accountId: gameAccount.accountId, privateKey: gameAccount.privateKey },
        pool: { accountId: poolAccount.accountId, privateKey: poolAccount.privateKey },
      },
      null,
      2,
    ),
  )

  console.log('Deploying wasm...')
  record('deploy token', (await deployWasm(tokenAccount.signer, path.join(wasmDir, 'notf_token.wasm'))).hash, tokenAccount.accountId)
  record('deploy game', (await deployWasm(gameAccount.signer, path.join(wasmDir, 'notf_game.wasm'))).hash, gameAccount.accountId)
  record('deploy pool', (await deployWasm(poolAccount.signer, path.join(wasmDir, 'notf_pool.wasm'))).hash, poolAccount.accountId)

  console.log('Initializing...')
  record(
    'init token',
    (
      await send(tokenAccount.signer, tokenAccount.accountId, 'new', {
        owner_id: operator.accountId,
        game_id: gameAccount.accountId,
        pool_id: poolAccount.accountId,
      })
    ).hash,
    tokenAccount.accountId,
  )
  record(
    'init game',
    (
      await send(gameAccount.signer, gameAccount.accountId, 'new', {
        owner_id: operator.accountId,
        operator_id: operator.accountId,
        token_id: tokenAccount.accountId,
      })
    ).hash,
    gameAccount.accountId,
  )
  record(
    'init pool',
    (
      await send(poolAccount.signer, poolAccount.accountId, 'new', {
        owner_id: operator.accountId,
        operator_id: operator.accountId,
        token_id: tokenAccount.accountId,
      })
    ).hash,
    poolAccount.accountId,
  )

  const metadata = await viewFunction(tokenAccount.accountId, 'ft_metadata', {})
  console.log('metadata', metadata)
  const supply = await viewFunction(tokenAccount.accountId, 'ft_total_supply', {})
  console.log('supply', supply)

  const poolFund = wholeToRaw(1000).toString()
  record(
    'fund drop pool',
    (
      await send(
        operator.signer,
        tokenAccount.accountId,
        'ft_transfer_call',
        {
          receiver_id: poolAccount.accountId,
          amount: poolFund,
          memo: 'seed drop pool',
          msg: '',
        },
        100,
        1n,
      )
    ).hash,
    tokenAccount.accountId,
  )
  const available = await viewFunction(poolAccount.accountId, 'get_available', {})
  console.log('pool available', available)

  const playerKey = (await import('near-api-js')).KeyPair.fromRandom('ed25519')
  const playerId = implicitAccountId(playerKey.getPublicKey())
  record('fund guest', (await transferNear(operator.signer, playerId, '0.05')).hash, playerId)
  await waitForAccount(playerId)
  record(
    'claim starter',
    (
      await send(operator.signer, gameAccount.accountId, 'claim_starter', {
        player: playerId,
      })
    ).hash,
    gameAccount.accountId,
  )
  const starterBalance = await viewFunction(tokenAccount.accountId, 'ft_balance_of', {
    account_id: playerId,
  })
  console.log('starter balance', starterBalance)

  const place = places[0]
  const salt = randomSalt()
  const latE6 = toE6(place.lat)
  const lngE6 = toE6(place.lng)
  const commitment = await commitmentHex(place.id, latE6, lngE6, salt)
  const roundId = `round-${Date.now()}`
  record(
    'commit round',
    (
      await send(operator.signer, gameAccount.accountId, 'commit_round', {
        round_id: roundId,
        player: playerId,
        location_id: place.id,
        commitment,
      })
    ).hash,
    gameAccount.accountId,
  )

  const guessLat = latE6 + 10_000
  const guessLng = lngE6 + 10_000
  const signedGuess = await signMetaTransaction({
    accountId: playerId,
    privateKey: playerKey.toString(),
    receiverId: gameAccount.accountId,
    methodName: 'submit_guess',
    args: { round_id: roundId, lat_e6: guessLat, lng_e6: guessLng },
    gasTera: 40,
  })
  const relayedGuess = await relayMetaTransaction(operator.signer, signedGuess)
  record('gasless guess', relayedGuess.hash, playerId)

  record(
    'reveal round',
    (
      await send(operator.signer, gameAccount.accountId, 'reveal_and_settle', {
        round_id: roundId,
        lat_e6: latE6,
        lng_e6: lngE6,
        salt_hex: salt,
      }, 80)
    ).hash,
    gameAccount.accountId,
  )
  const settled = await viewFunction(gameAccount.accountId, 'get_round', { round_id: roundId })
  console.log('settled round', settled)

  const dropPlace = places[1]
  const dropSalt = randomSalt()
  const dropLat = toE6(dropPlace.lat)
  const dropLng = toE6(dropPlace.lng)
  const dropCommitment = await commitmentHex(dropPlace.id, dropLat, dropLng, dropSalt)
  const dropId = `drop-${Date.now()}`
  const closesAt = Date.now() + 20_000
  record(
    'open drop',
    (
      await send(operator.signer, poolAccount.accountId, 'open_drop', {
        drop_id: dropId,
        location_id: dropPlace.id,
        commitment: dropCommitment,
        prize: wholeToRaw(25).toString(),
        closes_at_ms: closesAt,
      })
    ).hash,
    poolAccount.accountId,
  )
  const signedDrop = await signMetaTransaction({
    accountId: playerId,
    privateKey: playerKey.toString(),
    receiverId: poolAccount.accountId,
    methodName: 'submit_guess',
    args: { drop_id: dropId, lat_e6: dropLat, lng_e6: dropLng },
    gasTera: 40,
  })
  const relayedDrop = await relayMetaTransaction(operator.signer, signedDrop)
  record('gasless drop guess', relayedDrop.hash, playerId)
  const waitMs = Math.max(0, closesAt - Date.now() + 8_000)
  console.log(`waiting ${waitMs}ms for the drop window to close`)
  await new Promise((resolve) => setTimeout(resolve, waitMs))
  record(
    'settle drop',
    (
      await send(operator.signer, poolAccount.accountId, 'settle', {
        drop_id: dropId,
        lat_e6: dropLat,
        lng_e6: dropLng,
        salt_hex: dropSalt,
      }, 100)
    ).hash,
    poolAccount.accountId,
  )
  const drop = await viewFunction(poolAccount.accountId, 'get_drop', { drop_id: dropId })
  console.log('settled drop', drop)
  const finalBalance = await viewFunction(tokenAccount.accountId, 'ft_balance_of', {
    account_id: playerId,
  })
  console.log('final player balance', finalBalance)

  const locked = []
  for (const created of [tokenAccount, gameAccount, poolAccount]) {
    try {
      const removed = await created.signer.deleteKey(created.publicKey)
      record(`lock ${created.accountId}`, txHash(removed), created.accountId)
      locked.push(created.accountId)
    } catch (error) {
      console.log(`could not lock ${created.accountId}: ${explain(error)}`)
    }
  }

  const publication = {
    configured: true,
    network: 'testnet',
    rpcUrl: process.env.NEAR_RPC_URL || 'https://rpc.testnet.near.org',
    tokenContract: tokenAccount.accountId,
    gameContract: gameAccount.accountId,
    poolContract: poolAccount.accountId,
    relayerAccount: operator.accountId,
    sampleRoundId: roundId,
    sampleDropId: dropId,
    samplePlayer: playerId,
    playerBalance: String(finalBalance),
    contractsLocked: locked,
    transactions,
    accounts: {
      token: explorerAccount(tokenAccount.accountId),
      game: explorerAccount(gameAccount.accountId),
      pool: explorerAccount(poolAccount.accountId),
      relayer: explorerAccount(operator.accountId),
      player: explorerAccount(playerId),
    },
  }
  mkdirSync(path.join(root, 'docs'), { recursive: true })
  writeFileSync(path.join(root, 'docs/testnet-deploy.json'), JSON.stringify(publication, null, 2))
  writeFileSync(path.join(root, 'src/chain/testnet.json'), JSON.stringify(publication, null, 2))
  console.log('wrote docs/testnet-deploy.json')
}

main().catch((error) => {
  console.error(explain(error))
  process.exit(1)
})
