'use strict'

/**
 * Accounts, sessions and who owns what.
 *
 *  - An account is a row in `users`. One of them is the super admin (role
 *    `owner`). Nobody registers as it: the server creates it at start-up when
 *    there is none (ensureAdministrator), and a partial unique index makes
 *    sure there is exactly one, however many processes start together.
 *    Registration only ever makes plain users.
 *  - A session is a random token handed to the browser and a row holding its
 *    SHA-256. Signing out, changing the password, disabling an account and a
 *    password reset all work by deleting rows, so they take effect at once.
 *  - Every per-account collection carries the account's id in `userId`
 *    (OWNED below is the one list of them). Data written before accounts
 *    existed carries the constant 'local' and is handed to the super admin
 *    when that account is created.
 */
const crypto = require('crypto')
const User = require('../models/User')
const Session = require('../models/Session')
const Workflow = require('../models/Workflow')
const Share = require('../models/Share')
const { UserAsset } = require('../models/Asset')
const BrandKit = require('../models/BrandKit')
const Provider = require('../models/Provider')
const ModelOverride = require('../models/ModelOverride')
const Run = require('../models/Run')
const Template = require('../models/Template')
const TextTemplate = require('../models/TextTemplate')
const settings = require('./settings')
const { getStorage } = require('../storage')
const { hashPassword, verifyPassword, burnVerification, temporaryPassword } = require('../utils/password')
const { ApiError, badRequest } = require('../utils/http')
const { getConfig, ConfigError } = require('../config')
const { LEGACY_USER, SYSTEM_USER, ROLES } = require('../constants')

const USERNAME_RE = /^[A-Za-z0-9_-]{3,32}$/
// Deliberately loose: one @, something on both sides, a dot in the domain. Nothing is ever sent to it.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PASSWORD_MIN = 8
const PASSWORD_MAX = 128

const SESSION_TTL_MS = Object.freeze({ standard: 12 * 3600 * 1000, remember: 30 * 24 * 3600 * 1000 })
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/
/** How stale lastSeenAt may get before a request refreshes it. */
const SEEN_GRANULARITY_MS = 60 * 1000

const notBuiltin = { builtin: { $ne: true } }
/**
 * Every collection whose documents belong to one account, with the filter
 * that picks the per-account ones where a collection also holds site content.
 * Adoption of old data and deletion of an account both walk this list - a new
 * per-account collection has to be added here.
 */
const OWNED = [
  { model: Workflow },
  { model: Share },
  { model: UserAsset },
  { model: BrandKit },
  { model: Provider },
  { model: ModelOverride },
  { model: Run },
  { model: Template, filter: notBuiltin },
  { model: TextTemplate, filter: notBuiltin },
]

/* ----------------------------------------------------------------- users */

/** The contract's User. Nothing else about an account leaves the server through it. */
function serializeUser(u) {
  return {
    id: String(u._id),
    username: u.username,
    // '' for a super admin that was created without ADMIN_EMAIL and has not added one yet.
    email: u.email || '',
    role: u.role,
    // True while the password is one somebody else knows; the API then serves only the change of it.
    mustChangePassword: !!u.mustChangePassword,
    createdAt: u.createdAt,
  }
}

function parseUsername(v) {
  if (typeof v !== 'string' || !USERNAME_RE.test(v)) throw badRequest('auth.invalid_username')
  return v
}

function parseEmail(v) {
  const email = typeof v === 'string' ? v.trim() : ''
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) throw badRequest('auth.invalid_email')
  return email
}

function parsePassword(v) {
  if (typeof v !== 'string' || v.length < PASSWORD_MIN || v.length > PASSWORD_MAX) {
    throw badRequest('auth.weak_password', { min: PASSWORD_MIN, max: PASSWORD_MAX })
  }
  return v
}

/** Which unique index a duplicate-key error is about. */
function duplicateOf(err) {
  if (!err || err.code !== 11000) return ''
  const fields = Object.keys(err.keyPattern || {})
  if (fields.includes('usernameLower')) return 'username'
  if (fields.includes('emailLower')) return 'email'
  if (fields.includes('role')) return 'owner'
  return 'other'
}

const taken = (what) => new ApiError(409, what === 'username' ? 'auth.username_taken' : 'auth.email_taken')

