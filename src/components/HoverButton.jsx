import { forwardRef, useCallback, useEffect, useRef, useState } from 'react'

function mergeRefs(...refs) {
  return (node) => {
    refs.forEach((ref) => {
      if (!ref) return
      if (typeof ref === 'function') {
        ref(node)
        return
      }
      ref.current = node
    })
  }
}

export const HoverButton = forwardRef(function HoverButton(
  {
    className = '',
    children,
    onMouseEnter,
    onMouseLeave,
    onMouseMove,
    onPointerEnter,
    onPointerLeave,
    onPointerMove,
    style,
    ...props
  },
  ref,
) {
  const buttonRef = useRef(null)
  const [isListening, setIsListening] = useState(false)
  const [circles, setCircles] = useState([])
  const lastAddedRef = useRef(0)
  const scheduledCircleIdsRef = useRef(new Set())
  const circleTimeoutIdsRef = useRef([])

  const createCircle = useCallback((x, y) => {
    const buttonWidth = buttonRef.current?.offsetWidth || 1
    const xPos = Math.max(0, Math.min(1, x / buttonWidth))
    const color = `linear-gradient(to right, var(--circle-start) ${xPos * 100}%, var(--circle-end) ${xPos * 100}%)`

    setCircles((current) => [
      ...current,
      { id: `${Date.now()}-${Math.random()}`, x, y, color, fadeState: null },
    ])
  }, [])

  function handlePointerEnter(event) {
    setIsListening(true)
    onPointerEnter?.(event)
  }

  function handlePointerLeave(event) {
    setIsListening(false)
    onPointerLeave?.(event)
  }

  function handlePointerMove(event) {
    if (isListening) {
      const currentTime = Date.now()
      if (currentTime - lastAddedRef.current > 100) {
        lastAddedRef.current = currentTime
        const rect = event.currentTarget.getBoundingClientRect()
        createCircle(event.clientX - rect.left, event.clientY - rect.top)
      }
    }

    onPointerMove?.(event)
  }

  function handleMouseEnter(event) {
    setIsListening(true)
    onMouseEnter?.(event)
  }

  function handleMouseLeave(event) {
    setIsListening(false)
    onMouseLeave?.(event)
  }

  function handleMouseMove(event) {
    if (isListening) {
      const currentTime = Date.now()
      if (currentTime - lastAddedRef.current > 100) {
        lastAddedRef.current = currentTime
        const rect = event.currentTarget.getBoundingClientRect()
        createCircle(event.clientX - rect.left, event.clientY - rect.top)
      }
    }

    onMouseMove?.(event)
  }

  useEffect(() => {
    circles.forEach((circle) => {
      if (scheduledCircleIdsRef.current.has(circle.id)) return
      scheduledCircleIdsRef.current.add(circle.id)

      const fadeIn = window.setTimeout(() => {
        setCircles((current) =>
          current.map((entry) =>
            entry.id === circle.id ? { ...entry, fadeState: 'in' } : entry,
          ),
        )
      }, 0)

      const fadeOut = window.setTimeout(() => {
        setCircles((current) =>
          current.map((entry) =>
            entry.id === circle.id ? { ...entry, fadeState: 'out' } : entry,
          ),
        )
      }, 1000)

      const remove = window.setTimeout(() => {
        setCircles((current) => current.filter((entry) => entry.id !== circle.id))
        scheduledCircleIdsRef.current.delete(circle.id)
      }, 2200)

      circleTimeoutIdsRef.current.push(fadeIn, fadeOut, remove)
    })
  }, [circles])

  useEffect(() => {
    const circleTimeoutIds = circleTimeoutIdsRef.current
    const scheduledCircleIds = scheduledCircleIdsRef.current

    return () => {
      circleTimeoutIds.forEach((id) => window.clearTimeout(id))
      circleTimeoutIdsRef.current = []
      scheduledCircleIds.clear()
    }
  }, [])

  return (
    <button
      ref={mergeRefs(buttonRef, ref)}
      className={`hover-button ${className}`.trim()}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onPointerMove={handlePointerMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseMove={handleMouseMove}
      style={{
        '--circle-start': 'var(--hover-button-circle-start, #a0d9f8)',
        '--circle-end': 'var(--hover-button-circle-end, #3a5bbf)',
        ...style,
      }}
      {...props}
    >
      {circles.map(({ id, x, y, color, fadeState }) => (
        <span
          className={`hover-button-circle ${fadeState ? `is-${fadeState}` : ''}`}
          key={id}
          style={{ left: x, top: y, background: color }}
          aria-hidden="true"
        />
      ))}
      <span className="hover-button-content">{children}</span>
    </button>
  )
})
