import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { setRouteCacheBackend } from './lib/routing'
import { indexedDbRouteCache } from './store/storage'

setRouteCacheBackend(indexedDbRouteCache)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
