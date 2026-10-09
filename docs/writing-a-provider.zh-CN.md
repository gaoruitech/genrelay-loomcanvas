# 编写模型接入

[English](writing-a-provider.md)

一种接入类型就是 `server/src/providers/` 下的一个 CommonJS 模块，负责在 LoomCanvas 的运行和某一种上游接口格式之间做转换。本文按注册表和任务执行器实际使用的方式说明这个接口。

建议对照内置的几个一起看：`gaorui.js`（异步任务）、`openaiCompatible.js` 和 `gemini.js`（同步）。

## 插件管什么、不管什么

| 插件 | LoomCanvas |
| --- | --- |
| 列出自己的模型 | 给标识加上实例前缀、套用管理端的覆盖项、缓存列表 |
| 组装上游请求、解析响应 | 解密 Key、校验输入、排队、控制时限、重试、取消 |
| 告诉系统结果在哪 | 下载到存储、按内容识别类型、生成缩略图 |
| 对话时报告 token 用量 | 预估和记录成本、调用计费钩子 |

插件不碰数据库，也不碰存储。

## 模块的形状

```js
module.exports = {
  type: 'acme',                 // 必填，/^[a-z0-9-]+$/，定了就不要再改
  label: 'Acme',                // 显示名称
  defaultBaseUrl: 'https://…',  // 可选
  fields: [ /* 表单字段 */ ],    // 必填（可以是空数组）
  sync: false,                  // 可选，见「同步与异步」

  async listModels(cfg, { signal }) {},
  async test(cfg, { signal }) {},
  async submit(cfg, run) {},
  async poll(cfg, run) {},
  async chat(cfg, req) {},
}
```

五个函数都必须有，缺一个 `register()` 就会在启动时报错。上游用不到的函数也要写出来，并在里面抛错（见示例）。

### `fields`

每一项描述接入表单里的一个输入框。

| 属性 | 类型 | 含义 |
| --- | --- | --- |
| `key` | string | 字段名。有两个特殊的名字，见下。 |
| `label` | string | 显示在输入框旁边。 |
| `type` | `'text'` \| `'password'` \| `'textarea'` | 可选。`secret` 为真时默认 `password`，否则 `text`。 |
| `secret` | boolean | 输入时打码。 |
| `required` | boolean | `apiKey` 和 `baseUrl` 由服务端强制检查，其余的由表单检查。 |
| `placeholder`、`help` | string | 可选的提示。 |

- `apiKey` 加密后入库，传给你时是 `cfg.apiKey`。
- `baseUrl` 会校验成不带账号密码的 `http(s)` 地址，传给你时是 `cfg.baseUrl`（用户留空时是 `defaultBaseUrl`）。
- 其他字段按普通字符串保存（最长 5000 个字符），传给你时是 `cfg.<key>`。不要把机密放在这些字段里。

### `cfg`

`{ baseUrl, apiKey, ...其他字段 }`，Key 已经解密。不要写进日志，也不要放进错误信息。

## 各个函数

### `listModels(cfg, { signal }) → ModelSpec[]`

返回这个实例提供的模型，标识用上游自己的（不带实例前缀）。调用时带一个 12 秒的中止信号，结果缓存五分钟。

- 抛错时使用上一次成功的列表，没有就是空列表。所以固定的模型清单不要依赖网络。
- 它可能在还没填 Key 的时候被调用。能返回多少就返回多少，不要抛错。

