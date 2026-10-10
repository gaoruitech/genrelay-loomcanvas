# HTTP 接口

[English](api.md)

接口的两份文档：

- [architecture.md](architecture.md)：中文，前后端共同遵守的约定，说明每个接口为什么这样设计。
- [api.md](api.md)：英文，按 `server/src/routes/` 里的代码逐个列出请求、返回和错误码。查某个字段、某个错误码时看这一份。

两份文档与代码不一致时，以代码为准，并请提 issue。

> 状态：早期开发中。首个正式版本发布前，路径和结构可能调整，目前没有接口版本号。

## 通用约定

- 所有接口前缀 `/api`。存下来的文件在 `/files/<key>`，不管用的是哪种存储。
- 请求体是 JSON，上传文件除外（`multipart/form-data`，字段名 `file`）。JSON 最大 1 MB，`/api/workflow` 下最大 6 MB，`/api/auth` 和 `/api/canvas-share` 下最大 64 KB。需要登录的接口先验凭证、再解析请求体。
- 返回统一为 `{ "result": 0, "message": "ok", "data": … }`。失败时 `result` 非 0、HTTP 状态码相应变化，并多一个 `code`：这条提示的稳定标识（`server/src/i18n/zh-CN.js` 里的键）。程序里请按 `code` 判断，不要按 `message`。
- `message` 的语言按请求决定：请求头 `X-Locale`（`zh-CN` 或 `en`）→ `Accept-Language` → 设置里的 `defaultLocale` → `zh-CN`。
- 登录：`ACCESS_PASSWORD` 为空时不需要。否则先用 `POST /api/auth/login` 换取凭证，之后每个请求带 `Authorization: Bearer <token>`。凭证有效期 30 天，改了口令或 `SECRET_KEY` 即失效。
- 只有真正没登录才返回 401（`auth.login_required`）。上游接口的认证失败以 400 返回。
- 请求本身格式不对（路径里的百分号编码有误、不支持的字符集等）返回 4xx，`code` 为 `common.bad_request`。

## 接口索引

「公开」表示设了口令也不需要登录。

### 基础

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/app/bootstrap` | 公开。站点信息、是否需要登录、版本号、`limits.maxUploadMb`（服务端的上传上限）；也用作健康检查。 |
| POST | `/api/auth/login` | 公开。`{ password }` → `{ token }`。每个客户端 10 分钟内最多 10 次（IPv6 客户端按 /64 网段计），所有客户端合计最多 300 次；超出返回 429（`auth.too_many_attempts`）。 |

### 文件

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/files/upload` | 上传一个文件。按内容识别类型，接受图片、视频、音频。返回的 `url` 永远是站内相对地址 `/files/<key>`，文件在本地磁盘上还是在桶里都一样。 |
| POST | `/api/files/fetch` | `{ url }`，由服务端抓取远程图片并转存。只接受图片：地址指向本实例存储里的视频时也返回 400（`file.image_only`）。 |
| GET | `/files/<key>` | 公开。每个存下来的文件唯一的地址，文件在哪个后端都一样：在本地磁盘上就从磁盘读；在桶里、分发方式是 `proxy` 时由应用从桶里流式转发（支持 `Range` → 206、`If-None-Match` → 304）；分发方式是 `redirect` 时返回 302，指向桶的公开地址。不是图片、视频、音频的一律按附件下载。找不到返回 404；存储服务连不上返回 502。 |

### 模型与运行

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/models` | 已启用的模型，可带 `?kind=image\|video\|chat`。每个模型带 `custom`：`true` 是用户手动添加的自定义模型，`false` 是服务商清单里的模型。对话模型的 `acceptsVideo` 表示能不能输入视频（高瑞清单里的 `gemini-3.5-flash-c` 和高瑞的自定义对话模型是 `true`，其余都是 `false`；视频怎么发见[服务商](providers.zh-CN.md#哪个节点用哪类模型)），`acceptsImage` 表示能不能读图片（`false` 是纯文本模型）。 |
| POST | `/api/runs/estimate` | 预估一次运行的成本。 |
| POST | `/api/runs` | 发起图片或视频运行 → `{ runId }`。未完成的运行已有 500 个时返回 429（`run.queue_full`）。 |
| GET | `/api/runs/:id` | 查询一次运行。 |
| POST | `/api/runs/status` | `{ ids }` 批量查询，最多 100 个。 |
| POST | `/api/runs/:id/cancel` | 取消排队中或进行中的运行。 |
| POST | `/api/llm/tasks` | 发起对话运行 → `{ taskId }`。带 `videoUrl` 而模型没有 `acceptsVideo` 时返回 400（`model.no_video_input`）；带 `imageUrls` 而模型是纯文本模型（没有 `acceptsImage`）时返回 400（`model.no_image_input`）；未完成的运行已有 500 个时同样返回 429。 |
| GET | `/api/llm/tasks/:id` | 查询对话运行。 |

### 画布

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/workflow/list` | 画布列表，最近的 200 张。 |
| POST | `/api/workflow` | 新建。 |
| GET | `/api/workflow/:id` | 读取。 |
| PUT | `/api/workflow/:id` | 保存，只改请求里带的字段。 |
| POST | `/api/workflow/:id/duplicate` | 复制。 |
| DELETE | `/api/workflow/:id` | 删除（软删除）。 |
| POST | `/api/workflow/download` | 代理下载一个素材文件。 |
| POST | `/api/workflow/:id/download-zip` | 把画布里的素材打包下载。最多 100 个文件，单个最大 1 GiB，总大小最大 4 GiB；放不下的换成 `NN-<类型>-skipped.txt`。 |

