import { forwardRef } from 'react'

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
  function handlePointerEnter(event) {
    onPointerEnter?.(event)
  }

  function handlePointerLeave(event) {
    onPointerLeave?.(event)
  }

  function handlePointerMove(event) {
    onPointerMove?.(event)
  }

  function handleMouseEnter(event) {
    onMouseEnter?.(event)
  }

  function handleMouseLeave(event) {
    onMouseLeave?.(event)
  }

  function handleMouseMove(event) {
    onMouseMove?.(event)
  }

  return (
    <button
      ref={mergeRefs(ref)}
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
      <span className="hover-button-content">{children}</span>
    </button>
  )
})
