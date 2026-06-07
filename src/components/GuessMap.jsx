import { useEffect, useRef, useState } from 'react'
import { clientConfig } from '../config'
import { loadGoogleMaps } from '../lib/googleMaps'

export function GuessMap({ selectedGuess, onSelectGuess, disabled }) {
  const mapNodeRef = useRef(null)
  const mapRef = useRef(null)
  const markerRef = useRef(null)
  const [loadState, setLoadState] = useState(
    clientConfig.googleMapsApiKey ? 'loading' : 'missing-key',
  )

  useEffect(() => {
    if (!mapNodeRef.current) return undefined

    let listener
    let cancelled = false

    loadGoogleMaps()
      .then((google) => {
        if (cancelled || !mapNodeRef.current) return

        mapRef.current = new google.maps.Map(mapNodeRef.current, {
          center: { lat: 18, lng: 0 },
          zoom: 1,
          disableDefaultUI: true,
          zoomControl: true,
          zoomControlOptions: {
            position: google.maps.ControlPosition.LEFT_TOP,
          },
          gestureHandling: 'greedy',
          minZoom: 1,
          mapTypeId: 'roadmap',
          ...(google.maps.RenderingType
            ? { renderingType: google.maps.RenderingType.RASTER }
            : {}),
          styles: [
            { elementType: 'geometry', stylers: [{ color: '#eef4ff' }] },
            { elementType: 'labels.text.fill', stylers: [{ color: '#34475b' }] },
            { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#cae8ff' }] },
          ],
        })

        const initialCenter = { lat: 18, lng: 0 }

        window.requestAnimationFrame(() => {
          if (!cancelled && mapRef.current) {
            google.maps.event.trigger(mapRef.current, 'resize')
            mapRef.current.setCenter(initialCenter)
            mapRef.current.setZoom(1)
          }
        })

        window.setTimeout(() => {
          if (!cancelled && mapRef.current) {
            google.maps.event.trigger(mapRef.current, 'resize')
            mapRef.current.setCenter(initialCenter)
            mapRef.current.setZoom(1)
          }
        }, 120)

        listener = mapRef.current.addListener('click', (event) => {
          if (disabled) return

          const nextGuess = {
            lat: event.latLng.lat(),
            lng: event.latLng.lng(),
          }

          if (!markerRef.current) {
            markerRef.current = new google.maps.Marker({
              map: mapRef.current,
              position: nextGuess,
            })
          } else {
            markerRef.current.setPosition(nextGuess)
          }

          onSelectGuess(nextGuess)
        })

        setLoadState('ready')
      })
      .catch(() => {
        if (!cancelled) setLoadState('error')
      })

    return () => {
      cancelled = true
      if (listener) listener.remove()
    }
  }, [disabled, onSelectGuess])

  useEffect(() => {
    if (!selectedGuess || !markerRef.current) return

    markerRef.current.setPosition(selectedGuess)
    mapRef.current?.panTo(selectedGuess)
  }, [selectedGuess])

  if (loadState === 'missing-key') {
    return (
      <div className="map-placeholder">
        <strong>Guess map unavailable</strong>
        <p>Add `VITE_GOOGLE_MAPS_API_KEY` to enable world pin placement.</p>
      </div>
    )
  }

  if (loadState === 'error') {
    return (
      <div className="map-placeholder">
        <strong>Map load failed</strong>
        <p>Verify the Google Maps browser key and allowed referrers.</p>
      </div>
    )
  }

  return <div ref={mapNodeRef} className="guess-map-canvas" />
}
