/**
 * The adapter contract as executable checks. Every `EditorAdapter` the project ships must pass it;
 * a host can run the same suite against its own adapter (copy this file: it needs only vitest).
 */
import { describe, expect, it } from 'vitest'
import type { EditorAdapter, CanvasDocument, Run, LlmTask } from '../src/embed/types'

export interface ContractFixture {
  adapter: EditorAdapter
  /** Id of a canvas that exists and may be overwritten. */
  canvasId: string
  /** An image model id and a chat model id that `listModels()` returns. */
  imageModel: string
  chatModel: string
  /** A prompt that keeps a run unfinished long enough to cancel it (optional). */
  slowPrompt?: string
  /** Whether `resolveFileUrl(upload().url)` must be fetchable from the test process. */
  fetchUploads?: boolean
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitRun(adapter: EditorAdapter, id: string, timeoutMs = 20000): Promise<Run> {
  const end = Date.now() + timeoutMs
  for (;;) {
    const [run] = await adapter.getRuns([id])
    if (run && ['succeeded', 'failed', 'canceled'].includes(run.status)) return run
    if (Date.now() > end) throw new Error(`run ${id} still ${run?.status}`)
    await sleep(100)
  }
}

async function waitLlm(adapter: EditorAdapter, id: string, timeoutMs = 20000): Promise<LlmTask> {
  const end = Date.now() + timeoutMs
  for (;;) {
    const task = await adapter.getLlm(id)
    if (['succeeded', 'failed', 'canceled'].includes(task.status)) return task
    if (Date.now() > end) throw new Error(`task ${id} still ${task.status}`)
    await sleep(100)
  }
}

export function runAdapterContract(name: string, fixture: () => ContractFixture | Promise<ContractFixture>) {
  describe(`adapter contract: ${name}`, () => {
    const doc = (): Partial<CanvasDocument> => ({
      name: 'Contract canvas',
      nodes: [
        { id: 'n1', type: 'text', position: { x: 10, y: 20 }, data: { text: 'hello' } },
        { id: 'n2', type: 'image-gen', position: { x: 300, y: 20 }, data: { prompt: 'a cat', model: 'x' } },
      ],
      edges: [{ id: 'e1', type: 'glow', source: 'n1', target: 'n2', sourceHandle: 'text-out', targetHandle: 'text-in' }],
      viewport: { x: 5, y: 6, zoom: 0.8 },
      settings: { bg: { color: '#101010', pattern: 'dots', gap: 24 } },
      brandKitId: '',
    })

    it('saves a canvas and loads the same document back', async () => {
      const { adapter, canvasId } = await fixture()
      const saved = await adapter.saveCanvas(canvasId, doc())
      expect(typeof saved.updatedAt).toBe('string')
      const loaded = await adapter.loadCanvas(canvasId)
      expect(loaded.id).toBe(canvasId)
      expect(loaded.document.name).toBe('Contract canvas')
      expect(loaded.document.nodes.map((n) => [n.id, n.type, n.position, n.data])).toEqual(doc().nodes!.map((n) => [n.id, n.type, n.position, n.data]))
      expect(loaded.document.edges.map((e) => [e.source, e.sourceHandle, e.target, e.targetHandle])).toEqual([['n1', 'text-out', 'n2', 'text-in']])
      expect(loaded.document.viewport).toEqual({ x: 5, y: 6, zoom: 0.8 })
      expect(loaded.document.settings.bg).toMatchObject({ color: '#101010', pattern: 'dots' })
      expect(typeof loaded.document.schemaVersion).toBe('number')
    })

    it('a viewport-only save keeps the content and does not count as a change', async () => {
      const { adapter, canvasId } = await fixture()
      const first = await adapter.saveCanvas(canvasId, doc())
      await sleep(15)
      const second = await adapter.saveCanvas(canvasId, { viewport: { x: 100, y: 200, zoom: 1.5 } })
      expect(second.updatedAt).toBe(first.updatedAt)
      const loaded = await adapter.loadCanvas(canvasId)
      expect(loaded.document.viewport).toEqual({ x: 100, y: 200, zoom: 1.5 })
      expect(loaded.document.nodes).toHaveLength(2)
      expect(loaded.document.name).toBe('Contract canvas')
    })

    it('rejects loading a canvas that does not exist', async () => {
      const { adapter } = await fixture()
      await expect(adapter.loadCanvas('0123456789abcdef01234567')).rejects.toBeTruthy()
    })

    it('lists models with the fields the editor reads', async () => {
      const { adapter, imageModel, chatModel } = await fixture()
      const models = await adapter.listModels()
      expect(Array.isArray(models)).toBe(true)
      for (const m of models) {
        expect(typeof m.id).toBe('string')
        expect(typeof m.label).toBe('string')
        expect(['image', 'video', 'chat']).toContain(m.kind)
      }
      expect(models.find((m) => m.id === imageModel)?.kind).toBe('image')
      expect(models.find((m) => m.id === chatModel)?.kind).toBe('chat')
    })

    it('runs to completion and reports outputs', async () => {
      const { adapter, imageModel, canvasId } = await fixture()
      const { runId } = await adapter.submitRun({ model: imageModel, prompt: 'a red apple', params: { aspectRatio: '1:1' }, workflowId: canvasId, nodeId: 'n2' })
      expect(typeof runId).toBe('string')
      const run = await waitRun(adapter, runId)
      expect(run.status).toBe('succeeded')
      expect(run.id).toBe(runId)
      expect(run.outputs.length).toBeGreaterThan(0)
      expect(run.outputs[0].type).toBe('image')
      expect(typeof run.outputs[0].url).toBe('string')
      expect(typeof adapter.resolveFileUrl(run.outputs[0].url)).toBe('string')
    })

    it('getRuns answers for several ids at once and ignores unknown ones', async () => {
      const { adapter, imageModel } = await fixture()
      const a = await adapter.submitRun({ model: imageModel, prompt: 'one' })
      const b = await adapter.submitRun({ model: imageModel, prompt: 'two' })
      const runs = await adapter.getRuns([a.runId, b.runId, '0123456789abcdef01234567'])
      expect(runs.map((r) => r.id).sort()).toEqual([a.runId, b.runId].sort())
      await Promise.all([waitRun(adapter, a.runId), waitRun(adapter, b.runId)])
    })

    it('rejects a run with an unknown model', async () => {
      const { adapter } = await fixture()
      await expect(adapter.submitRun({ model: 'nobody:nothing', prompt: 'x' })).rejects.toBeTruthy()
    })

    it('cancels an unfinished run', async () => {
      const { adapter, imageModel, slowPrompt } = await fixture()
      if (!slowPrompt) return
      const { runId } = await adapter.submitRun({ model: imageModel, prompt: slowPrompt })
      await sleep(50)
      await adapter.cancelRun(runId)
      const run = await waitRun(adapter, runId)
      expect(run.status).toBe('canceled')
    })

    it('runs a text task to completion', async () => {
      const { adapter, chatModel } = await fixture()
      const { taskId } = await adapter.submitLlm({ model: chatModel, prompt: 'say hi' })
      expect(typeof taskId).toBe('string')
      const task = await waitLlm(adapter, taskId)
      expect(task.status).toBe('succeeded')
      expect(typeof task.text).toBe('string')
      expect(task.text!.length).toBeGreaterThan(0)
    })

    it('stores an upload and gives back an address the browser can load', async () => {
      const { adapter, fetchUploads } = await fixture()
      // 1x1 PNG
      const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))
      let progressed = false
      const file = await adapter.upload(new Blob([png], { type: 'image/png' }), { filename: 'dot.png', onProgress: () => { progressed = true } })
      expect(typeof file.url).toBe('string')
      expect(file.url.length).toBeGreaterThan(0)
      const src = adapter.resolveFileUrl(file.url)
      expect(typeof src).toBe('string')
      if (fetchUploads) {
        expect(/^https?:\/\//.test(src)).toBe(true)
        const res = await fetch(src)
        expect(res.status).toBe(200)
        expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0)
      }
      // Progress is optional for an adapter; calling it must at least not break the upload.
      expect(typeof progressed).toBe('boolean')
    })

    it('resolveFileUrl leaves absolute and data addresses alone', async () => {
      const { adapter } = await fixture()
      expect(adapter.resolveFileUrl('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png')
      expect(adapter.resolveFileUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA')
    })
  })
}
