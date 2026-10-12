/**
 * An adapter with no server behind it: canvases live in memory, uploads become object URLs,
 * runs "finish" after a short delay with a generated picture. For demos, tests and for trying the
 * editor before a backend exists. It imports nothing from the application.
 */
import type { LlmTask, ModelSpec, Run, RunRequest } from '../types'
import { createEmptyDocument, migrateDocument } from './document'
import type { LlmRequest, MemoryAdapter, MemoryAdapterOptions, StoredCanvas } from './types'

const DEMO_MODELS: ModelSpec[] = [
  {
    id: 'demo:image', providerId: 'demo', providerName: 'Demo', label: 'Demo image', kind: 'image',
    acceptsImage: true, maxReferenceImages: 4,
    options: { aspectRatios: ['1:1', '16:9', '9:16'], resolutions: ['1K', '2K'], counts: [1, 2] },
    defaults: { aspectRatio: '1:1', resolution: '1K', count: 1 },
  },
  { id: 'demo:chat', providerId: 'demo', providerName: 'Demo', label: 'Demo chat', kind: 'chat', acceptsImage: true },
]

const RATIO: Record<string, [number, number]> = { '1:1': [512, 512], '16:9': [640, 360], '9:16': [360, 640], '4:3': [600, 450], '3:4': [450, 600] }

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c] as string))
}

/** A picture that shows the prompt, as a data URL: no network, works offline. */
function demoPicture(req: RunRequest, n: number): string {
  const [w, h] = RATIO[String(req.params?.aspectRatio || '1:1')] || RATIO['1:1']
  let hue = 0
  for (const ch of `${req.prompt}${n}`) hue = (hue * 31 + ch.charCodeAt(0)) % 360
  const text = escapeXml((req.prompt || 'demo').slice(0, 42))
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
    + `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 70% 55%)"/><stop offset="1" stop-color="hsl(${(hue + 70) % 360} 70% 35%)"/></linearGradient></defs>`
    + `<rect width="${w}" height="${h}" fill="url(#g)"/>`
    + `<text x="50%" y="50%" fill="#fff" font-family="sans-serif" font-size="${Math.round(w / 22)}" text-anchor="middle" dominant-baseline="middle">${text}</text>`
    + `<text x="50%" y="${h - 18}" fill="rgba(255,255,255,.7)" font-family="sans-serif" font-size="12" text-anchor="middle">memory adapter · ${escapeXml(req.model)}</text></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

interface Job { run: Run; doneAt: number; outputs: Run['outputs']; canceled: boolean }
interface TextJob { task: LlmTask; doneAt: number; text: string }

export function createMemoryAdapter(options: MemoryAdapterOptions = {}): MemoryAdapter {
  const canvases: Record<string, StoredCanvas> = {}
  for (const [id, doc] of Object.entries(options.canvases || {})) {
    canvases[id] = { id, document: migrateDocument(doc), updatedAt: new Date().toISOString(), createdAt: new Date().toISOString() }
  }
  const models = options.models || DEMO_MODELS
  const runMs = options.runMs ?? 1200
  const jobs = new Map<string, Job>()
  const textJobs = new Map<string, TextJob>()
  const runRequests: RunRequest[] = []
  let seq = 0
  const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))

  function settle(job: Job): Run {
    if (job.canceled) return job.run
    const now = Date.now()
    if (now >= job.doneAt) {
      job.run = { ...job.run, status: 'succeeded', progress: 100, outputs: job.outputs, finishedAt: new Date(job.doneAt).toISOString() }
    } else {
      const total = Math.max(1, runMs)
      job.run = { ...job.run, status: 'running', progress: Math.min(99, Math.round(100 - ((job.doneAt - now) / total) * 100)) }
    }
    return job.run
  }

  return {
    canvases,
    runRequests,

    async loadCanvas(id) {
      if (!canvases[id]) throw Object.assign(new Error(`Canvas not found: ${id}`), { status: 404 })
      return clone(canvases[id])
    },
    async saveCanvas(id, doc) {
      const cur = canvases[id] || { id, document: createEmptyDocument(), createdAt: new Date().toISOString() }
      const { legacyLayout, ...rest } = clone(doc)
      const next = { ...cur.document, ...rest }
      if (legacyLayout === false) delete next.legacyLayout
      // A viewport-only save is not a change of content: keep the timestamp, like the stock server.
      const viewportOnly = Object.keys(rest).every((k) => k === 'viewport')
      const updatedAt = viewportOnly && cur.updatedAt ? cur.updatedAt : new Date().toISOString()
      canvases[id] = { ...cur, document: next, updatedAt }
      return { updatedAt }
    },
    async listModels() { return clone(models) },
    async submitRun(req) {
      const model = models.find((m) => m.id === req.model)
      if (!model) throw Object.assign(new Error(`Unknown model: ${req.model}`), { status: 400 })
      runRequests.push(clone(req))
      const id = `run_${++seq}`
      const count = Math.max(1, Number(req.params?.count) || 1)
      const outputs = options.resolveRun
        ? options.resolveRun(req)
        : Array.from({ length: count }, (_, i) => ({ type: 'image' as const, url: demoPicture(req, i) }))
      jobs.set(id, {
        run: { id, status: 'queued', progress: 0, outputs: [], model: req.model, kind: model.kind, createdAt: new Date().toISOString() },
        doneAt: Date.now() + runMs,
        outputs,
        canceled: false,
      })
      return { runId: id }
    },
    async getRuns(ids) {
      return ids.map((id) => jobs.get(id)).filter((j): j is Job => !!j).map((j) => clone(settle(j)))
    },
    async cancelRun(id) {
      const job = jobs.get(id)
      if (!job || settle(job).status === 'succeeded') return
      job.canceled = true
      job.run = { ...job.run, status: 'canceled' }
    },
    async submitLlm(req: LlmRequest) {
      const id = `llm_${++seq}`
      const text = options.resolveLlm ? options.resolveLlm(req) : `Demo answer to: ${req.prompt}`.slice(0, 400)
      textJobs.set(id, { task: { status: 'queued', progress: 0 }, doneAt: Date.now() + runMs, text })
      return { taskId: id }
    },
    async getLlm(taskId) {
      const job = textJobs.get(taskId)
      if (!job) throw Object.assign(new Error('Task not found'), { status: 404 })
      if (Date.now() >= job.doneAt) job.task = { status: 'succeeded', progress: 100, text: job.text }
      else job.task = { status: 'running', progress: 50 }
      return clone(job.task)
    },
    async upload(file, opts) {
      opts?.onProgress?.(100)
      const url = URL.createObjectURL(file)
      return { url, key: url, size: file.size, mime: file.type || 'application/octet-stream' }
    },
    resolveFileUrl: (url) => url,
    capabilities: () => ({ upstreamByUrl: true }),
    async estimate() { return { unitCost: 0, totalCost: 0, currency: 'USD', unknown: true } },
  }
}
