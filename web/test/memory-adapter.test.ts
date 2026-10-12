// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createMemoryAdapter } from '../src/embed/memoryAdapter'
import { createEmptyDocument } from '../src/embed/document'
import { ADAPTER_REQUIRED_KEYS, validateAdapter } from '../src/embed/options'
import { runAdapterContract } from './adapterContract'

const adapter = createMemoryAdapter({ canvases: { c1: createEmptyDocument('Start') }, runMs: 120 })
// A run that is still unfinished when the contract cancels it.
const slow = createMemoryAdapter({ canvases: { c1: createEmptyDocument() }, runMs: 5000 })

runAdapterContract('memory', () => ({ adapter, canvasId: 'c1', imageModel: 'demo:image', chatModel: 'demo:chat' }))

describe('memory adapter', () => {
  it('has every required member', () => {
    for (const k of ADAPTER_REQUIRED_KEYS) expect(typeof (adapter as any)[k]).toBe('function')
    expect(() => validateAdapter(adapter)).not.toThrow()
    expect(() => validateAdapter({ loadCanvas() {} })).toThrow(/missing saveCanvas/)
    expect(() => validateAdapter(null)).toThrow(/adapter/)
  })

  it('cancels a run that has not finished', async () => {
    const { runId } = await slow.submitRun({ model: 'demo:image', prompt: 'x' })
    await slow.cancelRun(runId)
    expect((await slow.getRuns([runId]))[0].status).toBe('canceled')
  })

  it('records what it was asked and keeps canvases inspectable', async () => {
    const a = createMemoryAdapter({ canvases: { x: createEmptyDocument('X') }, runMs: 1 })
    await a.submitRun({ model: 'demo:image', prompt: 'p', nodeId: 'n' })
    expect(a.runRequests).toEqual([{ model: 'demo:image', prompt: 'p', nodeId: 'n' }])
    await a.saveCanvas('x', { name: 'Renamed' })
    expect(a.canvases.x.document.name).toBe('Renamed')
  })

  it('migrates the canvases it is seeded with', async () => {
    const a = createMemoryAdapter({ canvases: { old: { name: 'Old', nodes: [{ id: 'a', type: 'image-gen', position: { x: 0, y: 0 }, data: { prompt: '', brandKitId: 'k1' } }], edges: [] } as any } })
    const loaded = await a.loadCanvas('old')
    expect(loaded.document.schemaVersion).toBe(3)
    expect(loaded.document.brandKitId).toBe('k1')
    expect('brandKitId' in loaded.document.nodes[0].data).toBe(false)
  })

  it('uses host-supplied results', async () => {
    const a = createMemoryAdapter({ runMs: 1, resolveRun: () => [{ type: 'image', url: 'https://x/y.png' }], resolveLlm: (r) => `echo ${r.prompt}` })
    const { runId } = await a.submitRun({ model: 'demo:image', prompt: 'p' })
    await new Promise((r) => setTimeout(r, 10))
    expect((await a.getRuns([runId]))[0].outputs).toEqual([{ type: 'image', url: 'https://x/y.png' }])
    const { taskId } = await a.submitLlm({ model: 'demo:chat', prompt: 'hi' })
    await new Promise((r) => setTimeout(r, 10))
    expect((await a.getLlm(taskId)).text).toBe('echo hi')
  })
})