### 模板与工具

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/canvas/templates` | 画布模板。 |
| GET | `/api/canvas/text-templates` | 文本模板，`?lang=zh\|en`。 |
| POST | `/api/canvas/tool/slice` | 切片。 |
| POST | `/api/canvas/tool/collage` | 拼图。 |
| POST | `/api/canvas/tool/watermark` | 加水印。 |
| POST | `/api/canvas/tool/fit` | 改尺寸。 |
| POST | `/api/canvas/platform-export` | 多平台导出。 |

### 品牌包

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/brand-kits` | 列表。 |
| POST | `/api/brand-kits` | 新建。 |
| PUT | `/api/brand-kits/:id` | 修改。 |
| DELETE | `/api/brand-kits/:id` | 删除（软删除）。 |

### 资产

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/user-asset/list` | 我的资产，分页。 |
| POST | `/api/user-asset` | 登记一个已上传的文件。 |
| POST | `/api/user-asset/register-output` | 把生成结果存入「成品」。 |
| POST | `/api/user-asset/folder/delete` | 解散文件夹，保留其中的资产。 |
| PUT | `/api/user-asset/:id` | 改名、移动、改标签、改分类。 |
| DELETE | `/api/user-asset/:id` | 删除（软删除，文件保留）。 |
| GET | `/api/canvas-asset/categories` | 公共素材库的分类。 |
| GET | `/api/canvas-asset/list` | 公共素材库的列表。 |

### 分享链接

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/canvas-share/publish` | 为一张画布创建或更新分享。 |
| GET | `/api/canvas-share/mine` | 我的全部链接，含已过期和已撤销的。 |
| GET | `/api/canvas-share/plaza` | 我的有效链接，分页。 |
| GET | `/api/canvas-share/:token` | 公开。只读快照，只认链接里的 token（数据库 id 不行，登录与否都一样）。不存在、已过期、已撤销统一返回 404。快照里不带运行状态、运行号和任务号、失败详情和成本。 |
| POST | `/api/canvas-share/:token/copy` | 把快照复制成自己的一张新画布。同样只认 token。 |
| PUT | `/api/canvas-share/:id` | 改标题、描述、有效期、撤销状态。 |
| POST | `/api/canvas-share/:id/revoke` | 撤销。 |
| DELETE | `/api/canvas-share/:id` | 第一次撤销，再调一次从列表移除。 |

