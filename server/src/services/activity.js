'use strict'

/**
 * The team activity log: what is recorded, and how an entry reads.
 *
 * TYPES is the complete list. Each type names its category (what the log is
 * filtered by), the sentence it renders to, and the `detail` fields it may
 * carry - anything else handed to record() is dropped, so a key, an address or
 * a prompt cannot end up in the log by accident.
 *
 * Recording never fails the action it describes: an entry that cannot be
 * written is reported on the server's console and the request goes on.
 */
const TeamActivity = require('../models/TeamActivity')
const { t } = require('../i18n')

/**
 * type -> { category, message, detail }. `detail` lists the fields an entry of
 * that type may carry; what each of them holds is documented in docs/api.md
 * ("The activity log") and is a contract: clients build their own sentence
 * from `type` + `detail`, so a field is only ever added, never renamed or
 * given another meaning. Entries written before a field existed do not have
 * it - every field is optional to a reader.
 */
const TYPES = {
  // target: the member. inviterId/inviterName: whose invite link was used.
  'member:joined': { category: 'member', message: 'activity.member_joined', detail: ['inviterId', 'inviterName', 'invitationId'] },
  // role: what they were ('admin' | 'member').
  'member:left': { category: 'member', message: 'activity.member_left', detail: ['role', 'canvasesInherited', 'runsCanceled'] },
  'member:removed': { category: 'member', message: 'activity.member_removed', detail: ['role', 'canvasesInherited', 'runsCanceled', 'wasAdmin', 'accountDeleted'] },
  // from / to: 'admin' | 'member'.
  'member:promoted': { category: 'member', message: 'activity.member_promoted', detail: ['from', 'to'] },
  'member:demoted': { category: 'member', message: 'activity.member_demoted', detail: ['from', 'to'] },
  // from / to: the display name before and after ('' = the username is shown). username: the account's.
  'member:renamed': { category: 'member', message: 'activity.member_renamed', detail: ['from', 'to', 'username'] },
  // target: the new owner. fromId/fromName: the owner before.
  'team:transferred': { category: 'member', message: 'activity.team_transferred', detail: ['fromId', 'fromName'] },
  'team:owner_appointed': { category: 'member', message: 'activity.team_owner_appointed', detail: ['fromId', 'fromName'] },
  // maxUses: 0 = unlimited. expiresInDays: what was asked for.
  'invite:created': { category: 'invite', message: 'activity.invite_created', detail: ['maxUses', 'expiresAt', 'expiresInDays'] },
  // What the link was when it was revoked. createdById/createdByName: who had made it.
  'invite:revoked': { category: 'invite', message: 'activity.invite_revoked', detail: ['maxUses', 'usedCount', 'expiresAt', 'createdById', 'createdByName'] },
  'provider:created': { category: 'provider', message: 'activity.provider_created', detail: ['vendor', 'enabled'] },
  'provider:deleted': { category: 'provider', message: 'activity.provider_deleted', detail: ['vendor'] },
  // cleared: the key was removed rather than replaced. Never the key or any part of it.
  'provider:key_changed': { category: 'provider', message: 'activity.provider_key_changed', detail: ['cleared'] },
  // custom: the provider now uses an address other than the vendor's own. Never the address.
  'provider:url_changed': { category: 'provider', message: 'activity.provider_url_changed', detail: ['custom'] },
  // enabled: present when it was switched. renamed + from/to: present when the name changed.
  'provider:updated': { category: 'provider', message: 'activity.provider_updated', detail: ['enabled', 'renamed', 'from', 'to'] },
  'provider:model_added': { category: 'provider', message: 'activity.provider_model_added', detail: ['model', 'kind'] },
  'provider:model_removed': { category: 'provider', message: 'activity.provider_model_removed', detail: ['model'] },
  'model:enabled': { category: 'provider', message: 'activity.model_enabled', detail: [] },
  'model:disabled': { category: 'provider', message: 'activity.model_disabled', detail: [] },
  // before / after: the price ({ unit, currency, ...amounts }) or null for "no price".
  'model:price_changed': { category: 'provider', message: 'activity.model_price_changed', detail: ['priced', 'before', 'after'] },
  // before / after: { team: { runs, amount }, memberDefault: { runs, amount }, currency, blockUnpriced }; null = no limit.
  'limits:team_changed': { category: 'limits', message: 'activity.limits_team_changed', detail: ['before', 'after'] },
  // before / after: { runs, amount }; null = follows the team's default for members.
  'limits:member_changed': { category: 'limits', message: 'activity.limits_member_changed', detail: ['before', 'after'] },
  'usage:records_deleted': { category: 'limits', message: 'activity.usage_records_deleted', detail: ['deleted', 'before'] },
  'canvas:deleted': { category: 'canvas', message: 'activity.canvas_deleted', detail: [] },
  'canvas:restored': { category: 'canvas', message: 'activity.canvas_restored', detail: [] },
  'canvas:visibility_changed': { category: 'canvas', message: 'activity.canvas_visibility_changed', detail: ['from', 'to'] },
  'canvas:taken_over': { category: 'canvas', message: 'activity.canvas_taken_over', detail: ['fromId', 'fromName'] },
  'canvas:overwritten': { category: 'canvas', message: 'activity.canvas_overwritten', detail: ['revision'] },
  'share:created': { category: 'share', message: 'activity.share_created', detail: ['expiresAt'] },
  'share:revoked': { category: 'share', message: 'activity.share_revoked', detail: ['expiresAt'] },
  'team:created': { category: 'team', message: 'activity.team_created', detail: [] },
  'team:renamed': { category: 'team', message: 'activity.team_renamed', detail: ['from', 'to'] },
  // removed: the avatar was taken away rather than replaced.
  'team:avatar_changed': { category: 'team', message: 'activity.team_avatar_changed', detail: ['removed'] },
  // changed: the names of the settings; before / after: their values, keyed by the same names.
  'team:settings_changed': { category: 'team', message: 'activity.team_settings_changed', detail: ['changed', 'before', 'after'] },
  'team:dissolved': { category: 'team', message: 'activity.team_dissolved', detail: ['purgeAt'] },
  'team:restored': { category: 'team', message: 'activity.team_restored', detail: [] },
  'team:suspended': { category: 'team', message: 'activity.team_suspended', detail: [] },
  'team:resumed': { category: 'team', message: 'activity.team_resumed', detail: [] },
}