/**
 * Create an account: a plain user, always, and only while registration is
 * open. There is no way to become the super admin from here.
 */
async function register({ username, email, password }) {
  const name = parseUsername(username)
  const mail = parseEmail(email)
  const pass = parsePassword(password)
  if (!settings.get('registrationOpen')) throw new ApiError(403, 'auth.registration_closed')
  // The unique indexes are what makes the checks below race-free; make sure they exist.
  await User.init()
  if (await User.exists({ usernameLower: name.toLowerCase() })) throw taken('username')
  if (await User.exists({ emailLower: mail.toLowerCase() })) throw taken('email')

  try {
    return await User.create({
      username: name,
      usernameLower: name.toLowerCase(),
      email: mail,
      emailLower: mail.toLowerCase(),
      passwordHash: await hashPassword(pass),
      role: ROLES.USER,
    })
  } catch (err) {
    const dup = duplicateOf(err)
    if (dup === 'username' || dup === 'email') throw taken(dup)
    throw err
  }
}

/* --------------------------------------------------- the super admin */

/**
 * Make sure the instance has its super admin. With an owner account already
 * there - whoever created it, under whatever name - nothing is read from
 * `admin` and nothing is changed. Otherwise the account is created from
 * ADMIN_USERNAME / ADMIN_EMAIL / ADMIN_PASSWORD (config.admin), takes over the
 * data from before accounts, and:
 *
 *  - with a password given, that is its password;
 *  - without one, a random password is generated and returned here ONCE (the
 *    caller shows it; only its hash is stored) and the account has to replace
 *    it at the first sign-in.
 *
 * Any number of processes may run this at the same moment: the unique index on
 * the owner role lets one of them create the account, the others find it there.
 *
 * Resolves { created, username, generatedPassword, adopted }.
 */
async function ensureAdministrator(admin) {
  await User.init()
  const existing = () => User.findOne({ role: ROLES.OWNER }).select('username').lean()
  const none = (owner) => ({ created: false, username: owner.username, generatedPassword: '', adopted: null })
  let owner = await existing()
  if (owner) return none(owner)

  const from = admin || getConfig().admin
  const username = String(from.username || 'admin')
  const email = String(from.email || '').trim()
  const given = from.password || ''
  if (!USERNAME_RE.test(username)) {
    throw new ConfigError(`ADMIN_USERNAME must be 3 to 32 characters (letters, digits, _ and -), got "${username.slice(0, 40)}"`)
  }
  if (email && (email.length > 254 || !EMAIL_RE.test(email))) throw new ConfigError('ADMIN_EMAIL is not a valid email address')
  if (given && (given.length < PASSWORD_MIN || given.length > PASSWORD_MAX)) {
    throw new ConfigError(
      `ADMIN_PASSWORD must be ${PASSWORD_MIN} to ${PASSWORD_MAX} characters long. ` +
      'Set a longer one, or remove it: a random password is then generated and shown once in the start-up log.'
    )
  }
  const password = given || temporaryPassword()

  let user
  try {
    user = await User.create({
      username,
      usernameLower: username.toLowerCase(),
      email,
      emailLower: email.toLowerCase(),
      passwordHash: await hashPassword(password),
      role: ROLES.OWNER,
      mustChangePassword: !given,
      // Stored with the account, so "a super admin exists" and "the old data
      // still has to be handed over" can never be seen apart.
      legacyAdoption: 'pending',
    })
  } catch (err) {
    const dup = duplicateOf(err)
    if (!dup) throw err
    // Another process created the super admin in the meantime: that one stands.
    owner = await existing()
    if (owner) return none(owner)
    // No super admin, yet the name or the address belongs to an ordinary account.
    if (dup === 'email') throw new ConfigError('ADMIN_EMAIL is already the email of another account. Set a different ADMIN_EMAIL, or leave it empty.')
    throw new ConfigError(`ADMIN_USERNAME "${username}" is already the name of another account. Set a different ADMIN_USERNAME.`)
  }
  const adopted = await adoptLegacy(user._id)
  return { created: true, username: user.username, generatedPassword: given ? '' : password, adopted }
}

/**
 * The one place a generated super admin password is shown: a framed block,
 * line by line through `log` (the console at start-up, a collector in tests).
 */
