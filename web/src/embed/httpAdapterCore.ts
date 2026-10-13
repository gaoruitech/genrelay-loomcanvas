/**
 * How the editor's needs map to the stock LoomCanvas server API (docs/api.md): the one place that
 * knows. The stand-alone app and the whole-app entry use it over the application's shared HTTP
 * client; the public `createHttpAdapter()` (httpAdapter.ts) uses it over a client of its own.
 *
 * Internal module: not part of the public API.
 */
import { unwrap, type ApiGroups } from '@/utils/api'
import { CANVAS_SCHEMA_VERSION, type CanvasDocument } from './document'
import type { AdapterCapabilities, CanvasLockInfo, CanvasPerson, EditorAdapter, StoredCanvas } from './types'

const DOC_FIELDS = ['name', 'nodes', 'edges', 'viewport', 'settings', 'brandKitId'] as const
/** What the editor draws. A save that carries any of it is a content save; anything else is metadata. */
const CONTENT_FIELDS = ['nodes', 'edges', 'settings', 'brandKitId'] as const

/**
 * The id of one editing session: made up once per adapter - that is once per tab for the stand-alone
 * app - and kept in memory only, so two tabs never share it (docs/api.md, "The edit lock").
 */
export function newEditSessionId(): string {
  const bytes = new Uint8Array(16)
  const c = (globalThis as any).crypto
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes)
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** The server's Person -> what the editor shows. */
const person = (p: any): CanvasPerson | null => (p && typeof p === 'object' ? { id: String(p.id || ''), name: String(p.name || p.username || '') } : null)
const lockOf = (l: any): CanvasLockInfo | null => (l && l.by ? { by: person(l.by)!, at: l.at, expiresAt: l.expiresAt, mine: !!l.mine, sameUser: !!l.sameUser } : null)

