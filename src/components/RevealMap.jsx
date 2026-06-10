import { useEffect, useRef, useState } from 'react'
import { clientConfig } from '../config'
import { loadGoogleMaps } from '../lib/googleMaps'

export function RevealMap({ revealResult }) {
  const mapNodeRef = useRef(null)
  const mapRef = useRef(null)
  const [loadState, setLoadState] = useState(
    clientConfig.googleMapsApiKey ? 'loading' : 'missing-key',
  )
  const guessLat = revealResult?.guess?.lat
  const guessLng = revealResult?.guess?.lng
  const answerLat = revealResult?.answer?.lat
  const answerLng = revealResult?.answer?.lng

  useEffect(() => {
    if (
      answerLat == null ||
      answerLng == null ||
      !mapNodeRef.current
    ) {
      return undefined
    }

    let cancelled = false
    setLoadState('loading')
    mapRef.current = null
    mapNodeRef.current.replaceChildren()

    loadGoogleMaps()
      .then((google) => {
        if (cancelled || !mapNodeRef.current) return

        const answer = { lat: answerLat, lng: answerLng }
        const guess = guessLat == null || guessLng == null ? null : { lat: guessLat, lng: guessLng }

        mapRef.current = new google.maps.Map(mapNodeRef.current, {
          center: guess ?? answer,
          zoom: guess ? 3 : 6,
          disableDefaultUI: false,
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: false,
          clickableIcons: false,
          gestureHandling: 'greedy',
        })

        const bounds = new google.maps.LatLngBounds()
        if (guess) bounds.extend(guess)
        bounds.extend(answer)

        if (guess) {
          new google.maps.Marker({
            map: mapRef.current,
            position: guess,
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              fillColor: '#dc2626',
              fillOpacity: 1,
              strokeColor: '#ffffff',
              strokeWeight: 3,
              scale: 10,
            },
          })
        }

        new google.maps.Marker({
          map: mapRef.current,
          position: answer,
          icon: {
            path: google.maps.SymbolPath.BACKWARD_CLOSED_ARROW,
            fillColor: '#facc15',
            fillOpacity: 1,
            strokeColor: '#111111',
            strokeWeight: 2,
            scale: 6,
          },
        })

        if (guess) {
          new google.maps.Polyline({
            map: mapRef.current,
            path: [guess, answer],
            strokeColor: '#111111',
            strokeOpacity: 0,
            icons: [
              {
                icon: {
                  path: 'M 0,-1 0,1',
                  strokeOpacity: 1,
                  strokeWeight: 3,
                  scale: 4,
                },
                offset: '0',
                repeat: '14px',
              },
            ],
          })
        }

        if (guess) {
          mapRef.current.fitBounds(bounds, 80)
        }
        setLoadState('ready')
      })
      .catch(() => {
        if (!cancelled) {
          setLoadState('error')
        }
      })

    return () => {
      cancelled = true
    }
  }, [answerLat, answerLng, guessLat, guessLng])

  if (loadState === 'missing-key') {
    return <div className="reveal-map-placeholder">Reveal map unavailable.</div>
  }

  if (loadState === 'error') {
    return <div className="reveal-map-placeholder">Reveal map failed to load.</div>
  }

  return <div ref={mapNodeRef} className="reveal-map-canvas" />
}