### 管理（设置页）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/admin/vendors` | 全部服务商及各自支持的模型。每家：`type`、`label`、`recommended`、`keyUrl`、`defaultBaseUrl`、`models[]`（清单里的模型：`model`、`label`、`kind`、`desc?`、`acceptsImage`、`acceptsVideo`、`videoEdit`、`custom: false`、`maxReferenceImages`、`options`、`defaults`）、`customKinds`（可以添加哪些类型的自定义模型）、`customDefaults`（每种类型的自定义模型能用的参数）。上一个版本的 `GET /api/admin/provider-types` 已经没有了（404）。 |
| GET | `/api/admin/providers` | 已添加的服务商列表。每个带 `customBaseUrl`（接口地址是否不是官方地址）和 `customModels: [{ model, kind, label }]`；不再有 `options`，也不再把模型字段平铺在顶层。 |
| POST | `/api/admin/providers` | 添加服务商：`{ type, apiKey, name?, baseUrl?, enabled? }`。`type` 是服务商标识（`gaorui`、`openai`、`gemini`），`apiKey` 必填（`provider.api_key_required`）；不带 `baseUrl` 表示用官方地址。请求里不再有模型字段。 |
| PUT | `/api/admin/providers/:id` | 修改服务商。服务商添加后不能更换：带上不同的 `type` 返回 400（`provider.vendor_fixed`）。 |
| DELETE | `/api/admin/providers/:id` | 删除服务商，连同其模型的覆盖项。 |
| POST | `/api/admin/providers/:id/test` | 连通性测试 → `{ ok, message }`，不再返回 `modelCount`。它调用上游的模型列表接口，只用来证明地址和 Key 可用。 |
| POST | `/api/admin/providers/:id/models` | 添加自定义模型：`{ model, kind, label? }` → 服务商对象。 |
| PUT | `/api/admin/providers/:id/models/:model` | 修改自定义模型的类型或显示名称：`{ kind?, label? }` → 服务商对象。模型名不能改。`:model` 要做 URL 编码。 |
| DELETE | `/api/admin/providers/:id/models/:model` | 删除自定义模型及其覆盖项 → 服务商对象。 |
| GET | `/api/admin/models` | 全部模型（含停用的和自定义的）及其覆盖项。 |
| PUT | `/api/admin/models/:modelId` | 修改模型的启用状态、名称、排序、默认参数、价格。`modelId` 要做 URL 编码。 |
| GET | `/api/admin/settings` | 读取站点设置。 |
| PUT | `/api/admin/settings` | 修改站点设置。不认识的键返回 400（`settings.unknown_key`）。 |
| GET | `/api/admin/storage` | 当前的存储：`source`（`saved` 设置页保存的 / `env` 环境变量 / `default` 默认）、`driver`（`local` / `s3`）、`delivery`、S3 配置（不含密钥，只有 `hasSecret` 和 `secretTail`）、仍在读取的旧桶 `previous`。 |
| POST | `/api/admin/storage/test` | `{ s3 }`，用提交的、尚未保存的配置真实地走一遍：写入、查询、读回比对、（`redirect` 分发时）从公开地址加载、删除。返回 `{ ok, steps, message, code }`。测试不通过也是 HTTP 200，`ok` 为 `false`，`code` 是 `storage.err_*`。 |
| PUT | `/api/admin/storage` | `{ driver: 'local' }` 或 `{ driver: 's3', s3, force? }`，保存并立即切换，不用重启。S3 配置会先测试；不通过就不保存，返回 400（`storage.save_needs_test`），测试结果在 `data.test` 里；带 `force: true` 则不测试直接保存。文件不会被移动。 |
| GET | `/api/admin/usage` | 用量汇总，`groupBy=day\|model`。 |
| GET | `/api/admin/usage/records` | 用量明细，分页。 |
| DELETE | `/api/admin/usage/records` | `?before=<YYYY-MM-DD 或 ISO 时间>` → `{ deleted }`。删除这一刻之前创建、已结束（成功、失败、已取消）的用量记录；只写日期表示这一天 UTC 零点之前。排队中、运行中的不动，文件不删。缺参数或日期不对返回 400（`validation.required` / `validation.bad_date`）。 |

管理接口没有单独的管理员角色：能登录的人都能调用。

添加一个服务商，再给它加一个自定义模型：

```bash
curl -X POST http://localhost:3000/api/admin/providers \
  -H 'Content-Type: application/json' \
  -d '{"type":"openai","apiKey":"sk-…"}'

curl -X POST http://localhost:3000/api/admin/providers/<上一步返回的 id>/models \
  -H 'Content-Type: application/json' \
  -d '{"model":"some-chat-model","kind":"chat","label":"我的对话模型"}'
```

自定义模型的规则和错误码：

- `model` 是上游的模型名：只能用字母、数字和 `. _ - : / @`，最长 120 个字符。缺了返回 `provider.custom_name_required`，格式不对返回 `provider.custom_bad_name`。
- `kind` 必填，没有默认值（`provider.custom_kind_required`），而且必须在这家服务商的 `customKinds` 里（`provider.custom_kind_unsupported`）。内置三家都只能是 `image` 或 `chat`，`video` 会被拒绝。
- 不能和服务商清单里的模型重名（`provider.custom_in_catalog`），同一个服务商下不能重复（`provider.custom_exists`），每个服务商最多 100 个（`provider.custom_max`）。
- 修改时带了不同的 `model` 返回 `provider.custom_name_fixed`；修改或删除一个不存在的自定义模型返回 404（`provider.custom_not_found`）。
- 以上除注明的以外都是 400。三个接口都返回更新后的服务商对象。添加后，这个模型以 `<标识>:<模型名>` 出现在 `GET /api/models` 里，`custom` 为 `true`，参数取自 `customDefaults[kind]`。

`GET /api/admin/vendors` 的完整返回示例、服务商对象的每个字段，逐项列在 [api.md](api.md#vendors)。

存储接口的请求和返回逐项列在 [api.md](api.md#storage)；各个字段的含义、各家服务的配法见[存储](storage.zh-CN.md)。