const CATEGORIES = [...new Set(Object.values(TYPES).map((d) => d.category))]

/** How deep a `detail` value may nest: before -> team -> runs. */
const MAX_DEPTH = 2

/** Only small plain values survive: a number, a boolean, a short string, or up to two levels of those. */
function plain(v, depth = 0) {
  if (v === null || typeof v === 'boolean') return v
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') return v.slice(0, 120)
  if (v instanceof Date) return v.toISOString()
  if (Array.isArray(v)) return depth < 1 ? v.slice(0, 20).map((x) => plain(x, MAX_DEPTH)).filter((x) => x !== undefined) : undefined
  if (v && typeof v === 'object' && depth < MAX_DEPTH) {
    const out = {}
    for (const [k, x] of Object.entries(v).slice(0, 12)) {
      const val = plain(x, depth + 1)
      if (val !== undefined && /^[A-Za-z][A-Za-z0-9]{0,29}$/.test(k)) out[k] = val
    }
    return out
  }
  return undefined
}

/**
 * Write one entry. `actor` is { id, name } ('' id: the site's super admin
 * acting from outside); `target` is { type, id, name } or null.
 */
async function record(teamId, actor, type, target = null, detail = {}) {
  const def = TYPES[type]
  if (!def) throw new Error(`unknown activity type: ${type}`)
  const kept = {}
  for (const key of def.detail) {
    const value = plain(detail ? detail[key] : undefined)
    if (value !== undefined) kept[key] = value
  }
  try {
    await TeamActivity.create({
      teamId: String(teamId),
      actorId: String((actor && actor.id) || ''),
      actorName: String((actor && actor.name) || '').slice(0, 80),
      type,
      category: def.category,
      target: target ? { type: String(target.type || ''), id: String(target.id || ''), name: String(target.name || '').slice(0, 120) } : {},
      detail: kept,
    })
  } catch (err) {
    console.error(`[activity] ${type} of team ${teamId} could not be recorded:`, err && err.message)
  }
}

