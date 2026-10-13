'use strict'

/**
 * Environment configuration. Everything the server reads from the environment
 * is parsed and validated here, once, so the rest of the code can trust it.
 */
const net = require('net')
const path = require('path')

const { t } = require('./i18n')
const { parseS3Config } = require('./storage/schema')

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

/** true / false, or null when the variable is not set. */
function bool(name) {
  const raw = str(name).toLowerCase()
  if (!raw) return null
  if (raw === 'true') return true
  if (raw === 'false') return false
  throw new ConfigError(`${name} must be true or false, got "${raw}"`)
}

const TRUST_PROXY_NAMES = new Set(['loopback', 'linklocal', 'uniquelocal'])

function isSubnet(v) {
  const [addr, prefix, ...rest] = v.split('/')
  const family = net.isIP(addr)
  if (!family || rest.length) return false
  if (prefix === undefined) return true
  return /^\d{1,3}$/.test(prefix) && Number(prefix) <= (family === 4 ? 32 : 128)
}

/**
 * TRUST_PROXY: how many reverse proxies sit in front (1, 2...), or which
 * addresses they connect from. There is deliberately no "trust everything":
 * with it any client could pick its own address in X-Forwarded-For and walk
 * around the sign-in rate limit.
 */
function trustProxy(name) {
  const raw = str(name)
  if (!raw) return false
  if (/^\d+$/.test(raw)) {
    const hops = Number(raw)
    if (hops > 10) throw new ConfigError(`${name} must be at most 10 proxies, got "${raw}"`)
    return hops || false
  }
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean)
  for (const item of list) {
    if (!TRUST_PROXY_NAMES.has(item) && !isSubnet(item)) {
      throw new ConfigError(
        `${name} must be the number of reverse proxies in front of the server (e.g. 1) or a comma-separated list of ` +
        `their addresses (IP, CIDR, loopback, linklocal, uniquelocal); got "${item}"`
      )
    }
  }
  return list
}

const S3_REQUIRED = ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']

/**
 * The bucket the S3_* variables describe, when they describe one completely.
 * It is where new files go with STORAGE_DRIVER=s3, and a bucket that is still
 * read with any other driver: an install that used it and then went back to the
 * local disk keeps its files. Resolves { s3, problem }: with the driver set to
 * s3 a missing or invalid value stops the server; otherwise it is only reported
 * (`problem`), since nothing is written there.
 */
function envBucket(driver) {
  if (driver !== 's3' && S3_REQUIRED.some((name) => !str(name))) return { s3: null, problem: '' }
  try {
    return { s3: envS3(), problem: '' }
  } catch (err) {
    if (driver === 's3') throw err
    return { s3: null, problem: err.message }
  }
}

/** S3_* variables as a storage configuration (storage/schema.js). */
function envS3() {
  for (const name of S3_REQUIRED) {
    if (!str(name)) throw new ConfigError(`STORAGE_DRIVER=s3 requires ${name}`)
  }
  try {
    return Object.freeze(parseS3Config({
      endpoint: str('S3_ENDPOINT'),
      region: str('S3_REGION'),
      bucket: str('S3_BUCKET'),
      accessKeyId: str('S3_ACCESS_KEY_ID'),
      secretAccessKey: str('S3_SECRET_ACCESS_KEY'),
      forcePathStyle: /^(1|true|yes)$/i.test(str('S3_FORCE_PATH_STYLE')),
      keyPrefix: str('S3_KEY_PREFIX'),
      publicBaseUrl: str('S3_PUBLIC_BASE_URL'),
      presignEndpoint: str('S3_PRESIGN_ENDPOINT'),
      delivery: str('S3_DELIVERY').toLowerCase(),
      acl: str('S3_ACL').toLowerCase(),
    }))
  } catch (err) {
    throw new ConfigError(`The S3_* storage settings are not valid: ${err.message}`)
  }
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
  if (storageDriver === 'oss') {
    // Both languages: this is read by whoever upgraded, before any request sets a language.
    throw new ConfigError(['en', 'zh-CN'].map((locale) => t(locale, 'storage.oss_driver_removed')).join(' | '))
  }
  if (!['local', 's3'].includes(storageDriver)) {
    throw new ConfigError(`STORAGE_DRIVER must be one of local, s3 (got "${storageDriver}")`)
  }

  let publicUrl = str('PUBLIC_URL').replace(/\/+$/, '')
  if (publicUrl) {
    let u
    try { u = new URL(publicUrl) } catch { throw new ConfigError('PUBLIC_URL is not a valid URL') }
    if (!['http:', 'https:'].includes(u.protocol)) throw new ConfigError('PUBLIC_URL must be http(s)')
  }

  const serverRoot = path.resolve(__dirname, '..')
  const resolveFromRoot = (p) => (path.isAbsolute(p) ? p : path.resolve(serverRoot, p))
  const bucket = envBucket(storageDriver)

  return Object.freeze({
    port: int('PORT', 3000, { min: 1, max: 65535 }),
    mongodbUri: str('MONGODB_URI', 'mongodb://127.0.0.1:27017/loomcanvas'),
    secretKey,
    publicUrl,
    // The super admin the server creates when there is none. Read at that
    // moment only, and checked there (services/accounts.js): once the account
    // exists these are not looked at again. The password is taken as written.
    admin: Object.freeze({
      username: str('ADMIN_USERNAME', 'admin') || 'admin',
      email: str('ADMIN_EMAIL'),
      password: process.env.ADMIN_PASSWORD === undefined ? '' : String(process.env.ADMIN_PASSWORD),
    }),
    // First value of the "registration open" setting; null = not set, the setting's own default (open) applies.
    registrationOpen: bool('REGISTRATION_OPEN'),
    // Set by an install from before accounts. It no longer does anything; index.js says so once.
    legacyAccessPassword: str('ACCESS_PASSWORD') !== '',
    corsOrigins: str('CORS_ORIGIN').split(',').map((s) => s.trim()).filter(Boolean),
    trustProxy: trustProxy('TRUST_PROXY'),
    // Hosts exempt from the private-address block of the downloader, for
    // upstreams on the local network that return result links pointing at themselves.
    ssrfAllowHosts: str('SSRF_ALLOW_HOSTS').split(',').map((s) => s.trim()).filter(Boolean),
    maxUploadBytes: int('MAX_UPLOAD_MB', 50, { min: 1, max: 2048 }) * 1024 * 1024,
    billingHook: str('BILLING_HOOK'),
    webDist: str('WEB_DIST') ? resolveFromRoot(str('WEB_DIST')) : '',
    storage: Object.freeze({
      driver: storageDriver,
      localDir: resolveFromRoot(str('STORAGE_LOCAL_DIR', './data/files')),
      // The bucket the S3_* variables describe, validated; null when they do not describe one.
      // New files go there only with STORAGE_DRIVER=s3 (and nothing saved on the settings page);
      // with any other driver it is still read, so the files an install left there keep loading.
      s3: bucket.s3,
      // Why the S3_* variables are not used although they are set ('' = no problem).
      s3Problem: bucket.problem,
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
