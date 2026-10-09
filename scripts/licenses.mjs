#!/usr/bin/env node
// License inventory and gate for LoomCanvas production dependencies.
//
//   node scripts/licenses.mjs            check: exit 1 when a production dependency is outside
//                                        the allowlist, or THIRD_PARTY_NOTICES.md is out of date
//   node scripts/licenses.mjs --write    regenerate THIRD_PARTY_NOTICES.md (still exit 1 on a violation)
//   node scripts/licenses.mjs --json     print the inventory as JSON (same exit code as check)
//   --root <dir>                         run against another checkout / a test fixture
//
// Exit codes: 0 clean, 1 violation or stale notices file, 2 usage or I/O error.
//
// Plain Node >= 20, no dependencies. It reports facts read from package metadata; it is not
// legal advice.
//
// How the inventory is built
// --------------------------
// The source of truth is each project's package-lock.json (lockfile v2/v3 `packages` map), NOT
// the contents of node_modules. That keeps the result identical on Windows, Linux and macOS even
// though each of them installs a different set of platform binaries.
//
//   dev: true          skipped. Never installed by `npm ci --omit=dev`, never shipped.
//   optional: true     INCLUDED. These are production dependencies that npm installs only on a
//                      matching platform (sharp's `@img/sharp-*` binaries). Every one of them is
//                      inventoried, including those not installed on this machine.
//   devOptional: true  INCLUDED. npm keeps these when only dev dependencies are omitted, so they
//                      can end up in a production install.
//   peer: true         INCLUDED. npm >= 7 installs peers.
//   link / workspace   skipped (first-party code), as is anything flagged `extraneous`.
//
// Where the license comes from
// ----------------------------
//   required packages  the installed node_modules/<path>/package.json (`license`, or the legacy
//                      `licenses` array, which is read as "any of"). When the package is not
//                      installed the lockfile's `license` field is used and a warning is printed.
//   optional packages  ALWAYS the lockfile's `license` field, whether installed or not, and the
//   (and devOptional)  repository column is the npm registry page. Reading node_modules here
//                      would make the output depend on the platform that ran the script.
//
// A package with no license in either place is reported as UNKNOWN and fails the check. Two
// packages (busboy, streamsearch) have no `license` in the lockfile because they use the legacy
// `licenses` array, so the check needs `npm ci` to have been run in server/ and web/.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECTS = ['server', 'web']
const NOTICES_FILE = 'THIRD_PARTY_NOTICES.md'

// ---------------------------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------------------------

// SPDX identifiers a production dependency may carry. Matching is exact: `GPL-2.0-only` is not
// here, and neither is anything with a `+` suffix or a `WITH` exception. Add an identifier only
// after it has been reviewed.
const ALLOWED_LICENSES = new Set([
  '0BSD',
  'Apache-2.0',
  'BlueOak-1.0.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'CC-BY-3.0',
  'CC-BY-4.0',
  'CC0-1.0',
  'ISC',
  'MIT',
  'MIT-0',
  'Python-2.0',
  'Unlicense',
  'Zlib',
])

// Non-SPDX spellings seen in package.json files, mapped to the identifier they mean. Keep this
// list to spellings that are unambiguous.
const LICENSE_ALIASES = {
  'Apache 2.0': 'Apache-2.0',
  'Apache License 2.0': 'Apache-2.0',
  'Apache License, Version 2.0': 'Apache-2.0',
  'BSD': 'BSD-2-Clause',
  'MIT/X11': 'MIT',
  'Public Domain': 'Unlicense',
}

