'use strict'

/**
 * The permission matrix of a team, walked over real HTTP.
 *
 * services/permissions.js holds the one table (MATRIX): for every action,
 * what the owner, an admin and a member may do - yes, no, or under a
 * condition. This file has one probe per action and runs every cell:
 *
 *   yes    the action goes through (also in the case that is refused to others)
 *   no     it is refused, and nothing happened
 *   cond   it goes through where the condition holds and is refused where it does not
 *
 * A row without a probe, or a probe without a row, fails the suite - so a
 * permission cannot be added, or changed, without saying here what it means.
 * The last test checks that docs/api.md and docs/api.zh-CN.md print the very
 * same table.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { boot } = require('./support/teamHarness')
const permissions = require('../src/services/permissions')

const MODEL = 'gaorui:nano-banana-2'
const MODEL_PATH = `/api/admin/models/${encodeURIComponent(MODEL)}`
const FORBIDDEN = [403, 'team.forbidden']
const text = (id = 'n1') => [{ id, type: 'text', position: { x: 0, y: 0 }, data: { text: 'hi' } }]

test('the permission matrix: every action, as the owner, an admin and a member', async (t) => {
  const h = await boot(t, 'matrix')
  if (!h) return t.skip('no MongoDB available (set TEST_MONGODB_URI)')

  const ann = await h.register('ann')
  const amy = await h.register('amy')
  const alan = await h.register('alan')
  const mia = await h.register('mia') // "somebody else": a plain member whose things the others act on
  const team = await h.createTeam(ann, 'Matrix')
  const T = `/api/teams/${team.id}`
  await h.join(ann, team.id, amy, { admin: true })
  await h.join(ann, team.id, alan)
  await h.join(ann, team.id, mia)
  await h.addProvider(ann.in(team.id), 'sk-matrix-team-key-0000aaaa')
  const actors = { owner: ann.in(team.id), admin: amy.in(team.id), member: alan.in(team.id) }
  const other = mia.in(team.id)
  let seq = 0

  /** A canvas of somebody else (mia) with the given visibility, or one of the actor's own. */
  const canvasOf = (c, visibility) => c.data('POST', '/api/workflow', { name: `c${++seq}`, visibility, nodes: text() })
  /** A new account in the team with that role. */
  async function fresh(role) {
    const c = await h.register(`f${++seq}x`)
    await h.join(ann, team.id, c, { admin: role === 'admin' })
    return c
  }

  /**
   * action -> (role, c) -> { allow, deny?, refusal?, denied? }
   *   allow    the case the action is allowed in (for those who may)
   *   deny     for a conditional cell: the case in which it is not
   *   refusal  what a refusal looks like ([status, code]); 403 team.forbidden unless said otherwise
   * Each returns the HTTP response, or { ok: boolean } where being allowed is not a status code.
   */
  const PROBES = {
    'canvas:create': (role, c) => ({ allow: () => c.call('POST', '/api/workflow', { name: 'mine' }) }),
    'canvas:edit_own': (role, c) => ({
      allow: async () => {
        const wf = await canvasOf(c, 'private')
        const saved = await c.call('PUT', `/api/workflow/${wf.id}`, { name: 'renamed', baseRevision: wf.revision })
        if (saved.status !== 200) return saved
        return c.call('DELETE', `/api/workflow/${wf.id}`)
      },
    }),
    'canvas:view': (role, c) => ({
      allow: async () => c.call('GET', `/api/workflow/${(await canvasOf(other, 'team_view')).id}`),
      deny: async () => c.call('GET', `/api/workflow/${(await canvasOf(other, 'private')).id}`),
      refusal: [404, 'canvas.not_found'],
    }),
    'canvas:edit': (role, c) => ({
      allow: async () => c.call('PUT', `/api/workflow/${(await canvasOf(other, 'team_edit')).id}`, { name: 'edited', baseRevision: 0 }),
      deny: async () => c.call('PUT', `/api/workflow/${(await canvasOf(other, 'team_view')).id}`, { name: 'edited', baseRevision: 0 }),
    }),
    'canvas:delete': (role, c) => ({
      allow: async () => c.call('DELETE', `/api/workflow/${(await canvasOf(other, 'team_edit')).id}`),
      deny: async () => c.call('DELETE', `/api/workflow/${(await canvasOf(other, 'private')).id}`),
      // An admin cannot delete what they cannot see: for them it is not there.
      denyRefusal: [404, 'canvas.not_found'],
    }),
    'canvas:set_visibility': (role, c) => (role === 'member'
      ? {
        allow: async () => c.call('PATCH', `/api/workflow/${(await canvasOf(c, 'private')).id}/access`, { visibility: 'team_edit' }),
        deny: async () => c.call('PATCH', `/api/workflow/${(await canvasOf(other, 'team_edit')).id}/access`, { visibility: 'private' }),
      }
      : {
        allow: async () => c.call('PATCH', `/api/workflow/${(await canvasOf(other, 'team_view')).id}/access`, { visibility: 'team_edit' }),
        deny: async () => c.call('PATCH', `/api/workflow/${(await canvasOf(other, 'private')).id}/access`, { visibility: 'team_edit' }),
        denyRefusal: [404, 'canvas.not_found'],
      }),
    'canvas:take_over': (role, c) => {
      const locked = async (visibility) => {
        const wf = await canvasOf(other, visibility)
        await other.data('POST', `/api/workflow/${wf.id}/lock`)
        return wf
      }
      return {
        allow: async () => c.call('POST', `/api/workflow/${(await locked('team_edit')).id}/lock`, { takeover: true }),
        deny: async () => c.call('POST', `/api/workflow/${(await locked('team_view')).id}/lock`, { takeover: true }),
      }
    },
    'canvas:overwrite': (role, c) => (role === 'member'
      ? {
        allow: async () => c.call('PUT', `/api/workflow/${(await canvasOf(c, 'team_edit')).id}`, { name: 'mine again', baseRevision: 7, force: true }),
        deny: async () => c.call('PUT', `/api/workflow/${(await canvasOf(other, 'team_edit')).id}`, { name: 'forced', baseRevision: 7, force: true }),
      }
      : {
        allow: async () => c.call('PUT', `/api/workflow/${(await canvasOf(other, 'team_edit')).id}`, { name: 'forced', baseRevision: 7, force: true }),
        deny: async () => c.call('PUT', `/api/workflow/${(await canvasOf(other, 'team_view')).id}`, { name: 'forced', baseRevision: 7, force: true }),
      }),
    'canvas:restore': (role, c) => ({
      allow: async () => {
        const wf = await canvasOf(other, 'team_view')
        await other.data('DELETE', `/api/workflow/${wf.id}`)
        return c.call('POST', `/api/workflow/${wf.id}/restore`)
      },
    }),
    'share:create': (role, c) => ({
      allow: async () => c.call('POST', '/api/canvas-share/publish', { workflowId: (await canvasOf(other, 'team_edit')).id }),
      deny: async () => c.call('POST', '/api/canvas-share/publish', { workflowId: (await canvasOf(other, 'team_view')).id }),
    }),
    'share:manage_all': (role, c) => ({
      allow: async () => {
        const wf = await canvasOf(other, 'team_view')
        const share = await other.data('POST', '/api/canvas-share/publish', { workflowId: wf.id })
        return c.call('POST', `/api/canvas-share/${share.id}/revoke`)
      },
      // Somebody else's link is not in a member's list at all.
      refusal: [404, 'share.not_found'],
    }),
    'asset:use': (role, c) => ({
      allow: async () => {
        const added = await c.call('POST', '/api/user-asset', { name: 'a', mediaUrl: 'https://example.com/a.png', width: 10, height: 10 })
        if (added.status !== 200) return added
        const saved = await c.call('POST', '/api/canvas/text-templates', { title: 's', content: 'hello' })
        if (saved.status !== 200) return saved
        return c.call('GET', '/api/user-asset/list')
      },
    }),
    'asset:manage_all': (role, c) => ({
      allow: async () => {
        const asset = await other.data('POST', '/api/user-asset', { name: 'hers', mediaUrl: 'https://example.com/b.png', width: 10, height: 10 })
        const renamed = await c.call('PUT', `/api/user-asset/${asset.id}`, { name: 'renamed' })
        if (renamed.status !== 200) return renamed
        const snippet = await other.data('POST', '/api/canvas/text-templates', { title: 'hers', content: 'hello' })
        return c.call('DELETE', `/api/canvas/text-templates/${snippet.id}`)
      },
    }),
    'brandkit:manage': (role, c) => ({ allow: () => c.call('POST', '/api/brand-kits', { name: `kit${++seq}` }) }),
    'provider:manage': (role, c) => ({ allow: () => c.call('PUT', MODEL_PATH, { label: `label ${++seq}` }) }),
    'run:create': (role, c) => ({ allow: () => c.call('POST', '/api/runs', { model: MODEL, prompt: 'hi' }) }),
    'invite:manage': (role, c) => ({ allow: () => c.call('POST', `${T}/invitations`, {}) }),
    'member:remove': (role, c) => ({
      allow: async () => c.call('DELETE', `${T}/members/${(await fresh('member')).user.id}`),
      deny: async () => c.call('DELETE', `${T}/members/${(await fresh('admin')).user.id}`),
    }),
    'member:set_role': (role, c) => ({ allow: async () => c.call('PATCH', `${T}/members/${(await fresh('member')).user.id}`, { role: 'admin' }) }),
    'usage:view_own': (role, c) => ({ allow: () => c.call('GET', `${T}/usage`) }),
    'usage:view_all': (role, c) => {
      // Not a refusal but a narrower answer: everybody's records, or one's own.
      const scope = async () => ({ ok: (await c.data('GET', `${T}/usage`)).scope === 'all' && (await c.data('GET', `${T}/members`)).withUsage === true })
      return {
        allow: async () => {
          await ann.data('PATCH', T, { settings: { adminsSeeAll: true } })
          try { return await scope() } finally { await ann.data('PATCH', T, { settings: { adminsSeeAll: false } }) }
        },
        deny: scope,
      }
    },
    'limits:manage': (role, c) => ({
      allow: async () => {
        const set = await c.call('PUT', `${T}/limits`, { team: { runs: null } })
        if (set.status !== 200) return set
        return c.call('PATCH', `${T}/members/${mia.user.id}`, { limits: { runs: null } })
      },
    }),
    'activity:view': (role, c) => ({ allow: () => c.call('GET', `${T}/activity`) }),
    'team:rename': (role, c) => ({ allow: () => c.call('PATCH', T, { name: 'Matrix' }) }),
    'team:settings': (role, c) => ({ allow: () => c.call('PATCH', T, { settings: { copyToPersonal: true }, timezone: 'UTC' }) }),
    'team:transfer': (role, c) => ({
      allow: async () => {
        const out = await c.call('POST', `${T}/transfer`, { userId: amy.user.id, confirm: 'Matrix' })
        // Back again, so the cast keeps its roles.
        if (out.status === 200) await amy.data('POST', `${T}/transfer`, { userId: ann.user.id, confirm: 'Matrix' })
        return out
      },
    }),
    'team:dissolve': (role, c) => ({
      allow: async () => {
        const out = await c.call('DELETE', `${T}?confirm=Matrix`)
        if (out.status === 200) await ann.data('POST', `${T}/restore`)
        return out
      },
    }),
    'team:leave': (role, c) => ({
      // Somebody new with the same role leaves, so the cast stays.
      allow: async () => (role === 'owner' ? c.call('POST', `${T}/leave`) : (await fresh(role)).call('POST', `${T}/leave`)),
      refusal: [409, 'team.owner_cannot_leave'],
    }),
  }

  await t.test('every row of the table has a probe, and every probe a row', () => {
    const actions = permissions.MATRIX.map((r) => r.action)
    assert.deepEqual(Object.keys(PROBES).sort(), actions.slice().sort())
    assert.equal(new Set(actions).size, actions.length)
    for (const row of permissions.MATRIX) {
      for (const role of permissions.ROLES) assert.ok(['yes', 'no', 'cond'].includes(row[role]), `${row.action}.${role}`)
      const conditional = permissions.ROLES.filter((r) => row[r] === 'cond')
      assert.deepEqual(Object.keys(row.when || {}).sort(), conditional.slice().sort(), `${row.action}: a condition for each conditional cell, and no other`)
      if (conditional.length) assert.ok(row.note, `${row.action}: a conditional cell needs its note`)
    }
  })

  const went = (r) => (typeof r.ok === 'boolean' ? r.ok : r.status >= 200 && r.status < 300)
  const describe = (r) => (typeof r.ok === 'boolean' ? `ok=${r.ok}` : `${r.status} ${r.body && r.body.code}`)
  function assertRefused(r, want, what) {
    if (typeof r.ok === 'boolean') return assert.equal(r.ok, false, what)
    assert.deepEqual([r.status, r.body && r.body.code], want, what)
  }

  for (const row of permissions.MATRIX) {
    await t.test(`${row.action}: owner ${row.owner}, admin ${row.admin}, member ${row.member}`, async () => {
      for (const role of permissions.ROLES) {
        const cell = row[role]
        const probe = PROBES[row.action](role, actors[role])
        const what = `${row.action} as ${role} (${cell})`
        if (cell === 'yes') {
          const r = await probe.allow()
          assert.ok(went(r), `${what}: ${describe(r)}`)
          // Unconditionally allowed: also in the case others are refused in.
          if (probe.deny && permissions.ROLES.some((x) => row[x] === 'cond')) {
            const d = await probe.deny()
            assert.ok(went(d), `${what}, in the case that is conditional for others: ${describe(d)}`)
          }
        } else if (cell === 'no') {
          assertRefused(await probe.allow(), probe.refusal || FORBIDDEN, what)
        } else {
          assert.ok(probe.deny, `${row.action}: a conditional cell needs a case in which it is refused`)
          const r = await probe.allow()
          assert.ok(went(r), `${what}, where the condition holds: ${describe(r)}`)
          assertRefused(await probe.deny(), probe.denyRefusal || probe.refusal || FORBIDDEN, `${what}, where it does not`)
        }
      }
    })
  }

  await t.test('what the server tells a client about its role is the same table', async () => {
    for (const role of permissions.ROLES) {
      const told = (await actors[role].data('GET', T)).permissions
      const boot = (await actors[role].data('GET', '/api/bootstrap')).space.permissions
      assert.deepEqual(told, boot)
      for (const row of permissions.MATRIX) {
        const want = row[role] === 'yes' ? true : row[role] === 'no' ? false : (row.action === 'usage:view_all' ? false : null)
        assert.equal(told[row.action], want, `${row.action} as ${role}`)
      }
    }
    // In a personal space there is one person: everything that exists there is theirs to do.
    const mine = (await alan.data('GET', '/api/bootstrap')).space.permissions
    assert.ok(Object.values(mine).every((v) => v === true))
    // Per canvas, the conditional cells are answered for that canvas.
    const hers = await canvasOf(other, 'team_view')
    assert.deepEqual((await actors.member.data('GET', `/api/workflow/${hers.id}`)).access, { canView: true, canEdit: false, canDelete: false, canSetVisibility: false, canTakeOver: false, canOverwrite: false, canShare: false })
    assert.deepEqual((await actors.admin.data('GET', `/api/workflow/${hers.id}`)).access, { canView: true, canEdit: false, canDelete: true, canSetVisibility: true, canTakeOver: false, canOverwrite: false, canShare: false })
    assert.deepEqual((await actors.owner.data('GET', `/api/workflow/${hers.id}`)).access, { canView: true, canEdit: true, canDelete: true, canSetVisibility: true, canTakeOver: true, canOverwrite: true, canShare: true })
  })

  await t.test('with "only managers may share" a member cannot publish even what they may edit', async () => {
    const own = await canvasOf(actors.member, 'team_edit')
    await ann.data('PATCH', T, { settings: { publicShare: 'managers' } })
    assert.deepEqual(await actors.member.refused('POST', '/api/canvas-share/publish', { workflowId: own.id }), FORBIDDEN)
    assert.equal((await actors.member.data('GET', `/api/workflow/${own.id}`)).access.canShare, false)
    assert.equal(await actors.admin.status('POST', '/api/canvas-share/publish', { workflowId: own.id }), 200)
    await ann.data('PATCH', T, { settings: { publicShare: 'editors' } })
    assert.equal(await actors.member.status('POST', '/api/canvas-share/publish', { workflowId: own.id }), 200)
  })
})

