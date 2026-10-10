# 编写服务商模块

[English](writing-a-provider.md)

一家服务商是两个文件：`server/src/providers/` 下的一个 CommonJS 模块，负责在 LoomCanvas 的运行和这家服务商的接口之间做转换；`server/src/providers/catalog/` 下的一份模型清单，写明这家服务商支持哪些模型。本文按注册表和任务执行器实际使用的方式说明这两样东西。

建议对照内置的几个一起看：`gaorui.js`（异步任务）、`openai.js` 和 `gemini.js`（同步），以及它们的清单 `catalog/gaorui.json`、`catalog/openai.json`、`catalog/gemini.json`。

每家服务商都要遵守两条规则：

- **模型是写明的，不是推断的。** 一家服务商的模型就是它清单里的条目。模块不向上游读取模型列表来提供模型，任何地方都不能根据模型的名字推出它的类型或能力。服务商模块里如果有向上游列模型的函数，或者拿模型名去匹配某个模式，`server/test/vendors.test.js` 会失败。
- **高瑞以外的服务商只走官方接口。** 高瑞的接口是我们自己的，可以不标准。其他服务商的模块只发送那家官方接口文档里写明的内容：不带中转服务的扩展，不带私有字段。用户可以把接口地址改成别的，但对方必须使用同样的官方接口。

## 模块管什么、不管什么

| 服务商模块和模型清单 | LoomCanvas |
| --- | --- |
| 写明这家服务商的模型，以及自定义模型能用什么 | 给标识加上实例前缀、加上用户添加的自定义模型、套用管理端的覆盖项 |
| 组装上游请求、解析响应 | 解密 Key、校验输入、排队、控制时限、重试、取消 |
| 告诉系统结果在哪 | 下载到存储、按内容识别类型、生成缩略图 |
| 对话时报告 token 用量 | 预估和记录成本、调用计费钩子 |

服务商模块不碰数据库，也不碰存储。

## 模块的形状

```js
const { loadCatalog } = require('./catalog')

module.exports = {
  type: 'acme',                       // 必填，/^[a-z0-9-]+$/，定了就不要再改：服务商标识
  label: 'Acme',                      // 显示名称
  defaultBaseUrl: 'https://…',        // 这家服务商的官方地址
  catalog: loadCatalog('acme'),       // 必填：catalog/acme.json，加载时校验
  customKinds: ['image', 'chat'],     // 必填（可以是空数组）：用户可以手动添加哪些类型的模型
  customSpec: (kind) => CUSTOM[kind], // 必填：这种类型的自定义模型能用什么
  sync: false,                        // 可选，见「同步与异步」
  recommended: false,                 // 可选：显示「推荐」标记
  keyUrl: '',                         // 可选：表单里「获取 API Key」的链接

  async test(cfg, { signal }) {},
  async submit(cfg, run) {},
  async poll(cfg, run) {},
  async chat(cfg, req) {},
}
```

下面这些情况，`register()` 会在启动时报错：

- 没有 `type`，或者它不是由小写字母、数字和连字符组成；
- `customSpec`、`test`、`submit`、`poll`、`chat` 有哪个不是函数。上游用不到的函数也要写出来，并在里面抛错（见示例）；
- `catalog` 不是数组；
- `customKinds` 不是数组，里面有 `image`、`video`、`chat` 以外的值，或者列了某种类型而 `customSpec(kind)` 对它没有返回内容。

没有表单字段需要声明。每家服务商的表单都一样：API Key、名称，以及「高级」里的接口地址。

### `cfg`

`{ baseUrl, apiKey }`，Key 已经解密。`baseUrl` 是用户在「高级」里填的地址，没填时是你的 `defaultBaseUrl`；它已经校验成不带账号密码的 `http(s)` 地址。不要把 Key 写进日志，也不要放进错误信息。

## 模型清单文件

`server/src/providers/catalog/<type>.json` 正好三段，三段都必须有。某种类型没有模型就写空数组，这样「没有」是写明的，而不是靠缺省。

```json
{
  "image": [
    {
      "id": "acme-image-1",
      "label": "Acme Image 1",
      "acceptsImage": true,
      "acceptsVideo": false,
      "videoEdit": false,
      "maxReferenceImages": 4,
      "options": { "aspectRatios": ["1:1", "16:9", "9:16"], "resolutions": ["1K", "2K"] },
      "defaults": { "aspectRatio": "1:1", "resolution": "1K", "count": 1 }
    }
  ],
  "video": [],
  "chat": []
}
```

