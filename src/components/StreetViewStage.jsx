import { useEffect, useRef, useState } from 'react'
import { clientConfig } from '../config'
import { loadGoogleMaps } from '../lib/googleMaps'

function buildStreetViewImage(round) {
  if (!round || !clientConfig.googleMapsApiKey) return undefined

  const { lat, lng } = round.panorama.position
  const heading = round.panorama.pov?.heading ?? 0
  const pitch = round.panorama.pov?.pitch ?? 0

  const params = new URLSearchParams({
    key: clientConfig.googleMapsApiKey,
    size: '1600x900',
    heading: String(heading),
    pitch: String(pitch),
    fov: '90',
    source: 'outdoor',
  })

  if (round.panorama.panoId) {
    params.set('pano', round.panorama.panoId)
  } else {
    params.set('location', `${lat},${lng}`)
  }

  return `https://maps.googleapis.com/maps/api/streetview?${params.toString()}`
}

export function StreetViewStage({ round }) {
  const containerRef = useRef(null)
  const panoramaRef = useRef(null)
  const [loadState, setLoadState] = useState(
    clientConfig.googleMapsApiKey ? 'loading' : 'missing-key',
  )

  useEffect(() => {
    if (!round || !containerRef.current || !clientConfig.googleMapsApiKey) {
      return undefined
    }

    let cancelled = false
    let fallbackTimeoutId

    setLoadState('loading')

    loadGoogleMaps()
      .then((google) => {
        if (cancelled || !containerRef.current) return

        panoramaRef.current = new google.maps.StreetViewPanorama(containerRef.current, {
          pano: round.panorama.panoId,
          position: round.panorama.position,
          pov: round.panorama.pov,
          zoom: round.panorama.zoom,
          addressControl: false,
          fullscreenControl: false,
          motionTracking: false,
          motionTrackingControl: false,
          showRoadLabels: false,
          linksControl: true,
          clickToGo: true,
          scrollwheel: true,
          disableDefaultUI: false,
          visible: true,
        })

        const panorama = panoramaRef.current

        const finalizeReady = () => {
          if (cancelled || !panorama) return
          const panoValue = panorama.getPano?.()
          if (panoValue) {
            setLoadState('ready')
            google.maps.event.trigger(panorama, 'resize')
            panorama.setPov(round.panorama.pov)
            panorama.setZoom(round.panorama.zoom)
          }
        }

        panorama.addListener('pano_changed', finalizeReady)
        panorama.addListener('position_changed', finalizeReady)

        if (round.panorama.panoId) {
          panorama.setPano(round.panorama.panoId)
        } else {
          panorama.setPosition(round.panorama.position)
        }

        fallbackTimeoutId = window.setTimeout(() => {
          if (cancelled) return
          const panoValue = panorama.getPano?.()
          if (!panoValue) {
            setLoadState('fallback')
          }
        }, 2500)
      })
      .catch(() => {
        if (!cancelled) {
          setLoadState('fallback')
        }
      })

    return () => {
      cancelled = true
      window.clearTimeout(fallbackTimeoutId)
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

  const imageUrl = buildStreetViewImage(round)

  return (
    <div className={`street-stage ${loadState === 'fallback' ? 'is-fallback' : ''}`}>
      {loadState === 'fallback' ? (
        <img
          key={`${round.roundId}-${imageUrl}`}
          className="street-stage-image"
          src={imageUrl}
          alt="Street View fallback"
          draggable="false"
        />
      ) : null}
      <div
        ref={containerRef}
        className={`street-stage-canvas ${loadState === 'ready' ? 'is-visible' : ''}`}
      />
    </div>
  )
}