/** `detail` fields that name an account, and the field next to each that carries that account's name. */
const PERSON_FIELDS = { fromId: 'fromName', inviterId: 'inviterName', createdById: 'createdByName' }

const isId = (v) => typeof v === 'string' && /^[0-9a-f]{24}$/i.test(v)

/** The accounts a page of entries mentions: actors, member targets, and the people named in `detail`. */
function peopleIds(rows) {
  const ids = new Set()
  for (const row of rows || []) {
    if (isId(row.actorId)) ids.add(row.actorId)
    const target = row.target || {}
    if (target.type === 'member' && isId(target.id)) ids.add(target.id)
    for (const key of Object.keys(PERSON_FIELDS)) if (row.detail && isId(row.detail[key])) ids.add(row.detail[key])
  }
  return [...ids]
}

/**
 * One stored entry -> what the API returns.
 *
 * `names` is spaces.people() for peopleIds(rows) in this team. With it the
 * people of the entry are who they are NOW: the display name they have in the
 * team today and whether they are still in it (`state`). The name written at
 * the time is the fallback - for somebody nobody remembers any more, and for
 * a caller that passes no `names`.
 *
 * `message` is the sentence in the reader's language, as it always was; a
 * client that renders its own from `type` and `detail` falls back to it for a
 * type it does not know.
 */
function serialize(row, locale, names = null) {
  const def = TYPES[row.type]
  const stored = row.target || {}
  const lookup = (id) => (names && isId(id) && names.get(String(id))) || null

  let actor
  if (!row.actorId) {
    // The site's super admin acting from outside the team: not a member, not a person of the team.
    actor = { id: '', username: '', name: t(locale, 'activity.site_admin'), state: 'active', left: false, deleted: false, system: true }
  } else {
    const person = lookup(row.actorId)
    actor = person
      ? { ...person, name: person.name || row.actorName || '', system: false }
      : { id: row.actorId, username: '', name: row.actorName || '', state: 'active', left: false, deleted: false, system: false }
  }

  let target = null
  if (stored.id || stored.name) {
    target = { type: stored.type || '', id: stored.id || '', name: stored.name || '' }
    if (target.type === 'member') {
      const person = lookup(target.id)
      if (person) {
        target.name = person.name || target.name
        target.person = { ...person, name: target.name }
      }
    }
  }

  const detail = { ...(row.detail || {}) }
  for (const [idKey, nameKey] of Object.entries(PERSON_FIELDS)) {
    const person = lookup(detail[idKey])
    if (person && person.name) detail[nameKey] = person.name
  }

  return {
    id: String(row._id),
    type: row.type,
    category: row.category,
    actor,
    target,
    detail,
    message: def ? t(locale, def.message, { actor: actor.name, target: target ? target.name : '', ...flat(detail) }) : row.type,
    createdAt: row.createdAt,
  }
}

/** Placeholder values a sentence may use: the top-level strings and numbers of `detail`. */
function flat(detail) {
  const out = {}
  for (const [k, v] of Object.entries(detail || {})) if (typeof v === 'string' || typeof v === 'number') out[k] = v
  return out
}

/** Remove the entries older than `days` (0 = keep for ever). Returns how many went. */
async function sweep(days, now = Date.now()) {
  if (!days) return 0
  const r = await TeamActivity.deleteMany({ createdAt: { $lt: new Date(now - days * 24 * 3600 * 1000) } })
  return r.deletedCount || 0
}

module.exports = { TYPES, CATEGORIES, PERSON_FIELDS, record, serialize, peopleIds, sweep }
