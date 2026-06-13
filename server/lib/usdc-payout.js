import bs58 from 'bs58'
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js'

export const DEFAULT_SOLANA_RPC_URL = 'https://api.mainnet-beta.solana.com'
export const DEFAULT_USDC_MINT_ADDRESS = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
export const DEFAULT_USDC_DECIMALS = 6

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
const TRANSFER_CHECKED_INSTRUCTION = 12

function keypairFromBytes(bytes) {
  if (bytes.length === 32) {
    return Keypair.fromSeed(bytes)
  }

  if (bytes.length === 64) {
    return Keypair.fromSecretKey(bytes)
  }

  throw new Error('Drop operator private key must be a 32-byte seed or 64-byte secret key.')
}

function parseOperatorKeypair(rawSecretKey) {
  const value = String(rawSecretKey ?? '').trim()

  if (!value) {
    const error = new Error('Drop operator private key is not configured.')
    error.code = 'OPERATOR_PRIVATE_KEY_MISSING'
    throw error
  }

  if (value.startsWith('[')) {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) {
      throw new Error('Drop operator private key JSON must be an array.')
    }
    return keypairFromBytes(Uint8Array.from(parsed))
  }

  if (value.includes(',')) {
    return keypairFromBytes(Uint8Array.from(value.split(',').map((entry) => Number(entry.trim()))))
  }

  if (/^[0-9a-fA-F]+$/.test(value) && value.length % 2 === 0) {
    return keypairFromBytes(Uint8Array.from(Buffer.from(value, 'hex')))
  }

  return keypairFromBytes(bs58.decode(value))
}

function getOperatorKeypair(rawSecretKey, expectedAddress) {
  const keypair = parseOperatorKeypair(rawSecretKey)
  const publicKey = keypair.publicKey.toBase58()
  const configuredAddress = String(expectedAddress ?? '').trim()

  if (configuredAddress && configuredAddress !== publicKey) {
    const error = new Error('Drop operator wallet address does not match the private key.')
    error.code = 'OPERATOR_ADDRESS_MISMATCH'
    throw error
  }

  return keypair
}

function parseUsdAmountToAtomic(amountUsd, decimals) {
  const value = String(amountUsd ?? '').trim()

  if (!/^\d+(\.\d+)?$/.test(value)) {
    throw new Error('USDC payout amount must be a positive decimal number.')
  }

  const [wholePart, fractionPart = ''] = value.split('.')
  const fraction = `${fractionPart}${'0'.repeat(decimals)}`.slice(0, decimals)
  const atomic =
    BigInt(wholePart) * (10n ** BigInt(decimals)) +
    BigInt(fraction || '0')

  if (atomic <= 0n) {
    throw new Error('USDC payout amount must be greater than zero.')
  }

  return atomic
}

function getAssociatedTokenAddress(mint, owner) {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0]
}

function createAssociatedTokenAccountInstruction({
  payer,
  associatedTokenAccount,
  owner,
  mint,
}) {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: associatedTokenAccount, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: Buffer.alloc(0),
  })
}

function createTransferCheckedInstruction({
  source,
  mint,
  destination,
  owner,
  amountRaw,
  decimals,
}) {
  const data = Buffer.alloc(10)
  data.writeUInt8(TRANSFER_CHECKED_INSTRUCTION, 0)
  data.writeBigUInt64LE(amountRaw, 1)
  data.writeUInt8(decimals, 9)

  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data,
  })
}

export function createUsdcPayoutClient(config = {}) {
  const rpcUrl = config.rpcUrl || DEFAULT_SOLANA_RPC_URL
  const mintAddress = config.mintAddress || DEFAULT_USDC_MINT_ADDRESS
  const decimals = Number(config.decimals ?? DEFAULT_USDC_DECIMALS)
  const operatorPrivateKey = config.operatorPrivateKey ?? ''
  const operatorWalletAddress = config.operatorWalletAddress ?? ''
  let cachedConnection = null
  let cachedOperator = null
  let cachedMint = null

  function getConnection() {
    cachedConnection ??= new Connection(rpcUrl, 'confirmed')
    return cachedConnection
  }

  function getOperator() {
    cachedOperator ??= getOperatorKeypair(operatorPrivateKey, operatorWalletAddress)
    return cachedOperator
  }

  function getMint() {
    cachedMint ??= new PublicKey(mintAddress)
    return cachedMint
  }

  function getStatus() {
    if (!operatorPrivateKey) {
      return {
        configured: false,
        operatorWalletAddress: operatorWalletAddress || null,
        mintAddress,
        rpcUrl,
        decimals,
      }
    }

    try {
      return {
        configured: true,
        operatorWalletAddress: getOperator().publicKey.toBase58(),
        mintAddress: getMint().toBase58(),
        rpcUrl,
        decimals,
      }
    } catch (error) {
      return {
        configured: false,
        operatorWalletAddress: operatorWalletAddress || null,
        mintAddress,
        rpcUrl,
        decimals,
        error: error.message,
      }
    }
  }

  async function sendReward({
    recipientWalletAddress,
    amountUsd,
    dropCycleNumber,
    settlementId,
  }) {
    if (!operatorPrivateKey) {
      return {
        status: 'pending_configuration',
        reason: 'DROP_OPERATOR_PRIVATE_KEY is not configured.',
      }
    }

    const operator = getOperator()
    const mint = getMint()
    const recipient = new PublicKey(recipientWalletAddress)
    const amountRaw = parseUsdAmountToAtomic(amountUsd, decimals)
    const connection = getConnection()
    const operatorTokenAccount = getAssociatedTokenAddress(mint, operator.publicKey)
    const recipientTokenAccount = getAssociatedTokenAddress(mint, recipient)
    const operatorAccount = await connection.getAccountInfo(operatorTokenAccount)

    if (!operatorAccount) {
      throw new Error('Operator USDC associated token account was not found.')
    }

    const balance = await connection.getTokenAccountBalance(operatorTokenAccount)
    if (BigInt(balance.value.amount) < amountRaw) {
      throw new Error('Operator USDC balance is too low for this drop payout.')
    }

    const transaction = new Transaction()
    const recipientAccount = await connection.getAccountInfo(recipientTokenAccount)
    if (!recipientAccount) {
      transaction.add(
        createAssociatedTokenAccountInstruction({
          payer: operator.publicKey,
          associatedTokenAccount: recipientTokenAccount,
          owner: recipient,
          mint,
        }),
      )
    }

    transaction.add(
      createTransferCheckedInstruction({
        source: operatorTokenAccount,
        mint,
        destination: recipientTokenAccount,
        owner: operator.publicKey,
        amountRaw,
        decimals,
      }),
    )
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [operator],
      { commitment: 'confirmed' },
    )

    return {
      status: 'sent',
      signature,
      dropCycleNumber,
      settlementId,
      operatorWalletAddress: operator.publicKey.toBase58(),
      recipientWalletAddress: recipient.toBase58(),
      operatorTokenAccount: operatorTokenAccount.toBase58(),
      recipientTokenAccount: recipientTokenAccount.toBase58(),
      mintAddress: mint.toBase58(),
      amountUsd,
      amountRaw: amountRaw.toString(),
    }
  }

  return {
    getStatus,
    sendReward,
  }
}
