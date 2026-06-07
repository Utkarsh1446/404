export function formatWallet(address) {
  return `${address.slice(0, 4)}...${address.slice(-4)}`
}

export function formatDistance(distanceKm) {
  return `${distanceKm.toFixed(1)} km`
}
