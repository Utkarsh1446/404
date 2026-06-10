import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { GoArrowUpRight } from 'react-icons/go'
import { HoverButton } from './HoverButton'
import './CardNav.css'

const CardNav = ({
  logo,
  logoAlt = 'Logo',
  items,
  className = '',
  ease = 'power3.out',
  baseColor = '#fff',
  menuColor,
  buttonBgColor = '#111',
  buttonTextColor = 'white',
  ctaLabel = 'Get Started',
  onCtaClick,
  ctaClassName = '',
  onLogoClick,
}) => {
  const [isHamburgerOpen, setIsHamburgerOpen] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const navRef = useRef(null)
  const cardsRef = useRef([])
  const tlRef = useRef(null)

  const calculateHeight = useCallback(() => {
    const navEl = navRef.current
    if (!navEl) return 260

    const isMobile = window.matchMedia('(max-width: 768px)').matches
    if (isMobile) {
      const contentEl = navEl.querySelector('.card-nav-content')
      if (contentEl) {
        const wasVisible = contentEl.style.visibility
        const wasPointerEvents = contentEl.style.pointerEvents
        const wasPosition = contentEl.style.position
        const wasHeight = contentEl.style.height

        contentEl.style.visibility = 'visible'
        contentEl.style.pointerEvents = 'auto'
        contentEl.style.position = 'static'
        contentEl.style.height = 'auto'

        contentEl.offsetHeight

        const topBar = 60
        const padding = 16
        const contentHeight = contentEl.scrollHeight

        contentEl.style.visibility = wasVisible
        contentEl.style.pointerEvents = wasPointerEvents
        contentEl.style.position = wasPosition
        contentEl.style.height = wasHeight

        return topBar + contentHeight + padding
      }
    }
    return 260
  }, [])

  const createTimeline = useCallback(() => {
    const navEl = navRef.current
    if (!navEl) return null

    gsap.set(navEl, { height: 60, overflow: 'hidden' })
    gsap.set(cardsRef.current, { y: 50, opacity: 0 })

    const timeline = gsap.timeline({ paused: true })

    timeline.to(navEl, {
      height: calculateHeight,
      duration: 0.4,
      ease,
    })

    timeline.to(cardsRef.current, {
      y: 0,
      opacity: 1,
      duration: 0.4,
      ease,
      stagger: 0.08,
    }, '-=0.1')

    return timeline
  }, [calculateHeight, ease])

  useLayoutEffect(() => {
    const timeline = createTimeline()
    tlRef.current = timeline

    return () => {
      timeline?.kill()
      tlRef.current = null
    }
  }, [createTimeline, items])

  useLayoutEffect(() => {
    const handleResize = () => {
      if (!tlRef.current) return

      if (isExpanded) {
        const newHeight = calculateHeight()
        gsap.set(navRef.current, { height: newHeight })

        tlRef.current.kill()
        const newTl = createTimeline()
        if (newTl) {
          newTl.progress(1)
          tlRef.current = newTl
        }
      } else {
        tlRef.current.kill()
        const newTl = createTimeline()
        if (newTl) {
          tlRef.current = newTl
        }
      }
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [calculateHeight, createTimeline, isExpanded, items])

  const toggleMenu = () => {
    const timeline = tlRef.current
    if (!timeline) return

    if (!isExpanded) {
      setIsHamburgerOpen(true)
      setIsExpanded(true)
      timeline.play(0)
    } else {
      setIsHamburgerOpen(false)
      timeline.eventCallback('onReverseComplete', () => setIsExpanded(false))
      timeline.reverse()
    }
  }

  const setCardRef = (i) => (element) => {
    if (element) cardsRef.current[i] = element
  }

  return (
    <div className={`card-nav-container ${className}`}>
      <nav
        ref={navRef}
        className={`card-nav ${isExpanded ? 'open' : ''}`}
        style={{ backgroundColor: baseColor }}
      >
        <div className="card-nav-top">
          <HoverButton
            type="button"
            className={`hamburger-menu ${isHamburgerOpen ? 'open' : ''}`}
            onClick={toggleMenu}
            aria-label={isExpanded ? 'Close menu' : 'Open menu'}
            style={{ color: menuColor || '#000' }}
          >
            <span className="hamburger-line" />
            <span className="hamburger-line" />
          </HoverButton>

          <button
            className="logo-container"
            type="button"
            aria-label="Go to homepage"
            onClick={onLogoClick}
          >
            <img src={logo} alt={logoAlt} className="logo" />
          </button>

          <HoverButton
            type="button"
            className={`card-nav-cta-button ${ctaClassName}`.trim()}
            style={{ backgroundColor: buttonBgColor, color: buttonTextColor }}
            onClick={onCtaClick}
          >
            {ctaLabel}
          </HoverButton>
        </div>

        <div className="card-nav-content" aria-hidden={!isExpanded}>
          {(items || []).slice(0, 4).map((item, idx) => (
            <div
              key={`${item.label}-${idx}`}
              className="nav-card"
              ref={setCardRef(idx)}
              style={{ backgroundColor: item.bgColor, color: item.textColor }}
              onClick={item.onClick}
              role={item.onClick ? 'button' : undefined}
              tabIndex={item.onClick ? 0 : undefined}
              onKeyDown={(event) => {
                if (!item.onClick) return
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  item.onClick(event)
                }
              }}
            >
              <div className="nav-card-label">{item.label}</div>
              <div className="nav-card-links">
                {item.links?.map((lnk, index) => (
                  <a
                    key={`${lnk.label}-${index}`}
                    className="nav-card-link"
                    href={lnk.href}
                    aria-label={lnk.ariaLabel}
                    onClick={(event) => {
                      if (lnk.onClick) {
                        event.preventDefault()
                        lnk.onClick(event)
                      }
                    }}
                  >
                    <GoArrowUpRight className="nav-card-link-icon" aria-hidden="true" />
                    {lnk.label}
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      </nav>
    </div>
  )
}

export default CardNav
