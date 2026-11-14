import { readFileSync } from 'node:fs'
import {
  Account,
  JsonRpcProvider,
  KeyPair,
  PublicKey,
  actions,
  decodeSignedDelegate,
  encodeSignedDelegate,
  teraToGas,
} from 'near-api-js'

export { actions }

export const RPC_URL = process.env.NEAR_RPC_URL || 'https://rpc.testnet.near.org'
export const YOCTO = 10n ** 24n

export function nearToYocto(nearAmount) {
  const [whole, fraction = ''] = String(nearAmount).split('.')
  const frac = `${fraction}000000000000000000000000`.slice(0, 24)
  return BigInt(whole) * YOCTO + BigInt(frac)
}

export function implicitAccountId(publicKey) {
  const key = typeof publicKey === 'string' ? PublicKey.from(publicKey) : publicKey
  return Buffer.from(key.data).toString('hex')
}

export function account(accountId, privateKey, rpcUrl = RPC_URL) {
  return new Account(accountId, rpcUrl, privateKey)
}

export function provider(rpcUrl = RPC_URL) {
  return new JsonRpcProvider({ url: rpcUrl })
}

export function txHash(result) {
  return (
    result?.transaction?.hash ||
    result?.transaction_outcome?.id ||
    result?.final_execution_outcome?.transaction?.hash ||
    null
  )
}

export function explorerTx(hash) {
  return `https://testnet.nearblocks.io/txns/${hash}`
}

export function explorerAccount(accountId) {
  return `https://testnet.nearblocks.io/address/${accountId}`
}

export async function viewFunction(contractId, methodName, args = {}, rpcUrl = RPC_URL) {
  return provider(rpcUrl).callFunction({
    contractId,
    method: methodName,
    args,
    blockQuery: { finality: 'final' },
  })
}

export async function send(signer, receiverId, methodName, args, gasTera = 80, deposit = 0n) {
  const result = await signer.callFunctionRaw({
    contractId: receiverId,
    methodName,
    args,
    gas: teraToGas(gasTera),
    deposit,
    waitUntil: 'FINAL',
  })
  return { result, hash: txHash(result) }
}

export async function deployWasm(signer, wasmPath) {
  const code = new Uint8Array(readFileSync(wasmPath))
  const result = await signer.signAndSendTransaction({
    receiverId: signer.accountId,
    actions: [actions.deployContract(code)],
    waitUntil: 'FINAL',
  })
  return { result, hash: txHash(result), bytes: code.length }
}

export async function faucetCreate(accountId, publicKey) {
  const attempts = [
    ['https://helper.nearprotocol.com/account', { account_id: accountId, public_key: publicKey }],
    ['https://helper.testnet.near.org/account', { account_id: accountId, public_key: publicKey }],
    [
      'https://helper.nearprotocol.com/account',
      { newAccountId: accountId, newAccountPublicKey: publicKey },
    ],
  ]

  const errors = []
  for (const [url, body] of attempts) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const text = await response.text()
      if (response.ok) return { url, body: text }
      errors.push(`${url} ${response.status} ${text.slice(0, 240)}`)
    } catch (error) {
      errors.push(`${url} ${error.message}`)
    }
  }
  throw new Error(`Faucet failed for ${accountId}: ${errors.join(' | ')}`)
}

export async function createFundedAccount(prefix) {
  const key = KeyPair.fromRandom('ed25519')
  const accountId = `${prefix}-${crypto.randomUUID().replaceAll('-', '').slice(0, 8)}.testnet`
  const publicKey = key.getPublicKey().toString()
  await faucetCreate(accountId, publicKey)
  const signer = account(accountId, key.toString())
  await waitForAccount(accountId)
  const balance = await signer.getBalance()
  return {
    accountId,
    privateKey: key.toString(),
    publicKey,
    balance: balance.toString(),
    signer,
  }
}

export function randomSalt() {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')
}

export async function signMetaTransaction({
  accountId,
  privateKey,
  receiverId,
  methodName,
  args,
  gasTera = 120,
  rpcUrl = RPC_URL,
}) {
  const player = account(accountId, privateKey, rpcUrl)
  const { signedDelegate } = await player.createSignedMetaTransaction({
    receiverId,
    actions: [actions.functionCall(methodName, args, teraToGas(gasTera), 0n)],
    blockHeightTtl: 250,
  })
  const bytes = encodeSignedDelegate(signedDelegate)
  return Buffer.from(bytes).toString('base64')
}

export async function relayMetaTransaction(relayer, signedDelegateBase64, allowedReceivers = []) {
  const bytes = Buffer.from(signedDelegateBase64, 'base64')
  const signedDelegate = decodeSignedDelegate(bytes)
  const receiverId = signedDelegate.delegateAction.receiverId
  const call = signedDelegate.delegateAction.actions?.[0]?.functionCall
  const methodName = call?.methodName
  if (!call || methodName !== 'submit_guess') {
    throw new Error('Relayer only submits submit_guess meta-transactions.')
  }
  if (allowedReceivers.length > 0 && !allowedReceivers.includes(receiverId)) {
    throw new Error('Relayer rejected the receiver.')
  }
  if (call.deposit !== 0n) {
    throw new Error('Relayer rejects attached deposits.')
  }
  if (call.gas > teraToGas(150)) {
    throw new Error('Relayer rejects gas above 150 TGas.')
  }
  const result = await relayer.relayMetaTransaction(signedDelegate)
  return { result, hash: txHash(result), receiverId, methodName }
}

export async function accountExists(accountId, rpcUrl = RPC_URL) {
  try {
    await provider(rpcUrl).viewAccount({ accountId })
    return true
  } catch {
    return false
  }
}

export async function waitForAccount(accountId, rpcUrl = RPC_URL) {
  const started = Date.now()
  while (Date.now() - started < 40_000) {
    try {
      await provider(rpcUrl).viewAccount({ accountId })
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
  }
  throw new Error(`Account ${accountId} was not visible on RPC.`)
}