// Packages whose license is NOT on the allowlist but which have been looked at individually.
// Key: exact package name, or a prefix ending in `*`. An exact name wins over a prefix, and a
// longer prefix wins over a shorter one. `license` pins the exact expression that was reviewed:
// if the package ever declares something else the exception stops applying and the check fails.
// Each entry is printed as a "reviewed exception" by the check and listed in its own section of
// THIRD_PARTY_NOTICES.md. An exception records what was reviewed and why; it does not make a
// license permissive.
const EXCEPTIONS = {
  // libvips and the libraries it is built with, prebuilt by the sharp project as one shared
  // library per platform. No JavaScript. sharp's native addon loads it at run time (dynamic
  // linking); LoomCanvas neither modifies nor rebuilds it. `npm ci` installs only the one that
  // matches the host; the Docker image (node:20-alpine) gets a linuxmusl one.
  '@img/sharp-libvips-*': {
    license: 'LGPL-3.0-or-later',
    reason:
      'Prebuilt libvips shared library published by the sharp project. Loaded dynamically by ' +
      "sharp's native addon, used unmodified, replaceable by the user (swap the package or set " +
      'SHARP_FORCE_GLOBAL_LIBVIPS and build against a system libvips). Only the binary matching ' +
      'the install platform is present; the Docker image contains the linuxmusl build.',
  },
  // On Windows sharp does not use a separate libvips package: the libvips DLLs sit next to the
  // Apache-2.0 addon inside the same npm package, hence the compound expression.
  '@img/sharp-win32-*': {
    license: 'Apache-2.0 AND LGPL-3.0-or-later',
    reason:
      "sharp's Windows binary package: the Apache-2.0 native addon plus the LGPL libvips DLLs " +
      'shipped as separate files in the same package and loaded dynamically, unmodified. ' +
      'Installed only on Windows hosts; not present in the Docker image.',
  },
  // The WebAssembly build links libvips into a single .wasm file (static linking), which is a
  // different situation from the shared-library packages above.
  '@img/sharp-wasm32': {
    license: 'Apache-2.0 AND LGPL-3.0-or-later AND MIT',
    reason:
      "sharp's WebAssembly fallback: libvips is linked statically into one .wasm module. npm " +
      'installs it only when cpu=wasm32, so it is not present on any supported server platform ' +
      'nor in the Docker image. Listed because it is an optional production dependency in the ' +
      'lockfile.',
  },
}

// Things that are part of a deployment but do not come from npm. The Dockerfile and
// docker-compose.yml are parsed for base images and `apk add` packages; every one found must have
// an entry here, otherwise the check fails with "not reviewed". Keys: image repository without
// the tag, or `apk:<package>`.
const SYSTEM_COMPONENTS = {
  node: {
    name: 'Node.js runtime and Alpine Linux base image',
    license:
      'Node.js: MIT, with bundled components under their own licenses (V8 BSD-3-Clause, libuv ' +
      'MIT, OpenSSL Apache-2.0, ICU Unicode-3.0, zlib Zlib, npm Artistic-2.0, and others listed ' +
      'in the Node.js LICENSE file). Alpine packages: musl MIT, busybox GPL-2.0-only, apk-tools ' +
      'GPL-2.0-only, alpine-baselayout GPL-2.0-only, libstdc++/libgcc GPL-3.0-or-later WITH ' +
      'GCC-exception-3.1, and others.',
    note:
      'Base image of both build stages and of the final application image. The application ' +
      'runs on top of these as separate programs; the image health check calls busybox `wget`.',
  },
  mongo: {
    name: 'MongoDB Community Server',
    license: 'SSPL-1.0 (server); the image also contains mongosh (Apache-2.0) and an Ubuntu base',
    note:
      'Run as a separate service from the upstream image referenced in docker-compose.yml. It ' +
      'is not linked into LoomCanvas and is not copied into the application image; the ' +
      'application talks to it over the network through the Apache-2.0 `mongodb` driver.',
  },
  'apk:dumb-init': {
    name: 'dumb-init',
    license: 'MIT',
    note: 'Installed from the Alpine repository into the application image; used as PID 1.',
  },
}

// Rows of the "Notable non-npm components" table that cannot be derived from a lockfile or from
// the Docker files. They are statements about the LoomCanvas source as it was when they were
// written; update them when the source changes.
const STATIC_COMPONENT_ROWS = [
  {
    onlyIfProject: 'web',
    name: 'Inline SVG icons',
    where: 'SVG markup in `web/src` (not an npm package)',
    license: 'Feather: MIT, Copyright (c) 2013-2023 Cole Bemis, https://github.com/feathericons/feather',
    note:
      'The interface icons are inline 24x24 stroke SVGs. Several of them (for example image, ' +
      'chevron-left, book, download, upload, check, x, video, trash, edit) have the same geometry ' +
      'as the corresponding Feather icons; the others were drawn for LoomCanvas in the same style.',
  },
]

