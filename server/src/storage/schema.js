'use strict'

/**
 * Shape and validation of an S3 storage configuration, shared by the
 * environment bootstrap (config.js) and the settings API.
 *
 * One driver speaks to every S3-compatible service. What differs between
 * vendors is expressed as explicit options (forcePathStyle, region, acl), never
 * guessed from the endpoint while serving files. `preset` is only a label the
 * settings page uses to pre-fill those options.
 */
const crypto = require('crypto')
const { badRequest } = require('../utils/http')

const PRESETS = ['aws', 'r2', 'oss', 'minio', 'custom']
const DELIVERIES = ['proxy', 'redirect']
const ACLS = ['', 'private', 'public-read']

const BUCKET_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/
const REGION_RE = /^[a-z0-9][a-z0-9-]{0,39}$/
const PREFIX_PART_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/

function str(v, field, max) {
  if (v === undefined || v === null) return ''
  if (typeof v !== 'string') throw badRequest('validation.string', { field })
  const s = v.trim()
  if (s.length > max || /[\r\n\0]/.test(s)) throw badRequest('validation.bad_format', { field })
  return s
}

function bool(v, field) {
  if (v === undefined || v === null) return false
  if (typeof v !== 'boolean') throw badRequest('validation.boolean', { field })
  return v
}

/** An http(s) URL without credentials, query or fragment; returned without a trailing slash. */
function httpUrl(v, field, { allowPath }) {
  const s = str(v, field, 500)
  if (!s) return ''
  let u
  try { u = new URL(s) } catch { throw badRequest('validation.bad_url', { field }) }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw badRequest('validation.bad_url', { field })
  if (u.username || u.password || u.search || u.hash) throw badRequest('validation.bad_url', { field })
  if (!allowPath && u.pathname !== '/') throw badRequest('storage.endpoint_has_path')
  return (u.origin + (allowPath ? u.pathname : '')).replace(/\/+$/, '')
}

/** '' or 'a/b/' - what is put in front of every key inside the bucket. */
function keyPrefix(v) {
  const s = str(v, 'keyPrefix', 200).replace(/^\/+|\/+$/g, '')
  if (!s) return ''
  const parts = s.split('/')
  if (parts.some((p) => !PREFIX_PART_RE.test(p) || p.includes('..'))) throw badRequest('storage.bad_key_prefix')
  return parts.join('/') + '/'
}

/**
 * Validate an S3 configuration. `secretAccessKey` may be empty here: the
 * caller decides whether a stored secret stands in for it.
 */
function parseS3Config(input) {
  const b = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const preset = str(b.preset, 'preset', 20) || 'custom'
  if (!PRESETS.includes(preset)) throw badRequest('validation.one_of', { field: 'preset', values: PRESETS.join(' / ') })

  const endpoint = httpUrl(b.endpoint, 'endpoint', { allowPath: false })
  const bucket = str(b.bucket, 'bucket', 63)
  if (!bucket) throw badRequest('validation.required', { field: 'bucket' })
  if (!BUCKET_RE.test(bucket)) throw badRequest('storage.bad_bucket')
  // The single most common mistake: pasting the bucket's own domain as the endpoint.
  if (endpoint && new URL(endpoint).hostname.startsWith(`${bucket}.`)) throw badRequest('storage.endpoint_has_bucket')

  const region = str(b.region, 'region', 40).toLowerCase() || 'us-east-1'
  if (!REGION_RE.test(region)) throw badRequest('validation.bad_format', { field: 'region' })

  const accessKeyId = str(b.accessKeyId, 'accessKeyId', 200)
  if (!accessKeyId) throw badRequest('validation.required', { field: 'accessKeyId' })
  if (/\s/.test(accessKeyId)) throw badRequest('validation.bad_format', { field: 'accessKeyId' })
  const secretAccessKey = str(b.secretAccessKey, 'secretAccessKey', 500)

  const publicBaseUrl = httpUrl(b.publicBaseUrl, 'publicBaseUrl', { allowPath: true })
  const delivery = str(b.delivery, 'delivery', 20) || (publicBaseUrl ? 'redirect' : 'proxy')
  if (!DELIVERIES.includes(delivery)) throw badRequest('validation.one_of', { field: 'delivery', values: DELIVERIES.join(' / ') })
  if (delivery === 'redirect' && !publicBaseUrl) throw badRequest('storage.redirect_needs_public_url')

  const acl = str(b.acl, 'acl', 20)
  if (!ACLS.includes(acl)) throw badRequest('validation.one_of', { field: 'acl', values: ACLS.filter(Boolean).join(' / ') })

  return {
    preset,
    endpoint,
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    forcePathStyle: bool(b.forcePathStyle, 'forcePathStyle'),
    keyPrefix: keyPrefix(b.keyPrefix),
    publicBaseUrl,
    delivery,
    acl,
  }
}

/**
 * Identity of the place a configuration writes to: endpoint + bucket + prefix.
 * Credentials, region and addressing style are not part of it - changing those
 * still points at the same objects.
 */
function backendId(cfg) {
  const where = [String(cfg.endpoint || '').toLowerCase(), cfg.bucket, cfg.keyPrefix || ''].join('|')
  return `s3-${crypto.createHash('sha256').update(where).digest('hex').slice(0, 12)}`
}

/** Host shown in the status card: the endpoint's, or the AWS default when none is set. */
function endpointHost(cfg) {
  if (!cfg.endpoint) return `s3.${cfg.region}.amazonaws.com`
  try { return new URL(cfg.endpoint).host } catch { return '' }
}

module.exports = { PRESETS, DELIVERIES, ACLS, parseS3Config, backendId, endpointHost }
