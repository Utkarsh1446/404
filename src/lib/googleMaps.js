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
      window.gm_authFailure = () => {
        reject(
          new Error(
            'Google Maps authentication failed. Check billing, enabled APIs, and key referrer restrictions.',
          ),
        )
      }
      window[callbackName] = () => {
        resolve(window.google)
        delete window[callbackName]
      }

      const script = document.createElement('script')
      script.src =
        `https://maps.googleapis.com/maps/api/js?key=${clientConfig.googleMapsApiKey}` +
        `&libraries=marker&loading=async&callback=${callbackName}`
      script.async = true
      script.defer = true
      script.onerror = () => {
        reject(new Error('Google Maps failed to load.'))
        delete window[callbackName]
      }
      document.head.appendChild(script)
    })
  }

  return googleMapsPromise
}