**条目写在哪一段，就是哪种类型。** 条目里不能有 `kind` 字段。

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `id` | string | 上游的模型名，原样发送。只能用字母、数字和 `. _ - : / @`，最长 120 个字符。最终变成 `<实例标识>:<id>`。整个文件里不能重复。 |
| `label` | string | 显示名称。必填，不能为空。 |
| `acceptsImage` | boolean | 接受参考图。对话模型：能读图片。为 `false` 的对话模型是纯文本模型：带图片的对话请求在到达模块之前就以 `model.no_image_input` 被拒绝，大语言模型节点也不会把连着的图片发给它。 |
| `maxReferenceImages` | 不小于 0 的整数 | 最多几张。当且仅当 `acceptsImage` 为 `true` 时大于 0。 |
| `acceptsVideo` | boolean | 接受视频：视频模型是把它当原视频，对话模型是读它。带这个标记的对话模型会出现在视频分析节点里，你的 `chat` 会收到 `videoUrl`。没有这个标记的对话模型，带视频的请求在到达模块之前就以 `model.no_video_input` 被拒绝。OpenAI 官方接口没有视频这种内容片段，所以 `openaiShared.js` 的 `chatCompletion()` 同样会拒绝视频，除非模块说明自己的上游怎么收（高瑞模块传的是 `{ videoAsImageUrl: true }`）。 |
| `videoEdit` | boolean | 出现在视频编辑节点里（而不出现在视频生成节点里）。只能用在 `video` 段里带 `acceptsVideo` 的模型上。 |
| `options.aspectRatios` | string[] | 参数下拉里的选项。习惯上用 `'auto'` 表示「让模型自己定」。 |
| `options.resolutions` | string[] | 例如 `["1K", "2K"]` 或 `["720p"]`。 |
| `options.durations` | number[] | 秒。 |
| `options.counts` | number[] | 点一次出几个结果。 |
| `options.imgModes` | string[] | `"multi"`（多图参考）和 / 或 `"frames"`（首尾帧）。以 `params.imgMode` 传入。 |
| `defaults` | object | 参数的初始值，节点提交的参数会盖在它上面：`aspectRatio`、`resolution`、`duration`、`imgMode`、`count`。 |
| `_任意名字` | 任意 | 服务商模块私有，不会对外返回。见下。 |

校验（`catalog/index.js` 里的 `validateCatalog`）在模块加载时进行，遇到第一个问题就抛错。所以清单写坏了，服务端启动时就会停下，而不是以后表现为某个模型半能用半不能用。除了上表，它还要求：

- 除 `image`、`video`、`chat` 外没有别的段；
- 三个标记（`acceptsImage`、`acceptsVideo`、`videoEdit`）都明确写成 `true` 或 `false`；`options` 和 `defaults` 都要有，是对象（没有内容写 `{}`）；
- 没有不认识的字段。清单里没有 `desc`、`tag`、`pricing`：说明文字是语言文件里的键（见下），价格由部署者自己填；
- 每个选项列表非空、类型正确、没有重复。某个选项列表不存在，节点上就不显示对应的控件；
- 每个默认值都取自对应的选项列表（`defaults.aspectRatio` 取自 `options.aspectRatios`，以此类推）。`defaults.count` 是正整数；有 `options.counts` 时必须是其中之一。

**私有字段。** 名字以 `_` 开头的字段能通过校验，在模型信息离开服务端之前会被去掉。只有你的模块用得到的东西放在这里，比如某个模型用哪种请求格式（`catalog/gaorui.json` 里的 `"_protocol"`）。`run.spec` 上没有私有字段，要用 `run.model` 到自己的清单里查。

**条目的出处。** 内置的 OpenAI 和 Gemini 清单里，每个条目的出处记在 `server/src/providers/catalog/SOURCES.md` 里。你添加的服务商也请这样做。

**说明文字和名字。** 服务端的两个语言文件（`server/src/i18n/en.js` 和 `zh-CN.js`）里都要有：

- `provider.<type>.label`：服务商的名字。不加的话，显示的是你声明的 `label`。
- `model.<type>.<模型 id>.desc`：清单里每个模型的一句话说明，显示在模型下拉和「此服务商支持的模型」列表里。

对内置的服务商，`server/test/i18n.test.js` 要求两种语言里都有名字的键，以及清单里每个模型的 `desc` 键；这两种写法的键如果对不上任何已知的服务商或模型，也会失败。它检查哪些服务商是写在测试里的，添加服务商时要把你的加进去。

## 自定义模型

