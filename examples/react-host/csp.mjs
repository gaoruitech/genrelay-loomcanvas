// The Content-Security-Policy this example is served with (by `npm run preview` and by
// examples/serve.mjs). It is the policy docs/integration.md says an embedded editor needs, and
// nothing more: the browser check of this example fails when LoomCanvas violates it.
//
// `api` is the address of the LoomCanvas API the page calls (HTTP adapter); its origin also serves
// the stored files (`/files/<key>`). The memory adapter needs none of the three API entries.
export function contentSecurityPolicy(api = 'http://127.0.0.1:3000/api') {
  let origin = ''
  try { origin = new URL(api).origin } catch { /* a relative address: same origin, already covered by 'self' */ }
  return [
    "default-src 'none'",
    // No inline script, no eval.
    "script-src 'self'",
    // LoomCanvas positions nodes, menus and popups with style attributes.
    "style-src 'self' 'unsafe-inline'",
    // Results and uploads: the file origin; previews: blob: and data:.
    `img-src 'self' data: blob: ${origin}`.trim(),
    `media-src 'self' data: blob: ${origin}`.trim(),
    // The API; blob: and data: because previews are read back with fetch().
    `connect-src 'self' data: blob: ${origin}`.trim(),
    // fonts.css and its three files.
    "font-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ')
}
