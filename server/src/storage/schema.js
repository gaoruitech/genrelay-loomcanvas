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
const { ApiError } = require('../utils/http')
const { msg } = require('../i18n')

const PRESETS = ['aws', 'r2', 'oss', 'minio', 'custom']
const DELIVERIES = ['proxy', 'redirect']
const ACLS = ['', 'private', 'public-read']

const BUCKET_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/
const REGION_RE = /^[a-z0-9][a-z0-9-]{0,39}$/
const PREFIX_PART_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/

/**
 * A refusal about one field of the form. The message names the field in the
 * reader's words (`storage.field.*`), never by its key in the API, and
 * `data.field` says which input it belongs to - several fields share one
 * rule (the endpoint and the endpoint for signed URLs), so the code alone
 * does not say which of them is wrong.
 */
function refuse(key, field, params = {}) {
  return new ApiError(400, key, { field: msg(FIELD_LABEL[field]), ...params }, -1, { field })
}

/** The fields of the form and the catalog entry that names each of them. */
const FIELD_LABEL = {
  preset: 'storage.field.preset',
  endpoint: 'storage.field.endpoint',
  region: 'storage.field.region',
  bucket: 'storage.field.bucket',
  accessKeyId: 'storage.field.accessKeyId',
  secretAccessKey: 'storage.field.secretAccessKey',
  forcePathStyle: 'storage.field.forcePathStyle',
  keyPrefix: 'storage.field.keyPrefix',
  publicBaseUrl: 'storage.field.publicBaseUrl',
  presignEndpoint: 'storage.field.presignEndpoint',
  delivery: 'storage.field.delivery',
  acl: 'storage.field.acl',
}

function str(v, field, max) {
  if (v === undefined || v === null) return ''
  if (typeof v !== 'string') throw refuse('validation.string', field)
  const s = v.trim()
  if (s.length > max || /[\r\n\0]/.test(s)) throw refuse('validation.bad_format', field)
  return s
}

function bool(v, field) {
  if (v === undefined || v === null) return false
  if (typeof v !== 'boolean') throw refuse('validation.boolean', field)
  return v
}

/** An http(s) URL without credentials, query or fragment; returned without a trailing slash. */
function httpUrl(v, field, { allowPath }) {
  const s = str(v, field, 500)
  if (!s) return ''
  let u
  try { u = new URL(s) } catch { throw refuse('validation.bad_url', field) }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw refuse('validation.bad_url', field)
  if (u.username || u.password || u.search || u.hash) throw refuse('validation.bad_url', field)
  if (!allowPath && u.pathname !== '/') throw refuse('storage.endpoint_has_path', field)
  return (u.origin + (allowPath ? u.pathname : '')).replace(/\/+$/, '')
}

/** '' or 'a/b/' - what is put in front of every key inside the bucket. */
function keyPrefix(v) {
  const s = str(v, 'keyPrefix', 200).replace(/^\/+|\/+$/g, '')
  if (!s) return ''
  const parts = s.split('/')
  if (parts.some((p) => !PREFIX_PART_RE.test(p) || p.includes('..'))) throw refuse('storage.bad_key_prefix', 'keyPrefix')
  return parts.join('/') + '/'
}

/**
 * Validate an S3 configuration. `secretAccessKey` may be empty here: the
 * caller decides whether a stored secret stands in for it.
 */
function parseS3Config(input) {
  const b = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const preset = str(b.preset, 'preset', 20) || 'custom'
  if (!PRESETS.includes(preset)) throw refuse('validation.one_of', 'preset', { values: PRESETS.join(' / ') })

  const endpoint = httpUrl(b.endpoint, 'endpoint', { allowPath: false })
  const bucket = str(b.bucket, 'bucket', 63)
  if (!bucket) throw refuse('validation.required', 'bucket')
  if (!BUCKET_RE.test(bucket)) throw refuse('storage.bad_bucket', 'bucket')
  // The single most common mistake: pasting the bucket's own domain as the endpoint.
  if (endpoint && new URL(endpoint).hostname.startsWith(`${bucket}.`)) throw refuse('storage.endpoint_has_bucket', 'endpoint')

  const region = str(b.region, 'region', 40).toLowerCase() || 'us-east-1'
  if (!REGION_RE.test(region)) throw refuse('validation.bad_format', 'region')

  const accessKeyId = str(b.accessKeyId, 'accessKeyId', 200)
  if (!accessKeyId) throw refuse('validation.required', 'accessKeyId')
  if (/\s/.test(accessKeyId)) throw refuse('validation.bad_format', 'accessKeyId')
  const secretAccessKey = str(b.secretAccessKey, 'secretAccessKey', 500)

  const publicBaseUrl = httpUrl(b.publicBaseUrl, 'publicBaseUrl', { allowPath: true })
  // Where signed addresses point: the same service as `endpoint`, under the name it has from outside.
  const presignEndpoint = httpUrl(b.presignEndpoint, 'presignEndpoint', { allowPath: false })
  if (presignEndpoint && new URL(presignEndpoint).hostname.startsWith(`${bucket}.`)) throw refuse('storage.endpoint_has_bucket', 'presignEndpoint')
  const delivery = str(b.delivery, 'delivery', 20) || (publicBaseUrl ? 'redirect' : 'proxy')
  if (!DELIVERIES.includes(delivery)) throw refuse('validation.one_of', 'delivery', { values: DELIVERIES.join(' / ') })
  if (delivery === 'redirect' && !publicBaseUrl) throw refuse('storage.redirect_needs_public_url', 'publicBaseUrl')

  const acl = str(b.acl, 'acl', 20)
  if (!ACLS.includes(acl)) throw refuse('validation.one_of', 'acl', { values: ACLS.filter(Boolean).join(' / ') })

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
    presignEndpoint,
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

/** A bucket as a log line or an error names it: where it is, never a credential. */
function describePlace(cfg) {
  return `${endpointHost(cfg)}/${cfg.bucket}${cfg.keyPrefix ? `/${String(cfg.keyPrefix).replace(/\/$/, '')}` : ''}`
}

module.exports = { PRESETS, DELIVERIES, ACLS, parseS3Config, refuse, backendId, endpointHost, describePlace }
