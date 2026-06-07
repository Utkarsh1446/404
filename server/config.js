export const serverConfig = {
  port: Number(process.env.PORT ?? 8787),
  browserOrigin: process.env.BROWSER_ORIGIN ?? 'http://127.0.0.1:5173',
  rewardThresholdKm: Number(process.env.REWARD_THRESHOLD_KM ?? 50),
  challengeTtlMs: Number(process.env.CHALLENGE_TTL_MS ?? 10 * 60 * 1000),
  storageFile:
    process.env.STORAGE_FILE ??
    new URL('./data/runtime-store.json', import.meta.url).pathname,
}
