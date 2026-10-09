'use strict'

/**
 * Helpers that read a canvas node graph: cover selection, media collection
 * and stripping of run-time state. Shared by workflows, shares and the zip
 * export so the three never disagree about what a node contains.
 */
const { isMediaUrl } = require('../utils/validate')

// Node types searched for a cover image, best first: finished outputs, then
// generated results, then tool results, then material the user brought in.
const IMAGE_COVER_ORDER = [
  ['output', 'imageUrl'],
  ['image-gen', 'imageUrl'],
  ['image-edit', 'imageUrl'],
  ['slice', 'imageUrl'],
  ['collage', 'imageUrl'],
  ['watermark', 'imageUrl'],
  ['fit-size', 'imageUrl'],
  ['platform-export', 'imageUrl'],
  ['image', 'imageUrl'],
  ['image-collection', 'imageUrls'],
]
const VIDEO_COVER_ORDER = ['output', 'video-gen', 'video-edit', 'video']

function firstString(v) {
  if (typeof v === 'string' && v) return v
  if (Array.isArray(v)) return v.find((x) => typeof x === 'string' && x) || ''
  return ''
}

/**
 * Pick a cover for the list card. Images win over videos: an image can be
 * shown as-is, a video needs the browser to grab a frame first.
 */
function pickThumbnail(nodes) {
  const none = { thumbnail: '', thumbnailType: '' }
  if (!Array.isArray(nodes)) return none
  const dataOf = (type) => nodes.filter((n) => n && n.type === type && n.data && typeof n.data === 'object').map((n) => n.data)

  for (const [type, field] of IMAGE_COVER_ORDER) {
    for (const data of dataOf(type)) {
      const url = firstString(data[field])
      if (isMediaUrl(url)) return { thumbnail: url, thumbnailType: 'image' }
    }
  }
  for (const type of VIDEO_COVER_ORDER) {
    for (const data of dataOf(type)) {
      const url = firstString(data.videoUrl) || firstString(data.videoUrls)
      if (isMediaUrl(url)) return { thumbnail: url, thumbnailType: 'video' }
    }
  }
  return none
}

/** Every media URL a node holds (main result plus multi-result lists), de-duplicated. */
function collectNodeMedia(node) {
  const data = node && node.data && typeof node.data === 'object' ? node.data : {}
  const out = []
  const seen = new Set()
  const push = (v, kind) => {
    for (const url of Array.isArray(v) ? v : [v]) {
      if (!isMediaUrl(url) || seen.has(url)) continue
      seen.add(url)
      out.push({ url, kind })
    }
  }
  push(data.imageUrl, 'image')
  push(data.imageUrls, 'image')
  push(data.videoUrl, 'video')
  push(data.videoUrls, 'video')
  return out
}

// Run-time / task state that must not travel with a published or copied canvas.
const TRANSIENT_FIELDS = new Set(['status', 'progress', 'validationError', 'validationStamp', 'taskId', 'runId', 'errorMsg'])

/** Deep copy of the nodes with transient task state removed. */
function cleanNodes(nodes) {
  if (!Array.isArray(nodes)) return []
  return nodes.map((node) => {
    const copy = structuredClone(node)
    if (copy && copy.data && typeof copy.data === 'object') {
      for (const key of Object.keys(copy.data)) {
        if (TRANSIENT_FIELDS.has(key)) delete copy.data[key]
      }
    }
    return copy
  })
}

module.exports = { pickThumbnail, collectNodeMedia, cleanNodes }
