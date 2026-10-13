'use strict'

/** Process entry: configuration, database, seed, runner, HTTP server, shutdown. */
const mongoose = require('mongoose')
const { getConfig, ConfigError } = require('./config')

async function main() {
  let config
  try {
    config = getConfig()
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`\n[config] ${err.message}\n`)
      process.exit(1)
    }
    throw err
  }

  const { setAllowedHosts } = require('./utils/safeFetch')
  setAllowedHosts(config.ssrfAllowHosts)

  mongoose.set('strictQuery', true)
  await mongoose.connect(config.mongodbUri, { serverSelectionTimeoutMS: 10000 })
  console.log('[db] connected')

  const settings = require('./services/settings')
  await settings.load()
  // REGISTRATION_OPEN is the first value of that setting, not an override of a saved one.
  if (config.registrationOpen !== null && await settings.seed('registrationOpen', config.registrationOpen)) {
    console.log(`[auth] registration is ${config.registrationOpen ? 'open' : 'closed'} (REGISTRATION_OPEN); the super admin can change it under Settings > Site`)
  }
  // Storage: what was saved on the settings page wins over the environment.
  const storage = await require('./services/storageSettings').load()
  if (storage.secretUnreadable) {
    console.error('[storage] the saved S3 secret cannot be decrypted (was SECRET_KEY changed?). Enter it again under Settings > Storage.' +
      (storage.writable ? ' Until then the files in that bucket do not load.' : ' Until then the files in that bucket do not load and NEW FILES ARE REFUSED: nothing is written anywhere else in its place.'))
  }
  // Files of deleted accounts and teams that a storage could not give up yet are tried again in the background.
  require('./services/storageCleanup').start()
  // Providers saved by an older version are brought to the vendor model once.
  const upgraded = await require('./services/providerMigration').migrateProviders()
  if (upgraded.providers) console.log(`[providers] brought ${upgraded.providers} stored provider(s) up to date, ${upgraded.customModels} custom model(s) carried over`)
  // A custom model the vendor's catalog now lists itself is served from the catalog.
  const shadowed = await require('./services/providerMigration').dropShadowedCustomModels()
  if (shadowed) console.log(`[providers] ${shadowed} custom model(s) are now in their vendor's catalog; the custom entries were removed, settings for them are kept`)
  // Accounts: per-account indexes, the super admin, and data from before accounts (see services/accounts.js).
  if (config.legacyAccessPassword) {
    console.warn('[auth] ACCESS_PASSWORD is set but no longer used: LoomCanvas has accounts now. Remove it from the environment; see docs/getting-started.md#accounts.')
  }
  // Creates the super admin when there is none. A generated password is printed here, once, in a framed block.
  const accountState = await require('./services/accounts').prepare()
  if (accountState.admin.created && !accountState.admin.generated) {
    console.log(`[auth] created the super admin account "${accountState.admin.username}" with the password from ADMIN_PASSWORD`)
  }
  if (accountState.adopted) {
    console.log(`[auth] the data from before accounts now belongs to "${accountState.admin.username}": ${JSON.stringify(accountState.adopted)}`)
  }
  // Canvases written by an older version are brought to the current document shape.
  const canvases = await require('./routes/workflow').migrateStoredWorkflows()
  if (canvases) console.log(`[canvas] brought ${canvases} stored canvas(es) up to the current document version`)
  if (await require('./services/seed').seed()) console.log('[seed] built-in templates installed')

  // Teams: their indexes, the per-team run caps, and the hourly removal of dissolved teams whose time is up.
  const teams = require('./services/teams')
  await teams.start()

  const { getRunner } = require('./runner')
  const runner = getRunner()
  const resumed = await runner.start()
  if (resumed) console.log(`[runner] resumed ${resumed} unfinished run(s)`)
  // The counters the teams' monthly limits are checked against are a cache of the run records:
  // whatever a process that was killed mid-way left behind is put right from the records here.
  await require('./services/budget').reconcileAll()

  const retention = require('./services/retention')
  retention.start()

  const app = require('./app').createApp()
  const server = app.listen(config.port, () => {
    console.log(`[http] LoomCanvas server listening on :${config.port} (storage: ${storage.driver} from ${storage.source === 'saved' ? 'settings' : 'environment'}, accounts: ${accountState.users})`)
  })
  // Long uploads and zip downloads must not be cut by the default timeouts.
  server.requestTimeout = 15 * 60 * 1000
  server.headersTimeout = 60 * 1000

  let closing = false
  const shutdown = async (signal) => {
    if (closing) return
    closing = true
    console.log(`[shutdown] ${signal} received`)
    // If something hangs, do not hang with it.
    const force = setTimeout(() => { console.error('[shutdown] timed out, exiting'); process.exit(1) }, 20000)
    force.unref()
    try {
      retention.stop()
      teams.stop()
      server.close()
      server.closeIdleConnections()
      // In-flight runs go back to `queued`; the next start picks them up.
      await runner.shutdown()
      await mongoose.disconnect()
    } catch (err) {
      console.error('[shutdown] error:', err.message)
    }
    process.exit(0)
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('unhandledRejection', (reason) => console.error('[unhandledRejection]', reason))
}

main().catch((err) => {
  // A setting that only turns out to be wrong once the database is there (ADMIN_*).
  if (err instanceof ConfigError) console.error(`\n[config] ${err.message}\n`)
  else console.error('[fatal]', err && err.message ? err.message : err)
  process.exit(1)
})
