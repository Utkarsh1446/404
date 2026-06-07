export const clientConfig = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8787',
  googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? '',
}

export const uiConfig = {
  rewardThresholdKm: 50,
  roundTimerSeconds: 90,
}