// Font files found under web/public or web/src must be listed here (path relative to the
// repository root, forward slashes) with their license, otherwise the check fails. Empty today:
// the web app ships no font files.
const REVIEWED_FONT_FILES = {}

const FONT_EXTENSIONS = new Set(['.woff', '.woff2', '.ttf', '.otf', '.eot'])

// ---------------------------------------------------------------------------------------------
// SPDX expressions
// ---------------------------------------------------------------------------------------------

/** Parse an SPDX-style expression into { id } | { op: 'AND'|'OR', args: [...] }. */
function parseExpression(text) {
  const tokens = String(text).match(/\(|\)|[^\s()]+/g) || []
  let i = 0
  const peek = () => tokens[i]
  const isOp = (t, op) => typeof t === 'string' && t.toUpperCase() === op

  function parseOr() {
    const args = [parseAnd()]
    while (isOp(peek(), 'OR')) {
      i++
      args.push(parseAnd())
    }
    return args.length === 1 ? args[0] : { op: 'OR', args }
  }
  function parseAnd() {
    const args = [parseAtom()]
    while (isOp(peek(), 'AND')) {
      i++
      args.push(parseAtom())
    }
    return args.length === 1 ? args[0] : { op: 'AND', args }
  }
  function parseAtom() {
    const t = tokens[i++]
    if (t === undefined) throw new Error('unexpected end of expression')
    if (t === '(') {
      const inner = parseOr()
      if (tokens[i++] !== ')') throw new Error('missing )')
      return inner
    }
    if (t === ')' || isOp(t, 'AND') || isOp(t, 'OR') || isOp(t, 'WITH')) {
      throw new Error(`unexpected "${t}"`)
    }
    let id = t
    // "X WITH Y" is kept as one identifier, so it has to be allowlisted as a whole.
    if (isOp(peek(), 'WITH')) {
      i++
      const exception = tokens[i++]
      if (exception === undefined || exception === '(' || exception === ')') {
        throw new Error('missing exception after WITH')
      }
      id = `${id} WITH ${exception}`
    }
    return { id }
  }

  const tree = parseOr()
  if (i < tokens.length) throw new Error(`unexpected "${tokens[i]}"`)
  return tree
}

/** Returns the identifiers that keep `text` from being allowed; empty array means allowed. */
function disallowedParts(text) {
  const whole = String(text).trim()
  if (!whole) return ['UNKNOWN']
  if (LICENSE_ALIASES[whole]) return disallowedParts(LICENSE_ALIASES[whole])
  let tree
  try {
    tree = parseExpression(whole)
  } catch {
    return [whole] // not an expression we understand: "SEE LICENSE IN ...", free text, ...
  }
  const walk = (node) => {
    if (node.id !== undefined) {
      const id = LICENSE_ALIASES[node.id] || node.id
      return ALLOWED_LICENSES.has(id) ? [] : [node.id]
    }
    const parts = node.args.map(walk)
    if (node.op === 'AND') return parts.flat()
    // OR: one allowed branch is enough.
    return parts.some((p) => p.length === 0) ? [] : parts.flat()
  }
  return [...new Set(walk(tree))]
}

// ---------------------------------------------------------------------------------------------
// Package metadata
// ---------------------------------------------------------------------------------------------

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function licenseFromManifest(manifest) {
  const one = (value) => {
    if (typeof value === 'string') return value.trim()
    if (value && typeof value === 'object' && typeof value.type === 'string') return value.type.trim()
    return ''
  }
  const single = one(manifest.license)
  if (single) return single
  const list = Array.isArray(manifest.licenses) ? manifest.licenses : manifest.licenses ? [manifest.licenses] : []
  const types = list.map(one).filter(Boolean)
  if (types.length === 1) return types[0]
  // The legacy array form means the user may choose, i.e. OR.
  if (types.length > 1) return `(${types.join(' OR ')})`
  return ''
}

