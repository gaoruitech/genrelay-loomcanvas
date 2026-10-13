'use strict'

/**
 * "Can a service on the internet open this address?" - one rule, used for
 * every address that is handed to an upstream model: PUBLIC_URL, the public
 * domain of a bucket, and the endpoint a signed address is made for.
 *
 * The address alone is looked at; nothing is resolved or contacted. Not public:
 *   - anything that is not http(s), or that carries credentials;
 *   - literal loopback, private, link-local and other reserved addresses (the
 *     list the downloader refuses to connect to, utils/safeFetch.js);
 *   - a host name of a single label ("localhost", "minio", "storage"): a
 *     container or machine name, which only resolves inside its own network;
 *   - names under a suffix that is used for private networks.
 *
 * SSRF_ALLOW_HOSTS has no say here. It lists what this server may download
 * from; that the server can reach a host on its own network does not mean an
 * upstream on the internet can.
 */
const net = require('net')
const { isBlockedAddress } = require('./safeFetch')

/**
 * Suffixes that deployments use for names inside their own network and that
 * do not exist on the internet: .localhost, .local, .internal, .test and
 * .home.arpa (reserved for exactly that: RFC 6761, RFC 6762, RFC 8375), the
 * private suffixes RFC 6762 lists as in common use, and the service names of a
 * Kubernetes cluster.
 */
const PRIVATE_SUFFIXES = ['.localhost', '.local', '.internal', '.test', '.home.arpa', '.lan', '.home', '.corp', '.intranet', '.private', '.svc']

function isPubliclyReachable(raw) {
  let u
  try { u = new URL(String(raw)) } catch { return false }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
  if (u.username || u.password) return false
  // "minio." is the same host as "minio".
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '')
  if (!host) return false
  if (net.isIP(host)) return !isBlockedAddress(host)
  if (!host.includes('.')) return false
  return !PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix))
}

module.exports = { isPubliclyReachable }
