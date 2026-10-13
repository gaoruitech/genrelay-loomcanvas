'use strict'

/**
 * Billing hook.
 *
 * LoomCanvas has no built-in accounting: users bring their own upstream keys
 * and the app only estimates and records cost. Deployments that need to charge
 * or meter usage point BILLING_HOOK at a module exporting any of the three
 * functions below; missing ones fall back to these no-ops.
 *
 *   ctx  = { runId, userId, username, spaceId, teamId, kind, model, providerType, workflowId, nodeId, params, count }
 *          userId / username: the account that started the run (its id, and its
 *          name at the time of the call)
 *          spaceId: the space the run belongs to - equal to userId for a run in
 *          a personal space, the team's id for a run in a team
 *          teamId: the team's id for a run in a team, '' otherwise
 *   cost = { amount, currency, unknown }
 *
 * beforeRun runs once per run before anything is sent upstream; returning
 * { allow: false, reason } fails the run with that reason. afterRun fires on
 * success, onFailed on failure or cancellation (use it to refund).
 */
const path = require('path')

const noop = {
  async beforeRun(_ctx, _cost) { return { allow: true } },
  async afterRun(_ctx, _result) {},
  async onFailed(_ctx, _error) {},
}

function loadBillingHook(modulePath) {
  if (!modulePath) return noop
  const resolved = path.isAbsolute(modulePath) ? modulePath : path.resolve(process.cwd(), modulePath)
  let custom
  try {
    custom = require(resolved)
  } catch (err) {
    throw new Error(`BILLING_HOOK could not be loaded from ${resolved}: ${err.message}`)
  }
  const hook = { ...noop }
  for (const name of Object.keys(noop)) {
    if (custom[name] === undefined) continue
    if (typeof custom[name] !== 'function') throw new Error(`BILLING_HOOK: ${name} must be a function`)
    hook[name] = custom[name].bind(custom)
  }
  return hook
}

module.exports = noop
module.exports.loadBillingHook = loadBillingHook
