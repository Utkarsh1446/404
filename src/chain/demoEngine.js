import {
  dayKey,
  distanceMeters,
  ENTRY_WHOLE,
  FREE_PER_DAY,
  rewardWholeNotf,
  STARTER_WHOLE,
  toE6,
} from '../../shared/rules.js'

export function freshProfile(now = Date.now()) {
  return {
    balance: STARTER_WHOLE,
    day: dayKey(now),
    used: 0,
  }
}

export function profileForDay(profile, now = Date.now()) {
  const day = dayKey(now)
  if (profile.day === day) return profile
  return { ...profile, day, used: 0 }
}

export function freeRemaining(profile, now = Date.now()) {
  const current = profileForDay(profile, now)
  return Math.max(0, FREE_PER_DAY - current.used)
}

export function applyGuess({ profile, place, guess, now = Date.now() }) {
  const current = profileForDay(profile, now)
  const distanceM = distanceMeters(toE6(place.lat), toE6(place.lng), toE6(guess.lat), toE6(guess.lng))
  const reward = rewardWholeNotf(distanceM)
  let fee = 0
  let balance = current.balance
  let used = current.used

  if (used < FREE_PER_DAY) {
    used += 1
  } else {
    fee = ENTRY_WHOLE
    if (balance < fee) {
      const error = new Error('Not enough NOTF for another round.')
      error.code = 'INSUFFICIENT_NOTF'
      throw error
    }
    balance -= fee
  }

  balance += reward
  return {
    profile: { balance, day: current.day, used },
    distanceM,
    reward,
    fee,
  }
}
