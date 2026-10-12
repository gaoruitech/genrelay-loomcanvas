/**
 * The ready-made adapter for the stock LoomCanvas server API (docs/api.md). Public API.
 */
import { createApi, createHttpClient } from '@/utils/api'
import { originOf } from './runtime'
import { httpAdapterOver } from './httpAdapterCore'
import type { EditorAdapter, HttpAdapterOptions } from './types'

/**
 * An adapter that talks to a stock LoomCanvas server (or anything that speaks the same API).
 * It has its own HTTP client: nothing is shared with other adapters or with the page.
 */
export function createHttpAdapter(options: HttpAdapterOptions = {}): EditorAdapter {
  const apiBase = String(options.apiBase || '/api').replace(/\/+$/, '') || '/api'
  const fileBase = options.fileBase !== undefined ? String(options.fileBase || '').replace(/\/+$/, '') : originOf(apiBase)
  const http = createHttpClient({
    apiBase: () => apiBase,
    // Without getAuth the adapter sends no credentials at all: it never reads LoomCanvas' own token.
    getAuth: () => options.getAuth || (() => ({})),
    locale: options.locale,
    timeoutMs: options.timeoutMs,
    onUnauthorized: () => options.onAuthRequired?.(),
  })
  return httpAdapterOver(createApi(http), () => fileBase)
}
