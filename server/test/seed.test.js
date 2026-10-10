'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { TEMPLATES } = require('../src/services/seed')

/**
 * Node sizes in the current editor, on the generous side: a generation node
 * with a result in it is the tallest thing on a canvas. The web app holds the
 * same numbers (web/src/composables/useAutoLayout.ts, ESTIMATED_SIZE).
 */
const GENERATION = new Set(['image-gen', 'image-edit', 'video-gen', 'video-edit'])
const sizeOf = (type) => (GENERATION.has(type) ? { w: 260, h: 560 } : { w: 280, h: 320 })

test('built-in templates: no two nodes overlap at the current node sizes', () => {
  assert.ok(TEMPLATES.length >= 2)
  for (const tpl of TEMPLATES) {
    const boxes = tpl.graph.nodes.map((n) => ({ id: n.id, x: n.position.x, y: n.position.y, ...sizeOf(n.type) }))
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const [a, b] = [boxes[i], boxes[j]]
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y
        assert.ok(apart, `${tpl.key}: "${a.id}" and "${b.id}" overlap`)
      }
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