test('the documented permission matrix is the table the code uses', () => {
  const docs = path.join(__dirname, '..', '..', 'docs')
  const en = fs.readFileSync(path.join(docs, 'api.md'), 'utf8')
  const zh = fs.readFileSync(path.join(docs, 'api.zh-CN.md'), 'utf8')
  // English: the table as permissions.toMarkdown() prints it, line for line.
  for (const line of permissions.toMarkdown().split('\n')) assert.ok(en.includes(line), `docs/api.md is missing the row:\n${line}`)
  // Chinese: its own wording, the same ids and the same three cells.
  for (const row of permissions.MATRIX) {
    const cells = ` | \`${row.action}\` | ${permissions.SYMBOL[row.owner]} | ${permissions.SYMBOL[row.admin]} | ${permissions.SYMBOL[row.member]} | `
    assert.ok(zh.includes(cells), `docs/api.zh-CN.md: the row of ${row.action} should read "...${cells}..."`)
  }
  const ids = (text) => [...text.matchAll(/^\| [^|]+ \| `([a-z_]+:[a-z_]+)` \| [^|]+ \| [^|]+ \| [^|]+ \|/gm)].map((m) => m[1])
  const actions = permissions.MATRIX.map((r) => r.action)
  assert.deepEqual(ids(en), actions, 'docs/api.md lists exactly the rows of the table, in its order')
  assert.deepEqual(ids(zh), actions, 'docs/api.zh-CN.md lists exactly the rows of the table, in its order')
})
