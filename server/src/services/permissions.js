'use strict'

/**
 * Who may do what inside a team: the one table.
 *
 * Every role check in the routes goes through can() or one of the canvas
 * helpers below, the permission matrix in docs/api.md is this table printed
 * (toMarkdown), and test/teams.matrix.e2e.test.js walks the same rows over
 * real HTTP - so the documentation, the checks and the tests cannot drift
 * apart.
 *
 * A cell is 'yes', 'no' or 'cond': allowed under the condition the row's
 * `note` states, which the code expresses in `when`.
 *
 * In a personal space there is one person and no table: everything that
 * exists there is allowed, and the team-only actions do not exist.
 */
const { TEAM_ROLES, VISIBILITY } = require('../constants')

const { OWNER, ADMIN, MEMBER } = TEAM_ROLES
const Y = 'yes'
const N = 'no'
const C = 'cond'

const isCreator = (ctx) => !!ctx.canvas && creatorOf(ctx.canvas) === ctx.userId
const visibleToTeam = (ctx) => !!ctx.canvas && [VISIBILITY.TEAM_VIEW, VISIBILITY.TEAM_EDIT].includes(ctx.canvas.visibility)
const editableByTeam = (ctx) => !!ctx.canvas && ctx.canvas.visibility === VISIBILITY.TEAM_EDIT
const canSee = (ctx) => isCreator(ctx) || visibleToTeam(ctx)
const canChange = (ctx) => isCreator(ctx) || editableByTeam(ctx)
const editorsMayShare = (ctx) => !ctx.team || !ctx.team.settings || ctx.team.settings.publicShare !== 'managers'

/** Who made a document: `createdBy`, or - for rows from before teams - the space itself. */
function creatorOf(doc) {
  return String((doc && (doc.createdBy || doc.userId)) || '')
}

/**
 * action -> { owner, admin, member, label, note, when? }
 * `when[role]` decides a 'cond' cell from { userId, team, canvas, target }.
 */
const MATRIX = [
  { action: 'canvas:create', owner: Y, admin: Y, member: Y, label: 'Create a canvas' },
  { action: 'canvas:edit_own', owner: Y, admin: Y, member: Y, label: 'Edit or delete a canvas they created', note: 'A deleted canvas can be restored by the owner and admins for 30 days' },
  {
    action: 'canvas:view', owner: Y, admin: C, member: C, label: 'See somebody else\'s canvas',
    note: 'Admins and members: only canvases set to "team can view" or "team can edit". The owner sees all of them, "only me" included',
    when: { admin: canSee, member: canSee },
  },
  {
    action: 'canvas:edit', owner: Y, admin: C, member: C, label: 'Edit somebody else\'s canvas',
    note: 'Admins and members: only canvases set to "team can edit"',
    when: { admin: canChange, member: canChange },
  },
  {
    action: 'canvas:delete', owner: Y, admin: C, member: N, label: 'Delete somebody else\'s canvas',
    note: 'Admins: any canvas they can see',
    when: { admin: canSee },
  },
  {
    action: 'canvas:set_visibility', owner: Y, admin: C, member: C, label: 'Change who can see a canvas',
    note: 'Admins: any canvas they can see. Members: only canvases they created',
    when: { admin: canSee, member: isCreator },
  },
  {
    action: 'canvas:take_over', owner: Y, admin: C, member: C, label: 'Take over a canvas somebody else is editing',
    note: 'Whoever may edit the canvas: for admins and members that is their own canvases and those set to "team can edit"',
    when: { admin: canChange, member: canChange },
  },
  {
    action: 'canvas:overwrite', owner: Y, admin: C, member: C, label: 'Overwrite a newer version with their own on a save conflict',
    note: 'Admins: any canvas they may edit. Members: only canvases they created',
    when: { admin: canChange, member: isCreator },
  },
  { action: 'canvas:restore', owner: Y, admin: Y, member: N, label: 'Restore a deleted canvas', note: 'Within 30 days of the deletion' },
  {
    action: 'share:create', owner: Y, admin: C, member: C, label: 'Create a public share link',
    note: 'A canvas they may edit. With the team setting "only managers may share", members cannot',
    when: { admin: canChange, member: (ctx) => canChange(ctx) && editorsMayShare(ctx) },
  },
  { action: 'share:manage_all', owner: Y, admin: Y, member: N, label: 'See and revoke anybody\'s share links', note: 'Members see and revoke the links they created' },
  { action: 'asset:use', owner: Y, admin: Y, member: Y, label: 'See, use and upload team assets, templates and snippets', note: 'Everybody may edit or delete what they added themselves' },
  { action: 'asset:manage_all', owner: Y, admin: Y, member: N, label: 'Edit or delete assets, templates and snippets somebody else added' },
  { action: 'brandkit:manage', owner: Y, admin: Y, member: N, label: 'Create, change or delete brand kits', note: 'Members can only choose one for a canvas' },
  { action: 'provider:manage', owner: Y, admin: Y, member: N, label: 'Configure providers, keys, custom models, prices; switch models on and off', note: 'Members see names, models and prices - never a key, its last characters or the address' },
  { action: 'run:create', owner: Y, admin: Y, member: Y, label: 'Run models with the team\'s keys', note: 'Within the monthly limits' },
  { action: 'invite:manage', owner: Y, admin: Y, member: N, label: 'Create and revoke invite links' },
  {
    action: 'member:remove', owner: Y, admin: C, member: N, label: 'Remove a member',
    note: 'Admins can remove members, not the owner or other admins',
    when: { admin: (ctx) => !!ctx.target && ctx.target.role === MEMBER },
  },
  { action: 'member:set_role', owner: Y, admin: N, member: N, label: 'Make somebody an admin, or a member again' },
  { action: 'usage:view_own', owner: Y, admin: Y, member: Y, label: 'See their own records and usage' },
  {
    action: 'usage:view_all', owner: Y, admin: C, member: N, label: 'See everybody\'s records and usage',
    note: 'Admins: only while the owner has switched "admins see all records" on (off by default)',
    when: { admin: (ctx) => !!(ctx.team && ctx.team.settings && ctx.team.settings.adminsSeeAll) },
  },
  { action: 'limits:manage', owner: Y, admin: N, member: N, label: 'Set the monthly limits of the team and of members; delete usage records' },
  { action: 'activity:view', owner: Y, admin: Y, member: N, label: 'Read the team\'s activity log' },
  { action: 'team:rename', owner: Y, admin: Y, member: N, label: 'Change the team\'s name and avatar' },
  { action: 'team:settings', owner: Y, admin: N, member: N, label: 'Change the team\'s settings (default visibility, sharing, time zone...)' },
  { action: 'team:transfer', owner: Y, admin: N, member: N, label: 'Hand the team over to another member' },
  { action: 'team:dissolve', owner: Y, admin: N, member: N, label: 'Dissolve the team, or restore it within 7 days' },
  { action: 'team:leave', owner: N, admin: Y, member: Y, label: 'Leave the team', note: 'The owner hands the team over or dissolves it first' },
]