用户可以添加清单里没有的模型（见[服务商](providers.zh-CN.md#自定义模型)）。名字和类型由用户指定；能添加哪些类型、这样的模型能用什么，由你决定：

```js
const CUSTOM = {
  image: {
    acceptsImage: true,
    acceptsVideo: false,
    videoEdit: false,
    maxReferenceImages: 4,
    options: { aspectRatios: ['1:1', '16:9', '9:16'] },
    defaults: { aspectRatio: '1:1', count: 1 },
  },
}
```

- `customKinds` 列出用户可以选的类型。某种类型如果没有一种请求能适用于这类的任意模型，就不要列。内置的三家都没有列 `video`。
- `customSpec(kind)` 返回这种类型的能力和参数，形状和清单条目一样，只是没有 `id` 和 `label`。名字、类型和 `custom: true` 由注册表补上。
- 自定义模型和其他模型一样到达 `submit` 和 `chat`。`run.model` 是用户填的名字，`run.kind` 是用户选的类型，`run.spec.custom` 为 `true`。它在清单里没有条目，所以按清单条目选请求格式的模块，要有一个按 `run.kind` 的兜底（见 `gaorui.js` 里的 `protocolOf`）。
- 名字已经在你清单里的自定义模型，以及类型不在你列表里的自定义模型，注册表会拒绝。

## 各个函数

### `test(cfg, { signal }) → { ok?, message? }`

「测试连接」按钮背后的连通性测试，带一个 20 秒的中止信号。做一件开销小、又能证明地址和 Key 可用的事。内置的模块是调用上游的模型列表接口，返回的列表丢弃不用。

- 成功时返回 `{ ok: true }`。`message` 可选，不给就显示统一的「连接成功」提示。
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
| `model` | 上游的模型名，不带实例前缀：清单条目的 `id`，或者自定义模型的名字。 |
| `spec` | 合并了覆盖项的 [ModelSpec](#modelspec-参考)；模型已经被移除时（自定义模型被删掉了）为 `null`。`spec.maxReferenceImages` 是这个模型的参考图上限，组装请求时可以用它来截断；`spec.custom` 用来区分自定义模型和清单里的模型。 |
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

异步的服务商模块也可以在个别请求里直接从 `submit` 返回 `{ outputs }`，同样有效。

还没有 `externalId` 的运行在重启时的处理：任何请求都不会向上游发两次。服务端退出时，如果这次运行的 `submit`（或 `chat`）还没被调用，它回到队列，由下一个进程提交。如果调用已经开始，运行以 `run.interrupted` 失败，因为没人知道上游有没有收下它；进程崩溃后发现处于这种状态的运行也一样。同步型的服务商模块永远没有 `externalId`，所以它的运行只要在服务端停止时正在进行，就是这个结果；每一次 `chat` 调用也是。

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

服务商的名字和模型的说明文字也是这两个语言文件里的条目，见[模型清单文件](#模型清单文件)。

## ModelSpec 参考

服务端为每个模型给出的内容（`GET /api/models`、`run.spec`）。它由清单条目或 `customSpec(kind)` 生成，不需要你自己写。

| 属性 | 来自 | 含义 |
| --- | --- | --- |
| `id` | 实例标识加上条目的 `id` | `<实例标识>:<id>` |
| `providerId`、`providerName`、`providerType` | 添加的服务商 | 它的数据库 id、名称，以及服务商标识。 |
| `kind` | 清单里所在的段，或者用户选的类型 | `'image'`、`'video'` 或 `'chat'` |
| `label` | 条目的 `label`；自定义模型是用户填的显示名称，没填就是模型名 | 显示名称。管理端的覆盖项可以替换它。 |
| `custom` | | 自定义模型为 `true`，清单里的模型为 `false`。 |
| `desc` | `model.<type>.<模型 id>.desc` | 一句话说明，按读的人的语言给出。只有清单里的模型有。 |
| `acceptsImage`、`acceptsVideo`、`videoEdit`、`maxReferenceImages`、`options`、`defaults` | 条目或 `customSpec(kind)` | 含义同[模型清单文件](#模型清单文件)。管理端的覆盖项可以改 `defaults`。 |
| `pricing` | 管理端的覆盖项 | 部署者填了价格才有。没有的话模型显示「成本未知」。见[服务商](providers.zh-CN.md#价格)。 |

私有字段（`_` 开头）和表里没有的内容都会被去掉。

## 完整示例

假设有这样一家服务商，它的官方接口是：

- `GET /v1/me` → Key 有效时返回 200
- `POST /v1/generate` `{ model, prompt, images, ratio, size }` → `{ task_id }`
- `GET /v1/tasks/:id` → `{ state: 'working' | 'done' | 'failed', percent, image_url, message }`

`server/src/providers/catalog/acme.json`：

```json
{
  "image": [
    {
      "id": "acme-image-1",
      "label": "Acme Image 1",
      "acceptsImage": true,
      "acceptsVideo": false,
      "videoEdit": false,
      "maxReferenceImages": 4,
      "options": { "aspectRatios": ["1:1", "16:9", "9:16"], "resolutions": ["1K", "2K"] },
      "defaults": { "aspectRatio": "1:1", "resolution": "1K", "count": 1 }
    }
  ],
  "video": [],
  "chat": []
}
```

`server/src/providers/acme.js`：

```js
'use strict'

const { loadCatalog } = require('./catalog')
const { request, ProviderError, trimBase } = require('./http')
const { msg } = require('../i18n')

const DEFAULT_BASE_URL = 'https://api.acme.example'

// What a model the user added by hand gets. No resolution option: sizes
// differ per model, so a custom one is left at the model's own default.
const CUSTOM = {
  image: {
    acceptsImage: true,
    acceptsVideo: false,
    videoEdit: false,
    maxReferenceImages: 4,
    options: { aspectRatios: ['1:1', '16:9', '9:16'] },
    defaults: { aspectRatio: '1:1', count: 1 },
  },
}

function base(cfg) {
  return trimBase(cfg.baseUrl || DEFAULT_BASE_URL)
}

function auth(cfg) {
  if (!cfg.apiKey) throw new ProviderError('provider.api_key_missing')
  return { Authorization: `Bearer ${cfg.apiKey}` }
}

module.exports = {
  type: 'acme',
  label: 'Acme',
  defaultBaseUrl: DEFAULT_BASE_URL,
  catalog: loadCatalog('acme'),
  // This API has no chat and no video endpoint, so only images can be added by hand.
  customKinds: ['image'],
  customSpec: (kind) => CUSTOM[kind],

  async test(cfg, { signal } = {}) {
    await request({ url: `${base(cfg)}/v1/me`, headers: auth(cfg), signal, timeoutMs: 15000 })
    return { ok: true }
  },

  async submit(cfg, run) {
    if (run.kind !== 'image') throw new ProviderError('provider.model_not_supported', { model: run.model })
    if (!run.prompt) throw new ProviderError('run.prompt_required')
    const max = (run.spec && run.spec.maxReferenceImages) || CUSTOM.image.maxReferenceImages
    const images = []
    for (const url of (run.imageUrls || []).slice(0, max)) images.push(await run.media.toRef(url))
    const data = await request({
      method: 'POST',
      url: `${base(cfg)}/v1/generate`,
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
      url: `${base(cfg)}/v1/tasks/${encodeURIComponent(run.externalId)}`,
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

提示语，`server/src/i18n/en.js` 和 `zh-CN.js` 里各加一份（下面是 `zh-CN.js` 的写法）：

```js
'provider.acme.label': 'Acme',
'model.acme.acme-image-1.desc': '图片生成，最多 4 张参考图',
```

## 注册

在 `server/src/providers/index.js` 里内置服务商的后面加一行。注册的顺序就是显示的顺序：

```js
register(require('./acme'))
```

然后改掉那几个有意把服务商名单写死的测试：

- `server/test/registry.test.js`：已注册的服务商标识及其顺序。
- `server/test/vendors.test.js`：`VENDORS` 列表，以及每份清单里有哪些模型名。
- `server/test/i18n.test.js`：要求有名字和说明文字的服务商列表。

重启服务端。这家服务商连同它支持的模型，会出现在「设置 → 服务商 → 添加服务商」和引导页里。前端不用改：页面是按 `GET /api/admin/vendors` 画出来的。可以另外在 `web/src/locales/modules/settings.ts` 里加上 `settings.vendors.acme`（`label`、`desc`）：服务商卡片上的一句话介绍来自这里，名字也能在切换语言后不用重新加载就跟着变。

目前没有办法从源码目录之外加载服务商模块，它是随你的构建一起发布的。

## 对着假上游测试

项目测试服务商模块的办法是：起一个小的 HTTP 服务，记录收到的请求，按路由表作答，然后直接调用模块的函数。可以照 `server/test/providers.test.js` 的写法来。针对上面的示例，`server/test/acme.test.js`：

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
- 它**不能**证明真实的上游也是这样。正式依赖一个服务商模块之前，至少真实跑通一次。

模块外面的几层怎么测：

- `server/test/vendors.test.js` 检查每份清单能否通过校验、每家服务商的自定义模型规则，以及代码里没有任何地方根据模型名判断类型。`server/test/vendors.e2e.test.js` 通过管理接口把同样的事再走一遍。
- `server/test/runner.test.js` 用假的服务商模块和内存存储（`runner/memoryStore.js`）驱动执行器：时限、重试、取消、重启。
- `server/test/api.e2e.test.js` 通过 HTTP 跑完整的服务端，对着假上游，包括结果的下载。它放行了 `127.0.0.1`（效果等同于 `SSRF_ALLOW_HOSTS`），这样才能取到假上游给的结果链接。
- 想在本机手动对着假上游试一个服务商模块，启动服务端时加上 `SSRF_ALLOW_HOSTS=127.0.0.1`。生产环境不要这样设。