function repositoryFromManifest(manifest) {
  const repo = manifest.repository
  let url = typeof repo === 'string' ? repo : repo && typeof repo.url === 'string' ? repo.url : ''
  url = url.trim()
  if (!url) return ''
  const short = url.match(/^(?:(github|gitlab|bitbucket):)?([\w.-]+\/[\w.-]+)$/)
  if (short) {
    const host = { github: 'github.com', gitlab: 'gitlab.com', bitbucket: 'bitbucket.org' }[short[1] || 'github']
    return `https://${host}/${short[2]}`
  }
  url = url
    .replace(/^git\+/, '')
    .replace(/^git@([^:/]+):/, 'https://$1/')
    .replace(/^ssh:\/\/git@/, 'https://')
    .replace(/^git:\/\//, 'https://')
    .replace(/^http:\/\//, 'https://')
    .replace(/#.*$/, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '')
  return url
}

const registryPage = (name) => `https://www.npmjs.com/package/${name}`

function findException(name) {
  if (Object.hasOwn(EXCEPTIONS, name)) return { key: name, ...EXCEPTIONS[name] }
  let best = null
  for (const key of Object.keys(EXCEPTIONS)) {
    if (!key.endsWith('*') || !name.startsWith(key.slice(0, -1))) continue
    if (!best || key.length > best.key.length) best = { key, ...EXCEPTIONS[key] }
  }
  return best
}

function byNameThenVersion(a, b) {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1
  if (a.version !== b.version) return a.version < b.version ? -1 : 1
  return 0
}

/** Production inventory of one project, built from its lockfile. */
function inventoryProject(root, project, warnings) {
  const lockPath = join(root, project, 'package-lock.json')
  if (!existsSync(lockPath)) throw new Error(`${project}/package-lock.json not found`)
  const lock = readJson(lockPath)
  if (!lock.packages || typeof lock.packages !== 'object') {
    throw new Error(`${project}/package-lock.json has no "packages" map (lockfileVersion 2 or 3 is required)`)
  }

  const seen = new Map()
  for (const lockKey of Object.keys(lock.packages).sort()) {
    const entry = lock.packages[lockKey]
    const marker = lockKey.lastIndexOf('node_modules/')
    if (marker === -1) continue // the root project and workspace folders
    if (entry.dev || entry.link || entry.extraneous) continue

    const name = entry.name || lockKey.slice(marker + 'node_modules/'.length)
    const version = String(entry.version || '0.0.0')
    const id = `${name}@${version}`
    if (seen.has(id)) continue // same package hoisted to several places

    const optional = Boolean(entry.optional || entry.devOptional)
    const lockLicense = licenseFromManifest(entry)
    let license = lockLicense
    let repository = ''

    if (!optional) {
      const manifestPath = join(root, project, lockKey, 'package.json')
      if (existsSync(manifestPath)) {
        const manifest = readJson(manifestPath)
        if (String(manifest.version) === version) {
          license = licenseFromManifest(manifest) || lockLicense
          repository = repositoryFromManifest(manifest)
          if (lockLicense && license !== lockLicense) {
            warnings.push(`${project}: ${id} declares "${license}" in node_modules but "${lockLicense}" in the lockfile`)
          }
        } else {
          warnings.push(
            `${project}: node_modules has ${name}@${manifest.version}, lockfile wants ${version}; using lockfile data (run npm ci)`
          )
        }
      } else {
        warnings.push(`${project}: ${id} is not installed; using lockfile data (run npm ci)`)
      }
    }

    seen.set(id, {
      name,
      version,
      license: license || 'UNKNOWN',
      repository: repository || registryPage(name),
      scope: optional ? 'optional' : 'required',
    })
  }

  const packages = [...seen.values()].sort(byNameThenVersion)
  for (const pkg of packages) {
    const blocked = disallowedParts(pkg.license)
    if (blocked.length === 0) {
      pkg.status = 'allowed'
      continue
    }
    const exception = findException(pkg.name)
    if (exception && exception.license === pkg.license) {
      pkg.status = 'exception'
      pkg.exceptionKey = exception.key
      pkg.reason = exception.reason
    } else if (exception) {
      pkg.status = 'violation'
      pkg.problem = `declares "${pkg.license}", but the reviewed exception "${exception.key}" covers "${exception.license}" only`
    } else {
      pkg.status = 'violation'
      pkg.problem =
        pkg.license === 'UNKNOWN'
          ? 'no license found in package.json or in the lockfile'
          : `not on the allowlist: ${blocked.join(', ')}`
    }
  }
  return packages
}

// ---------------------------------------------------------------------------------------------
// Non-npm components
// ---------------------------------------------------------------------------------------------

function readText(file) {
  return existsSync(file) ? readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : null
}

/** Base images and apk packages named by the Dockerfile and docker-compose.yml. */
function systemComponents(root) {
  const found = new Map() // key -> { key, ref, source }
  const add = (key, ref, source) => {
    const id = `${key}\n${ref}`
    if (!found.has(id)) found.set(id, { key, ref, source })
  }
  const imageKey = (ref) => ref.replace(/@sha256:.*$/, '').replace(/:[^/:]*$/, '')

  const dockerfile = readText(join(root, 'Dockerfile'))
  if (dockerfile !== null) {
    const stages = new Set()
    const logical = dockerfile.replace(/\\\n/g, ' ').split('\n')
    for (const line of logical) {
      const from = line.match(/^\s*FROM\s+(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?/i)
      if (from) {
        if (!stages.has(from[1].toLowerCase()) && from[1].toLowerCase() !== 'scratch') {
          add(imageKey(from[1]), from[1], 'Dockerfile')
        }
        if (from[2]) stages.add(from[2].toLowerCase())
        continue
      }
      for (const command of line.split(/&&|;/)) {
        const apk = command.match(/\bapk\s+(?:--\S+\s+)*add\s+(.*)$/)
        if (!apk) continue
        for (const word of apk[1].trim().split(/\s+/)) {
          if (!word || word.startsWith('-')) continue
          const pkg = word.replace(/[=<>~].*$/, '')
          add(`apk:${pkg}`, pkg, 'Dockerfile')
        }
      }
    }
  }

  const compose = readText(join(root, 'docker-compose.yml'))
  if (compose !== null) {
    for (const line of compose.split('\n')) {
      const image = line.match(/^\s*image:\s*["']?([^\s"'#]+)/)
      if (image) add(imageKey(image[1]), image[1], 'docker-compose.yml')
    }
  }

  return [...found.values()]
    .map((item) => ({ ...item, known: SYSTEM_COMPONENTS[item.key] || null }))
    .sort((a, b) => (a.key + a.ref < b.key + b.ref ? -1 : 1))
}

/** Font files under web/public and web/src, as repository-relative forward-slash paths. */
function fontFiles(root) {
  const result = []
  const walk = (relative) => {
    const absolute = join(root, relative)
    if (!existsSync(absolute)) return
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const child = `${relative}/${entry.name}`
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== 'dist') walk(child)
      } else {
        const dot = entry.name.lastIndexOf('.')
        if (dot !== -1 && FONT_EXTENSIONS.has(entry.name.slice(dot).toLowerCase())) result.push(child)
      }
    }
  }
  walk('web/public')
  walk('web/src')
  return result.sort()
}

// ---------------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------------

const cell = (text) => String(text).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()

function countByLicense(packages) {
  const counts = new Map()
  for (const pkg of packages) counts.set(pkg.license, (counts.get(pkg.license) || 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
}

function renderNotices(model) {
  const out = []
  const push = (...lines) => out.push(...lines)

  push(
    '# Third-party notices',
    '',
    '<!-- Generated by scripts/licenses.mjs. Do not edit by hand: run `node scripts/licenses.mjs --write`. -->',
    '',
    'LoomCanvas is distributed under the GNU AGPL-3.0 and, separately, under a commercial license.',
    'It depends on the third-party software listed below, each under its own license. This file is',
    'an inventory of the production dependencies recorded in `server/package-lock.json` and',
    '`web/package-lock.json`, plus the components of a default deployment that do not come from npm.',
    'Development-only dependencies are not listed because they are not part of what is shipped.',
    '',
    'The full license text of each npm package is in its directory under `node_modules/` after',
    '`npm ci`. Packages marked `optional` are platform-specific: npm installs only those that match',
    'the machine it runs on, and they are all listed here regardless of where this file was generated.',
    '',
    '## Notable non-npm components',
    ''
  )

  push('| Component | Where it comes from | License | How LoomCanvas uses it |', '| --- | --- | --- | --- |')
  for (const item of model.system) {
    const where = item.key.startsWith('apk:')
      ? `\`apk add ${item.ref}\` in \`${item.source}\``
      : `image \`${item.ref}\` in \`${item.source}\``
    if (item.known) {
      push(`| ${cell(item.known.name)} | ${where} | ${cell(item.known.license)} | ${cell(item.known.note)} |`)
    } else {
      push(`| ${cell(item.ref)} | ${where} | NOT REVIEWED | Add an entry to SYSTEM_COMPONENTS in scripts/licenses.mjs. |`)
    }
  }
  if (model.libvips.length > 0) {
    push(
      `| libvips and the libraries built into it | npm packages ${model.libvips.map((n) => `\`${n}\``).join(', ')} (prebuilt binaries published by the sharp project) | LGPL-3.0-or-later for libvips; each binary package carries a notice file for the libraries built into it | Image processing on the server through \`sharp\`. See "Reviewed exceptions" below. |`
    )
  }
  if (model.fonts.length === 0) {
    push(
      '| Fonts | none | n/a | No font files are in `web/public` or `web/src`, and the web app loads none from a CDN. The stylesheets name `Inter` first and fall back to fonts already installed on the viewer\'s system. |'
    )
  } else {
    for (const file of model.fonts) {
      const known = REVIEWED_FONT_FILES[file]
      push(
        `| Font file | \`${file}\` | ${known ? cell(known.license) : 'NOT REVIEWED'} | ${known ? cell(known.note || 'Bundled with the web app.') : 'Add an entry to REVIEWED_FONT_FILES in scripts/licenses.mjs.'} |`
      )
    }
  }
  if (model.iconPackages.length > 0) {
    push(
      `| Icon packages | npm packages ${model.iconPackages.map((p) => `\`${p.name}\` (${p.license})`).join(', ')} | see the web table below | Icon components used by the UI library are compiled into the web bundle as inline SVG. No icon font is loaded. |`
    )
  }
  for (const row of STATIC_COMPONENT_ROWS) {
    if (row.onlyIfProject && !model.projects.some((p) => p.name === row.onlyIfProject && p.packages.length > 0)) continue
    push(`| ${cell(row.name)} | ${cell(row.where)} | ${cell(row.license)} | ${cell(row.note)} |`)
  }
  push('')

  for (const project of model.projects) {
    push(`## ${project.name}: production dependencies`, '')
    push(
      `${project.packages.length} packages from \`${project.name}/package-lock.json\`. By license: ` +
        countByLicense(project.packages)
          .map(([license, n]) => `${license} (${n})`)
          .join(', ') +
        '.',
      ''
    )
    push('| Package | Version | License | Scope | Repository |', '| --- | --- | --- | --- | --- |')
    for (const pkg of project.packages) {
      const mark = pkg.status === 'exception' ? ' [exception]' : pkg.status === 'violation' ? ' [NOT ALLOWED]' : ''
      push(`| ${cell(pkg.name)} | ${cell(pkg.version)} | ${cell(pkg.license)}${mark} | ${pkg.scope} | ${cell(pkg.repository)} |`)
    }
    push('')
  }

  push('## Reviewed exceptions', '')
  const exceptions = model.projects.flatMap((p) => p.packages.filter((x) => x.status === 'exception').map((x) => ({ ...x, project: p.name })))
  if (exceptions.length === 0) {
    push('None.', '')
  } else {
    push(
      'The packages below are production dependencies whose license is not on the allowlist in',
      '`scripts/licenses.mjs`. Each one is covered by an explicit entry in that script, pinned to the',
      'license expression shown here; a change in the declared license makes the check fail again.',
      ''
    )
    const groups = new Map()
    for (const item of exceptions) {
      if (!groups.has(item.exceptionKey)) groups.set(item.exceptionKey, [])
      groups.get(item.exceptionKey).push(item)
    }
    for (const key of [...groups.keys()].sort()) {
      const items = groups.get(key)
      push(`### \`${key}\``, '', `License: ${items[0].license}`, '', items[0].reason, '')
      push('| Package | Version | Project | Scope |', '| --- | --- | --- | --- |')
      for (const item of items) push(`| ${cell(item.name)} | ${cell(item.version)} | ${item.project} | ${item.scope} |`)
      push('')
    }
  }

  return out.join('\n').replace(/\n+$/, '') + '\n'
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------

function parseArgs(argv) {
  const options = { write: false, json: false, root: resolve(dirname(fileURLToPath(import.meta.url)), '..') }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--write') options.write = true
    else if (arg === '--json') options.json = true
    else if (arg === '--root') {
      if (!argv[i + 1]) throw new Error('--root needs a directory')
      options.root = resolve(argv[++i])
    } else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error(`unknown option ${arg}`)
  }
  return options
}

function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(`licenses: ${error.message}`)
    return 2
  }
  if (options.help) {
    console.log('usage: node scripts/licenses.mjs [--write] [--json] [--root <dir>]')
    return 0
  }

  const warnings = []
  let model
  try {
    const projects = PROJECTS.map((name) => ({ name, packages: inventoryProject(options.root, name, warnings) }))
    const all = projects.flatMap((p) => p.packages)
    model = {
      projects,
      system: systemComponents(options.root),
      fonts: fontFiles(options.root),
      libvips: [...new Set(all.filter((p) => p.name.startsWith('@img/sharp-libvips-')).map((p) => p.name))].sort(),
      iconPackages: (projects.find((p) => p.name === 'web')?.packages || []).filter((p) => /(^|[-/])icons?([-/]|$)/.test(p.name)),
    }
  } catch (error) {
    console.error(`licenses: ${error.message}`)
    return 2
  }

  const problems = []
  for (const project of model.projects) {
    for (const pkg of project.packages) {
      if (pkg.status === 'violation') problems.push(`${project.name}: ${pkg.name}@${pkg.version} (${pkg.license}): ${pkg.problem}`)
    }
  }
  for (const item of model.system) {
    if (!item.known) problems.push(`${item.source}: "${item.ref}" has no entry in SYSTEM_COMPONENTS (not reviewed)`)
  }
  for (const file of model.fonts) {
    if (!REVIEWED_FONT_FILES[file]) problems.push(`${file}: font file has no entry in REVIEWED_FONT_FILES (not reviewed)`)
  }

  const notices = renderNotices(model)
  const noticesPath = join(options.root, NOTICES_FILE)
  let stale = false
  if (options.write) {
    writeFileSync(noticesPath, notices, 'utf8')
  } else {
    const current = readText(noticesPath)
    stale = current !== notices
  }

  if (options.json) {
    console.log(JSON.stringify({ projects: model.projects, system: model.system, fonts: model.fonts, problems, stale }, null, 2))
  } else {
    for (const project of model.projects) {
      const optional = project.packages.filter((p) => p.scope === 'optional').length
      console.log(`${project.name}: ${project.packages.length} production packages (${optional} optional)`)
      for (const [license, n] of countByLicense(project.packages)) console.log(`  ${String(n).padStart(4)}  ${license}`)
    }
    const exceptions = model.projects.flatMap((p) => p.packages.filter((x) => x.status === 'exception').map((x) => `${p.name}: ${x.name}@${x.version} (${x.license})`))
    if (exceptions.length > 0) {
      console.log(`reviewed exceptions: ${exceptions.length}`)
      for (const line of exceptions) console.log(`  ${line}`)
    }
    if (options.write) console.log(`wrote ${NOTICES_FILE}`)
  }

  for (const warning of warnings) console.error(`warning: ${warning}`)
  if (problems.length > 0) {
    console.error(`\nFAIL: ${problems.length} item(s) not allowed`)
    for (const problem of problems) console.error(`  ${problem}`)
  }
  if (stale) {
    console.error(`\nFAIL: ${NOTICES_FILE} is ${existsSync(noticesPath) ? 'out of date' : 'missing'}; run: node scripts/licenses.mjs --write`)
  }
  if (problems.length === 0 && !stale && !options.json) console.log('OK')
  return problems.length > 0 || stale ? 1 : 0
}

process.exitCode = main()
