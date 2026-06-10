import { useCallback, useLayoutEffect, useRef, useState } from 'react'
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
  const [expandedHeight, setExpandedHeight] = useState(260)
  const navRef = useRef(null)

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

  useLayoutEffect(() => {
    const handleResize = () => {
      if (isExpanded) {
        setExpandedHeight(calculateHeight())
      }
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [calculateHeight, isExpanded])

  const toggleMenu = () => {
    if (!isExpanded) {
      setExpandedHeight(calculateHeight())
      setIsHamburgerOpen(true)
      setIsExpanded(true)
    } else {
      setIsHamburgerOpen(false)
      setIsExpanded(false)
    }
  }

  return (
    <div className={`card-nav-container ${className}`}>
      <nav
        ref={navRef}
        className={`card-nav ${isExpanded ? 'open' : ''}`}
        style={{
          backgroundColor: baseColor,
          height: isExpanded ? expandedHeight : 60,
          transitionTimingFunction: ease.includes('expo') ? 'cubic-bezier(0.16, 1, 0.3, 1)' : undefined,
        }}
      >
        <div className="card-nav-top">
          <button
            type="button"
            className={`hamburger-menu ${isHamburgerOpen ? 'open' : ''}`}
            onClick={toggleMenu}
            aria-label={isExpanded ? 'Close menu' : 'Open menu'}
            style={{ color: menuColor || '#000' }}
          >
            <span className="hamburger-line" />
            <span className="hamburger-line" />
          </button>

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
              style={{
                '--nav-card-index': idx,
                backgroundColor: item.bgColor,
                color: item.textColor,
              }}
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
