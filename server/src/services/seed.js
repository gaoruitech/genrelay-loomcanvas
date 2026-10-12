'use strict'

/**
 * First-boot content: a couple of starter canvas templates and prompt
 * snippets. They belong to the site (SYSTEM_USER) and every account sees them.
 * Runs once per seed version (tracked in `settings`), so anything that is
 * later edited or deleted is never brought back.
 */
const Setting = require('../models/Setting')
const Template = require('../models/Template')
const TextTemplate = require('../models/TextTemplate')
const { SYSTEM_USER } = require('../constants')

const SEED_KEY = '_seedVersion'
// 3: the built-in templates are spaced for the redesigned nodes (see the note above TEMPLATES).
// 4: re-spaced for the three node layouts an account can choose from.
const SEED_VERSION = 4

const node = (id, type, x, y, data = {}) => ({ id, type, position: { x, y }, data })
// 连线必须带连接点：画布靠它区分文字输入、图片输入和各自的输出
const edge = (source, sourceHandle, target, targetHandle) => ({
  id: `e-${source}-${target}`, source, sourceHandle, target, targetHandle,
})

/*
 * Positions have to work in all three node layouts, because the layout is a
 * preference of the account that opens the template (web: composables/nodeLayout.ts,
 * GEN_NODE_SIZE): a generation node is up to 272 x 344 in layout A (the default),
 * 240 x 200 in B and 328 x 460 in C. Source nodes are about 280 x 300 in every
 * layout. Columns are 440 apart: a 160 gap after a source node - the same as Tidy up
 * leaves - and 168 after a generation node in A, 200 in B, 112 in C. Nothing sits
 * below a generation node, so a template never opens with overlapping nodes.
 * Change the node sizes -> re-space here and bump SEED_VERSION.
 */
const TEMPLATES = [
  {
    key: 'text-to-image',
    title: '文生图',
    description: '一段文字生成一张图片：最基础的起步流程。',
    order: 10,
    graph: {
      nodes: [
        node('prompt', 'text', 0, 0, { text: '一只坐在窗台上的橘猫，午后阳光，胶片质感' }),
        node('gen', 'image-gen', 440, 0),
      ],
      edges: [edge('prompt', 'text-out', 'gen', 'text-in')],
      viewport: { x: 0, y: 0, zoom: 1 },
      group: false,
    },
  },
  {
    key: 'image-to-video',
    title: '图生视频',
    description: '先出一张图，再用这张图和一段运镜描述生成视频。',
    order: 20,
    graph: {
      nodes: [
        node('prompt', 'text', 0, 0, { text: '雪山脚下的木屋，清晨薄雾，电影感构图' }),
        node('motion', 'text', 0, 360, { text: '镜头缓慢向前推进，薄雾流动，炊烟升起' }),
        node('image', 'image-gen', 440, 0),
        node('video', 'video-gen', 880, 0),
      ],
      edges: [
        edge('prompt', 'text-out', 'image', 'text-in'),
        edge('image', 'image-out', 'video', 'image-in'),
        edge('motion', 'text-out', 'video', 'text-in'),
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
      group: false,
    },
  },
]

const TEXT_TEMPLATES = [
  { key: 'product-white-zh', lang: 'zh', category: '产品图', order: 10, title: '白底产品图', content: '将产品置于纯白背景中央，柔和的棚拍光线，底部有自然的浅阴影，画面干净，突出材质细节，高清商业摄影。' },
  { key: 'product-scene-zh', lang: 'zh', category: '产品图', order: 20, title: '场景产品图', content: '把产品放进贴合其用途的生活场景中，自然光，浅景深，背景虚化，色调温暖，构图留出文案空间。' },
  { key: 'portrait-zh', lang: 'zh', category: '人物', order: 10, title: '自然光人像', content: '半身人像，窗边自然光，肤质真实，表情放松，背景简洁，85mm 镜头，浅景深。' },
  { key: 'camera-push-zh', lang: 'zh', category: '视频运镜', order: 10, title: '缓慢推近', content: '镜头缓慢向主体推近，主体保持稳定，背景有轻微的视差移动，节奏平稳。' },
  { key: 'camera-orbit-zh', lang: 'zh', category: '视频运镜', order: 20, title: '环绕展示', content: '镜头围绕主体水平环绕半圈，主体始终位于画面中心，光线保持一致，运动流畅。' },
  { key: 'product-white-en', lang: 'en', category: 'Product', order: 10, title: 'White background product shot', content: 'The product centered on a pure white background, soft studio lighting, a subtle natural shadow underneath, clean composition, crisp material detail, commercial photography.' },
  { key: 'product-scene-en', lang: 'en', category: 'Product', order: 20, title: 'Lifestyle product shot', content: 'Place the product in a lifestyle scene that fits its use, natural light, shallow depth of field, blurred background, warm tones, leave room for copy.' },
  { key: 'portrait-en', lang: 'en', category: 'People', order: 10, title: 'Natural light portrait', content: 'Half-body portrait, natural window light, realistic skin texture, relaxed expression, simple background, 85mm lens, shallow depth of field.' },
  { key: 'camera-push-en', lang: 'en', category: 'Camera moves', order: 10, title: 'Slow push in', content: 'The camera slowly pushes in toward the subject, the subject stays steady, slight parallax in the background, even pacing.' },
  { key: 'camera-orbit-en', lang: 'en', category: 'Camera moves', order: 20, title: 'Orbit', content: 'The camera orbits half a circle around the subject, keeping it centered, consistent lighting, smooth motion.' },
]

async function seed() {
  const marker = await Setting.findOne({ key: SEED_KEY }).lean()
  if (marker && Number(marker.value) >= SEED_VERSION) return false

  for (const t of TEMPLATES) {
    // 内置模板以代码为准：提升 SEED_VERSION 后会用新内容覆盖旧的内置模板
    await Template.updateOne(
      { key: t.key, builtin: true },
      { $set: { ...t, userId: SYSTEM_USER, builtin: true }, $setOnInsert: { isActive: true } },
      { upsert: true }
    )
  }
  for (const t of TEXT_TEMPLATES) {
    await TextTemplate.updateOne(
      { key: t.key, builtin: true },
      { $setOnInsert: { ...t, userId: SYSTEM_USER, builtin: true, isActive: true } },
      { upsert: true }
    )
  }
  await Setting.updateOne({ key: SEED_KEY }, { $set: { value: SEED_VERSION } }, { upsert: true })
  return true
}

module.exports = { seed, TEMPLATES, TEXT_TEMPLATES }
