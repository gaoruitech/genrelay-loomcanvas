import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { contentSecurityPolicy } from './csp.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))

/**
 * Where the library build really is. `"loomcanvas-web": "file:../../web"` makes npm LINK the folder,
 * so the files the dev server has to read are outside this project (in ../../web/dist-lib, or wherever
 * you pointed `file:` at). A package installed from an `npm pack` tarball is a real folder inside
 * node_modules and needs nothing.
 */
function libraryBuild(): string {
  try {
    return path.join(fs.realpathSync(path.join(here, 'node_modules/loomcanvas-web')), 'dist-lib')
  } catch {
    return path.resolve(here, '../../web/dist-lib')
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ['VITE_', 'PORT'])
  const api = env.VITE_LC_API || 'http://127.0.0.1:3000/api'
  const port = Number(env.PORT) || undefined
  return {
    // Relative asset addresses: the build works from any folder (examples/serve.mjs serves it under /react-host/).
    base: './',
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: port || 5173,
      strictPort: true,
      fs: { allow: [here, libraryBuild()] },
    },
    preview: {
      host: '127.0.0.1',
      port: port || 4174,
      strictPort: true,
      // The production build is served with a strict policy (the dev server is not: React's
      // fast refresh injects an inline script).
      headers: { 'Content-Security-Policy': contentSecurityPolicy(api) },
    },
    // The editor is one file of about 2 MB before gzip (docs/integration.md, "Limits").
    build: { chunkSizeWarningLimit: 2500 },
  }
})
