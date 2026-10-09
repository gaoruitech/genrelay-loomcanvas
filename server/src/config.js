'use strict'

/**
 * Environment configuration. Everything the server reads from the environment
 * is parsed and validated here, once, so the rest of the code can trust it.
 */
const path = require('path')

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true })

class ConfigError extends Error {}

function str(name, dft = '') {
  const v = process.env[name]
  return v === undefined || v === null ? dft : String(v).trim()
}

function int(name, dft, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = str(name)
  if (!raw) return dft
  const n = Number(raw)
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ConfigError(`${name} must be an integer between ${min} and ${max}, got "${raw}"`)
  }
  return n
}

function build() {
  const secretKey = str('SECRET_KEY')
  if (secretKey.length < 16) {
    // Never fall back to a generated key: provider API keys are encrypted with
    // it, so a key that changes between restarts silently destroys them.
    throw new ConfigError(
      'SECRET_KEY is required and must be at least 16 characters. ' +
      'Set it in server/.env (see .env.example); keep it stable, stored provider keys are encrypted with it.'
    )
  }

  const storageDriver = str('STORAGE_DRIVER', 'local').toLowerCase()
  if (!['local', 's3', 'oss'].includes(storageDriver)) {
    throw new ConfigError(`STORAGE_DRIVER must be one of local, s3, oss (got "${storageDriver}")`)
  }

  let publicUrl = str('PUBLIC_URL').replace(/\/+$/, '')
  if (publicUrl) {
    let u
    try { u = new URL(publicUrl) } catch { throw new ConfigError('PUBLIC_URL is not a valid URL') }
    if (!['http:', 'https:'].includes(u.protocol)) throw new ConfigError('PUBLIC_URL must be http(s)')
  }

  const serverRoot = path.resolve(__dirname, '..')
  const resolveFromRoot = (p) => (path.isAbsolute(p) ? p : path.resolve(serverRoot, p))

  return Object.freeze({
    port: int('PORT', 3000, { min: 1, max: 65535 }),
    mongodbUri: str('MONGODB_URI', 'mongodb://127.0.0.1:27017/loomcanvas'),
    secretKey,
    publicUrl,
    accessPassword: str('ACCESS_PASSWORD'),
    corsOrigins: str('CORS_ORIGIN').split(',').map((s) => s.trim()).filter(Boolean),
    trustProxy: str('TRUST_PROXY'),
    // Hosts exempt from the private-address block of the downloader, for
    // upstreams on the local network that return result links pointing at themselves.
    ssrfAllowHosts: str('SSRF_ALLOW_HOSTS').split(',').map((s) => s.trim()).filter(Boolean),
    maxUploadBytes: int('MAX_UPLOAD_MB', 50, { min: 1, max: 2048 }) * 1024 * 1024,
    billingHook: str('BILLING_HOOK'),
    webDist: str('WEB_DIST') ? resolveFromRoot(str('WEB_DIST')) : '',
    storage: Object.freeze({
      driver: storageDriver,
      localDir: resolveFromRoot(str('STORAGE_LOCAL_DIR', './data/files')),
      s3: Object.freeze({
        endpoint: str('S3_ENDPOINT'),
        region: str('S3_REGION', 'auto'),
        bucket: str('S3_BUCKET'),
        accessKeyId: str('S3_ACCESS_KEY_ID'),
        secretAccessKey: str('S3_SECRET_ACCESS_KEY'),
        forcePathStyle: /^(1|true|yes)$/i.test(str('S3_FORCE_PATH_STYLE')),
        publicBaseUrl: str('S3_PUBLIC_BASE_URL').replace(/\/+$/, ''),
      }),
      oss: Object.freeze({
        region: str('OSS_REGION'),
        endpoint: str('OSS_ENDPOINT'),
        bucket: str('OSS_BUCKET'),
        accessKeyId: str('OSS_ACCESS_KEY_ID'),
        accessKeySecret: str('OSS_ACCESS_KEY_SECRET'),
        publicBaseUrl: str('OSS_PUBLIC_BASE_URL').replace(/\/+$/, ''),
      }),
    }),
  })
}

let cached = null

/** Parsed configuration. Throws ConfigError with a readable message when invalid. */
function getConfig() {
  if (!cached) cached = build()
  return cached
}

/** Test helper: drop the cache so the next getConfig() re-reads process.env. */
function resetConfig() { cached = null }

module.exports = { getConfig, resetConfig, ConfigError }
