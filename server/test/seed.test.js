'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { TEMPLATES } = require('../src/services/seed')

/**
 * Node sizes in the editor, on the generous side. Generation nodes come in three
 * layouts an account chooses between, and a template has to open without
 * overlapping nodes in every one of them. The web app holds the same numbers
 * (web/src/composables/nodeLayout.ts, GEN_NODE_SIZE; the fallback for every other
 * node is in web/src/composables/useAutoLayout.ts).
 */
const MEDIA = new Set(['image-gen', 'image-edit', 'video-gen', 'video-edit'])
const TEXT = new Set(['llm', 'video-analysis'])
const GEN_NODE_SIZE = {
  a: { media: { w: 272, h: 344 }, text: { w: 272, h: 280 } },
  b: { media: { w: 240, h: 200 }, text: { w: 240, h: 200 } },
  c: { media: { w: 328, h: 460 }, text: { w: 328, h: 460 } },
}
const sizeOf = (type, layout) => (MEDIA.has(type) ? GEN_NODE_SIZE[layout].media : TEXT.has(type) ? GEN_NODE_SIZE[layout].text : { w: 280, h: 320 })

for (const layout of ['a', 'b', 'c']) {
  test(`built-in templates: no two nodes overlap in node layout ${layout.toUpperCase()}`, () => {
    assert.ok(TEMPLATES.length >= 2)
    for (const tpl of TEMPLATES) {
      const boxes = tpl.graph.nodes.map((n) => ({ id: n.id, x: n.position.x, y: n.position.y, ...sizeOf(n.type, layout) }))
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const [a, b] = [boxes[i], boxes[j]]
          const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y
          assert.ok(apart, `${tpl.key}: "${a.id}" and "${b.id}" overlap`)
        }
      }
    }
  })
}

test('built-in templates: in the default layout a column leaves a readable gap before the next one', () => {
  // Layout A is what a new account sees. Along a connection the next node starts at least 120px
  // after the previous one ends: room for the edge and for the port labels that show on hover.
  for (const tpl of TEMPLATES) {
    const byId = new Map(tpl.graph.nodes.map((n) => [n.id, n]))
    for (const e of tpl.graph.edges) {
      const [from, to] = [byId.get(e.source), byId.get(e.target)]
      if (from.position.x >= to.position.x) continue
      const gap = to.position.x - (from.position.x + sizeOf(from.type, 'a').w)
      assert.ok(gap >= 120, `${tpl.key}: ${e.id} leaves ${gap}px`)
    }
  }
})

test('built-in templates: every connection names its handles and joins nodes of the template', () => {
  for (const tpl of TEMPLATES) {
    const ids = new Set(tpl.graph.nodes.map((n) => n.id))
    assert.equal(ids.size, tpl.graph.nodes.length, `${tpl.key}: node ids are unique`)
    for (const e of tpl.graph.edges) {
      assert.ok(ids.has(e.source) && ids.has(e.target), `${tpl.key}: ${e.id}`)
      assert.match(e.sourceHandle, /^(text|image|video)-out$/, `${tpl.key}: ${e.id}`)
      assert.match(e.targetHandle, /^(text|image|image-last|video)-in$/, `${tpl.key}: ${e.id}`)
    }
  }
})
