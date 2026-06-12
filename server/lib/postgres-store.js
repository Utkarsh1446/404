import pg from 'pg'
import { createInitialState } from './file-store.js'

const STATE_ID = 'runtime'
const { Pool } = pg

function mergeInitialState(state) {
  return {
    ...createInitialState(),
    ...(state ?? {}),
  }
}

export function createPostgresStore(connectionString) {
  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
  })

  let setupPromise = null

  async function ensureStorage(client = pool) {
    setupPromise ??= (async () => {
      await client.query(`
        create table if not exists app_state (
          id text primary key,
          state jsonb not null,
          updated_at timestamptz not null default now()
        )
      `)

      await client.query(
        `
          insert into app_state (id, state)
          values ($1, $2::jsonb)
          on conflict (id) do nothing
        `,
        [STATE_ID, JSON.stringify(createInitialState())],
      )
    })()

    await setupPromise
  }

  async function read() {
    await ensureStorage()
    const result = await pool.query(
      'select state from app_state where id = $1',
      [STATE_ID],
    )

    return mergeInitialState(result.rows[0]?.state)
  }

  async function update(mutator) {
    await ensureStorage()
    const client = await pool.connect()

    try {
      await client.query('begin')
      const result = await client.query(
        'select state from app_state where id = $1 for update',
        [STATE_ID],
      )
      const state = mergeInitialState(result.rows[0]?.state)
      const mutationResult = await mutator(state)

      await client.query(
        `
          update app_state
          set state = $2::jsonb,
              updated_at = now()
          where id = $1
        `,
        [STATE_ID, JSON.stringify(state)],
      )
      await client.query('commit')

      return mutationResult
    } catch (error) {
      await client.query('rollback').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }

  async function close() {
    await pool.end()
  }

  return {
    provider: 'postgres',
    close,
    read,
    update,
  }
}
