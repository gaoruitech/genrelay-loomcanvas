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

  // Fail early on a bad storage setup (missing SDK, missing bucket...).
  const { getStorage } = require('./storage')
  const storage = getStorage()

  mongoose.set('strictQuery', true)
  await mongoose.connect(config.mongodbUri, { serverSelectionTimeoutMS: 10000 })
  console.log('[db] connected')

  const settings = require('./services/settings')
  await settings.load()
  if (await require('./services/seed').seed()) console.log('[seed] built-in templates installed')

  const { getRunner } = require('./runner')
  const runner = getRunner()
  const resumed = await runner.start()
  if (resumed) console.log(`[runner] resumed ${resumed} unfinished run(s)`)

  const retention = require('./services/retention')
  retention.start()

  const app = require('./app').createApp()
  const server = app.listen(config.port, () => {
    console.log(`[http] LoomCanvas server listening on :${config.port} (storage: ${storage.driver}, login: ${config.accessPassword ? 'on' : 'off'})`)
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
  console.error('[fatal]', err && err.message ? err.message : err)
  process.exit(1)
})
