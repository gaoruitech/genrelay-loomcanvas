'use strict'

/**
 * What a team's screens are told, over real HTTP: the facts the interface
 * shows next to the things themselves.
 *
 *  - an invite link says how many uses it has left, and nothing else about its use;
 *  - a provider says who looks after it and how its last connection test went -
 *    the test result to those who manage providers only;
 *  - the team says how many of its runs may be in flight at once;
 *  - saved templates and snippets say who saved them;
 *  - the activity log carries what changed (before and after), under the names
 *    people have in the team today;
 *  - a person who left the team and a person whose account is gone read
 *    differently, and the same in every list;
 *  - a folder can be created empty and deleted while empty, and only then;
 *  - where something can be copied to, and why not;
 *  - a history record has what a detail view needs, and several records leave as one zip;
 *  - removing a team reports everything that went.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { boot } = require('./support/teamHarness')

const MODEL = 'gaorui:nano-banana-2'
const CHAT = 'gaorui:talker'
const PERSON_KEYS = ['deleted', 'id', 'left', 'name', 'state', 'username']

/** The file names in a zip, from its central directory. */
function zipNames(buf) {
  const names = []
  let at = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  while (at !== -1 && buf.readUInt32LE(at) === 0x02014b50) {
    const nameLen = buf.readUInt16LE(at + 28)
    const extraLen = buf.readUInt16LE(at + 30)
    const commentLen = buf.readUInt16LE(at + 32)
    names.push(buf.subarray(at + 46, at + 46 + nameLen).toString('utf8'))
    at += 46 + nameLen + extraLen + commentLen
    if (at + 4 > buf.length) break
  }
  return names
}

