import { useEffect, useRef, useState } from 'react'
import { clientConfig } from '../config'
import { loadGoogleMaps } from '../lib/googleMaps'

export function GuessMap({
  selectedGuess,
  onSelectGuess,
  disabled,
  isExpanded,
  onRequestExpand,
}) {
  const mapNodeRef = useRef(null)
  const mapRef = useRef(null)
  const markerRef = useRef(null)
  const googleRef = useRef(null)
  const disabledRef = useRef(disabled)
  const expandedRef = useRef(isExpanded)
  const onSelectGuessRef = useRef(onSelectGuess)
  const onRequestExpandRef = useRef(onRequestExpand)
  const [loadState, setLoadState] = useState(
    clientConfig.googleMapsApiKey ? 'loading' : 'missing-key',
  )

  useEffect(() => {
    disabledRef.current = disabled
  }, [disabled])

  useEffect(() => {
    expandedRef.current = isExpanded
  }, [isExpanded])

  useEffect(() => {
    onSelectGuessRef.current = onSelectGuess
  }, [onSelectGuess])

  useEffect(() => {
    onRequestExpandRef.current = onRequestExpand
  }, [onRequestExpand])

  useEffect(() => {
    if (!mapNodeRef.current || mapRef.current) return undefined

    let listener
    let cancelled = false

    loadGoogleMaps()
      .then((google) => {
        if (cancelled || !mapNodeRef.current) return
        googleRef.current = google

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
          if (disabledRef.current) return
          if (!expandedRef.current) {
            onRequestExpandRef.current?.()
            return
          }

          const nextGuess = {
            lat: event.latLng.lat(),
            lng: event.latLng.lng(),
          }

          if (!markerRef.current) {
            markerRef.current = new google.maps.Marker({
              map: mapRef.current,
              position: nextGuess,
              icon: {
                path: google.maps.SymbolPath.CIRCLE,
                fillColor: '#dc2626',
                fillOpacity: 1,
                strokeColor: '#ffffff',
                strokeWeight: 2,
                scale: 8,
              },
            })
          } else {
            markerRef.current.setPosition(nextGuess)
          }

          onSelectGuessRef.current?.(nextGuess)
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
  }, [])

  useEffect(() => {
    if (!mapRef.current || !googleRef.current) return

    const currentCenter = selectedGuess ?? mapRef.current.getCenter?.()?.toJSON?.() ?? { lat: 18, lng: 0 }
    const currentZoom = mapRef.current.getZoom?.() ?? 1

    window.requestAnimationFrame(() => {
      if (!mapRef.current || !googleRef.current) return
      googleRef.current.maps.event.trigger(mapRef.current, 'resize')
      mapRef.current.setCenter(currentCenter)
      mapRef.current.setZoom(currentZoom)
    })
  }, [isExpanded, selectedGuess])

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

  return (
    <div
      ref={mapNodeRef}
      className={`guess-map-canvas ${isExpanded ? 'is-expanded' : 'is-collapsed'}`}
    />
  )
}
