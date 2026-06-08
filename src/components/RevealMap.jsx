import { useEffect, useRef, useState } from 'react'
import { clientConfig } from '../config'
import { loadGoogleMaps } from '../lib/googleMaps'

export function RevealMap({ revealResult }) {
  const mapNodeRef = useRef(null)
  const mapRef = useRef(null)
  const [loadState, setLoadState] = useState(
    clientConfig.googleMapsApiKey ? 'loading' : 'missing-key',
  )

  useEffect(() => {
    if (!revealResult || !mapNodeRef.current) return undefined

    let cancelled = false

    loadGoogleMaps()
      .then((google) => {
        if (cancelled || !mapNodeRef.current) return

        const guess = revealResult.guess
        const answer = revealResult.answer

        mapRef.current = new google.maps.Map(mapNodeRef.current, {
          center: guess,
          zoom: 3,
          disableDefaultUI: false,
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: false,
          clickableIcons: false,
          gestureHandling: 'greedy',
        })

        const bounds = new google.maps.LatLngBounds()
        bounds.extend(guess)
        bounds.extend(answer)

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

        mapRef.current.fitBounds(bounds, 80)
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
  }, [revealResult])

  if (loadState === 'missing-key') {
    return <div className="reveal-map-placeholder">Reveal map unavailable.</div>
  }

  if (loadState === 'error') {
    return <div className="reveal-map-placeholder">Reveal map failed to load.</div>
  }

  return <div ref={mapNodeRef} className="reveal-map-canvas" />
}
