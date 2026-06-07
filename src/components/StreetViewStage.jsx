import { useEffect, useRef, useState } from 'react'
import { clientConfig } from '../config'
import { loadGoogleMaps } from '../lib/googleMaps'

function buildStreetViewFallback(round) {
  if (!round || !clientConfig.googleMapsApiKey) return undefined

  const { lat, lng } = round.panorama.position
  const heading = round.panorama.pov?.heading ?? 0
  const pitch = round.panorama.pov?.pitch ?? 0

  const params = new URLSearchParams({
    key: clientConfig.googleMapsApiKey,
    location: `${lat},${lng}`,
    size: '1600x900',
    heading: String(heading),
    pitch: String(pitch),
    fov: '90',
    source: 'outdoor',
  })

  return `https://maps.googleapis.com/maps/api/streetview?${params.toString()}`
}

export function StreetViewStage({ round }) {
  const containerRef = useRef(null)
  const panoramaRef = useRef(null)
  const [loadState, setLoadState] = useState(
    clientConfig.googleMapsApiKey ? 'loading' : 'missing-key',
  )

  useEffect(() => {
    if (!round || !containerRef.current) return undefined

    let cancelled = false
    let paintTimeoutId
    setLoadState(clientConfig.googleMapsApiKey ? 'loading' : 'missing-key')

    loadGoogleMaps()
      .then((google) => {
        if (cancelled || !containerRef.current) return
        const streetViewService = new google.maps.StreetViewService()

        streetViewService.getPanorama(
          {
            location: round.panorama.position,
            radius: 300,
          },
          (data, streetViewStatus) => {
            if (cancelled) return

            if (streetViewStatus !== 'OK' || !data?.location?.pano) {
              setLoadState('error')
              return
            }

            panoramaRef.current = new google.maps.StreetViewPanorama(containerRef.current, {
              pano: data.location.pano,
              pov: round.panorama.pov,
              zoom: round.panorama.zoom,
              addressControl: false,
              linksControl: true,
              motionTracking: false,
              fullscreenControl: false,
              showRoadLabels: false,
              visible: true,
            })

            const repaint = () => {
              if (!cancelled && panoramaRef.current) {
                google.maps.event.trigger(panoramaRef.current, 'resize')
                panoramaRef.current.setPov(round.panorama.pov)
                panoramaRef.current.setZoom(round.panorama.zoom)
                panoramaRef.current.setVisible(true)
              }
            }

            window.requestAnimationFrame(repaint)
            window.setTimeout(repaint, 120)
            paintTimeoutId = window.setTimeout(repaint, 500)

            setLoadState('ready')
          },
        )
      })
      .catch(() => {
        if (!cancelled) {
          setLoadState('error')
        }
      })

    return () => {
      cancelled = true
      window.clearTimeout(paintTimeoutId)
    }
  }, [round])

  if (!round) {
    return (
      <div className="stage-placeholder">
        <span className="eyebrow">Street view</span>
        <h3>Connect, then launch a round.</h3>
        <p>The active panorama loads only after the server assigns a valid world drop.</p>
      </div>
    )
  }

  if (loadState === 'missing-key') {
    return (
      <div className="stage-placeholder">
        <span className="eyebrow">Maps key needed</span>
        <h3>Add `VITE_GOOGLE_MAPS_API_KEY` to enable Street View.</h3>
        <p>The server round flow is live, but Google Maps requires a browser API key.</p>
      </div>
    )
  }

  if (loadState === 'error') {
    return (
      <div
        className="stage-placeholder"
        style={
          buildStreetViewFallback(round)
            ? { backgroundImage: `url("${buildStreetViewFallback(round)}")` }
            : undefined
        }
      >
        <span className="eyebrow">Load failure</span>
        <h3>Google Maps could not load.</h3>
        <p>Check the key, referrer restrictions, and browser connectivity.</p>
      </div>
    )
  }

  return (
    <div
      className={`street-stage ${loadState === 'ready' ? 'is-ready' : 'is-loading'}`}
      style={
        buildStreetViewFallback(round)
          ? { backgroundImage: `url("${buildStreetViewFallback(round)}")` }
          : undefined
      }
    >
      <div className="stage-overlay">
        <span className="eyebrow">Live round</span>
        <div className="stage-overlay-copy">
          <strong>World mode</strong>
          <span>Pan, zoom, and place one pin on the guess map.</span>
        </div>
      </div>
      <div ref={containerRef} className="street-stage-canvas" />
    </div>
  )
}