function announceGeneratedPassword({ username, generatedPassword }, log = console.log) {
  const lines = [
    'LoomCanvas created the super admin account.',
    '',
    `    Username:  ${username}`,
    `    Password:  ${generatedPassword}`,
    '',
    'This password is shown only this once. Sign in with it: you will be',
    'asked to choose your own before anything else.',
    `Lost it? Run:  node server/src/cli/reset-password.js ${username}`,
  ]
  const width = Math.max(...lines.map((l) => l.length))
  const bar = '='.repeat(width + 4)
  log('')
  log(bar)
  for (const line of lines) log(`| ${line.padEnd(width)} |`)
  log(bar)
  log('')
}

/** Username or email -> the account, with its password hash. */
async function findByAccount(account) {
  const key = typeof account === 'string' ? account.trim().toLowerCase() : ''
  if (!key || key.length > 254) return null
  return User.findOne(key.includes('@') ? { emailLower: key } : { usernameLower: key }).select('+passwordHash')
}

/**
 * Check a sign-in. One error for "no such account" and "wrong password", after
 * the same amount of work, so neither the answer nor its timing tells them apart.
 */
async function checkCredentials(account, password) {
  const user = await findByAccount(account)
  const invalid = () => new ApiError(401, 'auth.invalid_credentials', {}, 401)
  if (typeof password !== 'string' || !password || password.length > PASSWORD_MAX) {
    await burnVerification('')
    throw invalid()
  }
  if (!user) {
    await burnVerification(password)
    throw invalid()
  }
  if (!(await verifyPassword(password, user.passwordHash))) throw invalid()
  // Only somebody who knows the password learns that the account is disabled.
  if (user.disabled) throw new ApiError(403, 'auth.account_disabled')
  return user
}

async function updateProfile(user, { username, email }) {
  const set = {}
  if (username !== undefined) {
    const name = parseUsername(username)
    if (name.toLowerCase() !== user.usernameLower && await User.exists({ usernameLower: name.toLowerCase() })) throw taken('username')
    Object.assign(set, { username: name, usernameLower: name.toLowerCase() })
  }
  if (email !== undefined) {
    const mail = parseEmail(email)
    if (mail.toLowerCase() !== user.emailLower && await User.exists({ emailLower: mail.toLowerCase() })) throw taken('email')
    Object.assign(set, { email: mail, emailLower: mail.toLowerCase() })
  }
  if (!Object.keys(set).length) throw badRequest('common.nothing_to_update')
  try {
    return await User.findByIdAndUpdate(user._id, { $set: set }, { new: true })
  } catch (err) {
    const dup = duplicateOf(err)
    if (dup === 'username' || dup === 'email') throw taken(dup)
    throw err
  }
}

/**
 * The account holder changes their own password. The new password is stored,
 * a replacement for the session that asked is opened (same expiry: changing a
 * password must not be a way to stay signed in for ever), and every other
 * session - the old current one included - ends. Returns the new token and how
 * many OTHER sessions ended.
 */
async function changePassword(user, password, currentSession, meta = {}) {
  const hash = await hashPassword(parsePassword(password))
  // A password the holder chose: whatever temporary one came before is replaced.
  await User.updateOne({ _id: user._id }, { $set: { passwordHash: hash, mustChangePassword: false } })
  const { token, session } = await createSession(user, {
    ...meta,
    remember: !!currentSession.remember,
    expiresAt: currentSession.expiresAt,
    login: false,
  })
  const ended = await revokeSessions(user._id, { except: session._id })
  return { token, revoked: Math.max(0, ended - 1) }
}

/**
 * Give an account a random temporary password and sign it out everywhere.
 * Returns the password, once. Whoever reads it out knows it, so the holder has
 * to replace it at the next sign-in.
 */
async function resetPassword(userId) {
  const password = temporaryPassword()
  await User.updateOne({ _id: userId }, { $set: { passwordHash: await hashPassword(password), mustChangePassword: true } })
  await revokeSessions(userId)
  return password
}

/* -------------------------------------------------------------- sessions */

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex')
}

