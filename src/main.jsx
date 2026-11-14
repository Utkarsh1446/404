import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './chain/chain.css'
import App from './App.jsx'
import ChainApp from './chain/ChainApp.jsx'

const legacy = new URLSearchParams(window.location.search).has('legacy')

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {legacy ? <App /> : <ChainApp />}
  </StrictMode>,
)
