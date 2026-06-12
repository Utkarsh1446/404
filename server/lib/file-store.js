import fs from 'node:fs'
import path from 'node:path'

export function createInitialState() {
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

export function createFileStore(storageFile) {
  function ensureStorage() {
    const dir = path.dirname(storageFile)

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    if (!fs.existsSync(storageFile)) {
      fs.writeFileSync(storageFile, JSON.stringify(createInitialState(), null, 2))
    }
  }

  function read() {
    ensureStorage()
    const raw = fs.readFileSync(storageFile, 'utf8')

    try {
      return { ...createInitialState(), ...JSON.parse(raw) }
    } catch {
      const initial = createInitialState()
      fs.writeFileSync(storageFile, JSON.stringify(initial, null, 2))
      return initial
    }
  }

  function write(state) {
    ensureStorage()
    fs.writeFileSync(storageFile, JSON.stringify(state, null, 2))
  }

  function update(mutator) {
    const state = read()
    try {
      const result = mutator(state)
      write(state)
      return result
    } catch (error) {
      write(state)
      throw error
    }
  }

  return {
    read,
    update,
  }
}
