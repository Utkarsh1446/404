import { clientConfig } from '../config'

let googleMapsPromise

export function loadGoogleMaps() {
  if (!clientConfig.googleMapsApiKey) {
    return Promise.reject(new Error('Missing VITE_GOOGLE_MAPS_API_KEY.'))
  }

  if (window.google?.maps) {
    return Promise.resolve(window.google)
  }

  if (!googleMapsPromise) {
    googleMapsPromise = new Promise((resolve, reject) => {
      const callbackName = `initGoogleMaps${Math.random().toString(36).slice(2)}`
      const script = document.createElement('script')

      const resetLoader = () => {
        googleMapsPromise = undefined
        delete window[callbackName]
        if (window.gm_authFailure === handleAuthFailure) {
          delete window.gm_authFailure
        }
        script.remove()
      }

      const handleAuthFailure = () => {
        resetLoader()
        reject(
          new Error(
            'Google Maps authentication failed. Check billing, enabled APIs, and key referrer restrictions.',
          ),
        )
      }

      window.gm_authFailure = handleAuthFailure
      window[callbackName] = () => {
        resolve(window.google)
        delete window.gm_authFailure
        delete window[callbackName]
      }

      script.src =
        `https://maps.googleapis.com/maps/api/js?key=${clientConfig.googleMapsApiKey}` +
        `&libraries=marker&loading=async&callback=${callbackName}`
      script.async = true
      script.defer = true
      script.onerror = () => {
        resetLoader()
        reject(new Error('Google Maps failed to load.'))
      }
      document.head.appendChild(script)
    })
  }

  return googleMapsPromise
}
