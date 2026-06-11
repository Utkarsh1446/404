import pg from 'pg'

function createInitialState() {
  return {
    players: [],
    authChallenges: [],
    sessions: [],
    rounds: [],
    guesses: [],
    multiplayerRooms: [],
    dropParticipations: [],
    dropSettlements: [],
    dailyAttemptLedger: [],
    rewardEvents: [],
  }
}

const { Pool } = pg

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
          values ('runtime', $1::jsonb)
          on conflict (id) do nothing
        `,
        [JSON.stringify(createInitialState())],
      )
    })()

    await setupPromise
  }

  async function read() {
    await ensureStorage()
    const result = await pool.query(
      'select state from app_state where id = $1',
      ['runtime'],
    )

    return {
      ...createInitialState(),
      ...(result.rows[0]?.state ?? {}),
    }
  }

  async function update(mutator) {
    await ensureStorage()
    const client = await pool.connect()

    try {
      await client.query('begin')
      const result = await client.query(
        'select state from app_state where id = $1 for update',
        ['runtime'],
      )
      const state = {
        ...createInitialState(),
        ...(result.rows[0]?.state ?? {}),
      }
      const mutationResult = mutator(state)

      await client.query(
        `
          update app_state
          set state = $2::jsonb, updated_at = now()
          where id = $1
        `,
        ['runtime', JSON.stringify(state)],
      )
      await client.query('commit')

      return mutationResult
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  }

  async function close() {
    await pool.end()
  }

  return {
    close,
    read,
    update,
  }
}
