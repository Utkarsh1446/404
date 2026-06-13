import path from 'node:path'
import { fileURLToPath } from 'node:url'

try {
  process.loadEnvFile?.()
} catch {
  // Local development can still run with the defaults below.
}

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const defaultStorageFile = fileURLToPath(new URL('./data/runtime-store.json', import.meta.url))
const storageFileEnv = process.env.STORAGE_FILE
const databaseUrl =
  process.env.DATABASE_URL ??
  process.env.SUPABASE_CONNECTION_STRING ??
  process.env.SUPBASE_CONNECTION_STRING ??
  ''

function parseBoolean(value, fallback = false) {
  if (value === undefined) return fallback
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase())
}

function resolveStorageFile(storageFile) {
  if (!storageFile) {
    return defaultStorageFile
  }

  return path.resolve(projectRoot, storageFile)
}

export const serverConfig = {
  port: Number(process.env.PORT ?? 8787),
  browserOrigin: process.env.BROWSER_ORIGIN ?? 'http://127.0.0.1:5173',
  rewardThresholdKm: Number(process.env.REWARD_THRESHOLD_KM ?? 50),
  challengeTtlMs: Number(process.env.CHALLENGE_TTL_MS ?? 10 * 60 * 1000),
  storageFile: resolveStorageFile(storageFileEnv),
  storageFileConfigured: Boolean(storageFileEnv),
  databaseUrl,
  databaseConfigured: Boolean(databaseUrl),
  livekitUrl: process.env.LIVEKIT_URL ?? '',
  livekitApiKey: process.env.LIVEKIT_API_KEY ?? '',
  livekitApiSecret: process.env.LIVEKIT_API_SECRET ?? '',
  solanaRpcUrl: process.env.SOLANA_RPC_URL ?? '',
  usdcMintAddress: process.env.USDC_MINT_ADDRESS ?? '',
  usdcDecimals: Number(process.env.USDC_DECIMALS ?? 6),
  dropOperatorWalletAddress: process.env.DROP_OPERATOR_WALLET_ADDRESS ?? '',
  dropOperatorPrivateKey: process.env.DROP_OPERATOR_PRIVATE_KEY ?? '',
  dropAutomationEnabled: parseBoolean(process.env.DROP_AUTOMATION_ENABLED, true),
  dropAutomationIntervalMs: Number(process.env.DROP_AUTOMATION_INTERVAL_MS ?? 60_000),
}
