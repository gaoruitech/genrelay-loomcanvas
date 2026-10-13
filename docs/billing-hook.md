# Billing hook

[简体中文](billing-hook.zh-CN.md)

LoomCanvas has no accounting of its own: people bring their own upstream keys, and the app only estimates and records cost. If your deployment needs to meter, limit or charge for usage, point `BILLING_HOOK` at a module of yours. The runner calls it around every run.

The hook is a small extension point, not a payment system. Read [Guarantees and non-guarantees](#guarantees-and-non-guarantees) before you put money behind it.

## Enabling it

Set `BILLING_HOOK` to the path of a CommonJS module:

```ini
BILLING_HOOK=./hooks/daily-budget.js
```

- A relative path is resolved against the directory the server process is started from (`server/` with `npm start`, `/app` in the Docker image). An absolute path avoids surprises.
- The module is loaded once at startup. If it cannot be loaded, or exports something that is not a function under one of the three names, the server refuses to start with a message beginning `BILLING_HOOK`.
- Changing the file needs a restart.

With Docker Compose, the stock Compose file passes `BILLING_HOOK` from `.env`; the file itself has to be mounted into the container. Set `BILLING_HOOK=/app/hooks/daily-budget.js` in `.env` and add the mount in `docker-compose.override.yml`:

```yaml
services:
  app:
    volumes:
      - ./hooks:/app/hooks:ro
```

## The interface

Export any of these three async functions. Missing ones default to "allow" and "do nothing".

```js
module.exports = {
  async beforeRun(ctx, cost) { return { allow: true } },
  async afterRun(ctx, result) {},
  async onFailed(ctx, error) {},
}
```

### `ctx`

The same object is passed to all three calls of one run.

| Field | Meaning |
| --- | --- |
| `runId` | Run id (string). Use it as your idempotency key. |
| `userId` | Id of the account that **started** the run (a 24-character hex string) - in its personal space and in a team alike, so a hook written before teams keeps charging the right person. `'local'` only for a run left over from before accounts that no account owns yet. Key your own records on this. |
| `spaceId` | Id of the space the run belongs to: whose providers and keys it uses and where its files go. Equal to `userId` for a run in a personal space; the team's id for a run in a team. |
| `teamId` | The team's id for a run in a team, `''` otherwise. Use it to charge a team instead of a person, or to tell team runs from personal ones. |
| `username` | The current username of the account in `userId`; `''` when the account no longer exists or the run is not owned yet. It can change when the user edits their profile. |
| `kind` | `'image'`, `'video'` or `'chat'`. |
| `model` | Model id, `<slug>:<upstream model>`. |
| `providerType` | For example `'gaorui'`. |
| `workflowId`, `nodeId` | Canvas and node the run came from, or `''`. Attribution only: they are supplied by the client. |
| `params` | Run parameters (aspect ratio, resolution, duration…). |
| `count` | Number of results requested by this run. The canvas submits one run per result, so this is normally 1. |

### `beforeRun(ctx, cost)`

Called once per run, after the run is taken from the queue and its provider has been resolved, and before anything is sent upstream.

`cost` is the estimate made when the run was created:

| Field | Meaning |
| --- | --- |
| `amount` | Estimated cost of the whole run. `0` when unknown. |
| `currency` | Currency of the price table, or `''`. |
| `unknown` | `true` when no amount could be calculated. Do not read `amount: 0` as free. Chat models priced per token are always unknown at this point. |

A team's [monthly limits](api.md#monthly-limits) are a separate, earlier check: they are applied when the run is **submitted**, and a run they refuse never reaches the queue or this hook. A chat run priced per token holds a reserve of the team's money limit from then until it ends; the hook is not told that reserve - `cost` here stays `unknown` for such a run, and its real cost arrives with `afterRun` (`result.cost`). When `beforeRun` refuses a run, or the run fails or is canceled, the place and the money it held of the team's limits are given back without the hook having to do anything.

Return value:

| You return | Effect |
| --- | --- |
| `{ allow: true }`, or nothing | The run proceeds. |
| `{ allow: false, reason: '…' }` | The run fails. `reason` (up to 300 characters) is shown to the user as it is, untranslated. |
| `{ allow: false }` | The run fails with the standard message `run.billing_denied`. |
| (throws) | The run fails with `run.billing_error`. The exception is logged; its text is not shown to the user. |

When `beforeRun` refuses or throws, `onFailed` is **not** called for that run: nothing was reserved from the runner's point of view.

### `afterRun(ctx, result)`

Called when the run has succeeded and its result is stored.

| Run kind | `result` |
| --- | --- |
| image, video | `{ outputs: [{ type, url, key, thumbnailUrl, thumbKey, width, height }] }` |
| chat | `{ text, usage?: { inputTokens, outputTokens }, cost?: { amount, currency, unknown } }` |

For chat models with a per-token price, `result.cost` is the cost calculated from reported usage. That is the first moment the real amount is known.

### `onFailed(ctx, error)`

Called when a run that `beforeRun` allowed ends without success: it failed, timed out, was canceled, or was interrupted by a server stop. Use it to refund or release what `beforeRun` reserved. It can be called more than once for the same run after a crash (see [Guarantees and non-guarantees](#guarantees-and-non-guarantees)), so make it idempotent per `ctx.runId`.

`error` is the error object. `error.code` tells common cases apart:

| `error.code` | Case |
| --- | --- |
| `'CANCELED'` | The user canceled the run. |
| `'TIMEOUT'` | A deadline passed. |
| `'UPSTREAM_FAILED'` | The upstream reported failure. |
| `'DOWNLOAD_FAILED'`, `'BAD_RESULT'`, `'EMPTY'` | The result could not be fetched or was not usable. |
| `'INTERRUPTED'` | The server stopped after the request was sent and before an upstream task id was known (`run.interrupted`). The upstream may or may not have processed it. |
| other or missing | An error from the provider or an internal one. |

Exceptions thrown by `afterRun` and `onFailed` are logged and otherwise ignored; they do not change the run.

## When each function is called

| Situation | `beforeRun` | `afterRun` | `onFailed` |
| --- | --- | --- | --- |
| Run succeeds | once | once | |
| Run fails or times out after being allowed | once | | once |
| User cancels a running run | once | | once (`CANCELED`) |
| User cancels a run that is still queued | | | |
| `beforeRun` refuses or throws | once | | |
| The run's provider was deleted before it started | | | |
| Clean shutdown while the run is in flight, upstream task id known, or nothing sent yet | once in total | when it finally succeeds | when it finally fails |
| Clean shutdown while the run is in flight, request sent, **no** task id (every sync provider, every chat) | once | | once (`INTERRUPTED`) |
| Process crash while the run is in flight, upstream task id known | once in total | when it finally succeeds | when it finally fails |
| Process crash while the run is in flight, **no** task id | once | | at the next start (`INTERRUPTED`), at least once |

## A worked example

A daily spending cap, in the currency of your price tables. Save as `hooks/daily-budget.js`:

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

This example is deliberately minimal. It mixes currencies if your price tables do, it refuses every chat model priced per token (their cost is unknown before the run), and it forgets everything on restart. A real hook keeps its state in a database, keyed by `ctx.runId`.

## Guarantees and non-guarantees

What the runner guarantees:

- `beforeRun` is called before anything is sent upstream, and at most once per run. The fact that it allowed the run is stored with the run (`billingStarted`), so a run that is re-queued by a restart is not charged a second time.
- A refusal stops the run: no upstream request is made.
- For a run that was allowed and reaches a final state while the process is alive, exactly one of `afterRun` and `onFailed` is called.
- A hook that throws never crashes the server or the run queue.

What it does **not** guarantee:

- **No delivery guarantee across crashes.** If the process dies (crash, `kill -9`, power loss) between storing a run's final state and calling the hook, the call is lost. Hook calls are not retried or replayed.
- **`onFailed` after a crash is at-least-once.** A run found mid-flight without an upstream task id at the next start is failed with `run.interrupted`. If `beforeRun` had allowed it, `onFailed` is called first and the run record is updated second. A crash between the two repeats the call at the following start, so `onFailed` should be idempotent per `ctx.runId`.
- **An interrupted run may have been processed upstream.** Nothing is sent to an upstream twice. On shutdown a run goes back to the queue only if it already has an upstream task id (it is polled again, not resubmitted) or if nothing was sent for it yet. A run whose request was sent but has no task id fails with `run.interrupted` and `onFailed` is called; that covers every run of a synchronous provider (OpenAI-compatible images, Gemini) and every chat that is in flight at that moment. Whether the upstream processed, and billed, that request is unknown.
- **Not transactional.** The hook and the run's database update are separate steps.
- **No timeout on the hook.** The runner awaits each call. A slow `beforeRun` delays the run and holds one of the `concurrency` slots.
- **The cost is an estimate.** It comes from the price table an operator typed in, not from the upstream's bill. A run that fails may still have been billed upstream.
- **The hook knows the account and the space, not more.** `ctx.userId` and `ctx.username` say who started the run, `ctx.spaceId` and `ctx.teamId` where; balances, plans and quotas are yours to keep. A hook written for earlier versions, where `userId` was always the constant `'local'`, has to be changed if it relied on that value.
- **A team's monthly limits come first.** A run a team's limit refuses is refused when it is submitted (`403 budget.*`) and never reaches the hook. The hook sees a team run only after it was accepted, when it is taken from the queue.
- **Tool nodes do not pass through the hook.** Slice, collage, watermark, resize and multi-platform export are not runs.
