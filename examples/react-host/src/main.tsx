import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// The editor's stylesheet is required; the fonts are optional (system fonts are used without them).
import 'loomcanvas-web/editor.css'
import 'loomcanvas-web/fonts.css'
import './host.css'
import { App } from './App'

// StrictMode mounts, unmounts and mounts every component again in development: the editor
// component has to survive that, which is why the example keeps it on.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
