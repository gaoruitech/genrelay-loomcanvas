'use strict'

/**
 * Teams over real HTTP. Two teams, their owners, admins and members, and
 * people who are in neither. What it holds the server to, above all:
 *
 *  - a space is closed: nothing of a team is reachable from outside it - not
 *    by id (the answer is the one an id that never existed gets), not in a
 *    list, not by naming the team in X-Space - and nothing of a personal
 *    space is reachable from a team;
 *  - a team's key is used by its members and shown to none of them, and no
 *    request can make the server send a stored key somewhere else;
 *  - somebody who is taken out of a team is out on their next request;
 *  - the monthly limits hold, also against submissions made at the same moment;
 *  - one editor at a time, and a save never overwrites what it has not seen.
 *
 * The role table itself is walked in teams.matrix.e2e.test.js.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { boot } = require('./support/teamHarness')

const KEY_A = 'sk-team-alpha-key-00000000aaaa'
const KEY_A2 = 'sk-team-alpha-key-00000000a2a2'
const KEY_B = 'sk-team-beta-key-000000000bbbb'
const KEY_AL = 'sk-al-personal-key-000000cccc'
const MODEL = 'gaorui:nano-banana-2'
const MODEL_PATH = `/api/admin/models/${encodeURIComponent(MODEL)}`
const NOBODY = '0123456789abcdef01234567'

test('teams: authorisation, invitations, isolation, keys, canvases, limits, the queue, leaving and closing', async (t) => {
  const h = await boot(t, 'teams')
  if (!h) return t.skip('no MongoDB available (set TEST_MONGODB_URI)')
  const { root, anon, db, upstream } = h
  const { ObjectId } = h.mongoose.Types

  const ann = await h.register('ann') // owner of Alpha
  const amy = await h.register('amy') // admin of Alpha
  const al = await h.register('alan') // member of Alpha
  const cam = await h.register('cam') // member of Alpha, removed along the way
  const bea = await h.register('bea') // owner of Beta
  const ben = await h.register('ben') // member of Beta
  const zed = await h.register('zed') // in no team
  let alpha
  let beta
  /** The same account acting inside Alpha / Beta. */
  const inA = (c) => c.in(alpha.id)
  const inB = (c) => c.in(beta.id)

  await t.test('creating a team needs the super admin\'s authorisation: the grant, the request for it, and the limits n and m', async () => {
    // Nobody may by default - and the site says so in the bootstrap.
    assert.deepEqual((await ann.data('GET', '/api/bootstrap')).teams, { authorised: false, canCreate: false, held: 0, max: 3, maxMembers: 50, request: null })
    assert.deepEqual(await ann.refused('POST', '/api/teams', { name: 'Alpha' }), [403, 'team.not_authorised'])
    assert.equal(await db.collection('teams').countDocuments({}), 0)

    // Asking: one pending request, which the account sees and can take back.
    const asked = await ann.data('POST', '/api/teams/creation-request', { note: 'for the studio' })
    assert.deepEqual([asked.request.status, asked.request.note, asked.authorised], ['pending', 'for the studio', false])
    assert.deepEqual(await ann.refused('POST', '/api/teams/creation-request', {}), [409, 'team.request_pending'])
    assert.equal((await ann.data('DELETE', '/api/teams/creation-request')).withdrawn, true)
    assert.equal((await ann.data('GET', '/api/teams/creation')).request, null)
    await ann.data('POST', '/api/teams/creation-request', { note: 'second try' })
    await bea.data('POST', '/api/teams/creation-request')

    // The super admin sees the pending ones; nobody else sees any of it.
    for (const [m, p, b] of [['GET', '/api/admin/team-requests'], ['GET', '/api/admin/teams'], ['PATCH', `/api/admin/users/${ann.user.id}`, { canCreateTeams: true }], ['PUT', '/api/admin/settings', { teamMaxPerUser: 99 }]]) {
      assert.deepEqual(await ann.refused(m, p, b), [403, 'auth.forbidden'], `${m} ${p}`)
    }
    const queue = await root.data('GET', '/api/admin/team-requests')
    assert.deepEqual([queue.pending, queue.list.map((r) => [r.user.username, r.status, r.note]).sort()], [2, [['ann', 'pending', 'second try'], ['bea', 'pending', '']]])

    // Rejected: the account reads why, is still not authorised, and may ask again.
    const annReq = queue.list.find((r) => r.user.username === 'ann')
    await root.data('POST', `/api/admin/team-requests/${annReq.id}/reject`, { reason: 'say which team' })
    const state = await ann.data('GET', '/api/teams/creation')
    assert.deepEqual([state.authorised, state.request.status, state.request.reason], [false, 'rejected', 'say which team'])
    assert.deepEqual(await root.refused('POST', `/api/admin/team-requests/${annReq.id}/approve`), [404, 'team.request_not_found'], 'a decided request is not decided again')
    await ann.data('POST', '/api/teams/creation-request', { note: 'Alpha, the studio' })

    // Approved: that is the grant.
    const again = (await root.data('GET', '/api/admin/team-requests')).list
    for (const r of again) await root.data('POST', `/api/admin/team-requests/${r.id}/approve`)
    assert.deepEqual((await root.data('GET', '/api/admin/users')).filter((u) => u.canCreateTeams).map((u) => u.username).sort(), ['ann', 'bea', 'root'])
    assert.deepEqual(await ann.refused('POST', '/api/teams/creation-request', {}), [409, 'team.already_authorised'])

    assert.deepEqual(await ann.refused('POST', '/api/teams', { name: '' }), [400, 'common.name_required'])
    assert.deepEqual(await ann.refused('POST', '/api/teams', { name: 'Alpha', timezone: 'Mars/Phobos' }), [400, 'validation.invalid'])
    alpha = await ann.data('POST', '/api/teams', { name: 'Alpha', timezone: 'Asia/Shanghai' })
    beta = await bea.data('POST', '/api/teams', { name: 'Beta' })
    assert.deepEqual([alpha.name, alpha.role, alpha.members, alpha.status, alpha.timezone, alpha.maxMembers], ['Alpha', 'owner', 1, 'active', 'Asia/Shanghai', 50])
    assert.equal(beta.timezone, 'UTC')
    assert.ok(!(await db.collection('users').findOne({ _id: new ObjectId(alpha.id) })), 'a team id is never an account id')

    // n: how many teams one account may create.
    await root.data('PUT', '/api/admin/settings', { teamMaxPerUser: 1 })
    assert.deepEqual(await ann.refused('POST', '/api/teams', { name: 'One too many' }), [403, 'team.max_owned'])
    await root.data('PUT', '/api/admin/settings', { teamMaxPerUser: 3 })
    assert.deepEqual([await root.status('PUT', '/api/admin/settings', { teamMaxPerUser: 0 }), await root.status('PUT', '/api/admin/settings', { teamMaxMembers: 0 })], [400, 400])

    // The grant taken back: no new teams, and the one that exists stays.
    await root.data('PATCH', `/api/admin/users/${ann.user.id}`, { canCreateTeams: false })
    assert.deepEqual(await ann.refused('POST', '/api/teams', { name: 'Another' }), [403, 'team.not_authorised'])
    assert.deepEqual((await ann.data('GET', '/api/teams')).teams.map((x) => [x.name, x.role]), [['Alpha', 'owner']])
    await root.data('PATCH', `/api/admin/users/${ann.user.id}`, { canCreateTeams: true })
  })

  await t.test('invite links: managers make them, whoever holds one joins as a member - until it expires, is used up or revoked, or the team is full', async () => {
    const A = `/api/teams/${alpha.id}`
    const inv = await ann.data('POST', `${A}/invitations`, {})
    assert.match(inv.token, /^[A-Za-z0-9_-]{43}$/)
    assert.deepEqual([inv.maxUses, inv.usedCount, inv.state, Math.round((new Date(inv.expiresAt) - Date.now()) / 86400000)], [10, 0, 'valid', 7], 'seven days and ten uses unless asked otherwise')
    const stored = await db.collection('teaminvitations').findOne({})
    assert.ok(!JSON.stringify(stored).includes(inv.token), 'the token is not in the database in the clear')
    assert.deepEqual([await ann.status('POST', `${A}/invitations`, { expiresInDays: 0 }), await ann.status('POST', `${A}/invitations`, { maxUses: -1 })], [400, 400])

    // Anybody with the link sees what it is for - and nothing of what is in the team.
    const seen = await anon.data('GET', `/api/team-invitations/${inv.token}`)
    assert.deepEqual([seen.state, seen.team.name, seen.team.members, seen.inviterName, seen.alreadyMember, seen.registrationOpen], ['valid', 'Alpha', 1, 'ann', false, true])
    assert.deepEqual(Object.keys(seen.team).sort(), ['avatar', 'id', 'maxMembers', 'members', 'name', 'ownerName'])
    assert.deepEqual(await anon.refused('GET', `/api/team-invitations/${'x'.repeat(43)}`), [404, 'invite.not_found'])
    assert.deepEqual(await anon.refused('POST', `/api/team-invitations/${inv.token}/accept`), [401, 'auth.required'])

    // Joining: always as a member.
    const joined = await amy.data('POST', `/api/team-invitations/${inv.token}/accept`)
    assert.deepEqual([joined.team.id, joined.team.role, joined.already], [alpha.id, 'member', false])
    // Using it again when already in: nothing happens, and no use is spent.
    assert.equal((await amy.data('POST', `/api/team-invitations/${inv.token}/accept`)).already, true)
    assert.equal((await amy.data('GET', `/api/team-invitations/${inv.token}`)).alreadyMember, true)
    await al.data('POST', `/api/team-invitations/${inv.token}/accept`)
    await cam.data('POST', `/api/team-invitations/${inv.token}/accept`)
    assert.equal((await ann.data('GET', `${A}/invitations`)).find((i) => i.id === inv.id).usedCount, 3)
    await ann.data('PATCH', `${A}/members/${amy.user.id}`, { role: 'admin' })

    // A member cannot make or see links; an admin can.
    assert.deepEqual(await al.refused('POST', `${A}/invitations`, {}), [403, 'team.forbidden'])
    assert.deepEqual(await al.refused('GET', `${A}/invitations`), [403, 'team.forbidden'])
    const single = await amy.data('POST', `${A}/invitations`, { maxUses: 1, expiresInDays: 1 })

    // With registration closed an invite link is no way in for somebody without an account.
    await root.data('PUT', '/api/admin/site', { registrationOpen: false })
    assert.equal((await anon.data('GET', `/api/team-invitations/${single.token}`)).registrationOpen, false)
    assert.deepEqual(await anon.refused('POST', '/api/auth/register', { username: 'newcomer', email: 'newcomer@example.com', password: 'newcomer-password-1', invite: single.token, token: single.token }), [403, 'auth.registration_closed'])
    await root.data('PUT', '/api/admin/site', { registrationOpen: true })

    // Full: m, the site's ceiling, or the one the super admin gave this team.
    await root.data('PATCH', `/api/admin/teams/${alpha.id}`, { maxMembers: 4 })
    assert.equal((await zed.data('GET', `/api/team-invitations/${single.token}`)).state, 'team_full')
    assert.deepEqual(await zed.refused('POST', `/api/team-invitations/${single.token}/accept`), [409, 'invite.team_full'])
    await root.data('PATCH', `/api/admin/teams/${alpha.id}`, { maxMembers: null })

    // Used up, revoked, expired: each says so, and none lets anybody in.
    const tmp = await h.register('tmp')
    await tmp.data('POST', `/api/team-invitations/${single.token}/accept`)
    assert.deepEqual(await zed.refused('POST', `/api/team-invitations/${single.token}/accept`), [410, 'invite.used_up'])
    await ann.data('DELETE', `${A}/invitations/${inv.id}`)
    assert.deepEqual(await zed.refused('POST', `/api/team-invitations/${inv.token}/accept`), [410, 'invite.revoked'])
    const old = await ann.data('POST', `${A}/invitations`, {})
    await db.collection('teaminvitations').updateOne({ _id: new ObjectId(old.id) }, { $set: { expiresAt: new Date(Date.now() - 1000) } })
    assert.deepEqual(await zed.refused('POST', `/api/team-invitations/${old.token}/accept`), [410, 'invite.expired'])
    assert.equal((await zed.data('GET', `/api/team-invitations/${old.token}`)).state, 'expired')
    assert.equal(await db.collection('teammembers').countDocuments({ userId: zed.user.id }), 0)

    // Twenty people at one link with three uses left: three get in.
    const three = await ann.data('POST', `${A}/invitations`, { maxUses: 3 })
    const crowd = []
    for (let i = 0; i < 8; i++) crowd.push(await h.register(`crowd${i}`))
    const results = await Promise.all(crowd.map((c) => c.status('POST', `/api/team-invitations/${three.token}/accept`)))
    assert.equal(results.filter((s) => s === 200).length, 3, String(results))
    // They leave again, and so does tmp: the cast is ann, amy, al, cam.
    for (const c of [...crowd, tmp]) await c.call('POST', `${A}/leave`)
    assert.deepEqual((await al.data('GET', `${A}/members`)).members.map((m) => [m.username, m.role]), [['ann', 'owner'], ['amy', 'admin'], ['alan', 'member'], ['cam', 'member']])

    await h.join(bea, beta.id, ben)
  })

  /* What each space holds, for the isolation checks: one of everything that has an id. */
  const things = {}
  async function fill(c, apiKey, label) {
    const provider = await h.addProvider(c, apiKey)
    await c.data('PUT', MODEL_PATH, { label: `${label} model` })
    const file = await h.upload(c)
    const workflow = await c.data('POST', '/api/workflow', { name: `${label} canvas`, nodes: [{ id: 'n1', type: 'image', position: { x: 0, y: 0 }, data: { imageUrl: file.url } }] })
    const share = await c.data('POST', '/api/canvas-share/publish', { workflowId: workflow.id, title: `${label} share` })
    const asset = await c.data('POST', '/api/user-asset', { name: `${label} asset`, mediaUrl: file.url, width: 800, height: 600 })
    const kit = await c.data('POST', '/api/brand-kits', { name: `${label} kit` })
    const template = await c.data('POST', '/api/canvas/templates', { title: `${label} template`, graph: { nodes: [{ id: 'a', type: 'text' }], edges: [] } })
    const snippet = await c.data('POST', '/api/canvas/text-templates', { title: `${label} snippet`, content: 'hello' })
    const { runId } = await c.data('POST', '/api/runs', { model: MODEL, prompt: `${label} prompt`, workflowId: workflow.id })
    const run = await h.waitRun(c, runId)
    assert.equal(run.status, 'succeeded', run.error)
    return { label, provider, file, workflow, share, asset, kit, template, snippet, runId, run }
  }

  await t.test('every space is filled, and each sees exactly its own', async () => {
    things.alpha = await fill(inA(ann), KEY_A, 'Alpha')
    things.beta = await fill(inB(bea), KEY_B, 'Beta')
    things.ann = await fill(ann, 'sk-ann-personal-key-0000dddd', 'Ann')
    things.alan = await fill(al, KEY_AL, 'Alan')

    const views = [
      [inA(ann), 'Alpha'], [inA(amy), 'Alpha'], [inA(al), 'Alpha'], [inB(bea), 'Beta'], [inB(ben), 'Beta'],
      [ann, 'Ann'], [al, 'Alan'], [ann.in('personal'), 'Ann'],
    ]
    for (const [c, label] of views) {
      const who = `${c.user.username} in ${c.space || 'personal'}`
      assert.deepEqual((await c.data('GET', '/api/workflow/list')).map((w) => w.name), [`${label} canvas`], who)
      assert.deepEqual((await c.data('GET', '/api/admin/providers')).map((p) => p.id), [things[label.toLowerCase()].provider.id], who)
      assert.deepEqual((await c.data('GET', '/api/models')).find((m) => m.id === MODEL).label, `${label} model`, who)
      assert.deepEqual((await c.data('GET', '/api/user-asset/list')).list.map((a) => a.name), [`${label} asset`], who)
      assert.deepEqual((await c.data('GET', '/api/brand-kits')).map((k) => k.name), [`${label} kit`], who)
      assert.deepEqual((await c.data('GET', '/api/canvas/templates')).filter((x) => !x.builtin).map((x) => x.title), [`${label} template`], who)
      assert.deepEqual((await c.data('GET', '/api/canvas/text-templates')).filter((x) => !x.builtin).map((x) => x.title), [`${label} snippet`], who)
      assert.equal((await c.data('GET', '/api/bootstrap')).hasProvider, true, who)
    }
    // Empty spaces are empty: somebody in no team, and a member's own personal space.
    for (const c of [zed, amy, ben]) {
      assert.deepEqual([await c.data('GET', '/api/workflow/list'), await c.data('GET', '/api/admin/providers'), await c.data('GET', '/api/models'), (await c.data('GET', '/api/user-asset/list')).list], [[], [], [], []])
      assert.equal((await c.data('GET', '/api/admin/usage')).totals.runs, 0)
    }
    // Share lists and records: the owner sees the team's; a member the ones they made (none yet).
    assert.deepEqual((await inA(ann).data('GET', '/api/canvas-share/mine')).list.map((s) => s.title), ['Alpha share'])
    assert.deepEqual((await inA(al).data('GET', '/api/canvas-share/mine')).list, [])
    assert.equal((await inA(ann).data('GET', '/api/admin/usage')).totals.runs, 1)
    assert.equal((await inA(al).data('GET', '/api/admin/usage')).totals.runs, 0)
    assert.equal((await ann.data('GET', '/api/admin/usage')).totals.runs, 1)

    // Where things were written: the space's id as owner, the person as creator, files under the space's prefix.
    for (const [label, spaceId, creator] of [['alpha', alpha.id, ann.user.id], ['beta', beta.id, bea.user.id], ['alan', al.user.id, al.user.id]]) {
      const v = things[label]
      for (const [name, id] of [['workflows', v.workflow.id], ['providers', v.provider.id], ['userassets', v.asset.id], ['brandkits', v.kit.id], ['shares', v.share.id], ['runs', v.runId]]) {
        const row = await db.collection(name).findOne({ _id: new ObjectId(id) })
        assert.deepEqual([row.userId, row.createdBy], [spaceId, creator], `${label} ${name}`)
      }
      assert.ok(v.file.key.startsWith(`uploads/${spaceId}/`), v.file.key)
      const run = await db.collection('runs').findOne({ _id: new ObjectId(v.runId) })
      assert.ok(run.outputs[0].key.startsWith(`outputs/${spaceId}/`), run.outputs[0].key)
      assert.equal(run.teamId, label === 'alan' ? '' : spaceId)
    }
  })

  /** Every route that takes the id of something, aimed at what `v` holds. */
  const byId = (v) => [
    ['GET', `/api/workflow/${v.workflow.id}`],
    ['PUT', `/api/workflow/${v.workflow.id}`, { name: 'taken', baseRevision: 0 }],
    ['PUT', `/api/workflow/${v.workflow.id}`, { name: 'taken', force: true }],
    ['PATCH', `/api/workflow/${v.workflow.id}/access`, { visibility: 'team_edit' }],
    ['POST', `/api/workflow/${v.workflow.id}/lock`, { takeover: true }],
    ['POST', `/api/workflow/${v.workflow.id}/duplicate`],
    ['POST', `/api/workflow/${v.workflow.id}/copy`, { toSpace: 'personal' }],
    ['POST', `/api/workflow/${v.workflow.id}/download-zip`, {}],
    ['POST', `/api/workflow/${v.workflow.id}/restore`],
    ['DELETE', `/api/workflow/${v.workflow.id}`],
    ['POST', '/api/canvas-share/publish', { workflowId: v.workflow.id }],
    ['PUT', `/api/canvas-share/${v.share.id}`, { title: 'taken' }],
    ['POST', `/api/canvas-share/${v.share.id}/revoke`],
    ['DELETE', `/api/canvas-share/${v.share.id}`],
    ['PUT', `/api/admin/providers/${v.provider.id}`, { name: 'taken', apiKey: 'sk-attacker-key-0000000000', baseUrl: 'http://127.0.0.1:1' }],
    ['POST', `/api/admin/providers/${v.provider.id}/test`],
    ['POST', `/api/admin/providers/${v.provider.id}/models`, { model: 'x-model', kind: 'image' }],
    ['DELETE', `/api/admin/providers/${v.provider.id}`],
    ['GET', `/api/runs/${v.runId}`],
    ['POST', `/api/runs/${v.runId}/cancel`],
    ['GET', `/api/llm/tasks/${v.runId}`],
    ['PUT', `/api/user-asset/${v.asset.id}`, { name: 'taken' }],
    ['POST', `/api/user-asset/${v.asset.id}/copy`, { toSpace: 'personal' }],
    ['DELETE', `/api/user-asset/${v.asset.id}`],
    ['PUT', `/api/brand-kits/${v.kit.id}`, { name: 'taken' }],
    ['DELETE', `/api/brand-kits/${v.kit.id}`],
    ['DELETE', `/api/canvas/templates/${v.template.key}`],
    ['DELETE', `/api/canvas/text-templates/${v.snippet.id}`],
  ]
  /** The same routes aimed at ids that never existed. */
  const ghost = { workflow: { id: NOBODY }, share: { id: NOBODY }, provider: { id: NOBODY }, runId: NOBODY, asset: { id: NOBODY }, kit: { id: NOBODY }, template: { key: 'u-0000000000000000' }, snippet: { id: NOBODY } }

  await t.test('isolation by id: what another space holds answers exactly like an id that never existed', async () => {
    const snapshot = async () => JSON.stringify(await Promise.all(['workflows', 'shares', 'providers', 'modeloverrides', 'runs', 'userassets', 'brandkits', 'templates', 'texttemplates'].map((n) => db.collection(n).find({}).sort({ _id: 1 }).toArray())))
    const before = await snapshot()
    const attempts = [
      // An outsider, and members of the other team, from their personal space...
      [zed, 'alpha'], [ben, 'alpha'], [bea, 'alpha'],
      // ...a member acting inside their own team, at the other team's and at a colleague's personal things...
      [inA(al), 'beta'], [inA(ann), 'beta'], [inA(amy), 'alan'], [inA(ann), 'alan'],
      // ...and the team's own members when they are not acting in the team.
      [al, 'alpha'], [ann, 'alpha'], [ann, 'alan'],
      // The site's super admin is no exception.
      [root, 'alpha'], [root, 'alan'],
    ]
    let checked = 0
    for (const [c, target] of attempts) {
      const real = byId(things[target])
      const fake = byId(ghost)
      for (let i = 0; i < real.length; i++) {
        const [m, p, body] = real[i]
        const got = await c.refused(m, p, body)
        const [fm, fp, fbody] = fake[i]
        const want = await c.refused(fm, fp, fbody)
        const who = `${c.user.username} in ${c.space || 'personal'} -> ${target}: ${m} ${p.replace(/[0-9a-f]{24}/, ':id')}`
        assert.deepEqual(got, want, who)
        assert.ok([403, 404].includes(got[0]), `${who}: ${got}`)
        checked++
      }
      // A batch status query simply leaves the foreign run out.
      assert.deepEqual(await c.data('POST', '/api/runs/status', { ids: [things[target].runId] }), [])
    }
    assert.ok(checked > 300, String(checked))
    assert.equal(await snapshot(), before, 'not a byte of anybody\'s data changed')
    assert.ok(!upstream.calls.some((call) => call.auth === 'sk-attacker-key-0000000000'))

    // Naming a team one is not in: every route, one answer - the same as for a team that does not exist.
    for (const c of [zed, ben, root]) {
      for (const space of [alpha.id, NOBODY]) {
        for (const [m, p, body] of [['GET', '/api/workflow/list'], ['GET', '/api/models'], ['GET', '/api/admin/providers'], ['POST', '/api/runs', { model: MODEL, prompt: 'x' }], ['GET', '/api/user-asset/list'], ['GET', '/api/brand-kits'], ['GET', '/api/admin/usage/records'], ['GET', '/api/canvas-share/mine'], ['POST', '/api/workflow', { name: 'x' }], ['GET', `/api/workflow/${things.alpha.workflow.id}`]]) {
          assert.deepEqual(await c.in(space).refused(m, p, body), [404, 'team.not_found'], `${c.user.username} ${m} ${p} as ${space}`)
        }
        for (const [m, p, body] of [['GET', ''], ['PATCH', '', { name: 'x' }], ['GET', '/members'], ['GET', '/invitations'], ['POST', '/invitations', {}], ['GET', '/usage'], ['GET', '/usage/records'], ['GET', '/limits'], ['PUT', '/limits', { team: { runs: 1 } }], ['GET', '/activity'], ['POST', '/leave'], ['POST', '/transfer', { userId: c.user.id, confirm: 'Alpha' }], ['DELETE', '?confirm=Alpha'], ['POST', '/restore'], ['DELETE', `/members/${al.user.id}`]]) {
          assert.deepEqual(await c.refused(m, `/api/teams/${space}${p}`, body), [404, 'team.not_found'], `${c.user.username} ${m} /api/teams/:id${p}`)
        }
      }
    }
    assert.deepEqual(await al.in('not-an-id').refused('GET', '/api/workflow/list'), [400, 'team.bad_space'])
    assert.deepEqual((await db.collection('teams').findOne({ _id: new ObjectId(alpha.id) })).name, 'Alpha')

    // The bootstrap does not fail on a stale choice of space: it falls back and says why.
    const boot = await zed.in(alpha.id).data('GET', '/api/bootstrap')
    assert.deepEqual([boot.space.kind, boot.spaceError, boot.spaces.length], ['personal', 'team.not_found', 1])
    const mine = await inA(al).data('GET', '/api/bootstrap')
    assert.deepEqual([mine.space.id, mine.space.kind, mine.space.role, mine.space.name, mine.spaces.map((s) => [s.kind, s.name, s.role])], [alpha.id, 'team', 'member', 'Alpha', [['personal', '', 'owner'], ['team', 'Alpha', 'member']]])
    assert.deepEqual([mine.space.permissions['provider:manage'], mine.space.permissions['run:create'], mine.space.permissions['canvas:edit']], [false, true, null])
    assert.deepEqual((await al.data('GET', '/api/auth/me')).spaces.map((s) => s.name), ['', 'Alpha'])
  })

  await t.test('the team\'s key: members run with it and are never shown it, its last characters or where it is sent', async () => {
    // A member runs an image: the upstream is called with the TEAM's key.
    upstream.calls.length = 0
    const { runId } = await inA(al).data('POST', '/api/runs', { model: MODEL, prompt: 'by a member' })
    const run = await h.waitRun(inA(al), runId)
    assert.equal(run.status, 'succeeded', run.error)
    assert.ok(upstream.calls.length > 0 && upstream.calls.filter((c) => c.url.startsWith('/v1/')).every((c) => c.auth === KEY_A), JSON.stringify(upstream.calls.map((c) => c.auth)))
    const row = await db.collection('runs').findOne({ _id: new ObjectId(runId) })
    assert.deepEqual([row.userId, row.teamId, row.createdBy, row.outputs[0].key.startsWith(`outputs/${alpha.id}/`)], [alpha.id, alpha.id, al.user.id, true])
    // The billing hook hears who ran it and where.
    const billed = h.billing().find((b) => b.runId === runId)
    assert.deepEqual([billed.userId, billed.username, billed.spaceId, billed.teamId], [al.user.id, 'alan', alpha.id, alpha.id])
    const own = h.billing().find((b) => b.runId === things.alan.runId)
    assert.deepEqual([own.userId, own.spaceId, own.teamId], [al.user.id, al.user.id, ''])

    // Inside the team only the team's providers exist: a member's personal one is not there...
    await al.data('POST', '/api/admin/providers', { type: 'gaorui', apiKey: KEY_AL, baseUrl: upstream.baseUrl, slug: 'mine' })
    assert.ok((await al.data('GET', '/api/models')).some((m) => m.id === 'mine:nano-banana-2'))
    assert.ok(!(await inA(al).data('GET', '/api/models')).some((m) => m.id.startsWith('mine:')))
    assert.deepEqual(await inA(al).refused('POST', '/api/runs', { model: 'mine:nano-banana-2', prompt: 'x' }), [400, 'model.provider_missing'])
    assert.deepEqual(await inA(al).refused('POST', '/api/runs/estimate', { model: 'mine:nano-banana-2' }), [400, 'model.provider_missing'])
    // ...and the team's key is never what a personal run uses.
    upstream.calls.length = 0
    const mine = await h.waitRun(al, (await al.data('POST', '/api/runs', { model: MODEL, prompt: 'personal' })).runId)
    assert.equal(mine.status, 'succeeded')
    assert.ok(upstream.calls.filter((c) => c.url.startsWith('/v1/')).every((c) => c.auth === KEY_AL))

    // Everything a member can read, read: no key, no ciphertext, no tail, no address.
    const stored = await db.collection('providers').findOne({ _id: new ObjectId(things.alpha.provider.id) })
    const m = inA(al)
    const A = `/api/teams/${alpha.id}`
    const readable = ['/api/bootstrap', '/api/auth/me', '/api/models', '/api/admin/providers', '/api/admin/models', '/api/admin/vendors', '/api/admin/usage', '/api/admin/usage/records', '/api/admin/usage?groupBy=member', '/api/workflow/list', `/api/workflow/${things.alpha.workflow.id}`, '/api/user-asset/list', '/api/brand-kits', '/api/canvas/templates', '/api/canvas-share/mine', `/api/runs/${runId}`, '/api/teams', A, `${A}/members`, `${A}/limits`, `${A}/usage`, `${A}/usage/records`]
    let all = ''
    for (const p of readable) all += JSON.stringify(await m.data('GET', p))
    all += JSON.stringify(await m.data('POST', '/api/runs/estimate', { model: MODEL }))
    all += JSON.stringify((await m.call('GET', `${A}/activity`)).body) + JSON.stringify((await m.call('GET', `${A}/invitations`)).body)
    for (const [what, secret] of [['the key', KEY_A], ['its ciphertext', stored.apiKeyEnc], ['its last characters', stored.keyTail], ['the address', upstream.baseUrl], ['the host', upstream.baseUrl.replace('http://', '')]]) {
      assert.ok(secret && !all.includes(secret), `${what} reached a member`)
    }
    const [seen] = await m.data('GET', '/api/admin/providers')
    assert.deepEqual([seen.name, seen.slug, seen.hasKey, seen.keyTail, seen.baseUrl, seen.customBaseUrl, seen.restricted], [things.alpha.provider.name, 'gaorui', true, '', '', false, true])
    // Members read models and prices - that is all they do with providers.
    for (const [method, p, body] of [['POST', '/api/admin/providers', { type: 'gaorui', apiKey: 'sk-x-0000000000' }], ['PUT', `/api/admin/providers/${things.alpha.provider.id}`, { name: 'x' }], ['PUT', `/api/admin/providers/${things.alpha.provider.id}`, { baseUrl: 'http://127.0.0.1:1', apiKey: 'sk-x-0000000000' }], ['DELETE', `/api/admin/providers/${things.alpha.provider.id}`], ['POST', `/api/admin/providers/${things.alpha.provider.id}/test`], ['POST', `/api/admin/providers/${things.alpha.provider.id}/models`, { model: 'x', kind: 'image' }], ['PUT', MODEL_PATH, { enabled: false }], ['PUT', MODEL_PATH, { pricing: { currency: 'CNY', unit: 'per_image', price: 0 } }]]) {
      assert.deepEqual(await m.refused(method, p, body), [403, 'team.forbidden'], `${method} ${p}`)
    }
    // Managers see what a personal owner sees: that a key is set and its last four characters - never the key.
    for (const c of [inA(ann), inA(amy)]) {
      const [p] = await c.data('GET', '/api/admin/providers')
      assert.deepEqual([p.hasKey, p.keyTail, p.baseUrl, p.restricted], [true, KEY_A.slice(-4), upstream.baseUrl, false])
      assert.ok(!JSON.stringify(p).includes(KEY_A) && !JSON.stringify(p).includes(stored.apiKeyEnc))
    }
  })

  await t.test('a stored key is never sent anywhere but the address it was saved with', async () => {
    const collector = await new Promise((resolve) => {
      const seen = []
      const srv = require('http').createServer((req, res) => { seen.push(String(req.headers.authorization || '')); res.end('{}') })
      srv.listen(0, '127.0.0.1', () => resolve({ seen, url: `http://127.0.0.1:${srv.address().port}`, close: () => { srv.closeAllConnections(); srv.close() } }))
    })
    t.after(() => collector.close())
    // In a personal space and in a team alike, by whoever may edit the provider.
    for (const [c, v, key] of [[al, things.alan, KEY_AL], [inA(amy), things.alpha, KEY_A], [inA(ann), things.alpha, KEY_A]]) {
      const P = `/api/admin/providers/${v.provider.id}`
      for (const body of [{ baseUrl: collector.url }, { baseUrl: `${collector.url}/v1`, name: 'x' }, { baseUrl: `${upstream.baseUrl}/elsewhere` }, { baseUrl: '' }, { baseUrl: collector.url, apiKey: '   ' }, { baseUrl: collector.url, clearKey: false }]) {
        assert.deepEqual(await c.refused('PUT', P, body), [400, 'provider.key_required_for_url'], JSON.stringify(body))
      }
      // The vendor - the other thing that decides where a key goes - is fixed.
      assert.deepEqual(await c.refused('PUT', P, { type: 'openai' }), [400, 'provider.vendor_fixed'])
      const row = await db.collection('providers').findOne({ _id: new ObjectId(v.provider.id) })
      assert.deepEqual([row.baseUrl, row.keyTail], [upstream.baseUrl, key.slice(-4)], 'the refused changes stored nothing')
      // The same address, however it is written, is no change and needs no key.
      for (const baseUrl of [`${upstream.baseUrl}/`, upstream.baseUrl.replace('http://', 'HTTP://'), upstream.baseUrl]) await c.data('PUT', P, { baseUrl, name: v.provider.name })
      // "Test connection" tests what is saved: nothing in the request moves it.
      upstream.calls.length = 0
      const tested = await c.call('POST', P + '/test', { baseUrl: collector.url, apiKey: 'sk-other-0000000000', type: 'openai' })
      assert.equal(tested.body.data.ok, true)
      assert.ok(upstream.calls.length > 0 && upstream.calls.every((call) => call.auth === key))
    }
    assert.deepEqual(collector.seen, [], 'nothing was ever sent to the other server')

    // Moving for real: with the key, or by giving the stored key up.
    const P = `/api/admin/providers/${things.alan.provider.id}`
    const moved = await al.data('PUT', P, { baseUrl: collector.url, apiKey: 'sk-al-new-key-00000000eeee' })
    assert.deepEqual([moved.baseUrl, moved.keyTail], [collector.url, 'eeee'])
    assert.deepEqual(await al.refused('PUT', P, { baseUrl: upstream.baseUrl }), [400, 'provider.key_required_for_url'])
    const cleared = await al.data('PUT', P, { baseUrl: upstream.baseUrl, clearKey: true })
    assert.deepEqual([cleared.baseUrl, cleared.hasKey, cleared.keyTail], [upstream.baseUrl, false, ''])
    // Without a stored key there is nothing to protect: the address moves freely.
    await al.data('PUT', P, { baseUrl: collector.url })
    await al.data('PUT', P, { baseUrl: upstream.baseUrl, apiKey: KEY_AL })
    assert.ok(collector.seen.every((a) => !a.includes(KEY_AL) && !a.includes(KEY_A)))

    // Storage: a saved secret access key is not put to work against another endpoint or key id.
    const s3 = { endpoint: 'http://127.0.0.1:9', bucket: 'lc-test-bucket', accessKeyId: 'AKIDTEST', region: 'us-east-1', forcePathStyle: true }
    await root.data('PUT', '/api/admin/storage', { driver: 's3', s3: { ...s3, secretAccessKey: 'storage-secret-0000' }, force: true })
    await root.data('PUT', '/api/admin/storage', { driver: 'local' })
    for (const change of [{ endpoint: collector.url }, { accessKeyId: 'AKIDOTHER' }]) {
      assert.deepEqual(await root.refused('PUT', '/api/admin/storage', { driver: 's3', s3: { ...s3, ...change }, force: true }), [400, 'storage.secret_required'], JSON.stringify(change))
      assert.deepEqual(await root.refused('POST', '/api/admin/storage/test', { s3: { ...s3, ...change } }), [400, 'storage.secret_required'])
    }
    assert.equal((await root.data('GET', '/api/admin/storage')).driver, 'local')
    // The bucket and the rest may change while the secret stays: same service, same key.
    const kept = await root.data('PUT', '/api/admin/storage', { driver: 's3', s3: { ...s3, bucket: 'lc-other-bucket' }, force: true })
    assert.equal(kept.s3.bucket, 'lc-other-bucket')
    await root.data('PUT', '/api/admin/storage', { driver: 'local' })
    assert.deepEqual(collector.seen, [])
    // Forget the made-up bucket again, so the rest of the suite has the local disk and nothing else.
    await db.collection('settings').deleteOne({ key: 'storage' })
    const storageSettings = require('../src/services/storageSettings')
    storageSettings.reset()
    await storageSettings.load()
  })

  await t.test('team canvases: three levels of visibility, the creator and the owner, copies between spaces take their files along', async () => {
    const A = `/api/teams/${alpha.id}`
    // A new team canvas starts as "team can view" unless its creator or the team says otherwise.
    const file = await h.upload(inA(al))
    const node = (url) => ({ id: 'n1', type: 'image', position: { x: 0, y: 0 }, data: { imageUrl: url } })
    const shown = await inA(al).data('POST', '/api/workflow', { name: 'Shown', nodes: [node(file.url)] })
    const secret = await inA(al).data('POST', '/api/workflow', { name: 'Secret', visibility: 'private' })
    const open = await inA(al).data('POST', '/api/workflow', { name: 'Open', visibility: 'team_edit' })
    assert.deepEqual([shown.visibility, secret.visibility, open.visibility, shown.createdBy.username, shown.spaceId], ['team_view', 'private', 'team_edit', 'alan', alpha.id])
    assert.deepEqual(shown.access, { canView: true, canEdit: true, canDelete: true, canSetVisibility: true, canTakeOver: true, canOverwrite: true, canShare: true })
    assert.equal(await inA(al).status('POST', '/api/workflow', { name: 'x', visibility: 'everyone' }), 400)

    // "Only me": the creator and the team's owner - nobody else, admins included.
    const names = async (c, q = '') => (await c.data('GET', `/api/workflow/list${q}`)).map((w) => w.name).sort()
    assert.deepEqual(await names(inA(al)), ['Alpha canvas', 'Open', 'Secret', 'Shown'])
    assert.deepEqual(await names(inA(ann)), ['Alpha canvas', 'Open', 'Secret', 'Shown'])
    for (const c of [inA(amy), inA(cam)]) {
      assert.deepEqual(await names(c), ['Alpha canvas', 'Open', 'Shown'], c.user.username)
      assert.deepEqual(await c.refused('GET', `/api/workflow/${secret.id}`), [404, 'canvas.not_found'])
      assert.deepEqual(await c.refused('PUT', `/api/workflow/${secret.id}`, { name: 'x', baseRevision: 0 }), [404, 'canvas.not_found'])
    }
    assert.deepEqual(await names(inA(amy), '?mine=1'), [])
    assert.deepEqual(await names(inA(ann), `?member=${al.user.id}&visibility=private`), ['Secret'])
    assert.deepEqual(await names(inA(cam), `?member=${al.user.id}&visibility=private`), [], 'a filter never widens what is visible')

    // "Team can view": seen and copied by all, changed by the creator and the owner only.
    const viewed = await inA(cam).data('GET', `/api/workflow/${shown.id}`)
    assert.deepEqual([viewed.access.canView, viewed.access.canEdit, viewed.access.canDelete, viewed.access.canShare, viewed.access.canSetVisibility], [true, false, false, false, false])
    for (const c of [inA(cam), inA(amy)]) {
      assert.deepEqual(await c.refused('PUT', `/api/workflow/${shown.id}`, { name: 'changed', baseRevision: 0 }), [403, 'team.forbidden'], c.user.username)
      assert.deepEqual(await c.refused('POST', `/api/workflow/${shown.id}/lock`), [403, 'team.forbidden'])
      assert.deepEqual(await c.refused('POST', '/api/canvas-share/publish', { workflowId: shown.id }), [403, 'team.forbidden'])
    }
    assert.deepEqual(await inA(cam).refused('DELETE', `/api/workflow/${shown.id}`), [403, 'team.forbidden'])
    assert.deepEqual(await inA(cam).refused('PATCH', `/api/workflow/${shown.id}/access`, { visibility: 'team_edit' }), [403, 'team.forbidden'])
    // A copy inside the team is the copier's own, and private.
    const dup = await inA(cam).data('POST', `/api/workflow/${shown.id}/duplicate`, {})
    assert.deepEqual([dup.createdBy.username, dup.visibility, dup.access.canEdit], ['cam', 'private', true])

    // "Team can edit": everybody edits; an admin may open up what they can see.
    await inA(cam).data('PUT', `/api/workflow/${open.id}`, { name: 'Open, edited', baseRevision: 0 })
    await inA(cam).data('DELETE', `/api/workflow/${open.id}/lock`)
    await inA(amy).data('PATCH', `/api/workflow/${shown.id}/access`, { visibility: 'team_edit' })
    assert.equal((await inA(cam).data('GET', `/api/workflow/${shown.id}`)).access.canEdit, true)
    await inA(al).data('PATCH', `/api/workflow/${shown.id}/access`, { visibility: 'team_view' })
    assert.deepEqual(await al.refused('PATCH', `/api/workflow/${things.alan.workflow.id}/access`, { visibility: 'team_view' }), [400, 'canvas.personal_no_visibility'])

    // The team's default for new canvases is the owner's to change.
    assert.deepEqual(await inA(amy).refused('PATCH', A, { settings: { defaultVisibility: 'private' } }), [403, 'team.forbidden'])
    await ann.data('PATCH', A, { settings: { defaultVisibility: 'private' } })
    assert.equal((await inA(cam).data('POST', '/api/workflow', { name: 'By default' })).visibility, 'private')
    await ann.data('PATCH', A, { settings: { defaultVisibility: 'team_view' } })

    // Personal -> team: a new canvas of the team, with its own copies of the files.
    const copied = await al.data('POST', `/api/workflow/${things.alan.workflow.id}/copy`, { toSpace: alpha.id })
    assert.deepEqual([copied.spaceId, copied.files], [alpha.id, 1])
    const inTeam = await inA(al).data('GET', `/api/workflow/${copied.workflowId}`)
    const url = inTeam.nodes[0].data.imageUrl
    assert.ok(url.startsWith(`/files/uploads/${alpha.id}/`) && url !== things.alan.file.url, url)
    assert.deepEqual([inTeam.visibility, inTeam.createdBy.username, inTeam.thumbnail], ['private', 'alan', url])
    assert.equal((await fetch(h.base + url)).status, 200)
    assert.ok(h.fileExists(things.alan.file.key), 'the source keeps its file')
    assert.deepEqual(await al.refused('POST', `/api/workflow/${things.alan.workflow.id}/copy`, { toSpace: 'personal' }), [400, 'space.same_space'])
    assert.deepEqual(await al.refused('POST', `/api/workflow/${things.alan.workflow.id}/copy`, { toSpace: beta.id }), [404, 'team.not_found'], 'only into a space one is in')

    // Team -> personal, unless the owner switched that off for members.
    const out = await inA(cam).data('POST', `/api/workflow/${shown.id}/copy`, { toSpace: 'personal' })
    const mine = await cam.data('GET', `/api/workflow/${out.workflowId}`)
    assert.ok(mine.nodes[0].data.imageUrl.startsWith(`/files/uploads/${cam.user.id}/`))
    assert.deepEqual(await inA(cam).refused('POST', `/api/workflow/${secret.id}/copy`, { toSpace: 'personal' }), [404, 'canvas.not_found'])
    await ann.data('PATCH', A, { settings: { copyToPersonal: false } })
    assert.deepEqual(await inA(cam).refused('POST', `/api/workflow/${shown.id}/copy`, { toSpace: 'personal' }), [403, 'space.copy_out_disabled'])
    assert.deepEqual(await inA(cam).refused('POST', `/api/user-asset/${things.alpha.asset.id}/copy`, { toSpace: 'personal' }), [403, 'space.copy_out_disabled'])
    assert.equal(await inA(ann).status('POST', `/api/workflow/${shown.id}/copy`, { toSpace: 'personal' }), 200)
    await ann.data('PATCH', A, { settings: { copyToPersonal: true } })

    // Assets: everybody adds, each manages their own, managers all; a copy takes the file along.
    const added = await inA(cam).data('POST', '/api/user-asset', { name: 'Cam asset', mediaUrl: file.url, width: 800, height: 600 })
    assert.deepEqual([added.scope, added.mine, added.canManage, added.uploaderName], ['team', true, true, 'cam'])
    const list = (await inA(al).data('GET', '/api/user-asset/list')).list
    assert.deepEqual(list.map((a) => [a.name, a.mine, a.canManage]).sort(), [['Alpha asset', false, false], ['Cam asset', false, false]])
    assert.deepEqual(await inA(al).refused('PUT', `/api/user-asset/${added.id}`, { name: 'x' }), [403, 'team.forbidden'])
    assert.deepEqual(await inA(al).refused('DELETE', `/api/user-asset/${added.id}`), [403, 'team.forbidden'])
    assert.equal((await inA(amy).data('PUT', `/api/user-asset/${added.id}`, { name: 'Cam asset, renamed' })).name, 'Cam asset, renamed')
    const assetCopy = await al.data('POST', `/api/user-asset/${things.alan.asset.id}/copy`, { toSpace: alpha.id })
    assert.ok(assetCopy.mediaUrl.startsWith(`/files/uploads/${alpha.id}/`))
    // Brand kits: all choose, managers change. Templates: all save, each removes their own.
    for (const [m, p, b] of [['POST', '/api/brand-kits', { name: 'x' }], ['PUT', `/api/brand-kits/${things.alpha.kit.id}`, { name: 'x' }], ['DELETE', `/api/brand-kits/${things.alpha.kit.id}`]]) assert.deepEqual(await inA(al).refused(m, p, b), [403, 'team.forbidden'])
    assert.equal((await inA(amy).data('PUT', `/api/brand-kits/${things.alpha.kit.id}`, { name: 'Alpha kit' })).canManage, true)
    assert.deepEqual(await inA(al).refused('DELETE', `/api/canvas/templates/${things.alpha.template.key}`), [403, 'team.forbidden'])
    const saved = await inA(al).data('POST', '/api/canvas/templates', { title: 'Al template', graph: { nodes: [{ id: 'a', type: 'text' }], edges: [] } })
    await inA(al).data('DELETE', `/api/canvas/templates/${saved.key}`)
    assert.equal(await inA(al).status('DELETE', '/api/canvas/templates/text-to-image'), 404, 'built-in templates are nobody\'s to delete')

    // Share links: whoever may edit publishes; managers see and revoke all; the owner can limit publishing to managers.
    const link = await inA(al).data('POST', '/api/canvas-share/publish', { workflowId: shown.id, title: 'For the client' })
    assert.equal((await anon.data('GET', `/api/canvas-share/${link.token}`)).title, 'For the client')
    assert.deepEqual((await inA(al).data('GET', '/api/canvas-share/mine')).list.map((s) => s.title), ['For the client'])
    assert.deepEqual((await inA(cam).data('GET', '/api/canvas-share/mine')).list, [])
    assert.deepEqual(await inA(cam).refused('POST', `/api/canvas-share/${link.id}/revoke`), [404, 'share.not_found'])
    assert.deepEqual((await inA(amy).data('GET', '/api/canvas-share/mine')).list.map((s) => [s.title, s.createdBy.username]).sort(), [['Alpha share', 'ann'], ['For the client', 'alan']])
    await inA(amy).data('POST', `/api/canvas-share/${link.id}/revoke`)
    assert.equal(await anon.status('GET', `/api/canvas-share/${link.token}`), 404)
    await ann.data('PATCH', A, { settings: { publicShare: 'managers' } })
    assert.deepEqual(await inA(al).refused('POST', '/api/canvas-share/publish', { workflowId: shown.id }), [403, 'team.forbidden'])
    await ann.data('PATCH', A, { settings: { publicShare: 'editors' } })

    // Deleting and restoring: the creator deletes, managers restore within 30 days.
    await inA(al).data('DELETE', `/api/workflow/${open.id}`)
    assert.deepEqual(await inA(al).refused('GET', '/api/workflow/trash'), [403, 'team.forbidden'])
    assert.deepEqual((await inA(amy).data('GET', '/api/workflow/trash')).map((w) => [w.name, w.deletedBy.username]), [['Open, edited', 'alan']])
    assert.deepEqual(await inA(al).refused('POST', `/api/workflow/${open.id}/restore`), [403, 'team.forbidden'])
    assert.equal((await inA(amy).data('POST', `/api/workflow/${open.id}/restore`)).name, 'Open, edited')
    await db.collection('workflows').updateOne({ _id: new ObjectId(dup.id) }, { $set: { isDeleted: true, deletedAt: new Date(Date.now() - 31 * 86400000) } })
    assert.deepEqual(await inA(ann).refused('POST', `/api/workflow/${dup.id}/restore`), [404, 'canvas.not_found'], 'after thirty days it stays deleted')
    things.shown = shown
    things.secret = secret
    things.open = open
  })

  await t.test('one editor at a time: the lock, its heartbeat and expiry, taking over, and saves that never overwrite unseen work', async () => {
    const W = `/api/workflow/${things.open.id}`
    const start = await inA(al).data('GET', W)
    assert.equal(start.lock, null)

    // The first editor takes the lock; a second one is told who holds it.
    const taken = await inA(al).data('POST', `${W}/lock`)
    assert.deepEqual([taken.lock.by.username, taken.lock.mine, taken.ttlSeconds, taken.heartbeatSeconds, taken.revision], ['alan', true, 36, 12, start.revision])
    const blocked = await inA(cam).call('POST', `${W}/lock`)
    assert.deepEqual([blocked.status, blocked.body.code, blocked.body.data.lock.by.username, blocked.body.data.canTakeOver], [423, 'canvas.locked', 'alan', true])
    assert.deepEqual([(await inA(cam).data('GET', W)).lock.by.username, (await inA(cam).data('GET', '/api/workflow/list')).find((w) => w.id === things.open.id).lock.by.username], ['alan', 'alan'], 'who is editing shows on the canvas and in the list')
    assert.deepEqual(await inA(cam).refused('PUT', W, { name: 'cam was here', settings: {}, baseRevision: start.revision }), [423, 'canvas.locked'])
    // Metadata (name, viewport) needs no lock - locks.e2e.test.js holds the server to that; content does.
    assert.deepEqual(await inA(cam).refused('PUT', W, { nodes: [], baseRevision: start.revision }), [423, 'canvas.locked'], 'no content of a canvas somebody else is editing')
    // The heartbeat keeps the moment the lock was taken and moves its end.
    await h.sleep(30)
    const beat = await inA(al).data('POST', `${W}/lock`)
    assert.ok(beat.lock.at === taken.lock.at && new Date(beat.lock.expiresAt) > new Date(taken.lock.expiresAt))

    // A team save names the revision it started from.
    assert.deepEqual(await inA(al).refused('PUT', W, { name: 'no revision', settings: {} }), [400, 'canvas.base_revision_required'])
    const first = await inA(al).data('PUT', W, { name: 'first', settings: {}, baseRevision: start.revision })
    assert.deepEqual([first.revision, first.lastEditedBy.username], [start.revision + 1, 'alan'])
    // A save from the old revision is refused, with what it needs to explain itself; nothing is written.
    const stale = await inA(al).call('PUT', W, { name: 'stale', nodes: [], baseRevision: start.revision })
    assert.deepEqual([stale.status, stale.body.code, stale.body.data.revision, stale.body.data.baseRevision, stale.body.data.lastEditedBy.username, stale.body.data.canOverwrite], [409, 'canvas.conflict', first.revision, start.revision, 'alan', true])
    assert.equal((await inA(al).data('GET', W)).name, 'first')
    // Moving the viewport is not an edit: no revision, and none needed.
    const panned = await inA(al).data('PUT', W, { viewport: { x: 9, y: 9, zoom: 2 } })
    assert.deepEqual([panned.revision, panned.viewport.x, panned.updatedAt], [first.revision, 9, first.updatedAt])

    // Taking over: whoever may edit. The former holder finds out at the next heartbeat or save.
    const over = await inA(cam).data('POST', `${W}/lock`, { takeover: true })
    assert.deepEqual([over.lock.by.username, over.lock.mine], ['cam', true])
    const lost = await inA(al).call('POST', `${W}/lock`)
    assert.deepEqual([lost.status, lost.body.code, lost.body.data.lock.by.username], [423, 'canvas.locked', 'cam'])
    assert.deepEqual(await inA(al).refused('PUT', W, { name: 'unsaved work', settings: {}, baseRevision: first.revision }), [423, 'canvas.locked'])
    // What the former holder had not saved goes into a copy of their own instead.
    const rescued = await inA(al).data('POST', '/api/workflow', { name: 'first (my version)', nodes: [], visibility: 'private' })
    assert.equal(rescued.createdBy.username, 'alan')
    const second = await inA(cam).data('PUT', W, { name: 'second', settings: {}, baseRevision: first.revision })
    assert.equal(second.revision, first.revision + 1)

    // Overwriting a newer version: the creator, admins and the owner - not another member.
    assert.deepEqual(await inA(cam).refused('PUT', W, { name: 'forced', settings: {}, baseRevision: 0, force: true }), [403, 'team.forbidden'])
    await inA(cam).data('DELETE', `${W}/lock`)
    assert.equal((await inA(cam).data('DELETE', `${W}/lock`)).released, false)
    const forced = await inA(al).data('PUT', W, { name: 'forced by its creator', settings: {}, baseRevision: 0, force: true })
    assert.deepEqual([forced.name, forced.revision, forced.lock.by.username], ['forced by its creator', second.revision + 1, 'alan'], 'a save takes the lock')

    // A lock nobody renews runs out by itself, and the canvas is free again.
    await db.collection('workflows').updateOne({ _id: new ObjectId(things.open.id) }, { $set: { 'lock.expiresAt': new Date(Date.now() - 1) } })
    assert.equal((await inA(cam).data('GET', W)).lock, null)
    assert.equal((await inA(cam).data('POST', `${W}/lock`)).lock.by.username, 'cam')
    // Two at the same instant: one gets it.
    await inA(cam).data('DELETE', `${W}/lock`)
    const race = await Promise.all([inA(al), inA(cam), inA(amy), inA(ann)].map((c) => c.status('POST', `${W}/lock`)))
    assert.deepEqual(race.slice().sort(), [200, 423, 423, 423])
    // Two saves from the same revision at the same instant: one is written.
    const holder = [inA(al), inA(cam), inA(amy), inA(ann)][race.indexOf(200)]
    const rev = (await holder.data('GET', W)).revision
    const saves = await Promise.all([holder.status('PUT', W, { name: 'one', settings: {}, baseRevision: rev }), holder.status('PUT', W, { name: 'two', settings: {}, baseRevision: rev })])
    assert.deepEqual(saves.slice().sort(), [200, 409])
    await holder.data('DELETE', `${W}/lock`)

    // A personal canvas: nobody to lock out; the revision check is there for a client that uses it.
    const P = `/api/workflow/${things.alan.workflow.id}`
    assert.equal((await al.data('POST', `${P}/lock`)).lock, null)
    const mine = await al.data('GET', P)
    const plain = await al.data('PUT', P, { name: 'as before teams', settings: {} })
    assert.equal(plain.revision, mine.revision + 1)
    assert.deepEqual(await al.refused('PUT', P, { name: 'stale', settings: {}, baseRevision: mine.revision }), [409, 'canvas.conflict'])
    assert.equal((await al.data('PUT', P, { name: 'Alan canvas', settings: {}, baseRevision: plain.revision })).revision, plain.revision + 1)
  })

  await t.test('monthly limits: runs and estimated money, per member and per team, refused at the limit and not a run later', async () => {
    const A = `/api/teams/${alpha.id}`
    const run = (c, prompt = 'x') => c.call('POST', '/api/runs', { model: MODEL, prompt })
    const used = async () => (await ann.data('GET', `${A}/limits`))
    const base = await used()
    assert.deepEqual([base.currency, base.timezone, base.blockUnpriced, base.team.runs.limit, base.team.runs.used, base.member.runs.limit], ['CNY', 'Asia/Shanghai', true, null, 2, null])
    // The month is the calendar month in the team's time zone.
    const { monthOf } = require('../src/services/budget')
    assert.deepEqual([monthOf('Asia/Shanghai', Date.parse('2026-09-30T16:30:00Z')).key, monthOf('UTC', Date.parse('2026-09-30T16:30:00Z')).key, monthOf('Asia/Shanghai', Date.parse('2026-09-30T16:30:00Z')).start.toISOString()], ['2026-10', '2026-09', '2026-09-30T16:00:00.000Z'])
    assert.equal(base.month, monthOf('Asia/Shanghai').key)

    // Limits are the owner's to set; a member reads their own numbers and nobody else's.
    for (const c of [amy, al]) assert.deepEqual(await c.refused('PUT', `${A}/limits`, { team: { runs: 1 } }), [403, 'team.forbidden'])
    assert.deepEqual(await amy.refused('PATCH', `${A}/members/${al.user.id}`, { limits: { runs: 1 } }), [403, 'team.forbidden'])
    const seenByAl = await al.data('GET', `${A}/limits`)
    assert.deepEqual([Object.keys(seenByAl).includes('team'), seenByAl.member.runs.used], [false, 1])

    // Per member: the default for everybody, and one member's own.
    await ann.data('PUT', `${A}/limits`, { memberDefault: { runs: 2 } })
    assert.equal((await run(inA(al))).status, 200)
    const refused = await run(inA(al))
    assert.deepEqual([refused.status, refused.body.code, /2 \/ 2/.test(refused.body.message)], [403, 'budget.member_runs', true])
    assert.equal((await run(inA(cam))).status, 200, 'another member has their own count')
    await ann.data('PATCH', `${A}/members/${al.user.id}`, { limits: { runs: 5 } })
    assert.equal((await run(inA(al))).status, 200, 'raised by the owner, at once')
    assert.deepEqual((await al.data('GET', `${A}/limits`)).member.runs, { used: 3, limit: 5, remaining: 2 })
    // A failed or canceled run gives its place back; one from last month never counted.
    upstream.hold()
    const held = (await run(inA(al), 'to be canceled')).body.data.runId
    await inA(al).data('POST', `/api/runs/${held}/cancel`)
    upstream.release()
    await db.collection('runs').insertOne({ userId: alpha.id, teamId: alpha.id, createdBy: al.user.id, kind: 'image', status: 'succeeded', modelId: MODEL, upstreamModel: 'nano-banana-2', providerId: new ObjectId(things.alpha.provider.id), cost: { amount: 0, currency: '', unknown: true }, createdAt: new Date(monthOf('Asia/Shanghai').start.getTime() - 1000), updatedAt: new Date() })
    assert.equal((await al.data('GET', `${A}/limits`)).member.runs.used, 3)

    // Per team: everybody together.
    const total = (await used()).team.runs.used
    await ann.data('PUT', `${A}/limits`, { team: { runs: total + 1 }, memberDefault: { runs: null } })
    await ann.data('PATCH', `${A}/members/${al.user.id}`, { limits: { runs: null } })
    assert.equal((await run(inA(amy))).status, 200)
    assert.deepEqual(await inA(al).refused('POST', '/api/runs', { model: MODEL, prompt: 'x' }), [403, 'budget.team_runs'])
    assert.deepEqual(await inA(ann).refused('POST', '/api/runs', { model: MODEL, prompt: 'x' }), [403, 'budget.team_runs'], 'the owner is under the team\'s limit too')
    assert.equal((await run(al)).status, 200, 'a team\'s limit is no limit on one\'s personal space')

    // Parallel submissions cannot both be the last one that fits.
    const now = (await used()).team.runs.used
    await ann.data('PUT', `${A}/limits`, { team: { runs: now + 4 } })
    const burst = await Promise.all(Array.from({ length: 24 }, (_, i) => run([inA(al), inA(cam), inA(amy)][i % 3], `burst ${i}`)))
    assert.equal(burst.filter((r) => r.status === 200).length, 4, String(burst.map((r) => r.status)))
    assert.ok(burst.filter((r) => r.status !== 200).every((r) => r.body.code === 'budget.team_runs'))
    assert.equal((await used()).team.runs.used, now + 4)
    await ann.data('PUT', `${A}/limits`, { team: { runs: null } })

    // Money: with a cost limit, a model without a price is refused - until it has one, or the owner lifts that rule.
    await ann.data('PUT', `${A}/limits`, { team: { amount: 2 } })
    const uncountable = (await ann.data('GET', `${A}/limits`)).uncountable
    assert.ok(uncountable.some((m) => m.id === MODEL && m.reason === 'unpriced'))
    assert.deepEqual(await inA(al).refused('POST', '/api/runs', { model: MODEL, prompt: 'x' }), [403, 'budget.unpriced_model'])
    await ann.data('PUT', `${A}/limits`, { blockUnpriced: false })
    assert.equal((await run(inA(al))).status, 200, 'allowed again: it counts as a run, not as money')
    await ann.data('PUT', `${A}/limits`, { blockUnpriced: true })
    await inA(amy).data('PUT', MODEL_PATH, { pricing: { currency: 'USD', unit: 'per_image', price: 0.5 } })
    assert.deepEqual(await inA(al).refused('POST', '/api/runs', { model: MODEL, prompt: 'x' }), [403, 'budget.currency_mismatch'])
    await inA(amy).data('PUT', MODEL_PATH, { pricing: { currency: 'CNY', unit: 'per_image', price: 0.8 } })
    assert.deepEqual((await inA(al).data('POST', '/api/runs/estimate', { model: MODEL })).totalCost, 0.8, 'members see the price')
    assert.equal((await run(inA(al))).status, 200) // 0.8
    assert.equal((await run(inA(cam))).status, 200) // 1.6
    const over = await run(inA(amy)) // 2.4 would pass 2
    assert.deepEqual([over.status, over.body.code], [403, 'budget.team_amount'])
    assert.deepEqual((await used()).team.amount, { used: 1.6, limit: 2, remaining: 0.4 })
    await ann.data('PUT', `${A}/limits`, { team: { amount: null }, memberDefault: { amount: 1 } })
    assert.deepEqual(await inA(al).refused('POST', '/api/runs', { model: MODEL, prompt: 'x' }), [403, 'budget.member_amount'])
    assert.equal((await run(inA(amy))).status, 200)
    await ann.data('PUT', `${A}/limits`, { memberDefault: { amount: null } })
    assert.deepEqual([await ann.status('PUT', `${A}/limits`, { team: { runs: -1 } }), await ann.status('PUT', `${A}/limits`, { team: { runs: 1.5 } }), await ann.status('PUT', `${A}/limits`, { currency: '$' })], [400, 400, 400])

    // The records the limits are counted from cannot be deleted while their month runs.
    assert.deepEqual(await inA(amy).refused('DELETE', '/api/admin/usage/records?before=2999-01-01'), [403, 'team.forbidden'])
    assert.deepEqual(await inA(ann).refused('DELETE', '/api/admin/usage/records?before=2999-01-01'), [400, 'usage.current_month'])
    assert.equal((await inA(ann).data('DELETE', `/api/admin/usage/records?before=${monthOf('Asia/Shanghai').start.toISOString()}`)).deleted, 1)
  })

  await t.test('records and usage: a member sees their own, the owner everybody\'s, an admin only once the owner says so', async () => {
    const A = `/api/teams/${alpha.id}`
    const who = async (c, q = '') => [...new Set((await c.data('GET', `/api/admin/usage/records?pageSize=100${q}`)).list.map((r) => r.createdBy.username))].sort()
    assert.deepEqual(await who(inA(ann)), ['alan', 'amy', 'ann', 'cam'])
    assert.deepEqual(await who(inA(ann), `&member=${cam.user.id}`), ['cam'])
    // Asking for somebody else's does not get somebody else's.
    for (const c of [inA(al), inA(amy)]) {
      assert.deepEqual(await who(c), [c.user.username])
      assert.deepEqual(await who(c, `&member=${cam.user.id}`), [c.user.username], 'the member parameter is ignored for those who may not use it')
      const summary = await c.data('GET', '/api/admin/usage?groupBy=member')
      assert.deepEqual([summary.scope, summary.items.map((i) => i.member.username)], ['own', [c.user.username]])
      assert.deepEqual((await c.data('GET', `${A}/usage?groupBy=member&member=${cam.user.id}`)).items.map((i) => i.member.username), [c.user.username])
      assert.equal((await c.data('GET', `${A}/members`)).members.some((m) => m.usage), false, 'no usage column for them')
    }
    const all = await ann.data('GET', `${A}/usage?groupBy=member`)
    assert.deepEqual([all.scope, all.timezone, all.items.map((i) => i.member.username).sort()], ['all', 'Asia/Shanghai', ['alan', 'amy', 'ann', 'cam']])
    assert.equal(all.totals.runs, all.items.reduce((n, i) => n + i.runs, 0))
    const members = (await ann.data('GET', `${A}/members`)).members
    assert.deepEqual(members.map((m) => [m.username, m.usage.runs > 0, m.limits.runs]), [['ann', true, null], ['amy', true, null], ['alan', true, null], ['cam', true, null]])

    // The switch is the owner's; an admin cannot give it to themselves.
    assert.deepEqual(await amy.refused('PATCH', A, { settings: { adminsSeeAll: true } }), [403, 'team.forbidden'])
    await ann.data('PATCH', A, { settings: { adminsSeeAll: true } })
    assert.deepEqual(await who(inA(amy)), ['alan', 'amy', 'ann', 'cam'])
    assert.equal((await amy.data('GET', A)).permissions['usage:view_all'], true)
    assert.deepEqual(await who(inA(al)), ['alan'], 'still nothing for members')
    await ann.data('PATCH', A, { settings: { adminsSeeAll: false } })
    assert.deepEqual(await who(inA(amy)), ['amy'])

    // A run of the team can be followed by any member (canvases show their results); only its starter and managers stop it.
    upstream.hold()
    const { runId } = await inA(al).data('POST', '/api/runs', { model: MODEL, prompt: 'never' })
    assert.equal((await inA(cam).data('GET', `/api/runs/${runId}`)).id, runId)
    assert.deepEqual(await inA(cam).refused('POST', `/api/runs/${runId}/cancel`), [403, 'team.forbidden'])
    assert.equal((await inA(amy).data('POST', `/api/runs/${runId}/cancel`)).status, 'canceled')
    upstream.release()
  })

  await t.test('removed from a team: out on the next request - with the lock, the queued runs and the "only me" canvases settled', async () => {
    const A = `/api/teams/${alpha.id}`
    // One run of the team at a time, so cam's second and third wait in the queue.
    await h.idle()
    await root.data('PATCH', `/api/admin/teams/${alpha.id}`, { concurrency: 1 })
    upstream.hold()
    const ids = []
    for (const prompt of ['running', 'queued 1', 'queued 2']) ids.push((await inA(cam).data('POST', '/api/runs', { model: MODEL, prompt })).runId)
    const statuses = async () => (await db.collection('runs').find({ _id: { $in: ids.map((id) => new ObjectId(id)) } }).sort({ _id: 1 }).toArray()).map((r) => r.status)
    const until = async (want) => { for (let i = 0; i < 100 && JSON.stringify(await statuses()) !== JSON.stringify(want); i++) await h.sleep(50); return statuses() }
    assert.deepEqual(await until(['running', 'queued', 'queued']), ['running', 'queued', 'queued'], 'the per-team cap holds two of them back')
    // Somebody else's personal run is not held up by the team's cap: it starts while the team's wait.
    await h.addProvider(zed, 'sk-zed-personal-key-0000ffff')
    const aside = (await zed.data('POST', '/api/runs', { model: MODEL, prompt: 'aside' })).runId
    for (let i = 0; i < 100 && (await zed.data('GET', `/api/runs/${aside}`)).status !== 'running'; i++) await h.sleep(50)
    assert.deepEqual([(await zed.data('GET', `/api/runs/${aside}`)).status, await statuses()], ['running', ['running', 'queued', 'queued']])
    const mineOnly = await inA(cam).data('POST', '/api/workflow', { name: 'Cam only', visibility: 'private' })
    const camOpen = await inA(cam).data('POST', '/api/workflow', { name: 'Cam open', visibility: 'team_edit' })
    await inA(cam).data('POST', `/api/workflow/${camOpen.id}/lock`)
    const camToken = cam.token

    // An admin removes members - not the owner, not another admin, and not themselves this way.
    assert.deepEqual(await al.refused('DELETE', `${A}/members/${cam.user.id}`), [403, 'team.forbidden'])
    assert.deepEqual(await amy.refused('DELETE', `${A}/members/${ann.user.id}`), [403, 'team.forbidden'])
    assert.deepEqual(await amy.refused('DELETE', `${A}/members/${amy.user.id}`), [400, 'team.use_leave'])
    assert.deepEqual(await amy.refused('DELETE', `${A}/members/${zed.user.id}`), [404, 'team.member_not_found'])
    const out = await amy.data('DELETE', `${A}/members/${cam.user.id}`)
    assert.deepEqual([out.removed, out.runsCanceled, out.canvasesInherited >= 1, out.keysSet], [true, 2, true, []])
    // The runs canceled with the membership say why - nobody pressed cancel on them.
    const dropped = (await ann.data('GET', `${A}/usage/records?pageSize=50`)).list.filter((r) => r.errorCode === 'run.canceled_member_removed')
    assert.deepEqual(dropped.map((r) => [r.status, r.error]), Array(2).fill(['canceled', '排队时被取消：发起人已不在这个团队']))

    // The very next request - same session, same token - is refused, everywhere.
    assert.equal(cam.token, camToken)
    for (const [m, p, b] of [['GET', '/api/workflow/list'], ['GET', `/api/workflow/${camOpen.id}`], ['PUT', `/api/workflow/${camOpen.id}`, { name: 'x', baseRevision: 0 }], ['POST', `/api/workflow/${camOpen.id}/lock`], ['POST', '/api/runs', { model: MODEL, prompt: 'x' }], ['GET', `/api/runs/${ids[0]}`], ['GET', '/api/models'], ['GET', '/api/admin/providers']]) {
      assert.deepEqual(await inA(cam).refused(m, p, b), [404, 'team.not_found'], `${m} ${p}`)
    }
    assert.deepEqual(await cam.refused('GET', A), [404, 'team.not_found'])
    assert.deepEqual((await cam.data('GET', '/api/bootstrap')).spaces.map((s) => s.kind), ['personal'])
    assert.equal((await cam.data('GET', '/api/workflow/list')).length, 1, 'their personal space is untouched')

    // What waited is canceled; what was already running finishes, and its result is the team's.
    assert.deepEqual(await statuses(), ['running', 'canceled', 'canceled'])
    upstream.release()
    assert.equal((await h.waitRun(inA(ann), ids[0])).status, 'succeeded')
    // The lock is free, what they made stays, and their "only me" canvas is the owner's now.
    assert.equal((await inA(al).data('GET', `/api/workflow/${camOpen.id}`)).lock, null)
    const kept = await inA(al).data('GET', `/api/workflow/${camOpen.id}`)
    assert.deepEqual([kept.createdBy.username, kept.createdBy.left, kept.createdBy.deleted], ['cam', true, false])
    const inherited = await inA(ann).data('GET', `/api/workflow/${mineOnly.id}`)
    assert.deepEqual([inherited.createdBy.username, inherited.visibility], ['ann', 'private'])
    assert.deepEqual(await inA(amy).refused('GET', `/api/workflow/${mineOnly.id}`), [404, 'canvas.not_found'])
    // A submission that slipped in at the same instant is caught before anything is sent.
    const slipped = new ObjectId()
    await db.collection('runs').insertOne({ _id: slipped, userId: alpha.id, teamId: alpha.id, createdBy: cam.user.id, kind: 'image', status: 'queued', modelId: MODEL, upstreamModel: 'nano-banana-2', providerId: new ObjectId(things.alpha.provider.id), providerType: 'gaorui', prompt: 'slipped', params: {}, count: 1, cost: { amount: 0, currency: '', unknown: true }, createdAt: new Date(), updatedAt: new Date() })
    upstream.calls.length = 0
    h.getRunner().enqueue(String(slipped), cam.user.id, alpha.id)
    const failed = await h.waitRun(inA(ann), String(slipped))
    assert.deepEqual([failed.status, failed.errorCode, upstream.calls.filter((c) => c.method === 'POST').length], ['failed', 'run.member_removed', 0])
    await root.data('PATCH', `/api/admin/teams/${alpha.id}`, { concurrency: null })

    // Leaving is the same from the member's side; the owner cannot leave.
    assert.deepEqual(await ann.refused('POST', `${A}/leave`), [409, 'team.owner_cannot_leave'])
    await h.join(ann, alpha.id, cam)
    assert.equal((await cam.data('POST', `${A}/leave`)).left, true)
    assert.deepEqual(await inA(cam).refused('GET', '/api/workflow/list'), [404, 'team.not_found'])

    // An admin who goes: the links they made stop working, and the owner is told which keys they entered.
    await inA(amy).data('PUT', `/api/admin/providers/${things.alpha.provider.id}`, { apiKey: KEY_A2 })
    const amyLink = await amy.data('POST', `${A}/invitations`, {})
    const gone = await ann.data('DELETE', `${A}/members/${amy.user.id}`)
    assert.deepEqual(gone.keysSet, [{ id: things.alpha.provider.id, name: things.alpha.provider.name }])
    assert.deepEqual(await amy.refused('POST', `/api/team-invitations/${amyLink.token}/accept`), [410, 'invite.revoked'], 'not a way back in')
    await inA(ann).data('PUT', `/api/admin/providers/${things.alpha.provider.id}`, { apiKey: KEY_A })
    await h.join(ann, alpha.id, amy, { admin: true })
    await h.join(ann, alpha.id, cam)
  })

  await t.test('roles: who becomes what, handing the team over, and the log of it all', async () => {
    const A = `/api/teams/${alpha.id}`
    // Only the owner makes admins; the owner's own role is not a field to edit.
    assert.deepEqual(await amy.refused('PATCH', `${A}/members/${al.user.id}`, { role: 'admin' }), [403, 'team.forbidden'])
    assert.deepEqual(await ann.refused('PATCH', `${A}/members/${ann.user.id}`, { role: 'member' }), [409, 'team.owner_role_fixed'])
    assert.deepEqual(await ann.refused('PATCH', `${A}/members/${al.user.id}`, { role: 'owner' }), [400, 'validation.one_of'])
    // A display name for this team: one's own, or by a manager.
    assert.equal((await al.data('PATCH', `${A}/members/${al.user.id}`, { displayName: 'Al the Great' })).name, 'Al the Great')
    assert.deepEqual(await al.refused('PATCH', `${A}/members/${cam.user.id}`, { displayName: 'x' }), [403, 'team.forbidden'])
    assert.equal((await inA(cam).data('GET', `/api/workflow/${things.shown.id}`)).createdBy.name, 'Al the Great')

    // Name and avatar: managers. Everything that decides who sees what: the owner.
    assert.equal((await amy.data('PATCH', A, { name: 'Alpha Studio' })).name, 'Alpha Studio')
    assert.deepEqual(await al.refused('PATCH', A, { name: 'x' }), [403, 'team.forbidden'])
    assert.deepEqual(await amy.refused('PATCH', A, { timezone: 'UTC' }), [403, 'team.forbidden'])
    await ann.data('PATCH', A, { name: 'Alpha' })

    // Handing over: to a member, with the team's name typed; the old owner becomes an admin.
    assert.deepEqual(await amy.refused('POST', `${A}/transfer`, { userId: amy.user.id, confirm: 'Alpha' }), [403, 'team.forbidden'])
    assert.deepEqual(await ann.refused('POST', `${A}/transfer`, { userId: amy.user.id, confirm: 'alpha' }), [400, 'team.confirm_mismatch'])
    assert.deepEqual(await ann.refused('POST', `${A}/transfer`, { userId: zed.user.id, confirm: 'Alpha' }), [404, 'team.member_not_found'])
    assert.deepEqual(await ann.refused('POST', `${A}/transfer`, { userId: ann.user.id, confirm: 'Alpha' }), [400, 'team.already_owner'])
    await ann.data('POST', `${A}/transfer`, { userId: amy.user.id, confirm: 'Alpha' })
    assert.deepEqual((await al.data('GET', `${A}/members`)).members.map((m) => [m.username, m.role]), [['amy', 'owner'], ['ann', 'admin'], ['alan', 'member'], ['cam', 'member']])
    assert.deepEqual(await ann.refused('PUT', `${A}/limits`, { team: { runs: 1 } }), [403, 'team.forbidden'], 'the former owner is an admin now')
    assert.deepEqual(await ann.refused('DELETE', `${A}?confirm=Alpha`), [403, 'team.forbidden'])
    assert.equal((await inA(amy).data('GET', `/api/workflow/${things.secret.id}`)).name, 'Secret', 'the new owner sees everything')
    assert.deepEqual(await inA(ann).refused('GET', `/api/workflow/${things.secret.id}`), [404, 'canvas.not_found'])
    await amy.data('POST', `${A}/transfer`, { userId: ann.user.id, confirm: 'Alpha' })

    // The activity log: managers read it, nobody writes to it, and it never holds a key or an address.
    assert.deepEqual(await al.refused('GET', `${A}/activity`), [403, 'team.forbidden'])
    const log = await amy.data('GET', `${A}/activity?pageSize=200`)
    const types = new Set(log.list.map((e) => e.type))
    for (const type of ['team:created', 'member:joined', 'member:left', 'member:removed', 'member:promoted', 'team:transferred', 'invite:created', 'invite:revoked', 'provider:created', 'provider:key_changed', 'model:price_changed', 'limits:team_changed', 'limits:member_changed', 'usage:records_deleted', 'canvas:deleted', 'canvas:restored', 'canvas:visibility_changed', 'canvas:taken_over', 'canvas:overwritten', 'share:created', 'share:revoked', 'team:renamed', 'team:settings_changed']) {
      assert.ok(types.has(type), `${type} is in the log`)
    }
    const dump = JSON.stringify([log, await db.collection('teamactivities').find({}).toArray()])
    for (const secret of [KEY_A, KEY_A2, upstream.baseUrl, 'by a member', 'burst 1']) assert.ok(!dump.includes(secret), `${secret} is not in the log`)
    const taken = log.list.find((e) => e.type === 'canvas:taken_over')
    // The people of an entry read under the name they have in the team today: alan has taken a display name since.
    const alNow = (await amy.data('GET', `${A}/members`)).members.find((m) => m.id === al.user.id).name
    assert.deepEqual([taken.actor.name, taken.actor.username, taken.category, taken.detail.fromId, taken.detail.fromName, taken.message.includes('cam') && taken.message.includes(alNow) && taken.message.includes(taken.target.name)], ['cam', 'cam', 'canvas', al.user.id, alNow, true])
    assert.ok((await amy.data('GET', `${A}/activity?category=member`)).list.every((e) => e.category === 'member'))
    assert.ok((await amy.data('GET', `${A}/activity?actor=${al.user.id}`)).list.every((e) => e.actor.id === al.user.id))
    assert.equal((await (async () => { const r = await amy.call('GET', `${A}/activity?pageSize=200`, undefined, { 'X-Locale': 'en' }); return r.body.data.list })()).some((e) => /created the team/.test(e.message)), true)
    for (const m of ['DELETE', 'PUT', 'POST', 'PATCH']) assert.equal(await ann.status(m, `${A}/activity`, {}), 404, `${m}: there is no such route`)
    assert.equal(await db.collection('teamactivities').countDocuments({ teamId: beta.id, type: { $nin: ['team:created', 'member:joined', 'provider:created', 'share:created', 'invite:created'] } }), 0, 'another team\'s log is its own')
    // Old entries go by age.
    const { sweep } = require('../src/services/activity')
    const n = await db.collection('teamactivities').countDocuments({})
    assert.equal(await sweep(365, Date.now()), 0)
    assert.equal(await sweep(365, Date.now() + 366 * 86400000), n)
  })

  await t.test('the super admin manages teams from outside: numbers, limits, a new owner when the old one cannot act - never the contents', async () => {
    const list = await root.data('GET', '/api/admin/teams')
    assert.deepEqual(list.teams.map((x) => [x.name, x.status, x.owner.username, x.owner.usable, x.counts.members]), [['Alpha', 'active', 'ann', true, 4], ['Beta', 'active', 'bea', true, 2]])
    assert.deepEqual(Object.keys(list.teams[0]).sort(), ['avatar', 'concurrency', 'counts', 'createdAt', 'dissolvedAt', 'effective', 'id', 'maxMembers', 'name', 'owner', 'purgeAt', 'status'])
    assert.deepEqual(list.defaults, { teamMaxPerUser: 3, teamMaxMembers: 50, teamConcurrency: 4, teamActivityDays: 365 })
    const all = JSON.stringify([list, await root.data('GET', '/api/admin/users'), await root.data('GET', `/api/admin/teams/${alpha.id}/members`)])
    for (const secret of [KEY_A, 'Alpha canvas', 'Secret', things.alpha.file.url, 'by a member']) assert.ok(!all.includes(secret), secret)
    const users = await root.data('GET', '/api/admin/users')
    assert.deepEqual(users.filter((u) => ['ann', 'alan', 'zed'].includes(u.username)).map((u) => [u.username, u.teams]), [['ann', { member: 1, owned: 1 }], ['alan', { member: 1, owned: 0 }], ['zed', { member: 0, owned: 0 }]])
    assert.equal(users.find((u) => u.username === 'ann').counts.workflows, 2, 'the counts of an account are those of its personal space: its own canvas and the copy it took')

    // A team's own limits.
    const patched = await root.data('PATCH', `/api/admin/teams/${beta.id}`, { maxMembers: 2, concurrency: 2 })
    assert.deepEqual([patched.maxMembers, patched.concurrency, patched.effective], [2, 2, { maxMembers: 2, concurrency: 2 }])
    assert.deepEqual([await root.status('PATCH', `/api/admin/teams/${beta.id}`, { maxMembers: 0 }), await root.status('PATCH', `/api/admin/teams/${beta.id}`, { concurrency: 99 }), await root.status('PATCH', `/api/admin/teams/${beta.id}`, {}), await root.status('PATCH', `/api/admin/teams/${NOBODY}`, { maxMembers: 5 })], [400, 400, 400, 404])
    await root.data('PATCH', `/api/admin/teams/${beta.id}`, { maxMembers: null, concurrency: null })

    // A new owner: only while the current one's account cannot be used.
    assert.deepEqual(await root.refused('POST', `/api/admin/teams/${beta.id}/owner`, { userId: ben.user.id }), [409, 'team.owner_usable'])
    // What the owner was editing at that moment is not held for an account that cannot come back.
    const heldByBea = (await inB(bea).data('GET', '/api/workflow/list'))[0]
    assert.equal((await inB(bea).data('POST', `/api/workflow/${heldByBea.id}/lock`)).lock.by.username, 'bea')
    await root.data('PATCH', `/api/admin/users/${bea.user.id}`, { disabled: true })
    assert.deepEqual(await bea.refused('GET', '/api/teams'), [401, 'auth.required'])
    assert.equal((await inB(ben).data('GET', '/api/workflow/list')).find((w) => w.id === heldByBea.id).lock, null, 'disabling an account gives its edit locks back at once')
    // The team goes on without its owner: members work, and see that the owner's account is disabled.
    assert.equal((await inB(ben).data('GET', '/api/workflow/list')).length, 1)
    assert.deepEqual((await ben.data('GET', `/api/teams/${beta.id}/members`)).members.map((m) => [m.username, m.role, m.disabled]), [['bea', 'owner', true], ['ben', 'member', false]])
    assert.equal((await root.data('GET', '/api/admin/teams')).teams[1].owner.usable, false)
    assert.deepEqual(await root.refused('POST', `/api/admin/teams/${beta.id}/owner`, { userId: zed.user.id }), [404, 'team.member_not_found'], 'somebody who is in the team')
    const appointed = await root.data('POST', `/api/admin/teams/${beta.id}/owner`, { userId: ben.user.id })
    assert.equal(appointed.owner.username, 'ben')
    await root.data('PATCH', `/api/admin/users/${bea.user.id}`, { disabled: false })
    h.auth.resetRateLimits()
    bea.token = (await anon.data('POST', '/api/auth/login', { account: 'bea', password: 'bea-password-1' })).token
    assert.deepEqual((await ben.data('GET', `/api/teams/${beta.id}/members`)).members.map((m) => [m.username, m.role]), [['ben', 'owner'], ['bea', 'admin']])
    assert.ok((await ben.data('GET', `/api/teams/${beta.id}/activity`)).list.some((e) => e.type === 'team:owner_appointed' && e.actor.id === ''))

    // Suspending: closed for everybody, nothing removed; reopened as it was.
    await root.data('PATCH', `/api/admin/teams/${beta.id}`, { status: 'suspended' })
    assert.deepEqual(await inB(ben).refused('GET', '/api/workflow/list'), [403, 'team.suspended'])
    assert.deepEqual(await bea.refused('GET', `/api/teams/${beta.id}/members`), [403, 'team.suspended'])
    assert.equal(await anon.status('GET', `/api/canvas-share/${things.beta.share.token}`), 404)
    assert.equal((await zed.in(beta.id).data('GET', '/api/bootstrap')).spaceError, 'team.not_found', 'an outsider still learns nothing')
    assert.equal((await inB(bea).data('GET', '/api/bootstrap')).spaceError, 'team.suspended')
    // The super admin's own pages do not go dark because the header names a closed team.
    await root.data('PATCH', `/api/admin/teams/${beta.id}`, { status: 'active' })
    assert.equal((await inB(ben).data('GET', '/api/workflow/list')).length, 1)
    assert.equal(await anon.status('GET', `/api/canvas-share/${things.beta.share.token}`), 200)

    // Deleting an account: not while it owns a team; otherwise it leaves its teams and only its personal space goes.
    assert.deepEqual(await root.refused('DELETE', `/api/admin/users/${ben.user.id}?confirm=ben`), [409, 'team.account_owns_teams'])
    assert.ok(await db.collection('users').findOne({ _id: new ObjectId(ben.user.id), disabled: false }), 'nothing happened to the account')
    const leaver = await h.register('leaver')
    await h.join(ann, alpha.id, leaver)
    const theirs = await inA(leaver).data('POST', '/api/workflow', { name: 'Left behind', visibility: 'team_view' })
    const personal = await h.upload(leaver)
    const inTeam = await h.upload(inA(leaver))
    const removed = await root.data('DELETE', `/api/admin/users/${leaver.user.id}?confirm=leaver`)
    assert.equal(removed.filesRemoved, true)
    assert.deepEqual([h.fileExists(personal.key), h.fileExists(inTeam.key)], [false, true], 'the personal files went, the team\'s stayed')
    const left = await inA(al).data('GET', `/api/workflow/${theirs.id}`)
    assert.deepEqual([left.name, left.createdBy.left, left.createdBy.deleted], ['Left behind', true, true])
    assert.equal(await db.collection('teammembers').countDocuments({ userId: leaver.user.id }), 0)
    assert.equal((await al.data('GET', `/api/teams/${alpha.id}/members`)).members.length, 4)
  })

  await t.test('dissolving: closed at once, restorable for seven days, then gone with everything in it - and nothing else', async () => {
    const A = `/api/teams/${alpha.id}`
    await h.idle()
    upstream.hold()
    await root.data('PATCH', `/api/admin/teams/${alpha.id}`, { concurrency: 1 })
    const running = (await inA(al).data('POST', '/api/runs', { model: MODEL, prompt: 'in flight' })).runId
    const waiting = (await inA(al).data('POST', '/api/runs', { model: MODEL, prompt: 'waiting' })).runId
    for (let i = 0; i < 100 && (await db.collection('runs').findOne({ _id: new ObjectId(running) })).status !== 'running'; i++) await h.sleep(50)
    await inA(al).data('POST', `/api/workflow/${things.open.id}/lock`)

    for (const c of [amy, al]) assert.deepEqual(await c.refused('DELETE', `${A}?confirm=Alpha`), [403, 'team.forbidden'])
    assert.deepEqual(await ann.refused('DELETE', `${A}?confirm=alpha`), [400, 'team.confirm_mismatch'])
    assert.deepEqual(await ann.refused('DELETE', A), [400, 'team.confirm_mismatch'])
    assert.deepEqual(await root.refused('DELETE', `/api/admin/teams/${alpha.id}?confirm=Alpha`), [409, 'team.still_active'], 'the super admin removes only what is already closed')
    const gone = await ann.data('DELETE', `${A}?confirm=Alpha`)
    assert.deepEqual([gone.status, Math.round((new Date(gone.purgeAt) - Date.now()) / 86400000)], ['dissolved', 7])

    // Closed for everybody, at once.
    for (const c of [amy, al, ann]) {
      assert.deepEqual(await inA(c).refused('GET', '/api/workflow/list'), [403, 'team.dissolved'], c.user.username)
      assert.deepEqual(await inA(c).refused('POST', '/api/runs', { model: MODEL, prompt: 'x' }), [403, 'team.dissolved'])
      assert.deepEqual(await c.refused('GET', `${A}/members`), [403, 'team.dissolved'])
    }
    assert.equal(await anon.status('GET', `/api/canvas-share/${things.alpha.share.token}`), 404, 'its share links stop')
    assert.equal((await db.collection('runs').findOne({ _id: new ObjectId(waiting) })).status, 'canceled', 'what waited is canceled')
    assert.equal((await db.collection('runs').findOne({ _id: new ObjectId(running) })).status, 'running', 'what was running finishes')
    assert.equal((await db.collection('workflows').findOne({ _id: new ObjectId(things.open.id) })).lock.by, '')
    // Members no longer see it; the owner does, with the day it will be removed.
    assert.deepEqual((await al.data('GET', '/api/teams')).teams, [])
    assert.deepEqual((await ann.data('GET', '/api/teams')).teams.map((x) => [x.name, x.status, !!x.purgeAt]), [['Alpha', 'dissolved', true]])
    assert.deepEqual(await al.refused('GET', A), [403, 'team.dissolved'])
    assert.equal((await ann.data('GET', A)).status, 'dissolved')
    upstream.release()

    // Restoring: the owner (or the super admin), and everything is as it was.
    assert.deepEqual(await amy.refused('POST', `${A}/restore`), [403, 'team.forbidden'])
    await ann.data('POST', `${A}/restore`)
    assert.deepEqual(await ann.refused('POST', `${A}/restore`), [409, 'team.not_dissolved'])
    assert.equal((await inA(al).data('GET', '/api/workflow/list')).length > 3, true)
    assert.equal(await anon.status('GET', `/api/canvas-share/${things.alpha.share.token}`), 200)
    assert.equal((await h.waitRun(inA(al), running)).status, 'succeeded')
    await ann.data('DELETE', `${A}?confirm=Alpha`)
    await root.data('POST', `/api/admin/teams/${alpha.id}/restore`)
    assert.equal((await al.data('GET', '/api/teams')).teams.length, 1)

    // Past the seven days: removed for good - documents, files, members, links, log.
    await ann.data('DELETE', `${A}?confirm=Alpha`)
    const teamFile = things.alpha.file.key
    assert.ok(h.fileExists(teamFile))
    assert.deepEqual((await h.teams.sweep(Date.now() + 6 * 86400000)).purged, [], 'not a day early')
    assert.ok(await db.collection('teams').findOne({ _id: new ObjectId(alpha.id) }))
    assert.deepEqual((await h.teams.sweep(Date.now() + 7 * 86400000 + 1000)).purged, [alpha.id])
    for (const name of ['workflows', 'shares', 'userassets', 'brandkits', 'providers', 'modeloverrides', 'runs', 'templates', 'texttemplates']) {
      assert.equal(await db.collection(name).countDocuments({ userId: alpha.id }), 0, `${name} of the team`)
    }
    for (const name of ['teammembers', 'teaminvitations', 'teamactivities']) assert.equal(await db.collection(name).countDocuments({ teamId: alpha.id }), 0, name)
    assert.equal(await db.collection('teams').countDocuments({ _id: new ObjectId(alpha.id) }), 0)
    assert.ok(!h.fileExists(teamFile) && !require('fs').existsSync(require('path').join(h.filesDir, 'uploads', alpha.id)), 'its files are gone')
    for (const c of [ann, amy, al]) assert.deepEqual(await inA(c).refused('GET', '/api/workflow/list'), [404, 'team.not_found'])
    assert.deepEqual(await ann.refused('POST', `${A}/restore`), [404, 'team.not_found'])

    // Everything else is where it was: the other team, and everybody's personal space.
    assert.deepEqual((await inB(ben).data('GET', '/api/workflow/list')).map((w) => w.name), ['Beta canvas'])
    assert.ok(h.fileExists(things.beta.file.key) && h.fileExists(things.alan.file.key) && h.fileExists(things.ann.file.key))
    assert.deepEqual((await ann.data('GET', '/api/workflow/list')).map((w) => w.name).sort(), ['Ann canvas', 'Shown'])
    assert.ok((await al.data('GET', '/api/workflow/list')).some((w) => w.name === 'Alan canvas'))
    assert.equal((await al.data('GET', '/api/admin/providers')).length, 2)
    assert.deepEqual((await ann.data('GET', '/api/teams')).creation.held, 0, 'a removed team no longer counts against n')

    // The super admin removing a team now: only a closed one, with its name typed.
    await root.data('PATCH', `/api/admin/teams/${beta.id}`, { status: 'suspended' })
    assert.deepEqual(await root.refused('DELETE', `/api/admin/teams/${beta.id}?confirm=beta`), [400, 'team.confirm_mismatch'])
    const purged = await root.data('DELETE', `/api/admin/teams/${beta.id}?confirm=Beta`)
    assert.deepEqual([purged.id, purged.filesRemoved, purged.removed.workflows], [beta.id, true, 1])
    assert.equal(await db.collection('teams').countDocuments({}), 0)
    assert.equal(await root.status('DELETE', `/api/admin/users/${ben.user.id}?confirm=ben`), 200, 'with its team gone the account can be deleted')
  })
})
