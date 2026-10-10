'use strict'

/**
 * Accounts, sessions and who owns what.
 *
 *  - An account is a row in `users`. The first one ever registered is the
 *    owner; a partial unique index makes sure there is exactly one, whatever
 *    races at that moment.
 *  - A session is a random token handed to the browser and a row holding its
 *    SHA-256. Signing out, changing the password, disabling an account and a
 *    password reset all work by deleting rows, so they take effect at once.
 *  - Every per-account collection carries the account's id in `userId`
 *    (OWNED below is the one list of them). Data written before accounts
 *    existed carries the constant 'local' and is handed to the owner once.
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
  return { id: String(u._id), username: u.username, email: u.email, role: u.role, createdAt: u.createdAt }
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

async function hasUsers() {
  return !!(await User.exists({}))
}

/**
 * Create an account. The first one is the owner and takes over whatever the
 * pre-account version left behind; later ones need registration to be open.
 */
async function register({ username, email, password }) {
  const name = parseUsername(username)
  const mail = parseEmail(email)
  const pass = parsePassword(password)
  // The unique indexes are what makes the checks below race-free; make sure they exist.
  await User.init()

  let first = !(await hasUsers())
  if (!first && !settings.get('registrationOpen')) throw new ApiError(403, 'auth.registration_closed')
  if (await User.exists({ usernameLower: name.toLowerCase() })) throw taken('username')
  if (await User.exists({ emailLower: mail.toLowerCase() })) throw taken('email')

  const passwordHash = await hashPassword(pass)
  for (;;) {
    try {
      const user = await User.create({
        username: name,
        usernameLower: name.toLowerCase(),
        email: mail,
        emailLower: mail.toLowerCase(),
        passwordHash,
        role: first ? ROLES.OWNER : ROLES.USER,
        // Stored with the account, so "an owner exists" and "the old data still
        // has to be handed over" can never be seen apart.
        legacyAdoption: first ? 'pending' : '',
      })
      if (first) await adoptLegacy(user._id)
      return user
    } catch (err) {
      const dup = duplicateOf(err)
      if (dup === 'username' || dup === 'email') throw taken(dup)
      if (dup !== 'owner') throw err
      // Somebody else became the owner in the meantime: this is an ordinary registration now.
      first = false
      if (!settings.get('registrationOpen')) throw new ApiError(403, 'auth.registration_closed')
    }
  }
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

/** Store a new password. `keepSession` survives; every other session of the account ends. */
async function setPassword(userId, password, { keepSession } = {}) {
  await User.updateOne({ _id: userId }, { $set: { passwordHash: await hashPassword(parsePassword(password)) } })
  return revokeSessions(userId, { except: keepSession })
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
  await User.updateOne({ _id: user._id }, { $set: { passwordHash: hash } })
  const { token, session } = await createSession(user, {
    ...meta,
    remember: !!currentSession.remember,
    expiresAt: currentSession.expiresAt,
    login: false,
  })
  const ended = await revokeSessions(user._id, { except: session._id })
  return { token, revoked: Math.max(0, ended - 1) }
}

/** Give an account a random password and sign it out everywhere. Returns the password, once. */
async function resetPassword(userId) {
  const password = temporaryPassword()
  await setPassword(userId, password)
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

/** Is there data from the pre-account version that nobody owns yet? */
async function hasLegacyData() {
  for (const { model, filter } of OWNED) {
    if (await model.collection.findOne(legacyFilter(filter), { projection: { _id: 1 } })) return true
  }
  return false
}

/**
 * Hand everything the pre-account version wrote to the owner. Each step is a
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
 *  - a hand-over to the owner that was interrupted is finished.
 * Resolves { users, adopted, legacyWaiting } for the start-up log.
 */
async function prepare() {
  await dropIndex(Provider, 'slug_1')
  await dropIndex(ModelOverride, 'modelId_1')
  await dropIndex(Template, 'key_1')
  for (const model of [Template, TextTemplate]) {
    await model.collection.updateMany({ builtin: true, userId: { $ne: SYSTEM_USER } }, { $set: { userId: SYSTEM_USER } })
  }
  await Promise.all([User, Session, Provider, ModelOverride, Template].map((m) => m.init()))

  let adopted = null
  const pending = await User.findOne({ role: ROLES.OWNER, legacyAdoption: 'pending' }).lean()
  if (pending) adopted = await adoptLegacy(pending._id)
  const users = await User.countDocuments({})
  // With accounts present, unowned data stays unowned: it is never given to anyone later.
  return { users, adopted, legacyWaiting: users === 0 && await hasLegacyData() }
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
  hasUsers,
  register,
  findByAccount,
  checkCredentials,
  updateProfile,
  setPassword,
  resetPassword,
  createSession,
  resolveToken,
  listSessions,
  hasSessionFrom,
  changePassword,
  revokeSession,
  revokeSessions,
  hasLegacyData,
  adoptLegacy,
  prepare,
  countsByUser,
  deleteAccount,
}
