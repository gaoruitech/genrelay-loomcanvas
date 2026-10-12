/*
 * Applies the stored colour theme before the first paint. Loaded synchronously from <head> as a file of its
 * own: the page's Content-Security-Policy is `script-src 'self'`, so this cannot be an inline script.
 * Keep it in step with src/composables/useTheme.ts (same storage key, same attributes).
 */
(function () {
  var root = document.documentElement
  var pref = 'dark'
  try {
    var saved = localStorage.getItem('loomcanvas-theme')
    if (saved === 'light' || saved === 'system') pref = saved
  } catch (e) { /* storage blocked: the default theme */ }
  var theme = pref
  if (pref === 'system') {
    theme = 'dark'
    try { if (window.matchMedia('(prefers-color-scheme: light)').matches) theme = 'light' } catch (e) { /* old browser */ }
  }
  root.setAttribute('data-theme', theme)
  root.setAttribute('theme-mode', theme)
  // The two <meta> tags sit above this script in index.html, so they exist by now.
  var meta = document.querySelector('meta[name="color-scheme"]')
  if (meta) meta.setAttribute('content', theme)
  meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', theme === 'light' ? '#eef2f9' : '#050a1e')
})()
