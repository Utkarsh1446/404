import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './chain/chain.css'
import ChainApp from './chain/ChainApp.jsx'
import LegacyApp from './LegacyApp.jsx'

const legacy = new URLSearchParams(window.location.search).has('legacy')

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {legacy ? (
      <Suspense fallback={null}>
        <LegacyApp />
      </Suspense>
    ) : (
      <ChainApp />
    )}
  </StrictMode>,
)
