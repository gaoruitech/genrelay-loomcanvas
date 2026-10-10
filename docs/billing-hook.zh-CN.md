# 计费钩子

[English](billing-hook.md)

LoomCanvas 自己不记账：大家用的是自己的上游 Key，应用只负责预估和记录成本。如果你的部署需要计量、限额或收费，把 `BILLING_HOOK` 指向你自己写的模块，任务执行器会在每次运行前后调用它。

钩子只是一个小的扩展点，不是支付系统。真要拿它管钱，请先读完[保证与不保证](#保证与不保证)。

## 启用

把 `BILLING_HOOK` 设成一个 CommonJS 模块的路径：

```ini
BILLING_HOOK=./hooks/daily-budget.js
```

- 相对路径以启动服务端进程时所在的目录为基准（用 `npm start` 时是 `server/`，Docker 镜像里是 `/app`）。写绝对路径最省心。
- 模块在启动时加载一次。加载不了，或者三个名字之一导出的不是函数，服务端拒绝启动，报错信息以 `BILLING_HOOK` 开头。
- 改了文件要重启才生效。

用 Docker Compose 时，自带的 Compose 文件会把 `.env` 里的 `BILLING_HOOK` 传进容器，文件本身则需要挂载进去。在 `.env` 里设置 `BILLING_HOOK=/app/hooks/daily-budget.js`，并在 `docker-compose.override.yml` 里加上挂载：

```yaml
services:
  app:
    volumes:
      - ./hooks:/app/hooks:ro
```

## 接口

导出下面三个异步函数中的任意几个。没导出的按「放行」和「什么都不做」处理。

```js
module.exports = {
  async beforeRun(ctx, cost) { return { allow: true } },
  async afterRun(ctx, result) {},
  async onFailed(ctx, error) {},
}
```

### `ctx`

同一次运行的三个调用拿到的是同样的内容。

| 字段 | 含义 |
| --- | --- |
| `runId` | 运行的标识（字符串）。可以拿它做幂等键。 |
| `userId` | 这次运行所属账号的 id（24 位十六进制字符串）。只有账号功能之前留下、还没有账号接手的运行才是 `'local'`。自己的记录请以它为键。 |
| `username` | 这个账号当前的用户名；账号已不存在或运行还没有归属时为 `''`。用户改资料后它会变。 |
| `kind` | `'image'`、`'video'` 或 `'chat'`。 |
| `model` | 模型标识，`<实例标识>:<上游模型名>`。 |
| `providerType` | 例如 `'gaorui'`。 |
| `workflowId`、`nodeId` | 这次运行来自哪张画布、哪个节点，没有则为 `''`。只用于归属，是客户端传上来的。 |
| `params` | 运行参数（比例、分辨率、时长等）。 |
| `count` | 这次运行要求的结果数量。画布每个结果提交一次运行，所以通常是 1。 |

### `beforeRun(ctx, cost)`

每次运行调用一次。时机是：运行已经从队列里取出、它的服务商已经确认可用，但还没有向上游发任何东西。

`cost` 是创建运行时算出的预估：

| 字段 | 含义 |
| --- | --- |
| `amount` | 整次运行的预估成本。未知时为 `0`。 |
| `currency` | 价格表的货币，没有则为 `''`。 |
| `unknown` | 算不出金额时为 `true`。不要把 `amount: 0` 当成免费。按 token 计价的对话模型在这个时刻一定是未知。 |

返回值：

| 你返回 | 效果 |
| --- | --- |
| `{ allow: true }`，或什么都不返回 | 运行继续。 |
| `{ allow: false, reason: '…' }` | 运行失败。`reason`（最多 300 个字符）原样显示给用户，不翻译。 |
| `{ allow: false }` | 运行失败，显示统一的提示 `run.billing_denied`。 |
| （抛出异常） | 运行以 `run.billing_error` 失败。异常记在日志里，内容不会显示给用户。 |

`beforeRun` 拒绝或抛错时，这次运行**不会**再调用 `onFailed`：在执行器看来，什么都还没预留。

### `afterRun(ctx, result)`

运行成功、结果已经存好之后调用。

| 运行类型 | `result` |
| --- | --- |
| 图片、视频 | `{ outputs: [{ type, url, key, thumbnailUrl, thumbKey, width, height }] }` |
| 对话 | `{ text, usage?: { inputTokens, outputTokens }, cost?: { amount, currency, unknown } }` |

按 token 计价的对话模型，`result.cost` 是按上游返回的用量算出来的成本。这是第一次能知道真实金额的时刻。

### `onFailed(ctx, error)`

被 `beforeRun` 放行的运行没有成功结束时调用：失败、超时、被取消，或者因服务端停止而中断。用它退还或释放 `beforeRun` 预留的额度。进程崩溃之后，同一次运行可能被调用不止一次（见[保证与不保证](#保证与不保证)），所以请按 `ctx.runId` 做到幂等。

`error` 是错误对象，常见情况可以用 `error.code` 区分：

| `error.code` | 情况 |
| --- | --- |
| `'CANCELED'` | 用户取消了运行。 |
| `'TIMEOUT'` | 超过了时限。 |
| `'UPSTREAM_FAILED'` | 上游报告失败。 |
| `'DOWNLOAD_FAILED'`、`'BAD_RESULT'`、`'EMPTY'` | 结果取不回来或不可用。 |
| `'INTERRUPTED'` | 请求已经发出、还没拿到上游任务号时服务端停了（`run.interrupted`）。上游有没有处理它，不确定。 |
| 其他或没有 | 服务商模块抛出的错误，或内部错误。 |

`afterRun` 和 `onFailed` 抛出的异常只记日志，不影响运行。

## 各个函数何时被调用

| 情况 | `beforeRun` | `afterRun` | `onFailed` |
| --- | --- | --- | --- |
| 运行成功 | 一次 | 一次 | |
| 放行之后失败或超时 | 一次 | | 一次 |
| 用户取消正在进行的运行 | 一次 | | 一次（`CANCELED`） |
| 用户取消还在排队的运行 | | | |
| `beforeRun` 拒绝或抛错 | 一次 | | |
| 运行开始前它的服务商已被删除 | | | |
| 运行途中正常退出，已有上游任务号，或者还什么都没发出去 | 总共一次 | 最终成功时 | 最终失败时 |
| 运行途中正常退出，请求已发出，**没有**任务号（同步型服务商的每次运行、每次对话） | 一次 | | 一次（`INTERRUPTED`） |
| 运行途中进程崩溃，已有上游任务号 | 总共一次 | 最终成功时 | 最终失败时 |
| 运行途中进程崩溃，**没有**任务号 | 一次 | | 下次启动时（`INTERRUPTED`），至少一次 |

## 完整示例

按价格表的货币做一个每日花费上限。保存为 `hooks/daily-budget.js`：

```js
'use strict'

/**
 * Example billing hook: a daily spending cap.
 * State is kept in memory, so it resets when the server restarts.
 */
const DAILY_LIMIT = 50 // in the currency of your price tables

let day = ''
let spent = 0
const reserved = new Map() // runId -> amount

function today() {
  return new Date().toISOString().slice(0, 10)
}

function rollOver() {
  if (day !== today()) {
    day = today()
    spent = 0
    reserved.clear()
  }
}

module.exports = {
  async beforeRun(ctx, cost) {
    rollOver()
    // No price configured: decide what that means for you. Here it is refused.
    if (cost.unknown) return { allow: false, reason: `No price is set for ${ctx.model}` }
    if (spent + cost.amount > DAILY_LIMIT) return { allow: false, reason: 'Daily budget used up' }
    spent += cost.amount
    reserved.set(ctx.runId, cost.amount)
    return { allow: true }
  },

  async afterRun(ctx) {
    reserved.delete(ctx.runId)
  },

  async onFailed(ctx) {
    // Give the reserved amount back.
    const amount = reserved.get(ctx.runId)
    if (amount === undefined) return
    reserved.delete(ctx.runId)
    spent -= amount
  },
}
```

这个示例有意写得很简单。价格表里如果混用了货币，它也会混着加；按 token 计价的对话模型会被全部拒绝（运行前成本未知）；一重启就全忘了。真正要用的钩子应该把状态存进数据库，并以 `ctx.runId` 为键。

## 保证与不保证

执行器保证的：

- `beforeRun` 在向上游发任何东西之前调用，每次运行最多一次。「已放行」这件事随运行一起存着（`billingStarted`），所以因重启而重新排队的运行不会被再扣一次。
- 拒绝就是不跑：不会向上游发请求。
- 被放行的运行，只要在进程存活期间走到了终态，`afterRun` 和 `onFailed` 恰好调用其中一个。
- 钩子抛错不会拖垮服务端或任务队列。

**不**保证的：

- **进程崩溃时不保证送达。** 如果进程在「存下运行终态」和「调用钩子」之间死掉（崩溃、`kill -9`、断电），这次调用就丢了。钩子调用不会重试，也不会补发。
- **崩溃之后的 `onFailed` 是「至少一次」。** 下次启动时发现卡在中途、又没有上游任务号的运行，会以 `run.interrupted` 判失败。如果 `beforeRun` 放行过它，先调用 `onFailed`，再更新运行记录。两步之间再崩溃，下一次启动会重复这次调用，所以 `onFailed` 应当按 `ctx.runId` 做到幂等。
- **被中断的运行，上游可能已经处理了。** 任何请求都不会向上游发两次。服务端退出时，运行只有在已经拿到上游任务号（之后继续轮询，不重新提交），或者还什么都没发出去时，才回到队列。请求已经发出、没有任务号的运行以 `run.interrupted` 失败，并调用 `onFailed`；同步型接入（OpenAI 兼容接口的图片、Gemini）的每一次运行，以及当时正在进行的每一次对话，都属于这种情况。上游有没有处理这个请求、有没有计费，无从得知。
- **不是事务。** 钩子和运行的数据库更新是分开的两步。
- **钩子没有超时。** 执行器会一直等它返回。`beforeRun` 慢，运行就被拖住，并占着一个并发名额（`concurrency`）。
- **成本是估算的。** 它来自部署者手填的价格表，不是上游的账单。失败的运行在上游也可能已经计费。
- **钩子只知道是哪个账号。** `ctx.userId` 和 `ctx.username` 说明这次运行属于谁；每个账号的余额、套餐、配额要由你自己记。为早期版本写的钩子如果依赖 `userId` 恒为常量 `'local'`，需要改。
- **工具节点不经过钩子。** 切片、拼图、加水印、改尺寸、多平台导出不是运行。
