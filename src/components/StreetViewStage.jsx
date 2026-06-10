import { useEffect, useMemo, useRef, useState } from 'react'
import { clientConfig } from '../config'
import { loadGoogleMaps } from '../lib/googleMaps'

function buildStreetViewImage(panoramaConfig) {
  if (!panoramaConfig?.position || !clientConfig.googleMapsApiKey) return undefined

  const { lat, lng } = panoramaConfig.position
  const heading = panoramaConfig.pov?.heading ?? 0
  const pitch = panoramaConfig.pov?.pitch ?? 0

  const params = new URLSearchParams({
    key: clientConfig.googleMapsApiKey,
    size: '1600x900',
    heading: String(heading),
    pitch: String(pitch),
    fov: '90',
  })

  if (panoramaConfig.panoId) {
    params.set('pano', panoramaConfig.panoId)
  } else {
    params.set('location', `${lat},${lng}`)
    params.set('source', 'outdoor')
  }

  return `https://maps.googleapis.com/maps/api/streetview?${params.toString()}`
}

export function StreetViewStage({ round }) {
  const containerRef = useRef(null)
  const panoramaRef = useRef(null)
  const [loadState, setLoadState] = useState(
    clientConfig.googleMapsApiKey ? 'loading' : 'missing-key',
  )
  const roundId = round?.roundId
  const panoId = round?.panorama?.panoId
  const lat = round?.panorama?.position?.lat
  const lng = round?.panorama?.position?.lng
  const heading = round?.panorama?.pov?.heading
  const pitch = round?.panorama?.pov?.pitch
  const zoom = round?.panorama?.zoom
  const panoramaConfig = useMemo(() => {
    if (lat == null || lng == null) return null

    return {
      roundId,
      position: {
        lat,
        lng,
      },
      panoId,
      pov: {
        heading,
        pitch,
      },
      zoom,
    }
  }, [heading, lat, lng, panoId, pitch, roundId, zoom])
  const hasValidPanorama = Boolean(panoramaConfig?.position)
  const imageUrl = buildStreetViewImage(panoramaConfig)

  useEffect(() => {
    if (!hasValidPanorama || !containerRef.current || !clientConfig.googleMapsApiKey) {
      return undefined
    }

    let cancelled = false
    let fallbackTimeoutId
    let panoramaListeners = []

    setLoadState('loading')

    loadGoogleMaps()
      .then((google) => {
        if (cancelled || !containerRef.current) return

        const service = new google.maps.StreetViewService()

        const mountPanorama = (panoramaOptions) => {
          if (cancelled || !containerRef.current) return

          panoramaRef.current = new google.maps.StreetViewPanorama(containerRef.current, {
            ...panoramaOptions,
            pov: panoramaConfig.pov,
            zoom: panoramaConfig.zoom,
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
          let hasFinalizedReady = false

          const finalizeReady = () => {
            if (cancelled || !panorama) return
            const panoValue = panorama.getPano?.()
            const positionValue = panorama.getPosition?.()
            if (panoValue && positionValue) {
              setLoadState('ready')
              google.maps.event.trigger(panorama, 'resize')
              if (!hasFinalizedReady) {
                panorama.setPov(panoramaConfig.pov)
                panorama.setZoom(panoramaConfig.zoom)
                hasFinalizedReady = true
              }
              window.clearTimeout(fallbackTimeoutId)
            }
          }

          const finalizeFallback = () => {
            if (cancelled || !panorama) return
            const statusValue = panorama.getStatus?.()
            const panoValue = panorama.getPano?.()
            if (statusValue === google.maps.StreetViewStatus.ZERO_RESULTS || !panoValue) {
              panorama.setVisible?.(false)
              setLoadState('fallback')
            }
          }

          panoramaListeners = [
            panorama.addListener('pano_changed', finalizeReady),
            panorama.addListener('position_changed', finalizeReady),
            panorama.addListener('links_changed', finalizeReady),
            panorama.addListener('status_changed', finalizeFallback),
          ]

          fallbackTimeoutId = window.setTimeout(() => {
            if (cancelled) return
            const panoValue = panorama.getPano?.()
            if (!panoValue) {
              panorama.setVisible?.(false)
              setLoadState('fallback')
            }
          }, 3000)
        }

        const panoramaRequests = [
          ...(panoramaConfig.panoId
            ? [
                {
                  pano: panoramaConfig.panoId,
                },
              ]
            : []),
          {
            location: panoramaConfig.position,
            radius: 250,
            source: google.maps.StreetViewSource.OUTDOOR,
            preference: google.maps.StreetViewPreference.BEST,
          },
          {
            location: panoramaConfig.position,
            radius: 1500,
            source: google.maps.StreetViewSource.OUTDOOR,
            preference: google.maps.StreetViewPreference.BEST,
          },
          {
            location: panoramaConfig.position,
            radius: 3500,
            preference: google.maps.StreetViewPreference.BEST,
          },
        ]

        const findPanorama = (requestIndex = 0) => {
          if (cancelled) return

          if (requestIndex >= panoramaRequests.length) {
            setLoadState('fallback')
            return
          }

          service.getPanorama(panoramaRequests[requestIndex], (data, status) => {
            if (cancelled) return

            if (status === google.maps.StreetViewStatus.OK && data?.location?.pano) {
              mountPanorama({
                pano: data.location.pano,
                position: data.location.latLng ?? panoramaConfig.position,
              })
              return
            }

            findPanorama(requestIndex + 1)
          })
        }

        findPanorama()
      })
      .catch(() => {
        if (!cancelled) {
          setLoadState('fallback')
        }
      })

    return () => {
      cancelled = true
      window.clearTimeout(fallbackTimeoutId)
      panoramaListeners.forEach((listener) => listener?.remove?.())
    }
  }, [hasValidPanorama, panoramaConfig])

  if (!round) {
    return (
      <div className="stage-placeholder">
        <span className="eyebrow">Street view</span>
        <h3>Connect, then launch a round.</h3>
        <p>The active panorama loads only after the server assigns a valid round location.</p>
      </div>
    )
  }

  if (!hasValidPanorama) {
    return (
      <div className="stage-placeholder">
        <h3>Location data is incomplete.</h3>
        <p>This round did not include a valid panorama payload. Start a fresh round.</p>
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
