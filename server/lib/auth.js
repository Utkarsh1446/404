import crypto from 'node:crypto'
import nacl from 'tweetnacl'
import { PublicKey } from '@solana/web3.js'

export function assertValidWalletAddress(walletAddress) {
  try {
    const publicKey = new PublicKey(walletAddress)
    return publicKey.toBytes()
  } catch {
    const error = new Error('Invalid Solana wallet address.')
    error.statusCode = 400
    throw error
  }
}

export function buildChallengeMessage(walletAddress, nonce, issuedAt) {
  return [
    'SuperPumped Guess wallet sign-in',
    `Wallet: ${walletAddress}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join('\n')
}

export function createChallenge(state, walletAddress) {
  assertValidWalletAddress(walletAddress)

  const nonce = crypto.randomUUID()
  const issuedAt = new Date().toISOString()
  const message = buildChallengeMessage(walletAddress, nonce, issuedAt)

  state.authChallenges = state.authChallenges.filter(
    (challenge) => challenge.walletAddress !== walletAddress,
  )

  state.authChallenges.push({
    walletAddress,
    nonce,
    issuedAt,
    message,
  })

  return { walletAddress, nonce, issuedAt, message }
}

export function verifyWalletSignature({
  walletAddress,
  message,
  signature,
  storedChallenge,
}) {
  if (!storedChallenge) {
    const error = new Error('No active challenge for this wallet.')
    error.statusCode = 400
    throw error
  }

  if (storedChallenge.message !== message) {
    const error = new Error('Challenge message mismatch.')
    error.statusCode = 400
    throw error
  }

  const publicKeyBytes = assertValidWalletAddress(walletAddress)
  const signatureBytes = Buffer.from(signature, 'base64')
  const messageBytes = new TextEncoder().encode(message)
  const verified = nacl.sign.detached.verify(
    messageBytes,
    signatureBytes,
    publicKeyBytes,
  )

  if (!verified) {
    const error = new Error('Invalid wallet signature.')
    error.statusCode = 401
    throw error
  }
}
