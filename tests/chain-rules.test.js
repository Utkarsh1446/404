import test from 'node:test'
import assert from 'node:assert/strict'
import {
  commitmentHex,
  dayKey,
  distanceMeters,
  ENTRY_WHOLE,
  FREE_PER_DAY,
  rewardWholeNotf,
  STARTER_WHOLE,
  toE6,
} from '../shared/rules.js'
import { applyGuess, freshProfile } from '../src/chain/demoEngine.js'

test('distance matches the contract vectors', () => {
  assert.equal(distanceMeters(48_856_600, 2_352_200, 48_856_600, 2_352_200), 0)
  assert.equal(distanceMeters(48_856_600, 2_352_200, 48_860_600, 2_337_600), 1156)
  assert.equal(distanceMeters(48_856_600, 2_352_200, 51_507_400, -127_800), 343_602)
  assert.equal(distanceMeters(40_712_800, -74_006_000, 40_758_000, -73_985_500), 5314)
})

test('reward tiers match the contract', () => {
  assert.equal(rewardWholeNotf(0), 25)
  assert.equal(rewardWholeNotf(1000), 25)
  assert.equal(rewardWholeNotf(1001), 15)
  assert.equal(rewardWholeNotf(50_000), 3)
  assert.equal(rewardWholeNotf(50_001), 0)
})

test('commitment hash matches the contract vector', async () => {
  const hash = await commitmentHex(
    'loc-test',
    48_856_600,
    2_352_200,
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  )
  assert.equal(hash, 'b2f86af8d31a55c38dee60ad76e41ae31e3c7ccff1af6916b8e0c399ab4ebb94')
})

test('demo ledger gives three free rounds and then charges 10 NOTF', () => {
  const now = Date.UTC(2026, 10, 14, 12, 0, 0)
  let profile = freshProfile(now)
  assert.equal(profile.balance, STARTER_WHOLE)
  const place = { id: 'paris', lat: 48.8566, lng: 2.3522 }
  const guess = { lat: 48.8566, lng: 2.3522 }

  for (let index = 0; index < FREE_PER_DAY; index += 1) {
    const settled = applyGuess({ profile, place, guess, now })
    assert.equal(settled.fee, 0)
    profile = settled.profile
  }

  const before = profile.balance
  const paid = applyGuess({ profile, place, guess, now: now + 1000 })
  assert.equal(paid.fee, ENTRY_WHOLE)
  assert.equal(paid.profile.balance, before - ENTRY_WHOLE + 25)
  assert.equal(paid.profile.used, FREE_PER_DAY)
  assert.equal(dayKey(now), dayKey(now + 1000))
  assert.equal(toE6(place.lat), 48_856_600)
})