/** Build the adapter on top of a set of endpoint groups. */
export function httpAdapterOver(api: ApiGroups, fileBase: () => string): EditorAdapter {
  let caps: Promise<AdapterCapabilities> | null = null
  const sessionId = newEditSessionId()
  /**
   * The release token of the lock this session holds, per canvas: what gives the lock back when the
   * page closes. It comes with every answer that shows this session's own lock.
   */
  const releaseTokens = new Map<string, string>()
  const noteLock = (id: string, lock: any) => {
    if (lock && lock.mine && typeof lock.releaseToken === 'string') releaseTokens.set(id, lock.releaseToken)
    else if (!lock || !lock.mine) releaseTokens.delete(id)
  }
  return {
    async loadCanvas(id) {
      const w = unwrap(await api.workflowApi.detail(id, sessionId)) as any
      noteLock(id, w.lock)
      const document: CanvasDocument = {
        schemaVersion: Number(w.schemaVersion) || CANVAS_SCHEMA_VERSION,
        name: w.name || '',
        nodes: w.nodes || [],
        edges: w.edges || [],
        viewport: w.viewport || { x: 0, y: 0, zoom: 1 },
        settings: w.settings || {},
        brandKitId: w.brandKitId || '',
        ...(w.legacyLayout ? { legacyLayout: true } : {}),
      }
      return {
        id: w.id, document, updatedAt: w.updatedAt, createdAt: w.createdAt,
        // Servers from before teams send none of these: the editor then behaves as it always did.
        ...(typeof w.revision === 'number' ? { revision: w.revision } : {}),
        ...(typeof w.metaRevision === 'number' ? { metaRevision: w.metaRevision } : {}),
        ...(w.access ? { access: { canEdit: w.access.canEdit, canTakeOver: w.access.canTakeOver, canOverwrite: w.access.canOverwrite, canShare: w.access.canShare, canSetVisibility: w.access.canSetVisibility } } : {}),
        lock: lockOf(w.lock),
        visibility: w.visibility || '',
        spaceId: w.spaceId || 'personal',
        lastEditedBy: person(w.lastEditedBy),
        lastEditedAt: w.lastEditedAt || null,
      } satisfies StoredCanvas
    },
    async saveCanvas(id, doc, options) {
      const body: Record<string, any> = {}
      for (const k of DOC_FIELDS) if (doc[k] !== undefined) body[k] = doc[k]
      // The server only accepts `false` here: "this old layout has been checked".
      if (doc.legacyLayout === false) body.legacyLayout = false
      body.sessionId = sessionId
      // Name, viewport, the old-layout flag: metadata. The server takes them from whoever may edit the
      // canvas - no lock, no revision, never a conflict - so a canvas can be renamed while somebody edits it.
      const content = CONTENT_FIELDS.some((k) => doc[k] !== undefined)
      if (!content) {
        const w = unwrap(await api.workflowApi.saveMeta(id, body))
        noteLock(id, w.lock)
        return { updatedAt: w.updatedAt, ...(typeof w.revision === 'number' ? { revision: w.revision } : {}) }
      }
      if (typeof options?.baseRevision === 'number') body.baseRevision = options.baseRevision
      if (options?.force) body.force = true
      const w = unwrap(await api.workflowApi.update(id, body))
      noteLock(id, w.lock)
      return { updatedAt: w.updatedAt, ...(typeof w.revision === 'number' ? { revision: w.revision } : {}) }
    },
    async acquireLock(id, options) {
      const out = unwrap(await api.workflowApi.lock(id, sessionId, !!options?.takeover))
      noteLock(id, out.lock)
      return {
        lock: lockOf(out.lock), revision: out.revision, state: out.state, name: out.name, metaRevision: out.metaRevision,
        heartbeatMs: out.heartbeatMs ?? (out.heartbeatSeconds ? out.heartbeatSeconds * 1000 : undefined),
      }
    },
    async releaseLock(id, options) {
      const token = releaseTokens.get(id)
      releaseTokens.delete(id)
      // The page is going away: only a beacon is sure to leave the browser, and it carries the
      // lock's release token instead of the session. Without a token the lock runs out by itself.
      if (options?.unloading) { if (token) api.workflowApi.releaseOnUnload(id, token); return }
      await api.workflowApi.unlock(id, sessionId)
    },
    async peekLock(id) {
      const out = unwrap(await api.workflowApi.peekLock(id, sessionId))
      noteLock(id, out.lock)
      return { lock: lockOf(out.lock), revision: out.revision, name: out.name, metaRevision: out.metaRevision, canEdit: out.canEdit, canTakeOver: out.canTakeOver, pollMs: out.pollMs }
    },
    async createCanvas(doc, options) {
      const body: Record<string, any> = { name: doc.name || '' }
      for (const k of DOC_FIELDS) if (k !== 'name' && doc[k] !== undefined) body[k] = doc[k]
      if (options?.visibility) body.visibility = options.visibility
      const w = unwrap(await api.workflowApi.create(body as any))
      return { id: w.id }
    },
    async listModels() {
      const list = unwrap(await api.modelsApi.list())
      return Array.isArray(list) ? list : []
    },
    async submitRun(req) { return unwrap(await api.runsApi.create(req)) },
    async getRuns(ids) {
      if (ids.length === 1) return [unwrap(await api.runsApi.get(ids[0]))]
      return unwrap(await api.runsApi.status(ids)) || []
    },
    async cancelRun(id) { unwrap(await api.runsApi.cancel(id)) },
    async submitLlm(req) { return unwrap(await api.llmApi.create(req)) },
    async getLlm(taskId) { return unwrap(await api.llmApi.get(taskId)) },
    async upload(file, opts) { return unwrap(await api.filesApi.upload(file, opts?.onProgress, opts?.filename)) },
    resolveFileUrl(url) {
      const base = fileBase()
      return base && typeof url === 'string' && url.startsWith('/files/') ? base + url : url
    },

    capabilities() {
      // One bootstrap call tells both; it is public, so it also works before sign-in.
      caps ||= api.appApi.bootstrap().then((res) => {
        const info = unwrap(res)
        return { maxUploadMb: info.limits?.maxUploadMb, upstreamByUrl: info.media?.upstreamByUrl, storageWritable: info.media?.writable }
      }).catch(() => ({}))
      return caps
    },
    async estimate(req) { return unwrap(await api.runsApi.estimate(req as any)) },
    async importRemoteFile(url) { return unwrap(await api.filesApi.fetch(url)) },
    async downloadFile(url, filename) { return (await api.workflowApi.download(url, filename)).data as Blob },
    async downloadZip(canvasId, urls) { return (await api.workflowApi.downloadZip(canvasId, urls)).data as Blob },
    async runTool(tool, p: any) {
      if (tool === 'slice') return unwrap(await api.canvasToolApi.slice(p.imageUrl, p.cols, p.rows))
      if (tool === 'collage') { const { imageUrls, ...opts } = p; return unwrap(await api.canvasToolApi.collage(imageUrls, opts)) }
      if (tool === 'watermark') { const { imageUrl, markUrl, ...opts } = p; return unwrap(await api.canvasToolApi.watermark(imageUrl, markUrl, opts)) }
      if (tool === 'fit') { const { imageUrl, ...opts } = p; return unwrap(await api.canvasToolApi.fit(imageUrl, opts)) }
      return unwrap(await api.platformExportApi.run(p.imageUrl, p.group))
    },
    async listCanvases() { return unwrap(await api.workflowApi.list()) || [] },
    brandKits: {
      list: async () => unwrap(await api.brandKitApi.list()),
      create: async (data) => unwrap(await api.brandKitApi.create(data)),
      update: async (id, data) => unwrap(await api.brandKitApi.update(id, data)),
      remove: async (id) => unwrap(await api.brandKitApi.remove(id)),
    },
    templates: {
      listCanvasTemplates: async () => unwrap(await api.canvasTemplateApi.list()),
      listTextTemplates: async (lang) => unwrap(await api.canvasTextTemplateApi.list(lang)),
      createCanvasTemplate: async (data) => unwrap(await api.canvasTemplateApi.create(data as any)),
      removeCanvasTemplate: async (key) => unwrap(await api.canvasTemplateApi.remove(key)),
      createTextTemplate: async (data) => unwrap(await api.canvasTextTemplateApi.create(data)),
      removeTextTemplate: async (id) => unwrap(await api.canvasTextTemplateApi.remove(id)),
    },
    assets: {
      categories: async () => unwrap(await api.canvasAssetApi.categories()),
      listBuiltin: async (params) => unwrap(await api.canvasAssetApi.list(params as any)),
      listMine: async (params) => unwrap(await api.userAssetApi.list(params)),
      create: async (data) => unwrap(await api.userAssetApi.create(data)),
      remove: async (id) => unwrap(await api.userAssetApi.remove(id)),
      registerOutput: async (data) => unwrap(await api.userAssetApi.registerOutput(data)),
      update: async (id, data) => unwrap(await api.userAssetApi.update(id, data)),
    },
    share: {
      publish: async (data) => unwrap(await api.canvasShareApi.publish(data)),
      mine: async () => unwrap(await api.canvasShareApi.mine()),
      remove: async (id) => unwrap(await api.canvasShareApi.remove(id)),
      copy: async (token, name) => unwrap(await api.canvasShareApi.copy(token, name)),
    },
  }
}
