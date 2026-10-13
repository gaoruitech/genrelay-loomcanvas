'use strict'

/**
 * A second server PROCESS on the database of a test that is already running:
 * its own module state, its own runner, its own event loop - which is what
 * "several server processes on one database" means, and what a second
 * createApp() in the same process would not be.
 *
 * The test spawns it with start(); merely loading this file (the test runner
 * loads every file under test/) does nothing.
 *
 *   const second = await start(h)      // h: a booted teamHarness
 *   second.base                        // http://127.0.0.1:<port>
 *   await second.stop()
 *
 * The child takes its settings from the environment the harness set up
 * (SECRET_KEY, storage, billing hook) and the database from LC_SECOND_MONGO.
 */
const path = require('path')
const { spawn } = require('child_process')

async function main() {
  const mongoose = require('mongoose')
  await mongoose.connect(process.env.LC_SECOND_MONGO, { serverSelectionTimeoutMS: 8000 })
  require('../../src/utils/safeFetch').setAllowedHosts(['127.0.0.1'])
  await require('../../src/services/settings').load()
  const teams = require('../../src/services/teams')
  await teams.start()
  const { getRunner } = require('../../src/runner')
  await getRunner().start()
  getRunner().pollIntervalMs = [40, 120]
  const server = require('../../src/app').createApp().listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  process.stdout.write(`${JSON.stringify({ port: server.address().port })}\n`)
  const stop = async () => {
    teams.stop()
    await getRunner().shutdown().catch(() => {})
    server.closeAllConnections()
    server.close()
    await mongoose.disconnect().catch(() => {})
    process.exit(0)
  }
  // The parent closes our stdin (or goes away): stop.
  process.stdin.on('end', stop)
  process.stdin.on('close', stop)
  process.stdin.resume()
}

/** Start the second process against the harness's database. Nothing may be queued or in flight at that moment. */
async function start(h) {
  const conn = h.mongoose.connection
  const uri = process.env.TEST_MONGODB_URI ? new URL(process.env.TEST_MONGODB_URI) : new URL(`mongodb://${conn.host}:${conn.port}/`)
  uri.pathname = `/${conn.name}`
  // Not a test file of its own: the test runner's marker for its children must not travel on.
  const { NODE_TEST_CONTEXT: _ignored, ...env } = process.env
  const child = spawn(process.execPath, [__filename], {
    env: { ...env, LC_SECOND_INSTANCE: '1', LC_SECOND_MONGO: uri.toString() },
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: path.join(__dirname, '..', '..'),
  })
  let err = ''
  child.stderr.on('data', (c) => { err += c })
  const port = await new Promise((resolve, reject) => {
    let out = ''
    const timer = setTimeout(() => reject(new Error(`the second instance did not start: ${err.slice(0, 500)}`)), 30000)
    child.stdout.on('data', (c) => {
      out += c
      const line = out.split('\n').find((l) => l.startsWith('{'))
      if (line) { clearTimeout(timer); resolve(JSON.parse(line).port) }
    })
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the second instance exited (${code}): ${err.slice(0, 500)}`)) })
  })
  const base = `http://127.0.0.1:${port}`
  return {
    base,
    pid: child.pid,
    /** A JSON call to the second process as the account and space of a harness client. */
    async call(client, method, pathname, body) {
      const headers = { Authorization: `Bearer ${client.token}` }
      if (client.space) headers['X-Space'] = client.space
      if (body !== undefined) headers['Content-Type'] = 'application/json'
      const res = await fetch(base + pathname, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
      return { status: res.status, body: await res.json() }
    },
    stderr: () => err,
    async stop() {
      if (child.exitCode !== null) return
      const gone = new Promise((resolve) => child.once('exit', resolve))
      child.stdin.end()
      const timer = setTimeout(() => child.kill(), 8000)
      await gone
      clearTimeout(timer)
    },
  }
}

if (require.main === module && process.env.LC_SECOND_INSTANCE === '1') {
  main().catch((err) => { console.error(err); process.exit(1) })
}

module.exports = { start }