/** Open a session. The token is returned here and nowhere else; only its hash is stored. */
async function createSession(user, { remember = false, userAgent = '', ip = '', expiresAt = null, login = true } = {}) {
  const token = crypto.randomBytes(32).toString('base64url')
  const now = Date.now()
  const session = await Session.create({
    userId: String(user._id),
    tokenHash: hashToken(token),
    // `expiresAt` is given when this session replaces another one and inherits its end.
    expiresAt: expiresAt ? new Date(expiresAt) : new Date(now + (remember ? SESSION_TTL_MS.remember : SESSION_TTL_MS.standard)),
    lastSeenAt: new Date(now),
    userAgent: String(userAgent || '').slice(0, 300),
    ip: String(ip || '').slice(0, 64),
    remember: !!remember,
  })
  if (login) User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date(now) } }, { timestamps: false }).catch(() => {})
  return { token, session }
}

/** Token -> { user, session } while the session is alive and the account is enabled, else null. */
async function resolveToken(token) {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null
  const session = await Session.findOne({ tokenHash: hashToken(token) }).lean()
  // The TTL index removes expired rows within a minute or so; until then this check does.
  if (!session || new Date(session.expiresAt).getTime() <= Date.now()) return null
  const user = await User.findById(session.userId).lean()
  if (!user || user.disabled) return null
  if (Date.now() - new Date(session.lastSeenAt || 0).getTime() > SEEN_GRANULARITY_MS) {
    Session.updateOne({ _id: session._id }, { $set: { lastSeenAt: new Date() } }, { timestamps: false }).catch(() => {})
  }
  return { user, session }
}

async function listSessions(userId, currentId) {
  const rows = await Session.find({ userId: String(userId), expiresAt: { $gt: new Date() } }).sort({ lastSeenAt: -1 }).limit(200).lean()
  return rows.map((s) => ({
    id: String(s._id),
    current: String(s._id) === String(currentId),
    createdAt: s.createdAt,
    lastSeenAt: s.lastSeenAt,
    userAgent: s.userAgent || '',
    ip: s.ip || '',
  }))
}

/**
 * Does the account behind this name (username or email) have a live session
 * opened from an address `sameAddress(ip)` accepts? Used by the sign-in limits
 * to recognise the holder's usual address. Runs the same two queries whether
 * or not the name exists.
 */
async function hasSessionFrom(account, sameAddress) {
  const key = typeof account === 'string' ? account.trim().toLowerCase() : ''
  const user = key && key.length <= 254
    ? await User.findOne(key.includes('@') ? { emailLower: key } : { usernameLower: key }).select('_id disabled').lean()
    : null
  const rows = await Session.find({ userId: user ? String(user._id) : '0'.repeat(24), expiresAt: { $gt: new Date() } })
    .select('ip').sort({ lastSeenAt: -1 }).limit(200).lean()
  return !!user && !user.disabled && rows.some((s) => sameAddress(s.ip))
}

/** End one session of this account. False when there is no such session (or it is somebody else's). */
async function revokeSession(userId, sessionId) {
  const r = await Session.deleteOne({ _id: sessionId, userId: String(userId) })
  return r.deletedCount > 0
}

/** End every session of an account, optionally sparing one. Returns how many ended. */
async function revokeSessions(userId, { except } = {}) {
  const r = await Session.deleteMany({ userId: String(userId), ...(except ? { _id: { $ne: except } } : {}) })
  return r.deletedCount || 0
}

/* ------------------------------------------- data from before accounts */

const legacyFilter = (filter) => ({ userId: { $in: [LEGACY_USER, null] }, ...(filter || {}) })

/**
 * Hand everything the pre-account version wrote to the super admin. Each step is a
 * plain "whatever is still unowned becomes yours", so running it again after
 * an interruption finishes the job and running it once more changes nothing.
 * Timestamps are left alone (the raw collection is used on purpose).
 */
async function adoptLegacy(ownerId) {
  const id = String(ownerId)
  const adopted = {}
  for (const { model, filter } of OWNED) {
    const r = await model.collection.updateMany(legacyFilter(filter), { $set: { userId: id } })
    if (r.modifiedCount) adopted[model.collection.collectionName] = r.modifiedCount
  }
  await User.updateOne({ _id: ownerId }, { $set: { legacyAdoption: 'done' } }, { timestamps: false })
  return adopted
}

async function dropIndex(model, name) {
  try {
    const indexes = await model.collection.indexes()
    if (indexes.some((i) => i.name === name && i.unique)) await model.collection.dropIndex(name)
  } catch (err) {
    // No such collection yet: nothing to drop.
    if (!err || (err.code !== 26 && err.codeName !== 'NamespaceNotFound')) throw err
  }
}

