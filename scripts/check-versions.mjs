// One version and one Node floor for the whole repository.
// The root package.json is the reference; server/ and web/ must agree with it,
// lockfiles included. (GET /api/app/bootstrap reports server/package.json's version.)
// examples/react-host is a package of its own (it is not built, shipped or installed by anything
// here): it carries the same version, licence and Node floor, and is checked the same way.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (rel) => JSON.parse(readFileSync(root + rel, 'utf8'))

const reference = read('package.json')
const problems = []
const expect = (where, what, actual, wanted) => {
  if (actual !== wanted) problems.push(`${where}: ${what} is ${JSON.stringify(actual)}, expected ${JSON.stringify(wanted)}`)
}

for (const dir of ['server', 'web', 'examples/react-host']) {
  const pkg = read(`${dir}/package.json`)
  const lock = read(`${dir}/package-lock.json`)
  expect(`${dir}/package.json`, 'version', pkg.version, reference.version)
  expect(`${dir}/package.json`, 'engines.node', pkg.engines && pkg.engines.node, reference.engines.node)
  expect(`${dir}/package.json`, 'license', pkg.license, reference.license)
  expect(`${dir}/package-lock.json`, 'version', lock.version, reference.version)
  expect(`${dir}/package-lock.json`, 'packages[""].version', lock.packages[''].version, reference.version)
}

if (problems.length) {
  console.error(problems.join('\n'))
  process.exit(1)
}
console.log(`versions: ${reference.version} everywhere, node ${reference.engines.node}`)