const BY_ACTION = new Map(MATRIX.map((row) => [row.action, row]))

/**
 * May the caller of this space do `action`? `ctx` carries what a conditional
 * cell looks at: { canvas } and/or { target: { role } }.
 * `space` is req.space: { kind, role, team, userId }.
 */
function can(space, action, ctx = {}) {
  const row = BY_ACTION.get(action)
  if (!row) throw new Error(`unknown permission: ${action}`)
  if (!space) return false
  // One person, their own space: there is nobody to check against.
  if (space.kind !== 'team') return true
  const cell = row[space.role]
  if (cell === Y) return true
  if (cell !== C) return false
  const when = row.when && row.when[space.role]
  return !!when && !!when({ userId: space.userId, team: space.team, ...ctx })
}

/**
 * The unconditional part of the table for one space, as the client gets it:
 * { 'provider:manage': true, ... }. A conditional cell is reported for the
 * team as a whole where it does not depend on a canvas (usage.view_all);
 * the per-canvas answers travel with each canvas (`access`).
 */
function summary(space) {
  const out = {}
  for (const row of MATRIX) {
    const cell = space.kind === 'team' ? row[space.role] : Y
    if (cell === Y) out[row.action] = true
    else if (cell === N) out[row.action] = false
    else if (row.action === 'usage:view_all') out[row.action] = can(space, row.action)
    // Per canvas or per member: decided when one is at hand.
    else out[row.action] = null
  }
  return out
}

/** What the caller may do with one canvas of this space. */
function canvasAccess(space, canvas) {
  const ctx = { canvas }
  const mine = space.kind !== 'team' || creatorOf(canvas) === space.userId
  return {
    canView: mine || can(space, 'canvas:view', ctx),
    canEdit: mine || can(space, 'canvas:edit', ctx),
    canDelete: mine || can(space, 'canvas:delete', ctx),
    canSetVisibility: space.kind === 'team' && can(space, 'canvas:set_visibility', ctx),
    canTakeOver: space.kind === 'team' && can(space, 'canvas:take_over', ctx),
    canOverwrite: can(space, 'canvas:overwrite', ctx),
    canShare: can(space, 'share:create', ctx),
  }
}

/** MongoDB filter: the canvases of a team space this caller may see. */
function visibleCanvasFilter(space) {
  if (space.kind !== 'team' || space.role === OWNER) return {}
  return { $or: [{ createdBy: space.userId }, { visibility: { $in: [VISIBILITY.TEAM_VIEW, VISIBILITY.TEAM_EDIT] } }] }
}

/** How a cell is printed: allowed, not allowed, allowed under the condition in the note. */
const SYMBOL = { [Y]: '✓', [N]: '—', [C]: '△' }

/** The matrix as the Markdown table in docs/api.md (one row per action, keyed by its id). */
function toMarkdown() {
  const lines = ['| Action | Id | Owner | Admin | Member | Note |', '| --- | --- | --- | --- | --- | --- |']
  for (const row of MATRIX) lines.push(markdownRow(row))
  return lines.join('\n')
}

function markdownRow(row) {
  return `| ${row.label} | \`${row.action}\` | ${SYMBOL[row.owner]} | ${SYMBOL[row.admin]} | ${SYMBOL[row.member]} | ${row.note || ''} |`
}

module.exports = { MATRIX, ROLES: [OWNER, ADMIN, MEMBER], can, summary, canvasAccess, visibleCanvasFilter, creatorOf, toMarkdown, markdownRow, SYMBOL }