/**
 * Start-up step, safe on every start:
 *  - slugs, model ids and template keys used to be unique across the whole
 *    database; they are unique per account now, so the old indexes go;
 *  - built-in templates move from the old single user to the site;
 *  - the super admin is created when there is none (ensureAdministrator)
 *    and takes over the data from before accounts;
 *  - a hand-over that was interrupted is finished.
 * `admin` defaults to the ADMIN_* variables. A generated password goes through
 * `log`, once, and is not part of what this resolves:
 * { users, adopted, admin: { created, username, generated } }.
 */
async function prepare({ admin, log = console.log } = {}) {
  await dropIndex(Provider, 'slug_1')
  await dropIndex(ModelOverride, 'modelId_1')
  await dropIndex(Template, 'key_1')
  for (const model of [Template, TextTemplate]) {
    await model.collection.updateMany({ builtin: true, userId: { $ne: SYSTEM_USER } }, { $set: { userId: SYSTEM_USER } })
  }
  await Promise.all([User, Session, Provider, ModelOverride, Template].map((m) => m.init()))

  const made = await ensureAdministrator(admin)
  if (made.generatedPassword) announceGeneratedPassword(made, log)
  let adopted = made.adopted && Object.keys(made.adopted).length ? made.adopted : null
  // Also the hand-over an earlier start (or another process) began and did not finish.
  const pending = await User.findOne({ role: ROLES.OWNER, legacyAdoption: 'pending' }).lean()
  if (pending) adopted = { ...(adopted || {}), ...(await adoptLegacy(pending._id)) }
  const users = await User.countDocuments({})
  // Unowned data that turns up after the hand-over stays unowned: it is never given to anyone later.
  return { users, adopted, admin: { created: made.created, username: made.username, generated: !!made.generatedPassword } }
}

/* ------------------------------------------------------ account removal */

/** Per-account counts for the owner's user list. Numbers only: no content crosses over. */
async function countsByUser() {
  const [workflows, runs] = await Promise.all([
    Workflow.aggregate([{ $match: { isDeleted: false } }, { $group: { _id: '$userId', n: { $sum: 1 } } }]),
    Run.aggregate([{ $group: { _id: '$userId', n: { $sum: 1 } } }]),
  ])
  const out = new Map()
  const at = (id) => out.get(id) || out.set(id, { workflows: 0, runs: 0 }).get(id)
  for (const r of workflows) at(String(r._id)).workflows = r.n
  for (const r of runs) at(String(r._id)).runs = r.n
  return out
}

/**
 * Remove an account with everything it owns: sessions first (nobody can act
 * as it any more), then its documents, then its files. `cancelRun` stops what
 * is still running for it.
 */
async function deleteAccount(userId, { cancelRun } = {}) {
  const id = String(userId)
  await User.updateOne({ _id: userId }, { $set: { disabled: true } })
  await revokeSessions(id)
  if (cancelRun) {
    const unfinished = await Run.find({ userId: id, status: { $in: ['queued', 'running', 'archiving'] } }).select('_id').lean()
    for (const run of unfinished) await cancelRun(String(run._id)).catch(() => {})
  }
  const removed = {}
  for (const { model, filter } of OWNED) {
    const r = await model.deleteMany({ userId: id, ...(filter || {}) })
    if (r.deletedCount) removed[model.collection.collectionName] = r.deletedCount
  }
  let files = 0
  let filesError = ''
  try {
    files = await getStorage().deleteUserFiles(id)
  } catch (err) {
    // The account is gone either way; what could not be removed from storage is reported, not hidden.
    filesError = (err && (err.name || err.code)) || 'error'
  }
  await User.deleteOne({ _id: userId })
  return { removed, files, filesError }
}

module.exports = {
  OWNED,
  SESSION_TTL_MS,
  serializeUser,
  register,
  ensureAdministrator,
  announceGeneratedPassword,
  findByAccount,
  checkCredentials,
  updateProfile,
  resetPassword,
  createSession,
  resolveToken,
  listSessions,
  hasSessionFrom,
  changePassword,
  revokeSession,
  revokeSessions,
  adoptLegacy,
  prepare,
  countsByUser,
  deleteAccount,
}