test('team data: what the screens are told', async (t) => {
  const h = await boot(t, 'teamdata')
  if (!h) return t.skip('no MongoDB available (set TEST_MONGODB_URI)')
  const { root, anon, db } = h
  const { ObjectId } = h.mongoose.Types

  const olga = await h.register('olga') // owner
  const adam = await h.register('adam') // admin
  const mia = await h.register('mia') // member, stays
  const leo = await h.register('leo') // member, removed along the way
  const dana = await h.register('dana') // member, account deleted along the way
  const zoe = await h.register('zoe') // in no team

  const team = await h.createTeam(olga, 'Studio', { avatar: '/files/uploads/2025/01/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png' })
  const T = `/api/teams/${team.id}`
  const inT = (c) => c.in(team.id)
  await h.join(olga, team.id, adam, { admin: true })
  await h.join(olga, team.id, mia)
  await h.join(olga, team.id, leo)
  await h.join(olga, team.id, dana)
  const activityOf = async (c = olga, query = '') => (await c.data('GET', `${T}/activity?pageSize=200${query}`)).list
  const latest = async (type) => (await activityOf()).find((e) => e.type === type)

  /** Raw bytes of an answer (the harness client reads bodies as text). */
  async function raw(c, method, pathname, body) {
    const headers = { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' }
    if (c.space) headers['X-Space'] = c.space
    const res = await fetch(h.base + pathname, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    const type = res.headers.get('content-type') || ''
    return { status: res.status, headers: res.headers, type, json: type.includes('json') ? await res.json() : null, bytes: type.includes('json') ? null : Buffer.from(await res.arrayBuffer()) }
  }

  await t.test('an invite link says how many uses are left - to anybody holding it, and nothing more about its use', async () => {
    const limited = await olga.data('POST', `${T}/invitations`, { maxUses: 3 })
    const open = await olga.data('POST', `${T}/invitations`, { maxUses: 0 })
    assert.deepEqual([limited.remainingUses, open.remainingUses], [3, null])

    const seen = await anon.data('GET', `/api/team-invitations/${limited.token}`)
    assert.equal(seen.remainingUses, 3)
    assert.deepEqual(Object.keys(seen).sort(), ['alreadyMember', 'contactName', 'expiresAt', 'inviterName', 'registrationOpen', 'remainingUses', 'state', 'team'], 'no total, no count of uses, nobody who used it')
    assert.equal((await anon.data('GET', `/api/team-invitations/${open.token}`)).remainingUses, null, 'no limit: nothing to count down')

    // One use is spent by somebody joining; somebody who is in already spends none.
    const guest = await h.register('guest')
    await guest.data('POST', `/api/team-invitations/${limited.token}/accept`)
    await guest.data('POST', `/api/team-invitations/${limited.token}/accept`)
    assert.equal((await anon.data('GET', `/api/team-invitations/${limited.token}`)).remainingUses, 2)
    assert.equal((await olga.data('GET', `${T}/invitations`)).find((i) => i.id === limited.id).remainingUses, 2)

    const joined = await latest('member:joined')
    assert.deepEqual([joined.actor.username, joined.detail.inviterId, joined.detail.inviterName, joined.detail.invitationId], ['guest', olga.user.id, 'olga', limited.id])

    // A link that cannot be used any more has no uses left to announce.
    await olga.data('DELETE', `${T}/invitations/${limited.id}`)
    const dead = await anon.data('GET', `/api/team-invitations/${limited.token}`)
    assert.deepEqual([dead.state, dead.remainingUses], ['revoked', null])
    // ... and the managers' list does not announce any either: a revoked link reads "revoked", not "2 of 3 left".
    const row = (await olga.data('GET', `${T}/invitations`)).find((i) => i.id === limited.id)
    assert.deepEqual([row.state, row.revoked, row.remainingUses, row.maxUses, row.usedCount], ['revoked', true, null, 3, 1])
    const revoked = await latest('invite:revoked')
    assert.deepEqual([revoked.detail.maxUses, revoked.detail.usedCount, revoked.detail.createdById, revoked.detail.createdByName], [3, 1, olga.user.id, 'olga'])
    const created = (await activityOf()).filter((e) => e.type === 'invite:created').find((e) => e.target.id === limited.id)
    assert.deepEqual([created.detail.maxUses, created.detail.expiresInDays, typeof created.detail.expiresAt], [3, 7, 'string'])
    await inT(guest).data('POST', `${T}/leave`)
  })

  await t.test('a dead invite link sends people to somebody who can still make a new one, and its row in the list has nothing left', async () => {
    // A team of its own: the counts of the team above are asserted further down.
    const boss = await h.register('boss')
    const aide = await h.register('aide')
    const pal = await h.register('pal')
    const annex = await h.createTeam(boss, 'Annex')
    const A = `/api/teams/${annex.id}`
    await h.join(boss, annex.id, aide, { admin: true })
    await h.join(boss, annex.id, pal, { admin: true })
    const ask = async (inv) => { const p = await anon.data('GET', `/api/team-invitations/${inv.token}`); return [p.state, p.inviterName, p.contactName] }

    // Whoever made the link, while they can still make another.
    const byAide = await aide.in(annex.id).data('POST', `${A}/invitations`, { maxUses: 5 })
    const byBoss = await boss.data('POST', `${A}/invitations`, { maxUses: 5 })
    assert.deepEqual(await ask(byAide), ['valid', 'aide', 'aide'])
    assert.deepEqual(await ask(byBoss), ['valid', 'boss', 'boss'])

    // An admin made a plain member again cannot make links: ask the owner.
    await boss.data('PATCH', `${A}/members/${aide.user.id}`, { role: 'member' })
    assert.deepEqual(await ask(byAide), ['valid', 'aide', 'boss'])
    await boss.data('PATCH', `${A}/members/${aide.user.id}`, { role: 'admin' })
    assert.deepEqual(await ask(byAide), ['valid', 'aide', 'aide'])

    // Expired: nothing left to announce in the list either.
    const old = await boss.data('POST', `${A}/invitations`, { maxUses: 5 })
    await db.collection('teaminvitations').updateOne({ _id: new ObjectId(old.id) }, { $set: { expiresAt: new Date(Date.now() - 1000) } })
    assert.deepEqual(await ask(old), ['expired', 'boss', 'boss'])
    const expired = (await boss.data('GET', `${A}/invitations`)).find((i) => i.id === old.id)
    assert.deepEqual([expired.state, expired.remainingUses, expired.maxUses, expired.usedCount], ['expired', null, 5, 0])

    // Its maker gone from the team (the links they made stop working as they go): the page still says who
    // invited, and names the owner as the one to ask.
    await aide.in(annex.id).data('POST', `${A}/leave`)
    assert.deepEqual(await ask(byAide), ['revoked', 'aide', 'boss'])
    const orphan = (await boss.data('GET', `${A}/invitations`)).find((i) => i.id === byAide.id)
    assert.deepEqual([orphan.state, orphan.remainingUses, orphan.maxUses, orphan.usedCount, orphan.createdBy.state], ['revoked', null, 5, 0, 'left'])

    // Its maker's account deleted altogether: the same.
    const byPal = await pal.in(annex.id).data('POST', `${A}/invitations`, { maxUses: 2 })
    await boss.data('DELETE', `${A}/invitations/${byPal.id}`)
    await root.data('DELETE', `/api/admin/users/${pal.user.id}?confirm=pal`)
    const gone = await ask(byPal)
    assert.deepEqual([gone[0], gone[2]], ['revoked', 'boss'])
    const revokedRow = (await boss.data('GET', `${A}/invitations`)).find((i) => i.id === byPal.id)
    assert.deepEqual([revokedRow.state, revokedRow.remainingUses, revokedRow.createdBy.state], ['revoked', null, 'deleted'])

    // Used up is not "dead for good" in the list's sense: it says 0, and so does a live link its number.
    const one = await boss.data('POST', `${A}/invitations`, { maxUses: 1 })
    const late = await h.register('late')
    await late.data('POST', `/api/team-invitations/${one.token}/accept`)
    const rows = await boss.data('GET', `${A}/invitations`)
    assert.deepEqual([rows.find((i) => i.id === one.id).state, rows.find((i) => i.id === one.id).remainingUses], ['used_up', 0])
    assert.deepEqual([rows.find((i) => i.id === byBoss.id).state, rows.find((i) => i.id === byBoss.id).remainingUses], ['valid', 5])

    // A closed team: nothing of it is shown, and there is nobody to ask.
    await boss.data('DELETE', `${A}?confirm=Annex`)
    const closed = await anon.data('GET', `/api/team-invitations/${byBoss.token}`)
    assert.deepEqual([closed.state, closed.team, closed.inviterName, closed.contactName, closed.remainingUses], ['team_unavailable', null, '', '', null])
  })

  let provider
  await t.test('a provider says who looks after it and how its last test went; members get the name and never the result', async () => {
    provider = await h.addProvider(inT(olga), 'sk-team-data-key-0000000000aa')
    assert.deepEqual([provider.maintainer.id, provider.maintainer.state, provider.lastTest], [olga.user.id, 'active', null])
    assert.deepEqual(Object.keys(provider.maintainer).sort(), PERSON_KEYS)

    // The admin changes it: the admin is its maintainer now. A save that changes nothing changes nobody.
    const renamed = await inT(adam).data('PUT', `/api/admin/providers/${provider.id}`, { name: 'House key' })
    assert.equal(renamed.maintainer.id, adam.user.id)
    assert.equal((await inT(olga).data('PUT', `/api/admin/providers/${provider.id}`, { name: 'House key' })).maintainer.id, adam.user.id)

    // A test is kept with the provider, and is not an edit.
    const before = (await inT(olga).data('GET', '/api/admin/providers'))[0]
    const tested = await inT(olga).data('POST', `/api/admin/providers/${provider.id}/test`)
    assert.deepEqual(tested, { ok: true, message: tested.message })
    const after = (await inT(adam).data('GET', '/api/admin/providers'))[0]
    assert.deepEqual([after.lastTest.ok, after.lastTest.message, after.maintainer.id, after.updatedAt], [true, tested.message, adam.user.id, before.updatedAt])
    assert.ok(Math.abs(Date.now() - new Date(after.lastTest.at).getTime()) < 60000)
    assert.deepEqual(Object.keys(after.lastTest).sort(), ['at', 'message', 'ok'], 'not who ran it, nothing of the upstream but its message')
    // ... and read in the reader's language, whoever ran it.
    const en = (await inT(adam).call('GET', '/api/admin/providers', undefined, { 'X-Locale': 'en' })).body.data[0]
    const zh = (await inT(adam).call('GET', '/api/admin/providers', undefined, { 'X-Locale': 'zh-CN' })).body.data[0]
    assert.deepEqual([en.lastTest.message, zh.lastTest.message], ['Connected', '连接成功'])

    // A member: the name of who to ask, the switch - no test result, no key, no address.
    const mine = (await inT(mia).data('GET', '/api/admin/providers'))[0]
    assert.deepEqual([mine.restricted, mine.maintainer.name, mine.lastTest, mine.keyTail, mine.baseUrl, mine.enabled], [true, 'adam', null, '', '', true])
    assert.ok(!JSON.stringify(mine).includes('Connected'))

    // The key changes: the old result says nothing about the new key.
    const rekeyed = await inT(olga).data('PUT', `/api/admin/providers/${provider.id}`, { apiKey: 'sk-team-data-key-0000000000bb' })
    assert.deepEqual([rekeyed.lastTest, rekeyed.maintainer.id], [null, olga.user.id])
    assert.equal((await latest('provider:key_changed')).detail.cleared, false)
    const named = (await activityOf()).find((e) => e.type === 'provider:updated')
    assert.deepEqual([named.detail.renamed, named.detail.from, named.detail.to], [true, provider.name, 'House key'])

    // A test that fails is kept too, with its reason; it is still not shown to members.
    const dead = await inT(olga).data('POST', '/api/admin/providers', { type: 'gaorui', apiKey: 'sk-dead-000000000000', baseUrl: 'http://127.0.0.1:9', name: 'Dead end' })
    const failed = await inT(olga).data('POST', `/api/admin/providers/${dead.id}/test`)
    assert.equal(failed.ok, false)
    const kept = (await inT(olga).data('GET', '/api/admin/providers')).find((p) => p.id === dead.id)
    assert.deepEqual([kept.lastTest.ok, kept.lastTest.message.length > 0], [false, true])
    assert.equal((await inT(mia).data('GET', '/api/admin/providers')).find((p) => p.id === dead.id).lastTest, null)
    await inT(olga).data('DELETE', `/api/admin/providers/${dead.id}`)

    // A personal space has the same fields.
    const own = await h.addProvider(zoe, 'sk-zoe-personal-key-00000000')
    assert.deepEqual([own.maintainer.id, own.maintainer.state, own.lastTest], [zoe.user.id, 'active', null])
  })

  await t.test('the team says how many of its runs may be in flight at once; the super admin\'s list shows its avatar', async () => {
    assert.equal((await mia.data('GET', T)).concurrency, 4, 'the site default')
    await root.data('PATCH', `/api/admin/teams/${team.id}`, { concurrency: 2 })
    assert.equal((await mia.data('GET', T)).concurrency, 2)
    await root.data('PUT', '/api/admin/settings', { teamConcurrency: 7 })
    assert.equal((await mia.data('GET', T)).concurrency, 2, 'the team\'s own cap wins')
    await root.data('PATCH', `/api/admin/teams/${team.id}`, { concurrency: null })
    assert.equal((await mia.data('GET', T)).concurrency, 7)
    await root.data('PUT', '/api/admin/settings', { teamConcurrency: 4 })

    const listed = (await root.data('GET', '/api/admin/teams')).teams.find((x) => x.id === team.id)
    assert.equal(listed.avatar, '/files/uploads/2025/01/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png')
    const plain = await h.createTeam(zoe, 'No picture')
    assert.equal((await root.data('GET', '/api/admin/teams')).teams.find((x) => x.id === plain.id).avatar, '')
  })

  await t.test('saved templates and snippets say who saved them; built-in ones are nobody\'s', async () => {
    const tpl = await inT(leo).data('POST', '/api/canvas/templates', { title: 'Leo\'s layout', graph: { nodes: [{ id: 'a', type: 'text' }], edges: [] } })
    assert.deepEqual([tpl.createdBy.id, tpl.createdBy.state, tpl.mine, tpl.canDelete, typeof tpl.createdAt], [leo.user.id, 'active', true, true, 'object'].map((v, i) => (i === 4 ? 'string' : v)))
    const snip = await inT(dana).data('POST', '/api/canvas/text-templates', { title: 'Dana\'s words', content: 'soft light', lang: 'en' })
    assert.deepEqual([snip.createdBy.id, snip.mine], [dana.user.id, true])

    const list = await inT(mia).data('GET', '/api/canvas/templates')
    const saved = list.find((x) => x.key === tpl.key)
    assert.deepEqual([saved.createdBy.name, saved.createdBy.state, saved.mine, saved.canDelete], ['leo', 'active', false, false])
    for (const builtin of list.filter((x) => x.builtin)) assert.deepEqual([builtin.createdBy, builtin.mine], [null, false])
    const words = (await inT(mia).data('GET', '/api/canvas/text-templates?lang=en')).find((x) => x.id === snip.id)
    assert.deepEqual([words.createdBy.name, words.mine], ['dana', false])

    // In a personal space the author is the one person there.
    const own = await zoe.data('POST', '/api/canvas/text-templates', { title: 'Mine', content: 'x' })
    assert.deepEqual([own.createdBy.id, own.createdBy.state, own.mine], [zoe.user.id, 'active', true])
  })

  await t.test('the activity log carries what changed, before and after, under the names people have in the team today', async () => {
    // Roles.
    await olga.data('PATCH', `${T}/members/${mia.user.id}`, { role: 'admin' })
    await olga.data('PATCH', `${T}/members/${mia.user.id}`, { role: 'member' })
    const promoted = await latest('member:promoted')
    const demoted = await latest('member:demoted')
    assert.deepEqual([promoted.detail, demoted.detail], [{ from: 'member', to: 'admin' }, { from: 'admin', to: 'member' }])
    assert.deepEqual([promoted.target.type, promoted.target.person.id, promoted.target.person.state], ['member', mia.user.id, 'active'])

    // Limits: the numbers, not just "changed".
    await olga.data('PUT', `${T}/limits`, { team: { runs: 100, amount: 50 }, memberDefault: { runs: 20 } })
    await olga.data('PUT', `${T}/limits`, { team: { runs: 200 } })
    const limits = await latest('limits:team_changed')
    assert.deepEqual([limits.detail.before.team.runs, limits.detail.after.team.runs, limits.detail.after.team.amount, limits.detail.after.memberDefault.runs, typeof limits.detail.after.currency], [100, 200, 50, 20, 'string'])
    await olga.data('PATCH', `${T}/members/${mia.user.id}`, { limits: { runs: 5 } })
    const own = await latest('limits:member_changed')
    assert.deepEqual([own.detail.before, own.detail.after, own.target.person.id], [{ runs: null, amount: null }, { runs: 5, amount: null }, mia.user.id])
    await olga.data('PATCH', `${T}/members/${mia.user.id}`, { limits: { runs: null } })

    // Settings and the name: old and new values.
    await olga.data('PATCH', T, { settings: { adminsSeeAll: true, publicShare: 'managers' }, timezone: 'Asia/Shanghai' })
    const settings = await latest('team:settings_changed')
    assert.deepEqual(settings.detail, {
      changed: ['timezone', 'adminsSeeAll', 'publicShare'],
      before: { timezone: 'UTC', adminsSeeAll: false, publicShare: 'editors' },
      after: { timezone: 'Asia/Shanghai', adminsSeeAll: true, publicShare: 'managers' },
    })
    await olga.data('PATCH', T, { settings: { adminsSeeAll: false, publicShare: 'editors' }, timezone: 'UTC' })
    await olga.data('PATCH', T, { name: 'Studio One' })
    assert.deepEqual((await latest('team:renamed')).detail, { from: 'Studio', to: 'Studio One' })
    await olga.data('PATCH', T, { name: 'Studio' })
    await olga.data('PATCH', T, { avatar: '' })
    assert.deepEqual((await latest('team:avatar_changed')).detail, { removed: true })

    // A price: from what to what.
    const path = `/api/admin/models/${encodeURIComponent(MODEL)}`
    await inT(olga).data('PUT', path, { pricing: { currency: 'CNY', unit: 'per_image', price: 0.5 } })
    await inT(olga).data('PUT', path, { pricing: { currency: 'CNY', unit: 'per_image', by: 'resolution', table: { '1K': 0.2, '2K': 0.4 } } })
    const price = await latest('model:price_changed')
    assert.deepEqual([price.detail.before.price, price.detail.before.unit, price.detail.after.by, price.detail.after.tiers, price.detail.after.min, price.detail.after.max, price.detail.priced], [0.5, 'per_image', 'resolution', 2, 0.2, 0.4, true])
    await inT(olga).data('PUT', path, { pricing: { currency: 'CNY', unit: 'per_image', price: 0.1 } })

    // A display name: the change is an entry, and every entry of that person reads under the new name -
    // also the ones written before it.
    await mia.data('PATCH', `${T}/members/${mia.user.id}`, { displayName: 'Mia Chen' })
    const renamed = await latest('member:renamed')
    assert.deepEqual([renamed.detail, renamed.actor.name, renamed.actor.username, renamed.target.name], [{ from: '', to: 'Mia Chen', username: 'mia' }, 'Mia Chen', 'mia', 'Mia Chen'])
    assert.equal(promoted.target.name, 'mia', 'as it read before')
    assert.equal((await latest('member:promoted')).target.name, 'Mia Chen')
    assert.match((await latest('member:promoted')).message, /Mia Chen/)
    assert.deepEqual(Object.keys(renamed.actor).sort(), [...PERSON_KEYS, 'system'].sort())
    await mia.data('PATCH', `${T}/members/${mia.user.id}`, { displayName: 'Mia Chen' })
    assert.equal((await activityOf()).filter((e) => e.type === 'member:renamed').length, 1, 'saving the same name again is not a change')

    // The super admin from outside is not a person of the team.
    await root.data('PATCH', `/api/admin/teams/${team.id}`, { status: 'suspended' })
    await root.data('PATCH', `/api/admin/teams/${team.id}`, { status: 'active' })
    const outside = await latest('team:suspended')
    assert.deepEqual([outside.actor.id, outside.actor.system, outside.actor.name.length > 0], ['', true, true])

    // Entries from before any of this - no detail, a type nobody knows any more - are still answered.
    const old = new Date('2025-01-01T00:00:00Z')
    await db.collection('teamactivities').insertMany([
      { teamId: team.id, actorId: olga.user.id, actorName: 'olga', type: 'member:promoted', category: 'member', target: { type: 'member', id: mia.user.id, name: 'mia' }, createdAt: old },
      { teamId: team.id, actorId: '0123456789abcdef01234567', actorName: 'somebody long gone', type: 'limits:team_changed', category: 'limits', target: {}, detail: {}, createdAt: old },
      { teamId: team.id, actorId: olga.user.id, actorName: 'olga', type: 'thing:retired', category: 'team', target: {}, detail: { x: 1 }, createdAt: old },
    ])
    const ancient = (await activityOf()).filter((e) => new Date(e.createdAt).getTime() === old.getTime())
    assert.equal(ancient.length, 3)
    const byType = Object.fromEntries(ancient.map((e) => [e.type, e]))
    assert.deepEqual([byType['member:promoted'].detail, byType['member:promoted'].message.length > 0, byType['member:promoted'].target.name], [{}, true, 'Mia Chen'])
    assert.deepEqual([byType['limits:team_changed'].actor.name, byType['limits:team_changed'].actor.state, byType['limits:team_changed'].target], ['somebody long gone', 'deleted', null])
    assert.equal(byType['thing:retired'].message, 'thing:retired')
    await db.collection('teamactivities').deleteMany({ createdAt: old })

    // Every type the server can write is in the catalogs of both languages.
    const { TYPES } = require('../src/services/activity')
    const { CATALOGS } = require('../src/i18n')
    for (const def of Object.values(TYPES)) for (const locale of Object.keys(CATALOGS)) assert.ok(Object.hasOwn(CATALOGS[locale], def.message), `${def.message} in ${locale}`)
  })

  /* What leo and dana leave behind: a canvas, an asset, a run, a template each; then they go. */
  const left = {}
  await t.test('somebody who left the team and somebody whose account is gone read differently - and the same in every list', async () => {
    await leo.data('PATCH', `${T}/members/${leo.user.id}`, { displayName: 'Leo K.' })
    for (const [name, c] of [['leo', leo], ['dana', dana]]) {
      const file = await h.upload(inT(c))
      const canvas = await inT(c).data('POST', '/api/workflow', { name: `Canvas of ${name}`, visibility: 'team_view' })
      const asset = await inT(c).data('POST', '/api/user-asset', { name: `Asset of ${name}`, mediaUrl: file.url, folder: `${name}-things` })
      const { runId } = await inT(c).data('POST', '/api/runs', { model: MODEL, prompt: `a picture by ${name}` })
      await h.waitRun(inT(c), runId)
      left[name] = { canvas, asset, runId }
    }
    const people = async () => {
      const [canvases, assets, records, log, templates, usage] = await Promise.all([
        inT(olga).data('GET', '/api/workflow/list'),
        inT(olga).data('GET', '/api/user-asset/list'),
        olga.data('GET', `${T}/usage/records?pageSize=100`),
        activityOf(),
        inT(olga).data('GET', '/api/canvas/templates'),
        olga.data('GET', `${T}/usage?groupBy=member`),
      ])
      const out = {}
      for (const [name, c] of [['leo', leo], ['dana', dana]]) {
        out[name] = {
          canvas: canvases.find((x) => x.id === left[name].canvas.id).createdBy,
          asset: assets.list.find((x) => x.id === left[name].asset.id).createdBy,
          record: records.list.find((x) => x.id === left[name].runId).createdBy,
          actor: log.find((e) => e.actor.id === c.user.id).actor,
          usage: usage.items.find((i) => i.key === c.user.id).member,
        }
      }
      out.leo.template = templates.find((x) => x.title === 'Leo\'s layout').createdBy
      return out
    }
    const pick = (p) => [p.state, p.left, p.deleted, p.name, p.username]

    const before = await people()
    for (const p of [...Object.values(before.leo), ...Object.values(before.dana)]) assert.equal(p.state, 'active')

    // leo is removed by the owner; dana's account is deleted by the super admin.
    await olga.data('DELETE', `${T}/members/${leo.user.id}`)
    await root.data('DELETE', `/api/admin/users/${dana.user.id}?confirm=dana`)

    const after = await people()
    for (const [where, p] of Object.entries(after.leo)) {
      assert.deepEqual(pick(p), ['left', true, false, 'Leo K.', 'leo'], `leo in ${where}: left the team, the account is there, the name they went by is kept`)
      assert.deepEqual(Object.keys(p).filter((k) => k !== 'system').sort(), PERSON_KEYS, where)
    }
    for (const [where, p] of Object.entries(after.dana)) {
      assert.deepEqual(pick(p), ['deleted', true, true, 'dana', 'dana'], `dana in ${where}: the account is gone, the name is kept`)
    }

    // The entries about them say so too, and what they were.
    const removals = (await activityOf()).filter((e) => e.type === 'member:removed')
    const removed = removals.find((e) => e.target.id === leo.user.id)
    const gone = removals.find((e) => e.target.id === dana.user.id)
    assert.deepEqual([removed.target.person.state, removed.target.name, removed.detail.role, removed.detail.accountDeleted], ['left', 'Leo K.', 'member', false])
    assert.deepEqual([gone.target.person.state, gone.target.name, gone.detail.accountDeleted, gone.actor.system], ['deleted', 'dana', true, true])

    // Somebody who comes back is simply in the team again.
    await h.join(olga, team.id, leo)
    const back = await people()
    assert.deepEqual(pick(back.leo.canvas), ['active', false, false, 'leo', 'leo'])
    await inT(leo).data('POST', `${T}/leave`)
    assert.deepEqual(pick((await people()).leo.canvas), ['left', true, false, 'leo', 'leo'], 'the name they went by the last time')
    assert.equal((await latest('member:left')).detail.role, 'member')

    // The owner hands over: who it was taken from is in the entry.
    await olga.data('POST', `${T}/transfer`, { userId: adam.user.id, confirm: 'Studio' })
    const handed = await latest('team:transferred')
    assert.deepEqual([handed.detail.fromId, handed.detail.fromName, handed.target.person.id], [olga.user.id, 'olga', adam.user.id])
    await adam.data('POST', `${T}/transfer`, { userId: olga.user.id, confirm: 'Studio' })
  })

  await t.test('a folder can be created empty and is deleted only while empty', async () => {
    const U = '/api/user-asset'
    const folders = async (c) => (await inT(c).data('GET', `${U}/list`)).folderList
    const made = await inT(mia).data('POST', `${U}/folder`, { name: 'Spring shoot' })
    assert.deepEqual(made, { name: 'Spring shoot', count: 0, empty: true, canDelete: true, existed: false })
    assert.equal((await inT(mia).data('POST', `${U}/folder`, { name: 'Spring shoot' })).existed, true)
    assert.deepEqual(await inT(mia).refused('POST', `${U}/folder`, { name: '   ' }), [400, 'asset.folder_required'])

    // Everybody sees it, empty; who may delete it: managers, and whoever created it.
    const list = await inT(olga).data('GET', `${U}/list`)
    assert.ok(list.folders.includes('Spring shoot'))
    const asSeen = async (c) => (await folders(c)).find((f) => f.name === 'Spring shoot')
    assert.deepEqual([(await asSeen(olga)).canDelete, (await asSeen(mia)).canDelete], [true, true])
    await h.join(olga, team.id, leo)
    assert.equal((await asSeen(leo)).canDelete, false)
    assert.deepEqual(await inT(leo).refused('DELETE', `${U}/folder?name=${encodeURIComponent('Spring shoot')}`), [403, 'team.forbidden'])

    // With an asset in it: refused, and the answer says how many are in the way.
    const file = await h.upload(inT(mia))
    const asset = await inT(mia).data('POST', U, { name: 'Shoe', mediaUrl: file.url, folder: 'Spring shoot' })
    assert.deepEqual([(await asSeen(olga)).count, (await asSeen(olga)).empty, (await asSeen(olga)).canDelete], [1, false, false])
    const full = await inT(olga).call('DELETE', `${U}/folder?name=${encodeURIComponent('Spring shoot')}`)
    assert.deepEqual([full.status, full.body.code, full.body.data, /1/.test(full.body.message)], [409, 'asset.folder_not_empty', { name: 'Spring shoot', count: 1 }, true])

    // Emptied - the asset moved out - it is still there, and now it can go.
    await inT(mia).data('PUT', `${U}/${asset.id}`, { folder: '' })
    assert.deepEqual([(await asSeen(mia)).count, (await asSeen(mia)).canDelete], [0, true])
    assert.deepEqual(await inT(mia).data('DELETE', `${U}/folder?name=${encodeURIComponent('Spring shoot')}`), { name: 'Spring shoot', deleted: true })
    assert.equal(await asSeen(olga), undefined)
    assert.deepEqual(await inT(mia).refused('DELETE', `${U}/folder?name=${encodeURIComponent('Spring shoot')}`), [404, 'asset.folder_not_found'])
    assert.deepEqual(await inT(mia).refused('DELETE', `${U}/folder`), [400, 'asset.folder_required'])

    // A folder that came about by an asset naming it stays when its last asset is deleted.
    await inT(mia).data('PUT', `${U}/${asset.id}`, { folder: 'By the way' })
    await inT(mia).data('DELETE', `${U}/${asset.id}`)
    const stays = (await folders(olga)).find((f) => f.name === 'By the way')
    assert.deepEqual([stays.count, stays.empty], [0, true])
    // Dissolving (managers) removes the folder too, and is not how a member gets rid of one.
    assert.deepEqual(await inT(leo).refused('POST', `${U}/folder/delete`, { name: 'By the way' }), [403, 'team.forbidden'])
    assert.deepEqual(await inT(olga).data('POST', `${U}/folder/delete`, { name: 'By the way' }), { moved: 0 })
    assert.equal((await folders(olga)).some((f) => f.name === 'By the way'), false)

    // Folders are per space: the same name elsewhere is another folder, and nobody else's is reachable.
    await zoe.data('POST', `${U}/folder`, { name: 'leo-things' })
    assert.deepEqual((await zoe.data('GET', `${U}/list`)).folderList, [{ name: 'leo-things', count: 0, empty: true, canDelete: true }])
    assert.deepEqual(await zoe.data('DELETE', `${U}/folder?name=leo-things`), { name: 'leo-things', deleted: true })
    assert.equal((await folders(olga)).find((f) => f.name === 'leo-things').count, 1, 'the team\'s folder of that name is untouched')
    await inT(leo).data('POST', `${T}/leave`)
  })

  await t.test('where something can be copied to - and why not', async () => {
    const other = await h.createTeam(mia, 'Second')
    const targets = async (c, query = '') => (await c.data('GET', `/api/spaces/copy-targets${query}`)).targets
    const brief = (list) => list.map((x) => [x.kind === 'team' ? x.name : 'personal', x.available, x.reason])

    // From her personal space: both teams. From the team: the personal space and the other team.
    assert.deepEqual(brief(await targets(mia)), [['personal', false, 'same_space'], ['Studio', true, ''], ['Second', true, '']])
    const fromTeam = await targets(inT(mia))
    assert.deepEqual(brief(fromTeam), [['personal', true, ''], ['Studio', false, 'same_space'], ['Second', true, '']])
    assert.deepEqual([fromTeam[0].id, fromTeam[1].id, fromTeam[1].current, fromTeam[2].role, fromTeam[1].message.length > 0], ['personal', team.id, true, 'owner', true])

    // The owner switched copying out off: members are told so; the owner still may.
    await olga.data('PATCH', T, { settings: { copyToPersonal: false } })
    assert.deepEqual(brief(await targets(inT(mia)))[0], ['personal', false, 'copy_out_disabled'])
    assert.deepEqual(brief(await targets(inT(olga)))[0], ['personal', true, ''])
    assert.deepEqual(await inT(mia).refused('POST', `/api/workflow/${left.leo.canvas.id}/copy`, { toSpace: 'personal' }), [403, 'space.copy_out_disabled'], 'the copy itself answers the same')
    await olga.data('PATCH', T, { settings: { copyToPersonal: true } })

    // A closed team is listed with the reason, and the copy is refused for it.
    await root.data('PATCH', `/api/admin/teams/${other.id}`, { status: 'suspended' })
    const closed = (await targets(inT(mia))).find((x) => x.id === other.id)
    assert.deepEqual([closed.available, closed.reason, closed.status], [false, 'team_suspended', 'suspended'])
    assert.deepEqual(await inT(mia).refused('POST', `/api/workflow/${left.leo.canvas.id}/copy`, { toSpace: other.id }), [403, 'team.suspended'])
    await root.data('PATCH', `/api/admin/teams/${other.id}`, { status: 'active' })

    // A full library of that kind.
    const stamp = new Date()
    await db.collection('userassets').insertMany(Array.from({ length: 5000 }, (_, i) => ({ userId: other.id, kind: 'brand', nodeType: 'IMAGE', name: `n${i}`, mediaUrl: '/files/uploads/2025/01/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png', isDeleted: false, createdAt: stamp, updatedAt: stamp })))
    const forBrand = (await targets(inT(mia), '?kind=asset&assetKind=brand')).find((x) => x.id === other.id)
    assert.deepEqual([forBrand.available, forBrand.reason, /5000/.test(forBrand.message)], [false, 'asset_kind_full', true])
    assert.equal((await targets(inT(mia), '?kind=asset&assetKind=product')).find((x) => x.id === other.id).available, true)
    assert.equal((await targets(inT(mia), '?kind=canvas')).find((x) => x.id === other.id).available, true)
    await db.collection('userassets').deleteMany({ userId: other.id })

    // Only the caller's own spaces, ever; and the question has to make sense.
    assert.deepEqual(brief(await targets(zoe)).map((x) => x[0]), ['personal', 'No picture'])
    assert.deepEqual(await mia.refused('GET', '/api/spaces/copy-targets?kind=team'), [400, 'validation.one_of'])
    assert.deepEqual(await mia.refused('GET', '/api/spaces/copy-targets?kind=asset&assetKind=nope'), [400, 'validation.one_of'])
    assert.equal((await anon.call('GET', '/api/spaces/copy-targets')).status, 401)
  })

  let chatId
  await t.test('a history record has what a detail view and a CSV need - the whole of it by its id', async () => {
    await inT(olga).data('POST', `/api/admin/providers/${provider.id}/models`, { model: 'talker', kind: 'chat' })
    await inT(olga).data('PUT', `/api/admin/models/${encodeURIComponent(CHAT)}`, { pricing: { currency: 'CNY', unit: 'per_1m_tokens', table: { input: 1, output: 2 } } })
    const tokens = await latest('model:price_changed')
    assert.deepEqual([tokens.detail.before, tokens.detail.after.unit, tokens.detail.after.input, tokens.detail.after.output, tokens.detail.after.price], [null, 'per_1m_tokens', 1, 2, null])
    const long = 'tell me about light. '.repeat(40)
    const task = await inT(mia).data('POST', '/api/llm/tasks', { model: CHAT, prompt: long, systemPrompt: 'be brief' })
    chatId = task.taskId
    for (let i = 0; i < 100; i++) {
      const s = await inT(mia).data('GET', `/api/llm/tasks/${chatId}`)
      if (['succeeded', 'failed', 'canceled'].includes(s.status)) break
      await h.sleep(100)
    }
    // A long answer, as an upstream would give one.
    const answer = 'light is a wave. '.repeat(100)
    await db.collection('runs').updateOne({ _id: new ObjectId(chatId) }, { $set: { text: answer } })

    const list = (await mia.data('GET', `${T}/usage/records?pageSize=100`)).list
    const row = list.find((r) => r.id === chatId)
    assert.deepEqual(
      [row.kind, row.status, row.model, row.prompt.length, row.promptLength, row.promptTruncated, row.text.length, row.textLength, row.textTruncated, row.usage, row.outputs, row.inputs, row.errorCode],
      ['chat', 'succeeded', CHAT, 200, long.length, true, 500, answer.length, true, { inputTokens: 10, outputTokens: 10, totalTokens: 20 }, [], { images: 0, videos: 0 }, '']
    )
    assert.ok(row.durationMs >= 0 && row.queuedMs >= 0 && typeof row.cost.unknown === 'boolean')
    assert.equal(row.systemPrompt, undefined, 'the list carries no system prompt')

    const whole = await mia.data('GET', `${T}/usage/records/${chatId}`)
    assert.deepEqual([whole.prompt, whole.promptTruncated, whole.text, whole.textTruncated, whole.systemPrompt, whole.imageUrls, whole.usage.totalTokens, whole.createdBy.id], [long, false, answer, false, 'be brief', [], 20, mia.user.id])
    assert.deepEqual(await inT(mia).data('GET', `/api/admin/usage/records/${chatId}`), whole, 'the same record through X-Space')

    // `full=1`: the list gives every record whole - what an export needs, in one call per page.
    const exported = (await mia.data('GET', `${T}/usage/records?pageSize=100&full=1`)).list.find((r) => r.id === chatId)
    assert.deepEqual(exported, whole, 'a row of the full list is the record read by its id')

    // An image run: its files are in the record, so the page needs no second call.
    const media = list.find((r) => r.id === left.leo.runId)
    assert.equal(media, undefined, 'a member reads their own records only')
    const all = (await olga.data('GET', `${T}/usage/records?pageSize=100`)).list
    const picture = all.find((r) => r.id === left.leo.runId)
    assert.deepEqual([picture.kind, picture.outputs.length, picture.outputs[0].type, picture.outputs[0].url.startsWith('/files/'), picture.text, picture.usage, picture.filesPurged, picture.createdBy.state], ['image', 1, 'image', true, '', null, false, 'left'])

    // Whose record one may read in full is whose one may list.
    assert.deepEqual(await mia.refused('GET', `${T}/usage/records/${left.leo.runId}`), [404, 'run.not_found'])
    assert.equal((await olga.data('GET', `${T}/usage/records/${left.leo.runId}`)).id, left.leo.runId)
    assert.deepEqual(await zoe.refused('GET', `/api/admin/usage/records/${chatId}`), [404, 'run.not_found'])
    assert.deepEqual(await zoe.refused('GET', `${T}/usage/records/${chatId}`), [404, 'team.not_found'])
    assert.deepEqual(await mia.refused('GET', `${T}/usage/records/not-an-id`), [400, 'validation.bad_format'])
  })

  await t.test('history search: q looks in the prompt, the model and the canvas name - within what the caller may list', async () => {
    // A team of its own: the counts of the team above are asserted further down.
    const sara = await h.register('sara') // owner
    const alan = await h.register('alan') // admin
    const mel = await h.register('mel') // member
    const lab = await h.createTeam(sara, 'Lab')
    const L = `/api/teams/${lab.id}`
    const inL = (c) => c.in(lab.id)
    await h.join(sara, lab.id, alan, { admin: true })
    await h.join(sara, lab.id, mel)
    await h.addProvider(inL(sara), 'sk-team-search-key-00000000aa')
    const hidden = await inL(mel).data('POST', '/api/workflow', { name: 'Moonlit storyboard', visibility: 'private' })
    const shared = await inL(mel).data('POST', '/api/workflow', { name: 'Harbour moodboard', visibility: 'team_view' })
    const run = async (c, prompt, workflowId) => {
      const { runId } = await inL(c).data('POST', '/api/runs', { model: MODEL, prompt, ...(workflowId ? { workflowId } : {}) })
      await h.waitRun(inL(c), runId)
      return runId
    }
    const fox = await run(sara, 'A red fox in NEON rain (50% off) [v2]')
    const street = await run(mel, 'quiet street, no people', hidden.id)
    const boats = await run(mel, 'boats at dawn', shared.id)
    const all = [fox, street, boats].sort()
    const found = async (who, q, extra = '') => (await who.data('GET', `${L}/usage/records?pageSize=100&q=${encodeURIComponent(q)}${extra}`)).list.map((r) => r.id).sort()

    // The prompt: any case, and as the text it is - not as a pattern.
    assert.deepEqual(await found(sara, 'neon RAIN'), [fox])
    assert.deepEqual(await found(sara, '(50% off) [v2]'), [fox])
    assert.deepEqual([await found(sara, '.*'), await found(sara, 'fox|boats'), await found(sara, '^A red')], [[], [], []])
    assert.deepEqual(await found(sara, '   '), all, 'nothing but spaces is no search')
    // The model, by its id or its name.
    assert.deepEqual(await found(sara, 'NANO-BANANA'), all)
    // The canvas the run came from, by its name - among the canvases the caller may see.
    assert.deepEqual([await found(sara, 'moonlit'), await found(sara, 'MOODBOARD')], [[street], [boats]])
    assert.deepEqual([await found(mel, 'moonlit'), await found(mel, 'storyboard')], [[street], [street]])

    // It only narrows what the caller may list anyway: a member's search never reaches somebody else's run...
    assert.deepEqual([await found(mel, 'fox'), await found(mel, 'banana')], [[], [street, boats].sort()])
    assert.deepEqual(await found(alan, 'banana'), [], 'an admin who is not shown everybody\'s records has none of his own')
    // ... and an admin who is shown everybody's does not find a run through the name of a private canvas that is not his to see.
    await sara.data('PATCH', L, { settings: { adminsSeeAll: true } })
    assert.deepEqual([await found(alan, 'boats'), await found(alan, 'moodboard'), await found(alan, 'moonlit')], [[boats], [boats], []])

    // Together with the other filters, and in the summary too.
    assert.deepEqual(await found(sara, 'banana', `&member=${mel.user.id}`), [street, boats].sort())
    assert.deepEqual(await found(sara, 'banana', '&status=failed'), [])
    const summary = await sara.data('GET', `${L}/usage?groupBy=model&q=${encodeURIComponent('neon')}`)
    assert.equal(summary.totals.runs, 1)
    assert.equal((await inL(sara).data('GET', '/api/admin/usage/records?q=boats')).total, 1, 'the same through X-Space')

    // A canvas in the trash is not searched by name any more.
    await inL(mel).data('DELETE', `/api/workflow/${shared.id}`)
    assert.deepEqual(await found(sara, 'moodboard'), [])

    // The text has a length, and is text.
    assert.deepEqual(await found(sara, 'x'.repeat(100)), [])
    assert.deepEqual(await sara.refused('GET', `${L}/usage/records?q=${'x'.repeat(101)}`), [400, 'validation.max_length'])
    assert.deepEqual(await sara.refused('GET', `${L}/usage/records?q[$ne]=x`), [400, 'validation.invalid'])
    assert.deepEqual(await sara.refused('GET', `${L}/usage?q[$regex]=.*`), [400, 'validation.invalid'])
  })

  await t.test('several history records leave as one zip: the caller\'s readable records only, named, capped', async () => {
    const zip = require('../src/services/zipExport')
    const ids = [left.leo.runId, chatId, left.dana.runId]

    const out = await raw(inT(olga), 'POST', '/api/runs/download-zip', { ids, name: '四月/导出' })
    assert.deepEqual([out.status, out.type], [200, 'application/zip'])
    assert.match(out.headers.get('content-disposition'), /filename\*=UTF-8''%E5%9B%9B%E6%9C%88_%E5%AF%BC%E5%87%BA\.zip/, 'the name asked for, made safe')
    const names = zipNames(out.bytes)
    assert.equal(names.length, 3)
    assert.match(names[0], /^01-nano-banana-2-\d{8}-\d{6}\.png$/)
    assert.match(names[1], /^02-talker-\d{8}-\d{6}\.txt$/)
    assert.match(names[2], /^03-nano-banana-2-\d{8}-\d{6}\.png$/)
    assert.ok(out.bytes.includes(h.png.subarray(0, 64)), 'stored, not compressed: the picture is in there as it is')
    assert.ok(out.bytes.includes(Buffer.from('light is a wave. light is a wave.')), 'and the whole text answer')

    // A member gets what they may read: their own chat answer, nobody's pictures.
    const mine = await raw(inT(mia), 'POST', '/api/runs/download-zip', { ids })
    assert.deepEqual(zipNames(mine.bytes).map((n) => n.replace(/\d{8}-\d{6}/, 'T')), ['01-talker-T.txt'])
    assert.match(mine.headers.get('content-disposition'), /history-\d{8}-\d{6}\.zip/)
    const none = await raw(inT(mia), 'POST', '/api/runs/download-zip', { ids: [left.leo.runId] })
    assert.deepEqual([none.status, none.json.code], [404, 'run.nothing_to_download'])
    // Another space's records are not there at all.
    assert.deepEqual(await zoe.refused('POST', '/api/runs/download-zip', { ids }), [404, 'run.nothing_to_download'])
    assert.deepEqual(await inT(zoe).refused('POST', '/api/runs/download-zip', { ids }), [404, 'team.not_found'])

    // `urls` narrows the files down and cannot add one.
    const url = (await olga.data('GET', `${T}/usage/records/${left.dana.runId}`)).outputs[0].url
    const narrowed = await raw(inT(olga), 'POST', '/api/runs/download-zip', { ids, urls: [url, 'http://169.254.169.254/latest'] })
    assert.deepEqual(zipNames(narrowed.bytes).map((n) => n.slice(0, 3)), ['03-'])
    assert.deepEqual(await inT(olga).refused('POST', '/api/runs/download-zip', { ids, urls: ['http://169.254.169.254/latest'] }), [404, 'run.nothing_to_download'])

    // A file that is gone leaves a note in its place, in the reader's language.
    const key = h.mongoose.connection.collection('runs')
    const gone = await key.findOne({ _id: new ObjectId(left.leo.runId) })
    await key.updateOne({ _id: gone._id }, { $set: { 'outputs.0.url': '/files/outputs/2025/01/00000000000000000000000000000000.png' } })
    const noted = await raw(inT(olga), 'POST', '/api/runs/download-zip', { ids: [left.leo.runId, left.dana.runId] })
    const got = zipNames(noted.bytes)
    assert.match(got[0], /^01-nano-banana-2-\d{8}-\d{6}-failed\.txt$/)
    assert.match(got[1], /^02-nano-banana-2-\d{8}-\d{6}\.png$/)
    assert.ok(noted.bytes.includes(Buffer.from('这个文件下载失败')) || noted.bytes.includes(Buffer.from('could not be downloaded')))
    await key.updateOne({ _id: gone._id }, { $set: { 'outputs.0.url': gone.outputs[0].url } })

    // An id is an id in either case.
    const upper = await raw(inT(olga), 'POST', '/api/runs/download-zip', { ids: [left.dana.runId.toUpperCase()] })
    assert.deepEqual([upper.status, zipNames(upper.bytes).length], [200, 1])

    // The caps, and what is not a request.
    const was = zip.limits.items
    zip.limits.items = 2
    const over = await inT(olga).call('POST', '/api/runs/download-zip', { ids })
    assert.deepEqual([over.status, over.body.code, /2/.test(over.body.message) && /3/.test(over.body.message)], [400, 'run.zip_max', true])
    zip.limits.items = was
    assert.deepEqual(await inT(olga).refused('POST', '/api/runs/download-zip', {}), [400, 'validation.array'])
    assert.deepEqual(await inT(olga).refused('POST', '/api/runs/download-zip', { ids: ['x'] }), [400, 'validation.required'])
    assert.deepEqual(await inT(olga).refused('POST', '/api/runs/download-zip', { ids: Array.from({ length: 101 }, () => left.leo.runId) }), [400, 'validation.max_items'])
    assert.deepEqual(await inT(olga).refused('POST', '/api/runs/download-zip', { ids, urls: 'x' }), [400, 'validation.array'])
    assert.deepEqual(await inT(olga).refused('POST', '/api/runs/download-zip', { ids, urls: Array.from({ length: 2001 }, (_, i) => `/files/outputs/x${i}.png`) }), [400, 'validation.max_items'])
    assert.equal((await anon.call('POST', '/api/runs/download-zip', { ids })).status, 401)
  })

  await t.test('an archive nobody waits for any more is given up at once - and one account cannot stack them up', async () => {
    const fs = require('fs')
    const path = require('path')
    const http = require('http')
    const runExport = require('../src/routes/runExport')
    // A result far larger than anything that fits into the buffers between here and the client.
    const key = 'outputs/2025/01/ffffffffffffffffffffffffffffffff.mp4'
    fs.mkdirSync(path.dirname(path.join(h.filesDir, key)), { recursive: true })
    fs.writeFileSync(path.join(h.filesDir, key), Buffer.alloc(96 * 1024 * 1024, 1))
    const runs = db.collection('runs')
    const before = await runs.findOne({ _id: new ObjectId(left.dana.runId) })
    await runs.updateOne({ _id: before._id }, { $set: { 'outputs.0.url': `/files/${key}`, 'outputs.0.type': 'video' } })

    /** Ask for the archive and stop reading after the first bytes: a client on a line that stalls. */
    const stalled = () => new Promise((resolve, reject) => {
      const url = new URL(h.base + '/api/runs/download-zip')
      const req = http.request({ host: url.hostname, port: url.port, path: url.pathname, method: 'POST', headers: { Authorization: `Bearer ${olga.token}`, 'X-Space': team.id, 'Content-Type': 'application/json' } }, (res) => {
        res.once('data', () => { res.pause(); resolve({ status: res.statusCode, leave: () => req.destroy() }) })
      })
      req.on('error', reject)
      req.end(JSON.stringify({ ids: [left.dana.runId, chatId] }))
    })
    const waitFor = async (cond, what) => {
      for (let i = 0; i < 100; i++) { if (cond()) return; await h.sleep(30) }
      assert.fail(what)
    }
    const mine = () => runExport.inFlight.get(olga.user.id) || 0

    const was = runExport.limits.perAccount
    runExport.limits.perAccount = 1
    try {
      const first = await stalled()
      assert.deepEqual([first.status, mine()], [200, 1], 'the archive is on its way and held back by the client')
      // A second one from the same account has to wait its turn; somebody else is not affected.
      const second = await inT(olga).call('POST', '/api/runs/download-zip', { ids: [chatId] })
      assert.deepEqual([second.status, second.body.code, /1/.test(second.body.message)], [429, 'run.zip_busy', true])
      assert.equal((await raw(inT(mia), 'POST', '/api/runs/download-zip', { ids: [chatId] })).status, 200)

      // The client goes away in the middle of the file: the work stops, the place is free again.
      first.leave()
      await waitFor(() => mine() === 0, 'the abandoned archive is still being written')
      const again = await raw(inT(olga), 'POST', '/api/runs/download-zip', { ids: [chatId] })
      assert.deepEqual([again.status, zipNames(again.bytes).length], [200, 1])
      assert.equal(mine(), 0, 'a finished archive gives its place back too')
    } finally {
      runExport.limits.perAccount = was
      await runs.updateOne({ _id: before._id }, { $set: { 'outputs.0.url': before.outputs[0].url, 'outputs.0.type': before.outputs[0].type } })
      fs.rmSync(path.join(h.filesDir, key), { force: true })
    }
  })

  await t.test('removing a team reports everything that went, every kind by name', async () => {
    const teams = require('../src/services/teams')
    const { OWNED } = require('../src/services/accounts')
    for (const { model } of OWNED) assert.ok(teams.PURGE_COUNT_KEYS[model.collection.collectionName], `${model.collection.collectionName} has a name in the counts`)

    const expected = {
      members: await db.collection('teammembers').countDocuments({ teamId: team.id }),
      invitations: await db.collection('teaminvitations').countDocuments({ teamId: team.id }),
      activity: await db.collection('teamactivities').countDocuments({ teamId: team.id }),
      canvases: await db.collection('workflows').countDocuments({ userId: team.id }),
      assets: await db.collection('userassets').countDocuments({ userId: team.id }),
      assetFolders: await db.collection('userassetfolders').countDocuments({ userId: team.id }),
      runs: await db.collection('runs').countDocuments({ userId: team.id }),
      providers: await db.collection('providers').countDocuments({ userId: team.id }),
      modelOverrides: await db.collection('modeloverrides').countDocuments({ userId: team.id }),
      templates: await db.collection('templates').countDocuments({ userId: team.id }),
      textTemplates: await db.collection('texttemplates').countDocuments({ userId: team.id }),
    }
    assert.ok(expected.members >= 3 && expected.invitations >= 4 && expected.activity > 20 && expected.canvases === 2 && expected.assets >= 2 && expected.assetFolders >= 2 && expected.runs === 3 && expected.providers === 1 && expected.templates === 1 && expected.textTemplates === 1, JSON.stringify(expected))
    assert.ok(await db.collection('teamformermembers').countDocuments({ teamId: team.id }) >= 2)

    await root.data('PATCH', `/api/admin/teams/${team.id}`, { status: 'suspended' })
    const out = await root.data('DELETE', `/api/admin/teams/${team.id}?confirm=Studio`)
    assert.deepEqual([out.id, out.name, out.filesRemoved], [team.id, 'Studio', true])
    for (const [key, n] of Object.entries(expected)) assert.equal(out.counts[key], n + (key === 'activity' ? 1 : 0), key)
    assert.deepEqual([out.counts.shares, out.counts.brandKits, out.counts.files > 0, out.counts.files], [0, 0, true, out.files], 'a kind of which there was none is 0, not absent')
    assert.deepEqual(Object.keys(out.counts).sort(), ['activity', 'assetFolders', 'assets', 'brandKits', 'canvases', 'files', 'invitations', 'members', 'modelOverrides', 'providers', 'runs', 'shares', 'templates', 'textTemplates'])
    for (const name of ['teammembers', 'teaminvitations', 'teamactivities', 'teamformermembers']) assert.equal(await db.collection(name).countDocuments({ teamId: team.id }), 0, name)
    assert.equal(await db.collection('userassetfolders').countDocuments({ userId: team.id }), 0)
    assert.deepEqual(await root.refused('DELETE', `/api/admin/teams/${team.id}?confirm=Studio`), [404, 'team.not_found'])
  })
})
