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
  livekitUrl: process.env.LIVEKIT_URL ?? '',
  livekitApiKey: process.env.LIVEKIT_API_KEY ?? '',
  livekitApiSecret: process.env.LIVEKIT_API_SECRET ?? '',
}