见 [ModelSpec 参考](#modelspec-参考)。

### `test(cfg, { signal }) → { ok?, message?, modelCount? }`

「测试连接」按钮背后的连通性测试，带一个 20 秒的中止信号。做一件开销小、又能证明地址和 Key 可用的事。

- 成功时返回 `{ ok: true, modelCount }`。`message` 可选，不给就显示统一的「连接成功」提示。
- 失败就抛错。面向用户的错误会显示它的信息，其他情况显示「连接失败」。

### `submit(cfg, run) → { externalId } | { outputs }`

发起一次生成。

- 上游创建了需要稍后查询的任务时，返回 `{ externalId }`。任务号会随运行存下来，重启后能接着查靠的就是它。
- 结果已经拿到时，返回 `{ outputs: [...] }`。
- 两个都没有，运行以 `upstream.no_task_id` 失败。

### `poll(cfg, run) → { status, progress?, outputs?, error? }`

查询任务。`run.externalId` 就是 `submit` 返回的那个。

| `status` | 其他字段 | 效果 |
| --- | --- | --- |
| `'succeeded'` | `outputs`（非空） | 运行进入转存阶段。 |
| `'failed'` | `error` | 运行失败。`error` 填上游的原话（字符串，会显示在「上游生成失败：…」里），或者用 `msg()` 生成的一条信息。 |
| 其他任何值 | `progress` 0–100 | 仍在运行。进度只进不退，在结果存好之前最高到 94。 |

`poll` 每 2 到 8 秒调用一次，每次调用最多 30 秒。

### `chat(cfg, req) → { text, usage? }`

为大语言模型节点和视频分析节点做一次对话。`usage` 是 `{ inputTokens, outputTokens }`，上游有返回就带上，按 token 计价才算得出来。`text` 为空时运行失败。

### `run` / `req` 对象

`submit`、`poll`、`chat` 收到的是同一种形状：

| 属性 | 含义 |
| --- | --- |
| `id` | 运行的标识（字符串）。 |
| `kind` | `'image'`、`'video'` 或 `'chat'`。 |
| `model` | 上游的模型标识（你声明的 `id`，不带实例前缀）。 |
| `spec` | 合并了覆盖项的 ModelSpec；模型已经不在你的列表里时为 `null`。 |
| `prompt`、`systemPrompt` | 字符串，可能为空。 |
| `imageUrls` | 参考图的画布地址，已经按模型的 `maxReferenceImages` 截断。 |
| `videoUrls`、`videoUrl` | 原视频（最多一个），只有 `acceptsVideo` 的模型才有，对话模型也一样。 |
| `params` | 模型的 `defaults` 加上节点提交的参数：短字符串、数字、布尔值，例如 `aspectRatio`、`resolution`、`duration`、`imgMode`、`count`。取值是否合法要自己判断。 |
| `externalId` | 在 `poll` 里有值。 |
| `signal` | 带着时限和取消的 AbortSignal。**每个请求都要传。** |
| `media` | 把画布地址变成上游能读的东西的工具。它们和这次调用绑定在同一个中止信号上，取消、超时、服务端退出时，参考素材的加载也会停下。 |

`run.media`：

| 工具 | 返回 | 适用于上游接受 |
| --- | --- | --- |
| `await media.toBase64(url)` | `{ mime, data }`（base64，只限图片，最大 20 MB） | 内联数据 |
| `await media.toRef(url)` | 公网地址；没有公网地址时是 `data:` URI | 同一个字段两种都收 |
| `await media.toPublicUrl(url, what?)` | 公网地址，否则抛出 `media.needs_public_url` | 只收地址（以及视频） |

画布地址一般是站内相对地址（`/files/…`），不要原样转发给上游。

`toRef` 和 `toPublicUrl` 返回的地址只给你正在拼的这一次上游请求用。文件在桶里时，它可能是一个**预签名地址**：查询参数里带着签名，拿到它的人就能读这个文件，一小时后过期。所以：

- 只把它放进发给上游的请求里。不要写日志，不要放进错误信息、`outputs` 或任何你返回的内容里。
- 不要留着以后用。`poll` 里如果还需要这个地址，重新调用一次工具；`submit` 时拿到的地址到那时可能已经过期。
- 上游如果在接受任务很久之后（超过一小时）才去下载这个地址，会发现它已经过期。

### 结果（outputs）

```js
{ type: 'image' | 'video' | 'audio', url: 'https://…', headers?: { … } }  // 远程文件
{ type: 'image', b64: '…', mime?: 'image/png' }                          // 内联 base64
```

- `headers` 会在下载时带上，用于需要认证才能取的结果。只有地址在接口主机上时才加；签名的 CDN 链接必须不带 Key 去取。
- 图片的 `url` 也可以是 `data:` 地址。
- 下载回来的文件按内容检查：标成「图片」却不是图片，运行失败。上限：图片 60 MB，视频 1 GB。
- 下载经过 SSRF 防护。如果上游在内网，并且返回指向自身的链接，部署者需要把它的主机加进 `SSRF_ALLOW_HOSTS`。

## 同步与异步

| | 异步（默认） | 同步（`sync: true`） |
| --- | --- | --- |
| `submit` 返回 | `{ externalId }` | `{ outputs }` |
| `submit` 的时限 | `submitTimeoutSec`（默认 60 秒） | 图片或视频的超时 |
| `poll` | 一直调用到结束 | 不会被调用；实现成抛出 `provider.no_async` |
| 重启之后 | 接着轮询 | 见下 |

只要 `submit` 会一直等到结果出来，就要设 `sync: true`。不设的话，调用会在提交超时后被掐断。

异步插件也可以在个别请求里直接从 `submit` 返回 `{ outputs }`，同样有效。

还没有 `externalId` 的运行在重启时的处理：任何请求都不会向上游发两次。服务端退出时，如果这次运行的 `submit`（或 `chat`）还没被调用，它回到队列，由下一个进程提交。如果调用已经开始，运行以 `run.interrupted` 失败，因为没人知道上游有没有收下它；进程崩溃后发现处于这种状态的运行也一样。同步型插件永远没有 `externalId`，所以它的运行只要在服务端停止时正在进行，就是这个结果；每一次 `chat` 调用也是。

## 错误

抛出 `./http` 里的 `ProviderError`：

```js
const { ProviderError } = require('./http')

throw new ProviderError('upstream.error_detail', { detail: upstreamMessage })
throw new ProviderError('upstream.unrecognized', {}, { transient: true })
```

- 第一个参数是服务端语言文件（`server/src/i18n/en.js` 和 `zh-CN.js`）里的键，第二个参数填它的 `{占位符}`。用户看到的是自己语言的句子，接口调用方拿到的 `code` 就是这个键。
- 上游说的话放进 `detail` 这样的参数里，原样显示，不翻译。
- 第三个参数设置执行器会用到的标记：

| 标记 | 含义 | 执行器的处理 |
| --- | --- | --- |
| `safeToResubmit: true` | 上游**确定**没有收下这个请求。 | 重试 `submit`，最多 `maxRetries` 次，间隔 1 秒、2 秒、4 秒…，不超过时限。 |
| `transient: true` | 过一会儿再问可能就好了。 | `poll` 一直查到时限为止。没有这个标记时，连续五次查询出错就判失败。 |

超时和连接中断绝对不要标 `safeToResubmit`：任务可能已经建好了，再提交一次会被收两次钱。

使用 `./http` 里的 `request()`，上面大部分事情它已经替你做了：

| 情况 | 信息 | `transient` | `safeToResubmit` |
| --- | --- | --- | --- |
| 连接根本没建立（被拒绝、域名解析失败、不可达） | `upstream.unreachable` | 是 | 是 |
| 连接重置、超时、管道断开 | `upstream.interrupted` | 是 | 否 |
| HTTP 401 / 403 | `upstream.auth_rejected` | 否 | 否 |
| HTTP 429 / 503 | `upstream.http_error` | 是 | 是 |
| HTTP 408 / 500 / 502 / 504 | `upstream.http_error` | 是 | 否 |
| 其他非 2xx | `upstream.http_error` | 否 | 否 |

错误响应里带有说明时（`error.message`、`message`、`msg`、`detail` 或 `fail_reason`），用的是带 `_detail` 后缀的键，并把说明带上。`request()` 不跟随重定向，响应最大 80 MB。

其他规则：

- 不是面向用户的错误（普通的 `Error`、程序缺陷）只记在服务端日志里，用户看到的是统一的 `run.failed`，里面的内容不会泄露。
- 很多接口用 HTTP 200 返回、把错误放在响应体里。要自己检查并抛错。
- 需要新的提示语时，**两个**语言文件都要加这个键。两边不一致、代码用了不存在的键、语言文件里有没人用的键，`server/test/i18n.test.js` 都会失败。复用现有的 `upstream.*` 键可以省掉这些事。

显示名称也可以用同样的办法做成多语言：在两个语言文件里加上 `provider.<type>.label` 和 `provider.<type>.field.<key>.label` / `.help`。不加的话，显示的是你声明的 `label` 和 `help`。

## ModelSpec 参考

`listModels` 为每个模型返回的内容。不认识的属性（以及所有以 `_` 开头的）在离开服务端之前会被去掉，所以协议名这类私有数据可以放在同一个对象上。

| 属性 | 类型 | 默认 | 含义 |
| --- | --- | --- | --- |
| `id` | string | 必填 | 上游的模型标识。最终变成 `<实例标识>:<id>`。 |
| `kind` | `'image'` \| `'video'` \| `'chat'` | 必填 | 其他取值的条目会被丢弃。 |
| `label` | string | `id` | 显示名称。 |
| `desc` | string | 无 | 下拉里的一句话说明。 |
| `tag` | string | 无 | 下拉里的小标签。 |
| `acceptsImage` | boolean | `false` | 接受参考图。 |
| `acceptsVideo` | boolean | `false` | 接受原视频。对话模型：会出现在视频分析节点里，你的 `chat` 会收到 `videoUrl`。没有这个标记的对话模型，带视频的请求在到达插件之前就以 `model.no_video_input` 被拒绝。 |
| `videoEdit` | boolean | `false` | 出现在视频编辑节点里（而不出现在视频生成节点里）。 |
| `maxReferenceImages` | integer | `0` | 多出来的图在 `submit` 之前就被截掉。 |
| `options.aspectRatios` | string[] | 无 | 参数下拉里的选项。习惯上用 `'auto'` 表示「让模型自己定」。 |
| `options.resolutions` | string[] | 无 | 例如 `['1K', '2K']` 或 `['720p']`。 |
| `options.durations` | number[] | 无 | 秒。 |
| `options.counts` | number[] | 无 | 点一次出几个结果。画布每个单位提交一次运行。 |
| `options.imgModes` | string[] | 无 | `'multi'`（多图参考）和 / 或 `'frames'`（首尾帧）。以 `params.imgMode` 传入。 |
| `defaults` | object | `{}` | 参数的初始值，节点提交的参数会盖在它上面。 |
| `pricing` | object | 无 | 只有确定价格时才写。不写的话模型显示「成本未知」，由部署者自己填。见[模型接入](providers.zh-CN.md#价格)。 |

某个选项列表不存在，节点上就不显示对应的控件。

## 完整示例

假设有这样一个上游：

- `GET /v1/me` → Key 有效时返回 200
- `POST /v1/generate` `{ model, prompt, images, ratio, size }` → `{ task_id }`
- `GET /v1/tasks/:id` → `{ state: 'working' | 'done' | 'failed', percent, image_url, message }`

`server/src/providers/acme.js`：

```js
'use strict'

const { request, ProviderError, trimBase } = require('./http')
const { msg } = require('../i18n')

const MODELS = [
  {
    id: 'acme-image-1',
    label: 'Acme Image 1',
    kind: 'image',
    acceptsImage: true,
    maxReferenceImages: 4,
    options: { aspectRatios: ['1:1', '16:9', '9:16'], resolutions: ['1K', '2K'] },
    defaults: { aspectRatio: '1:1', resolution: '1K', count: 1 },
  },
]

function auth(cfg) {
  if (!cfg.apiKey) throw new ProviderError('provider.api_key_missing')
  return { Authorization: `Bearer ${cfg.apiKey}` }
}

module.exports = {
  type: 'acme',
  label: 'Acme',
  defaultBaseUrl: 'https://api.acme.example',
  fields: [
    { key: 'apiKey', label: 'API Key', secret: true, required: true },
    { key: 'baseUrl', label: 'Base URL', placeholder: 'https://api.acme.example' },
  ],

  async listModels() {
    return MODELS
  },

  async test(cfg, { signal } = {}) {
    await request({ url: `${trimBase(cfg.baseUrl)}/v1/me`, headers: auth(cfg), signal, timeoutMs: 15000 })
    return { ok: true, modelCount: MODELS.length }
  },

  async submit(cfg, run) {
    if (!run.prompt) throw new ProviderError('run.prompt_required')
    const images = []
    for (const url of run.imageUrls || []) images.push(await run.media.toRef(url))
    const data = await request({
      method: 'POST',
      url: `${trimBase(cfg.baseUrl)}/v1/generate`,
      headers: { 'Content-Type': 'application/json', ...auth(cfg) },
      data: { model: run.model, prompt: run.prompt, images, ratio: run.params.aspectRatio, size: run.params.resolution },
      signal: run.signal,
      timeoutMs: 60000,
    })
    if (!data || !data.task_id) throw new ProviderError('upstream.no_task_id')
    return { externalId: String(data.task_id) }
  },

  async poll(cfg, run) {
    const data = await request({
      url: `${trimBase(cfg.baseUrl)}/v1/tasks/${encodeURIComponent(run.externalId)}`,
      headers: auth(cfg),
      signal: run.signal,
      timeoutMs: 20000,
    })
    if (!data || typeof data !== 'object') throw new ProviderError('upstream.unrecognized', {}, { transient: true })
    if (data.state === 'done') {
      if (!data.image_url) return { status: 'failed', error: msg('upstream.no_image_url') }
      return { status: 'succeeded', outputs: [{ type: 'image', url: data.image_url }] }
    }
    if (data.state === 'failed') return { status: 'failed', error: String(data.message || '') }
    return { status: 'running', progress: Number(data.percent) || 0 }
  },

  async chat() {
    throw new ProviderError('run.chat_unsupported')
  },
}
```

## 注册

在 `server/src/providers/index.js` 里内置接入的旁边加一行：

```js
register(require('./acme'))
```

重启服务端。这个类型会出现在「设置 → 模型接入 → 添加接入」和引导页里。前端不用改：表单是按 `fields` 画出来的。

目前没有办法从源码目录之外加载接入，接入是随你的构建一起发布的。

## 对着假上游测试

项目测试接入的办法是：起一个小的 HTTP 服务，记录收到的请求，按路由表作答，然后直接调用插件的函数。可以照 `server/test/providers.test.js` 的写法来。针对上面的示例，`server/test/acme.test.js`：

```js
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('http')
const acme = require('../src/providers/acme')

/** Fake upstream: records every request, answers from a route table. */
async function fakeUpstream(routes) {
  const calls = []
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString()
      const call = { method: req.method, path: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : null }
      calls.push(call)
      const handler = routes[`${req.method} ${req.url}`]
      const out = handler ? handler(call) : { status: 404, body: { error: { message: 'no such route' } } }
      res.statusCode = out.status || 200
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(out.body))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { calls, baseUrl: `http://127.0.0.1:${server.address().port}`, close: () => { server.closeAllConnections(); server.close() } }
}

// Stand-ins for run.media, so the test does not need storage.
const media = {
  async toRef(url) { return `ref(${url})` },
  async toBase64(url) { return { mime: 'image/png', data: Buffer.from(url).toString('base64') } },
  async toPublicUrl(url) { return `public(${url})` },
}
const signal = new AbortController().signal

test('acme: submit, poll, errors', async (t) => {
  let task = { state: 'working', percent: 30 }
  const up = await fakeUpstream({
    'POST /v1/generate': (c) => (c.body.prompt === 'busy' ? { status: 503, body: { message: 'try later' } } : { body: { task_id: 't-1' } }),
    'GET /v1/tasks/t-1': () => ({ body: task }),
  })
  t.after(up.close)
  const cfg = { baseUrl: up.baseUrl, apiKey: 'sk-test' }
  const run = { kind: 'image', model: 'acme-image-1', prompt: 'a cat', imageUrls: ['/files/a.png'], params: { aspectRatio: '16:9', resolution: '2K' }, media, signal }

  assert.deepEqual(await acme.submit(cfg, run), { externalId: 't-1' })
  assert.equal(up.calls[0].headers.authorization, 'Bearer sk-test')
  assert.deepEqual(up.calls[0].body, { model: 'acme-image-1', prompt: 'a cat', images: ['ref(/files/a.png)'], ratio: '16:9', size: '2K' })

  const polling = { ...run, externalId: 't-1' }
  assert.deepEqual(await acme.poll(cfg, polling), { status: 'running', progress: 30 })
  task = { state: 'done', image_url: 'https://cdn.example/out.png' }
  assert.deepEqual(await acme.poll(cfg, polling), { status: 'succeeded', outputs: [{ type: 'image', url: 'https://cdn.example/out.png' }] })
  task = { state: 'failed', message: 'content rejected' }
  assert.deepEqual(await acme.poll(cfg, polling), { status: 'failed', error: 'content rejected' })

  // 503 means "not accepted": the runner may submit again.
  await assert.rejects(acme.submit(cfg, { ...run, prompt: 'busy' }), (e) => e.userFacing && e.transient && e.safeToResubmit)
  await assert.rejects(acme.submit({ ...cfg, apiKey: '' }, run), (e) => e.i18n.code === 'provider.api_key_missing')
})
```

运行：

```bash
cd server
npm test
```

这样的测试能证明什么、不能证明什么：

- 它把你发出的请求和你能接受的响应固定了下来。
- 它**不能**证明真实的上游也是这样。正式依赖一个接入之前，至少真实跑通一次。

插件外面的几层怎么测：

- `server/test/runner.test.js` 用假接入和内存存储（`runner/memoryStore.js`）驱动执行器：时限、重试、取消、重启。
- `server/test/api.e2e.test.js` 通过 HTTP 跑完整的服务端，对着假上游，包括结果的下载。它放行了 `127.0.0.1`（效果等同于 `SSRF_ALLOW_HOSTS`），这样才能取到假上游给的结果链接。
- 想在本机手动对着假上游试一个插件，启动服务端时加上 `SSRF_ALLOW_HOSTS=127.0.0.1`。生产环境不要这样设。
