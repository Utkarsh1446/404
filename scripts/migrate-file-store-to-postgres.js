import fs from 'node:fs'

try {
  process.loadEnvFile?.()
} catch {
  // Deployment environments usually inject env vars directly.
}

const { serverConfig } = await import('../server/config.js')
const { createPostgresStore } = await import('../server/lib/postgres-store.js')

const force = process.argv.includes('--force')

function hasData(state) {
  return Object.values(state).some((value) => Array.isArray(value) && value.length > 0)
}

if (!serverConfig.databaseUrl) {
  console.error('DATABASE_URL or SUPABASE_CONNECTION_STRING is required.')
  process.exit(1)
}

if (!fs.existsSync(serverConfig.storageFile)) {
  console.error(`File store not found: ${serverConfig.storageFile}`)
  process.exit(1)
}

const fileState = JSON.parse(fs.readFileSync(serverConfig.storageFile, 'utf8'))
const store = createPostgresStore(serverConfig.databaseUrl)

try {
  const currentState = await store.read()

  if (hasData(currentState) && !force) {
    console.error(
      'Postgres state already has data. Re-run with --force to overwrite it.',
    )
    process.exit(1)
  }

  await store.update((state) => {
    Object.keys(state).forEach((key) => {
      delete state[key]
    })
    Object.assign(state, fileState)
  })

  console.log('Migrated file store data to Postgres.')
} finally {
  await store.close?.()
}
