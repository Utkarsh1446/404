const PI_E9 = 3141592654n
const SCALE = 1000000000n
const DENS = [2n, 12n, 30n, 56n, 90n, 132n]

export const REWARD_THRESHOLD_M = 50_000
export const STARTER_WHOLE = 100
export const ENTRY_WHOLE = 10
export const FREE_PER_DAY = 3
export const TOKEN_DECIMALS = 18

export function toE6(value) {
  return Math.round(Number(value) * 1_000_000)
}

export function fromE6(value) {
  return Number(value) / 1_000_000
}

export function commitmentPayload(locationId, latE6, lngE6, saltHex) {
  return `notfound-v1|${locationId}|${latE6}|${lngE6}|${saltHex}`
}

export async function commitmentHex(locationId, latE6, lngE6, saltHex) {
  const payload = commitmentPayload(locationId, latE6, lngE6, saltHex)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function cosScaled(degE6) {
  let x = (BigInt(degE6) * PI_E9) / 180_000_000n
  if (x < 0n) x = -x
  const x2 = (x * x) / SCALE
  let term = SCALE
  let sum = term
  let sign = -1n
  for (const denominator of DENS) {
    term = (term * x2) / SCALE / denominator
    sum += sign * term
    sign = -sign
  }
  return sum
}

function isqrt(value) {
  if (value <= 0n) return 0n
  let x = value
  let y = (x + 1n) / 2n
  while (y < x) {
    x = y
    y = (x + value / x) / 2n
  }
  return x
}

export function distanceMeters(lat1E6, lng1E6, lat2E6, lng2E6) {
  const mean = Number((BigInt(lat1E6) + BigInt(lat2E6)) / 2n)
  const cos = cosScaled(mean)
  const dLat = BigInt(lat2E6) - BigInt(lat1E6)
  const dLng = BigInt(lng2E6) - BigInt(lng1E6)
  const north = (dLat * 1111949266n) / 10_000_000_000n
  const east = (((dLng * cos) / SCALE) * 1111949266n) / 10_000_000_000n
  const northAbs = north < 0n ? -north : north
  const eastAbs = east < 0n ? -east : east
  return Number(isqrt(northAbs * northAbs + eastAbs * eastAbs))
}

export function rewardWholeNotf(distanceM) {
  if (distanceM <= 1_000) return 25
  if (distanceM <= 10_000) return 15
  if (distanceM <= 25_000) return 8
  if (distanceM <= REWARD_THRESHOLD_M) return 3
  return 0
}

export function wholeToRaw(whole) {
  return BigInt(whole) * 10n ** BigInt(TOKEN_DECIMALS)
}

export function formatWhole(raw) {
  const value = BigInt(raw)
  const scale = 10n ** BigInt(TOKEN_DECIMALS)
  const sign = value < 0n ? '-' : ''
  const abs = value < 0n ? -value : value
  const whole = abs / scale
  const fraction = (abs % scale) / 10n ** BigInt(TOKEN_DECIMALS - 2)
  return `${sign}${whole}.${fraction.toString().padStart(2, '0')}`
}

export function dayKey(timestamp = Date.now()) {
  return Math.floor(timestamp / 86_400_000)
}
