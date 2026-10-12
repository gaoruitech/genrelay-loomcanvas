/**
 * How the editor's needs map to the stock LoomCanvas server API (docs/api.md): the one place that
 * knows. The stand-alone app and the whole-app entry use it over the application's shared HTTP
 * client; the public `createHttpAdapter()` (httpAdapter.ts) uses it over a client of its own.
 *
 * Internal module: not part of the public API.
 */
import { unwrap, type ApiGroups } from '@/utils/api'
import { CANVAS_SCHEMA_VERSION, type CanvasDocument } from './document'
import type { AdapterCapabilities, EditorAdapter, StoredCanvas } from './types'

const DOC_FIELDS = ['name', 'nodes', 'edges', 'viewport', 'settings', 'brandKitId'] as const

/** Build the adapter on top of a set of endpoint groups. */
export function httpAdapterOver(api: ApiGroups, fileBase: () => string): EditorAdapter {
  let caps: Promise<AdapterCapabilities> | null = null
  return {
    async loadCanvas(id) {
      const w = unwrap(await api.workflowApi.detail(id)) as any
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
      return { id: w.id, document, updatedAt: w.updatedAt, createdAt: w.createdAt } satisfies StoredCanvas
    },
    async saveCanvas(id, doc) {
      const body: Record<string, any> = {}
      for (const k of DOC_FIELDS) if (doc[k] !== undefined) body[k] = doc[k]
      // The server only accepts `false` here: "this old layout has been checked".
      if (doc.legacyLayout === false) body.legacyLayout = false
      const w = unwrap(await api.workflowApi.update(id, body))
      return { updatedAt: w.updatedAt }
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
        return { maxUploadMb: info.limits?.maxUploadMb, upstreamByUrl: info.media?.upstreamByUrl }
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
    },
    assets: {
      categories: async () => unwrap(await api.canvasAssetApi.categories()),
      listBuiltin: async (params) => unwrap(await api.canvasAssetApi.list(params as any)),
      listMine: async (params) => unwrap(await api.userAssetApi.list(params)),
      create: async (data) => unwrap(await api.userAssetApi.create(data)),
      remove: async (id) => unwrap(await api.userAssetApi.remove(id)),
      registerOutput: async (data) => unwrap(await api.userAssetApi.registerOutput(data)),
    },
    share: {
      publish: async (data) => unwrap(await api.canvasShareApi.publish(data)),
      mine: async () => unwrap(await api.canvasShareApi.mine()),
      remove: async (id) => unwrap(await api.canvasShareApi.remove(id)),
      copy: async (token, name) => unwrap(await api.canvasShareApi.copy(token, name)),
    },
  }
}
