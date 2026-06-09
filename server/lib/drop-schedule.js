export const DROP_ACTIVE_MS = 2 * 60 * 60 * 1000
export const DROP_REVEAL_MS = 120 * 1000
export const DROP_CYCLE_MS = DROP_ACTIVE_MS + DROP_REVEAL_MS

function hashCycle(cycleNumber) {
  let hash = 2166136261
  const input = `notfound-drop-${cycleNumber}`

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return hash >>> 0
}

export function getDropWindow(timestamp = Date.now()) {
  const cycleNumber = Math.floor(timestamp / DROP_CYCLE_MS)
  const cycleStartAt = cycleNumber * DROP_CYCLE_MS
  const activeEndsAt = cycleStartAt + DROP_ACTIVE_MS
  const revealEndsAt = activeEndsAt + DROP_REVEAL_MS

  return {
    cycleNumber,
    cycleStartAt,
    activeEndsAt,
    revealEndsAt,
    phase: timestamp < activeEndsAt ? 'active' : 'reveal',
  }
}

export function pickDropLocation(locations, cycleNumber) {
  if (locations.length === 0) {
    const error = new Error('No active drop locations are configured.')
    error.statusCode = 500
    throw error
  }

  return locations[hashCycle(cycleNumber) % locations.length]
}

export function getScheduledDrop(locations, timestamp = Date.now()) {
  const window = getDropWindow(timestamp)
  const location = pickDropLocation(locations, window.cycleNumber)

  return {
    ...window,
    location,
  }
}
