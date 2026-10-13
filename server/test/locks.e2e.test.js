'use strict'

/**
 * The edit lock and what it is not, over real HTTP:
 *
 *  - renaming a canvas (and every other metadata-only save) needs neither the
 *    lock nor a revision and never makes the editor's next save a conflict;
 *  - the lock belongs to one editing session - one tab - not to an account:
 *    a second tab of the same person is locked out like anybody else and takes
 *    over the same way; nobody is ever told another session's id;
 *  - a session that lost the lock is told how: taken over, or run out;
 *  - a closing page can give the lock back without an Authorization header,
 *    with the release token of exactly that lock and with nothing else.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { boot } = require('./support/teamHarness')
const { EDIT_LOCK } = require('../src/constants')

const TAB1 = 'tab-one-aaaaaaaaaaaa'
const TAB2 = 'tab-two-bbbbbbbbbbbb'
const CAM = 'tab-cam-cccccccccccc'

test('edit locks: metadata without the lock, one session at a time, how a lock is lost, the release beacon', async (t) => {
  const h = await boot(t, 'locks')
  if (!h) return t.skip('no MongoDB available (set TEST_MONGODB_URI)')
  const { db } = h
  const { ObjectId } = h.mongoose.Types

  const ann = await h.register('ann')
  const al = await h.register('alan')
  const cam = await h.register('cam')
  const team = await h.createTeam(ann, 'Alpha')
  await h.join(ann, team.id, al)
  await h.join(ann, team.id, cam)
  const inT = (c) => c.in(team.id)
  const canvas = (c, extra) => inT(c).data('POST', '/api/workflow', { name: 'Storyboard', nodes: [], visibility: 'team_edit', ...extra })
  const expire = (id) => db.collection('workflows').updateOne({ _id: new ObjectId(id) }, { $set: { 'lock.expiresAt': new Date(Date.now() - 1) } })
  const lockOf = async (id) => (await db.collection('workflows').findOne({ _id: new ObjectId(id) })).lock
  const beacon = (id, body, type = 'text/plain;charset=UTF-8') => fetch(`${h.base}/api/workflow/${id}/lock/release`, { method: 'POST', headers: { 'Content-Type': type }, body: typeof body === 'string' ? body : JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }))

  await t.test('the numbers: a lock outlives two missed heartbeats and frees a dead tab within 40 seconds', () => {
    assert.ok(EDIT_LOCK.TTL_MS >= 30000 && EDIT_LOCK.TTL_MS <= 40000, String(EDIT_LOCK.TTL_MS))
    assert.ok(EDIT_LOCK.HEARTBEAT_MS >= 10000 && EDIT_LOCK.HEARTBEAT_MS <= 15000, String(EDIT_LOCK.HEARTBEAT_MS))
    assert.ok(EDIT_LOCK.TTL_MS >= 3 * EDIT_LOCK.HEARTBEAT_MS)
    // Chrome runs the timers of a tab hidden for five minutes once a minute: such a tab must lose
    // the lock (the TTL is shorter than that minute) - what the "reacquired" path is for - while a
    // tab throttled to one timer a second (any hidden tab) must keep it.
    assert.ok(EDIT_LOCK.TTL_MS < 60000 && EDIT_LOCK.HEARTBEAT_MS >= 5000)
    // Somebody waiting learns of a dead tab within a minute, of a closed one within seconds.
    assert.ok(EDIT_LOCK.WAIT_POLL_MS <= 10000 && EDIT_LOCK.TTL_MS + EDIT_LOCK.WAIT_POLL_MS <= 60000)
    assert.ok(EDIT_LOCK.LIST_POLL_MS >= 5000 && EDIT_LOCK.LIST_POLL_MS <= 30000)
  })

  await t.test('renaming while somebody else edits: no lock asked or taken, no revision moved, and the editor\'s next save goes through', async () => {
    const made = await canvas(ann)
    const W = `/api/workflow/${made.id}`
    const held = await inT(al).data('POST', `${W}/lock`, { sessionId: TAB1 })
    assert.deepEqual([held.state, held.name, held.metaRevision, held.revision], ['acquired', 'Storyboard', 0, made.revision])

    // The old way of renaming - PUT with nothing but the name - and the new one.
    const viaPut = await inT(cam).data('PUT', W, { name: 'Storyboard v2' })
    assert.deepEqual([viaPut.name, viaPut.revision, viaPut.metaRevision, viaPut.lock.by.username], ['Storyboard v2', made.revision, 1, 'alan'], 'renamed, content revision untouched, the lock still the editor\'s')
    assert.equal(viaPut.lastEditedBy, made.lastEditedBy, 'a rename is not an edit of the content')
    const viaPatch = await inT(cam).data('PATCH', `${W}/meta`, { name: 'Storyboard v3' })
    assert.deepEqual([viaPatch.name, viaPatch.revision, viaPatch.metaRevision], ['Storyboard v3', made.revision, 2])
    // A stale baseRevision is not looked at for metadata: nothing about it can conflict.
    assert.equal((await inT(cam).data('PUT', W, { name: 'Storyboard v3', baseRevision: 999 })).metaRevision, 2, 'the same name again changes nothing')
    const stored = await lockOf(made.id)
    assert.deepEqual([stored.by, stored.session], [al.user.id, TAB1])

    // The dedicated call refuses content instead of becoming a content save.
    assert.deepEqual(await inT(cam).refused('PATCH', `${W}/meta`, { name: 'x', nodes: [] }), [400, 'canvas.meta_only'])
    assert.deepEqual(await inT(cam).refused('PATCH', `${W}/meta`, { settings: {} }), [400, 'canvas.meta_only'])
    assert.deepEqual(await inT(cam).refused('PUT', W, { name: '   ' }), [400, 'common.name_required'])

    // The viewport is metadata too: it moves nothing, not even updatedAt.
    const panned = await inT(cam).data('PUT', W, { viewport: { x: 7, y: 8, zoom: 2 } })
    assert.deepEqual([panned.viewport.x, panned.revision, panned.metaRevision, panned.updatedAt], [7, made.revision, 2, viaPatch.updatedAt])

    // The editor learns the new name from its heartbeat, and its save - made from the revision it
    // opened - is no conflict. It does not send a name, so the new one stands.
    const beat = await inT(al).data('POST', `${W}/lock`, { sessionId: TAB1 })
    assert.deepEqual([beat.state, beat.name, beat.metaRevision, beat.revision], ['renewed', 'Storyboard v3', 2, made.revision])
    const saved = await inT(al).data('PUT', W, { nodes: [{ id: 'n1', type: 'text', position: { x: 0, y: 0 }, data: {} }], baseRevision: made.revision, sessionId: TAB1 })
    assert.deepEqual([saved.name, saved.revision, saved.metaRevision, saved.lock.mine], ['Storyboard v3', made.revision + 1, 2, true])

    // Content still needs the lock: the one who renamed cannot save nodes.
    assert.deepEqual(await inT(cam).refused('PUT', W, { nodes: [], baseRevision: saved.revision, sessionId: CAM }), [423, 'canvas.locked'])
    // A save of content and name together is a content save: refused as a whole, the name with it.
    assert.deepEqual(await inT(cam).refused('PUT', W, { name: 'sneaked in', nodes: [], baseRevision: saved.revision, sessionId: CAM }), [423, 'canvas.locked'])
    assert.equal((await inT(cam).data('GET', W)).name, 'Storyboard v3')
  })

  await t.test('renaming needs the right to edit: somebody who may only view is refused', async () => {
    const shown = await canvas(ann, { visibility: 'team_view', name: 'Look only' })
    const W = `/api/workflow/${shown.id}`
    assert.equal((await inT(al).data('GET', W)).access.canEdit, false)
    assert.deepEqual(await inT(al).refused('PUT', W, { name: 'mine now' }), [403, 'team.forbidden'])
    assert.deepEqual(await inT(al).refused('PATCH', `${W}/meta`, { name: 'mine now' }), [403, 'team.forbidden'])
    assert.deepEqual(await inT(al).refused('PATCH', `${W}/meta`, { viewport: { x: 1, y: 1, zoom: 1 } }), [403, 'team.forbidden'])
    assert.equal((await inT(ann).data('GET', W)).name, 'Look only')
    // A "only me" canvas of somebody else does not exist for them.
    const secret = await canvas(ann, { visibility: 'private' })
    assert.deepEqual(await inT(al).refused('PATCH', `/api/workflow/${secret.id}/meta`, { name: 'x' }), [404, 'canvas.not_found'])
  })

  await t.test('a personal space: no lock, a rename moves no revision, and content conflicts are found as before', async () => {
    const mine = await al.data('POST', '/api/workflow', { name: 'Private', nodes: [] })
    const P = `/api/workflow/${mine.id}`
    const lock = await al.data('POST', `${P}/lock`, { sessionId: TAB1 })
    assert.deepEqual([lock.lock, lock.state, lock.ttlMs, lock.heartbeatMs], [null, 'none', EDIT_LOCK.TTL_MS, EDIT_LOCK.HEARTBEAT_MS])
    const renamed = await al.data('PUT', P, { name: 'Private 2' })
    assert.deepEqual([renamed.name, renamed.revision, renamed.metaRevision], ['Private 2', mine.revision, 1])
    // Last write wins without a revision, as it always did; with one, a stale save is a conflict.
    const plain = await al.data('PUT', P, { nodes: [] })
    assert.equal(plain.revision, mine.revision + 1)
    assert.deepEqual(await al.refused('PUT', P, { nodes: [], baseRevision: mine.revision }), [409, 'canvas.conflict'])
    assert.equal((await al.data('PUT', P, { nodes: [], baseRevision: plain.revision })).revision, plain.revision + 1)
    // Two tabs in a personal space are told apart by the revision, never by a lock.
    assert.equal((await al.data('PUT', P, { nodes: [], baseRevision: plain.revision + 1, sessionId: TAB2 })).lock, null)
  })

  await t.test('one session at a time: a second tab of the same person is locked out and takes over like anybody else', async () => {
    const made = await canvas(ann)
    const W = `/api/workflow/${made.id}`
    const first = await inT(al).data('POST', `${W}/lock`, { sessionId: TAB1 })
    assert.deepEqual([first.state, first.lock.mine, first.lock.sameUser, first.ttlMs, first.heartbeatMs, first.ttlSeconds, first.heartbeatSeconds], ['acquired', true, true, EDIT_LOCK.TTL_MS, EDIT_LOCK.HEARTBEAT_MS, EDIT_LOCK.TTL_MS / 1000, EDIT_LOCK.HEARTBEAT_MS / 1000])
    assert.match(first.lock.releaseToken, /^[A-Za-z0-9_-]{43}$/)

    // The same account, another tab: locked, told it is itself, offered the takeover.
    const second = await inT(al).call('POST', `${W}/lock`, { sessionId: TAB2 })
    assert.deepEqual([second.status, second.body.code, second.body.data.lock.mine, second.body.data.lock.sameUser, second.body.data.canTakeOver, second.body.data.lost], [423, 'canvas.locked', false, true, true, null])
    assert.deepEqual([second.body.data.ttlMs, second.body.data.heartbeatMs], [EDIT_LOCK.TTL_MS, EDIT_LOCK.HEARTBEAT_MS])
    assert.match(second.body.message, /另一个标签页|another tab/)
    assert.deepEqual(await inT(al).refused('PUT', W, { nodes: [], baseRevision: made.revision, sessionId: TAB2 }), [423, 'canvas.locked'], 'a save from the tab that does not hold the lock')
    // A client that names no session is one more session, not a way in.
    assert.deepEqual(await inT(al).refused('POST', `${W}/lock`), [423, 'canvas.locked'])
    assert.deepEqual(await inT(al).refused('PUT', W, { nodes: [], baseRevision: made.revision }), [423, 'canvas.locked'])
    assert.deepEqual(await inT(al).refused('POST', `${W}/lock`, { sessionId: 'no' }), [400, 'validation.invalid'])
    assert.deepEqual(await inT(al).refused('POST', `${W}/lock`, { sessionId: 'has spaces in it' }), [400, 'validation.invalid'])

    // What others are told: who, since when, whether it is them - never the session, never the release token.
    for (const [c, query, mine, sameUser] of [[cam, '', false, false], [al, '', false, true], [al, `?sessionId=${TAB2}`, false, true], [al, `?sessionId=${TAB1}`, true, true]]) {
      const seen = await inT(c).call('GET', W + query)
      assert.deepEqual([seen.body.data.lock.by.username, seen.body.data.lock.mine, seen.body.data.lock.sameUser], ['alan', mine, sameUser])
      assert.equal(Object.hasOwn(seen.body.data.lock, 'releaseToken'), mine)
      assert.equal(JSON.stringify(seen.body).includes(TAB1), false, 'a session id never leaves the server')
      const listed = (await inT(c).data('GET', `/api/workflow/list${query}`)).find((w) => w.id === made.id)
      assert.deepEqual([listed.lock.mine, listed.lock.sameUser, Object.hasOwn(listed.lock, 'session')], [mine, sameUser, false])
    }
    assert.equal(JSON.stringify(second.body).includes(TAB1), false)

    // Taking over from oneself: no entry in the team's log, and the first tab learns how it lost the canvas.
    const before = (await inT(ann).data('GET', `/api/teams/${team.id}/activity?category=canvas`)).total
    const over = await inT(al).data('POST', `${W}/lock`, { sessionId: TAB2, takeover: true })
    assert.deepEqual([over.state, over.lock.mine, over.lock.sameUser], ['taken_over', true, true])
    assert.notEqual(over.lock.releaseToken, first.lock.releaseToken)
    assert.equal((await inT(ann).data('GET', `/api/teams/${team.id}/activity?category=canvas`)).total, before)
    const lostBeat = await inT(al).call('POST', `${W}/lock`, { sessionId: TAB1 })
    assert.deepEqual([lostBeat.status, lostBeat.body.code, lostBeat.body.data.lost, lostBeat.body.data.lock.sameUser], [423, 'canvas.locked', 'taken_over', true])
    const lostSave = await inT(al).call('PUT', W, { nodes: [], baseRevision: made.revision, sessionId: TAB1 })
    assert.deepEqual([lostSave.status, lostSave.body.code, lostSave.body.data.lost], [423, 'canvas.locked', 'taken_over'])
    assert.equal((await inT(al).data('GET', W)).revision, made.revision, 'nothing of the refused save was written')

    // Somebody else takes over: that one is written down, and the loser is told who.
    const taken = await inT(cam).data('POST', `${W}/lock`, { sessionId: CAM, takeover: true })
    assert.deepEqual([taken.state, taken.lock.by.username, taken.lock.mine, taken.lock.sameUser], ['taken_over', 'cam', true, true])
    assert.equal((await inT(ann).data('GET', `/api/teams/${team.id}/activity?category=canvas`)).total, before + 1)
    const told = await inT(al).call('POST', `${W}/lock`, { sessionId: TAB2 })
    assert.deepEqual([told.status, told.body.data.lost, told.body.data.lock.by.username, told.body.data.lock.sameUser], [423, 'taken_over', 'cam', false])
    assert.match(told.body.message, /cam/)
    // The tab that lost it two holders ago is no longer "the one it was taken from".
    assert.equal((await inT(al).call('POST', `${W}/lock`, { sessionId: TAB1 })).body.data.lost, null)
  })

  await t.test('a lock that ran out: carried on when nobody took the canvas, lost - and said so - when somebody did', async () => {
    const made = await canvas(ann)
    const W = `/api/workflow/${made.id}`
    const first = await inT(cam).data('POST', `${W}/lock`, { sessionId: CAM })
    // A tab in the background misses its heartbeats; the lock runs out; nobody comes.
    await expire(made.id)
    assert.equal((await inT(al).data('GET', W)).lock, null, 'free for others the moment it ran out')
    const back = await inT(cam).data('POST', `${W}/lock`, { sessionId: CAM })
    assert.deepEqual([back.state, back.lock.at, back.lock.releaseToken, back.revision], ['reacquired', first.lock.at, first.lock.releaseToken, made.revision])
    // The same when its next call is a save: it goes through and holds the lock again.
    await expire(made.id)
    const saved = await inT(cam).data('PUT', W, { nodes: [], baseRevision: made.revision, sessionId: CAM })
    assert.deepEqual([saved.revision, saved.lock.mine], [made.revision + 1, true])

    // This time somebody opens the canvas while it is free: no takeover needed, none recorded.
    await expire(made.id)
    const got = await inT(al).data('POST', `${W}/lock`, { sessionId: TAB1 })
    assert.equal(got.state, 'acquired')
    const late = await inT(cam).call('POST', `${W}/lock`, { sessionId: CAM })
    assert.deepEqual([late.status, late.body.code, late.body.data.lost, late.body.data.lock.by.username], [423, 'canvas.locked', 'expired', 'alan'])
    assert.match(late.body.message, /后台|background/)
    const lateSave = await inT(cam).call('PUT', W, { nodes: [], baseRevision: saved.revision, sessionId: CAM })
    assert.deepEqual([lateSave.status, lateSave.body.data.lost], [423, 'expired'])
    assert.equal((await inT(ann).data('GET', `/api/teams/${team.id}/activity?category=canvas`)).list.filter((e) => e.type === 'canvas:taken_over' && e.target.id === made.id).length, 0)
    // In English too.
    const en = await inT(cam).call('POST', `${W}/lock`, { sessionId: CAM }, { 'X-Locale': 'en' })
    assert.match(en.body.message, /in the background or offline.*alan is editing it now/)
  })

  await t.test('giving the lock back: the session that holds it, or a beacon with that lock\'s release token and no sign-in', async () => {
    const made = await canvas(ann)
    const W = `/api/workflow/${made.id}`
    const held = await inT(al).data('POST', `${W}/lock`, { sessionId: TAB1 })

    // Leaving inside the app: only the session that holds it.
    assert.equal((await inT(al).data('DELETE', `${W}/lock?sessionId=${TAB2}`)).released, false)
    assert.equal((await inT(al).data('DELETE', `${W}/lock`)).released, false)
    assert.equal((await inT(cam).data('DELETE', `${W}/lock?sessionId=${TAB1}`)).released, false)
    assert.equal((await inT(al).data('GET', W)).lock.by.username, 'alan')
    assert.equal((await inT(al).data('DELETE', `${W}/lock?sessionId=${TAB1}`)).released, true)
    assert.equal((await inT(cam).data('GET', W)).lock, null)

    // A page that closes: sendBeacon posts a string (text/plain), with no Authorization header.
    const again = await inT(al).data('POST', `${W}/lock`, { sessionId: TAB1 })
    assert.notEqual(again.lock.releaseToken, held.lock.releaseToken, 'a token is good for one lock')
    for (const bad of [{}, { releaseToken: 'x' }, { releaseToken: held.lock.releaseToken }, { releaseToken: 'A'.repeat(43) }, 'not json', '[]']) {
      assert.deepEqual(await beacon(made.id, bad), { status: 200, body: { result: 0, message: 'ok', data: { released: false } } })
    }
    assert.deepEqual((await beacon('0123456789abcdef01234567', { releaseToken: again.lock.releaseToken })).body.data, { released: false })
    assert.deepEqual((await beacon('nonsense', { releaseToken: again.lock.releaseToken })).body.data, { released: false })
    assert.equal((await inT(cam).data('GET', W)).lock.by.username, 'alan', 'still held after every wrong attempt')
    assert.deepEqual((await beacon(made.id, { releaseToken: again.lock.releaseToken })).body.data, { released: true })
    assert.equal((await inT(cam).data('GET', W)).lock, null)
    assert.deepEqual((await beacon(made.id, { releaseToken: again.lock.releaseToken })).body.data, { released: false }, 'once')

    // As application/json (fetch with keepalive), and a token from a save answer.
    const viaSave = await inT(cam).data('PUT', W, { nodes: [], baseRevision: made.revision, sessionId: CAM })
    assert.deepEqual((await beacon(made.id, { releaseToken: viaSave.lock.releaseToken }, 'application/json')).body.data, { released: true })

    // The token of a lock that changed hands frees nothing.
    const mine = await inT(al).data('POST', `${W}/lock`, { sessionId: TAB1 })
    const theirs = await inT(cam).data('POST', `${W}/lock`, { sessionId: CAM, takeover: true })
    assert.deepEqual((await beacon(made.id, { releaseToken: mine.lock.releaseToken })).body.data, { released: false })
    assert.equal((await inT(al).data('GET', W)).lock.by.username, 'cam')
    assert.deepEqual((await beacon(made.id, { releaseToken: theirs.lock.releaseToken })).body.data, { released: true })

    // Nothing else of /api/workflow became public with it.
    for (const [m, p] of [['POST', `${W}/lock`], ['DELETE', `${W}/lock`], ['GET', W], ['POST', `${W}/lock/release/x`], ['GET', `${W}/lock/release`]]) {
      assert.equal(await h.anon.status(m, p, m === 'GET' || m === 'DELETE' ? undefined : {}), 401, `${m} ${p}`)
    }
  })

  await t.test('two tabs at the same instant: one gets the canvas', async () => {
    const made = await canvas(ann)
    const W = `/api/workflow/${made.id}`
    const race = await Promise.all([TAB1, TAB2, 'tab-three-dddddddd', 'tab-four-eeeeeeeee'].map((s) => inT(al).status('POST', `${W}/lock`, { sessionId: s })))
    assert.deepEqual(race.slice().sort(), [200, 423, 423, 423])
    // And of two takeovers at once, one wins and the other is told so.
    const sessions = ['tab-five-ffffffffff', 'tab-six-gggggggggg']
    const overs = await Promise.all(sessions.map((s) => inT(cam).call('POST', `${W}/lock`, { sessionId: s, takeover: true })))
    assert.ok(overs.some((r) => r.status === 200))
    const stored = await lockOf(made.id)
    assert.equal(stored.by, cam.user.id)
    assert.ok(sessions.includes(stored.session))
  })

  await t.test('a tab in the background: heartbeats a minute apart lose the lock and get it back, a save from it goes through, and its token still frees it', async () => {
    const made = await canvas(ann)
    const W = `/api/workflow/${made.id}`
    const first = await inT(al).data('POST', `${W}/lock`, { sessionId: TAB1 })
    // Three throttled heartbeats in a row, each arriving after the lock ran out: each one carries on.
    for (let i = 0; i < 3; i++) {
      await expire(made.id)
      assert.equal((await inT(cam).data('GET', `${W}/lock`)).lock, null, 'free for others in between')
      const beat = await inT(al).data('POST', `${W}/lock`, { sessionId: TAB1 })
      assert.deepEqual([beat.state, beat.lock.at, beat.lock.releaseToken, beat.revision], ['reacquired', first.lock.at, first.lock.releaseToken, made.revision])
      assert.ok(new Date(beat.lock.expiresAt).getTime() > Date.now() + EDIT_LOCK.TTL_MS - 5000)
    }
    // A run finishes while the tab is hidden and its lock has run out: the auto-save goes through.
    await expire(made.id)
    const saved = await inT(al).data('PUT', W, { nodes: [], baseRevision: made.revision, sessionId: TAB1 })
    assert.deepEqual([saved.revision, saved.lock.mine, saved.lock.releaseToken], [made.revision + 1, true, first.lock.releaseToken])
    // The tab is closed while its lock has run out: the beacon still clears it (nothing is left behind).
    await expire(made.id)
    assert.deepEqual((await beacon(made.id, { releaseToken: first.lock.releaseToken })).body.data, { released: true })
    assert.equal((await lockOf(made.id)).by, '')

    // Somebody else came, edited and left while the tab was away: the tab gets the canvas ("acquired",
    // not "reacquired") and sees from the revision that its copy is old.
    const mine = await inT(al).data('POST', `${W}/lock`, { sessionId: TAB1 })
    await expire(made.id)
    const theirs = await inT(cam).data('PUT', W, { nodes: [{ id: 'c1', type: 'text', position: { x: 0, y: 0 }, data: {} }], baseRevision: saved.revision, sessionId: CAM })
    assert.equal((await inT(cam).data('DELETE', `${W}/lock?sessionId=${CAM}`)).released, true)
    const back = await inT(al).data('POST', `${W}/lock`, { sessionId: TAB1 })
    assert.deepEqual([back.state, back.revision], ['acquired', theirs.revision])
    assert.notEqual(back.revision, mine.revision)
    // And a save made from the old revision is the conflict it should be, lock or no lock.
    assert.deepEqual(await inT(al).refused('PUT', W, { nodes: [], baseRevision: mine.revision, sessionId: TAB1 }), [409, 'canvas.conflict'])
  })

  await t.test('a page that closes with a save still on its way: the save is written and does not take the lock back', async () => {
    const made = await canvas(ann)
    const W = `/api/workflow/${made.id}`
    const node = (id) => ({ id, type: 'text', position: { x: 0, y: 0 }, data: {} })
    const held = await inT(al).data('POST', `${W}/lock`, { sessionId: TAB1 })
    // The beacon overtakes the last auto-save.
    assert.deepEqual((await beacon(made.id, { releaseToken: held.lock.releaseToken })).body.data, { released: true })
    const late = await inT(al).data('PUT', W, { nodes: [node('a')], baseRevision: made.revision, sessionId: TAB1 })
    assert.deepEqual([late.revision, late.lock, late.nodes.length], [made.revision + 1, null, 1], 'written, and the canvas stays free')
    assert.equal((await lockOf(made.id)).by, '')
    assert.equal((await inT(cam).data('GET', `${W}/lock`)).lock, null)
    assert.equal(JSON.stringify(await inT(cam).data('GET', W)).includes(TAB1), false)
    // Only that session, and only for a moment: another tab of the same person saving takes the lock as usual...
    const other = await inT(al).data('PUT', W, { nodes: [node('b')], baseRevision: late.revision, sessionId: TAB2 })
    assert.equal(other.lock.mine, true)
    assert.equal((await inT(al).data('DELETE', `${W}/lock?sessionId=${TAB2}`)).released, true)
    // ...and so does the session that left, once the moment has passed.
    await db.collection('workflows').updateOne({ _id: new ObjectId(made.id) }, { $set: { 'lock.at': new Date(Date.now() - 60000), 'lock.prevSession': TAB1 } })
    const muchLater = await inT(al).data('PUT', W, { nodes: [node('c')], baseRevision: other.revision, sessionId: TAB1 })
    assert.equal(muchLater.lock.mine, true)
    // Opening the canvas again (a lock call) is a new lock like any other.
    assert.equal((await inT(al).data('DELETE', `${W}/lock?sessionId=${TAB1}`)).released, true)
    const again = await inT(al).data('POST', `${W}/lock`, { sessionId: TAB1 })
    assert.deepEqual([again.state, again.lock.mine], ['acquired', true])
    // The same with the two requests truly at once, many times: whichever lands first, the canvas ends up free and saved.
    let rev = muchLater.revision
    for (let i = 0; i < 8; i++) {
      const lock = await inT(al).data('POST', `${W}/lock`, { sessionId: TAB1 })
      const [saved, freed] = await Promise.all([
        inT(al).call('PUT', W, { nodes: [node(`r${i}`)], baseRevision: rev, sessionId: TAB1 }),
        beacon(made.id, { releaseToken: lock.lock.releaseToken }),
      ])
      assert.equal(saved.status, 200, JSON.stringify(saved.body))
      rev = saved.body.data.revision
      assert.equal(freed.body.data.released, true)
      assert.equal((await lockOf(made.id)).by, '', `round ${i}: nobody holds a canvas whose only tab is gone`)
    }
  })

  await t.test('looking without touching: the peek of a read-only editor and the lock list of a canvas list', async () => {
    const made = await canvas(ann, { name: 'Peeked' })
    const hidden = await canvas(ann, { visibility: 'private', name: 'Hidden' })
    const W = `/api/workflow/${made.id}`
    const free = await inT(cam).data('GET', `${W}/lock`)
    assert.deepEqual(free, { lock: null, revision: made.revision, metaRevision: 0, name: 'Peeked', canEdit: true, canTakeOver: true, ttlMs: EDIT_LOCK.TTL_MS, heartbeatMs: EDIT_LOCK.HEARTBEAT_MS, pollMs: EDIT_LOCK.WAIT_POLL_MS })
    assert.equal((await lockOf(made.id)).by, '', 'a look takes nothing')

    const held = await inT(al).data('POST', `${W}/lock`, { sessionId: TAB1 })
    assert.equal(held.pollMs, EDIT_LOCK.WAIT_POLL_MS)
    await inT(ann).data('POST', `/api/workflow/${hidden.id}/lock`, { sessionId: TAB2 })
    await inT(cam).data('PATCH', `${W}/meta`, { name: 'Peeked 2' })
    for (const [c, query, mine, sameUser] of [[cam, '', false, false], [al, '', false, true], [al, `?sessionId=${TAB2}`, false, true], [al, `?sessionId=${TAB1}`, true, true]]) {
      const seen = await inT(c).call('GET', `${W}/lock${query}`)
      assert.deepEqual([seen.body.data.lock.by.username, seen.body.data.lock.mine, seen.body.data.lock.sameUser, seen.body.data.name, seen.body.data.metaRevision], ['alan', mine, sameUser, 'Peeked 2', 1])
      assert.equal(Object.hasOwn(seen.body.data.lock, 'releaseToken'), mine)
      assert.equal(JSON.stringify(seen.body).includes(TAB1), false)
      assert.equal(Object.hasOwn(seen.body.data, 'nodes'), false)
    }
    const before = await lockOf(made.id)
    await inT(cam).data('GET', `${W}/lock`)
    assert.deepEqual(await lockOf(made.id), before, 'a look renews nothing')

    // The list of live locks: only what the caller may see, only live ones, no session ids.
    const forCam = await inT(cam).call('GET', '/api/workflow/locks')
    assert.equal(forCam.body.data.pollMs, EDIT_LOCK.LIST_POLL_MS)
    assert.deepEqual(forCam.body.data.locks.filter((l) => [made.id, hidden.id].includes(l.id)).map((l) => [l.id, l.lock.by.username, l.lock.mine, l.lock.sameUser]), [[made.id, 'alan', false, false]])
    assert.equal(JSON.stringify(forCam.body).includes(TAB1), false)
    assert.equal(JSON.stringify(forCam.body).includes('releaseToken'), false)
    const forAnn = (await inT(ann).data('GET', '/api/workflow/locks')).locks
    assert.deepEqual(forAnn.filter((l) => l.id === hidden.id).map((l) => [l.lock.sameUser, l.lock.mine]), [[true, false]], 'the creator sees her own hidden canvas')
    await expire(made.id)
    assert.equal((await inT(cam).data('GET', '/api/workflow/locks')).locks.some((l) => l.id === made.id), false, 'a lock that ran out is not listed')
    assert.deepEqual(await al.data('GET', '/api/workflow/locks'), { locks: [], pollMs: EDIT_LOCK.LIST_POLL_MS }, 'a personal space has none')
    assert.deepEqual(await al.data('GET', '/api/workflow/locks?since=0'), { locks: [], pollMs: EDIT_LOCK.LIST_POLL_MS }, 'and nobody else whose changes could arrive')

    // Who may look: whoever may see the canvas.
    assert.deepEqual(await inT(al).refused('GET', `/api/workflow/${hidden.id}/lock`), [404, 'canvas.not_found'])
    const shown = await canvas(ann, { visibility: 'team_view' })
    const viewer = await inT(al).data('GET', `/api/workflow/${shown.id}/lock`)
    assert.deepEqual([viewer.canEdit, viewer.canTakeOver, viewer.lock], [false, false, null])
    assert.equal(await h.anon.status('GET', `${W}/lock`), 401)
    assert.equal(await h.anon.status('GET', '/api/workflow/locks'), 401)
  })

  await t.test('the list poll carries what moved since the last answer: renames, new, deleted and restored canvases - and nothing of a private one', async () => {
    const { LIST_CHANGES_MAX } = require('../src/routes/workflow')
    const L = '/api/workflow/locks'
    const poll = (c, since) => inT(c).data('GET', since === undefined ? L : `${L}?since=${encodeURIComponent(since)}`)
    const ids = (list) => list.map((w) => w.id).sort()
    // Changes are counted from two seconds before `since` (a write stamped before an answer and stored after it):
    // wait that out where a test needs "nothing moved".
    const settle = () => new Promise((r) => setTimeout(r, 2100))
    const listOf = (c) => inT(c).data('GET', '/api/workflow/list')
    const countsOf = (list) => ({
      total: list.length,
      private: list.filter((w) => w.visibility === 'private').length,
      team_view: list.filter((w) => w.visibility === 'team_view').length,
      team_edit: list.filter((w) => w.visibility === 'team_edit').length,
    })

    const shared = await canvas(ann, { name: 'Shared board' })
    const secret = await canvas(ann, { name: 'Ann only', visibility: 'private' })
    const others = (list) => list.filter((w) => w.id !== shared.id)
    await settle()

    // Without `since`: nothing itemised, but the clock to come back with and the counts of the caller's own list.
    const first = await poll(cam)
    assert.deepEqual(Object.keys(first).sort(), ['counts', 'locks', 'now', 'pollMs'])
    assert.ok(Math.abs(Date.parse(first.now) - Date.now()) < 5000, String(first.now))
    assert.deepEqual(first.counts, countsOf(await listOf(cam)), 'the counts are those of GET /list for this caller')
    const forOwner = await poll(ann)
    assert.deepEqual(forOwner.counts, countsOf(await listOf(ann)))
    assert.ok(forOwner.counts.private > first.counts.private, 'the owner counts the private canvases a member does not see')

    // Nothing moved: nothing listed.
    const quiet = await poll(cam, first.now)
    assert.deepEqual([quiet.changed, quiet.removed, quiet.reload, quiet.counts], [[], [], undefined, first.counts])

    // A rename - from a list (PATCH meta) or from an editor (PUT with the name) - arrives with the new name and its metaRevision.
    await inT(ann).data('PATCH', `/api/workflow/${shared.id}/meta`, { name: 'Shared board v2' })
    await inT(ann).data('PATCH', `/api/workflow/${secret.id}/meta`, { name: 'Ann only v2' })
    const afterRename = await poll(cam, quiet.now)
    assert.deepEqual(afterRename.changed.map((w) => [w.id, w.name, w.metaRevision, w.revision]), [[shared.id, 'Shared board v2', 1, shared.revision]], 'the rename of a canvas cam may see, and not the private one')
    assert.deepEqual(afterRename.removed, [])
    assert.deepEqual(afterRename.changed[0], (await listOf(cam)).find((w) => w.id === shared.id), 'a changed canvas is the row GET /list gives')
    assert.equal(Object.hasOwn(afterRename.changed[0], 'nodes'), false)
    assert.equal(JSON.stringify(afterRename).includes('Ann only'), false, 'nothing of a private canvas leaves: not its name')
    assert.equal(JSON.stringify(afterRename).includes(secret.id), false, 'and not its id')
    assert.deepEqual(ids((await poll(ann, quiet.now)).changed), ids([shared, secret]), 'its creator is told about both')
    await inT(al).data('PUT', `/api/workflow/${shared.id}`, { name: 'Shared board v3' })
    const v3 = await poll(cam, afterRename.now)
    assert.deepEqual(v3.changed.map((w) => [w.name, w.metaRevision]), [['Shared board v3', 2]])

    // The time may come back as it was given (ISO) or as milliseconds; anything else is refused.
    assert.deepEqual((await poll(cam, Date.parse(afterRename.now))).changed.map((w) => w.id), [shared.id])
    assert.deepEqual(await inT(cam).refused('GET', `${L}?since=yesterday`), [400, 'validation.invalid'])

    // Looking around (the viewport) and the edit lock are not changes of the list.
    await inT(al).data('PUT', `/api/workflow/${shared.id}`, { viewport: { x: 3, y: 4, zoom: 1 } })
    await inT(al).data('POST', `/api/workflow/${shared.id}/lock`, { sessionId: TAB1 })
    const looked = await poll(cam, afterRename.now)
    assert.deepEqual(looked.changed.map((w) => [w.id, w.updatedAt]), [[shared.id, v3.changed[0].updatedAt]], 'updatedAt did not move')
    assert.deepEqual(looked.locks.filter((l) => l.id === shared.id).map((l) => l.lock.by.username), ['alan'], 'who is editing travels in `locks`, as before')
    // A content save is one: the card's "last edited" moves.
    const saved = await inT(al).data('PUT', `/api/workflow/${shared.id}`, { nodes: [], baseRevision: shared.revision, sessionId: TAB1 })
    const afterSave = await poll(cam, afterRename.now)
    assert.deepEqual(afterSave.changed.map((w) => [w.id, w.revision, w.lastEditedBy.username, w.lock.by.username]), [[shared.id, saved.revision, 'alan', 'alan']])
    await inT(al).data('DELETE', `/api/workflow/${shared.id}/lock?sessionId=${TAB1}`)

    // New, deleted, restored. (`shared` may still be inside the two seconds: it is left out of these looks.)
    const base = await poll(cam, afterSave.now)
    const fresh = await canvas(al, { name: 'Fresh' })
    const draft = await canvas(ann, { name: 'Ann draft', visibility: 'private' })
    const created = await poll(cam, base.now)
    assert.deepEqual(others(created.changed).map((w) => [w.id, w.name]), [[fresh.id, 'Fresh']], 'the new canvas, and not the private one')
    assert.equal(created.counts.total, base.counts.total + 1)
    await inT(ann).data('DELETE', `/api/workflow/${fresh.id}`)
    await inT(ann).data('DELETE', `/api/workflow/${draft.id}`)
    const deleted = await poll(cam, created.now)
    assert.deepEqual([others(deleted.changed), deleted.removed, deleted.counts.total], [[], [fresh.id], base.counts.total], 'the deleted canvas by its id; a private one that was deleted is not named to others')
    assert.deepEqual([...(await poll(ann, created.now)).removed].sort(), [fresh.id, draft.id].sort())
    await inT(ann).data('POST', `/api/workflow/${fresh.id}/restore`)
    const restored = await poll(cam, deleted.now)
    assert.deepEqual([others(restored.changed).map((w) => w.id), restored.removed, restored.counts.total], [[fresh.id], [], base.counts.total + 1], 'back on the list')

    // A change of visibility is not itemised - a canvas that became private must not be named to those who lost it.
    // The counts say that the list is no longer the one the client has.
    await inT(ann).data('PATCH', `/api/workflow/${shared.id}/access`, { visibility: 'private' })
    const hiddenNow = await poll(cam, restored.now)
    assert.equal(JSON.stringify(hiddenNow).includes(shared.id), false)
    assert.deepEqual([hiddenNow.counts.total, hiddenNow.counts.team_edit], [restored.counts.total - 1, restored.counts.team_edit - 1])
    await inT(ann).data('PATCH', `/api/workflow/${shared.id}/access`, { visibility: 'team_view' })
    const shownAgain = await poll(cam, hiddenNow.now)
    assert.deepEqual([shownAgain.counts.total, shownAgain.counts.team_view, shownAgain.counts.team_edit], [restored.counts.total, restored.counts.team_view + 1, restored.counts.team_edit - 1])

    // Bounded: past the cap nothing is itemised and the client is told to load the list again.
    for (let i = 0; i <= LIST_CHANGES_MAX; i += 1) await canvas(ann, { name: `Bulk ${i}` })
    const flood = await poll(cam, shownAgain.now)
    assert.deepEqual([flood.reload, flood.changed, flood.removed], [true, undefined, undefined])
    assert.deepEqual(flood.counts, countsOf(await listOf(cam)))
    // The two seconds before `since` still hold the flood; once `since` has moved past them the answers are itemised again.
    await settle()
    const calm = await poll(cam, (await poll(cam, flood.now)).now)
    assert.deepEqual([calm.reload, calm.changed, calm.removed], [undefined, [], []])
  })

  await t.test('the public release endpoint does not let an anonymous caller keep the database busy', async () => {
    const { RELEASE_LIMIT, resetReleaseLimit } = require('../src/routes/workflow')
    const made = await canvas(ann)
    const held = await inT(al).data('POST', `/api/workflow/${made.id}/lock`, { sessionId: TAB1 })
    resetReleaseLimit()
    const junk = { releaseToken: 'B'.repeat(43) }
    for (let i = 0; i < RELEASE_LIMIT.max; i += 20) await Promise.all(Array.from({ length: 20 }, () => beacon(made.id, junk)))
    // Past the limit even the right token is not looked at; the answer is the same as for any miss.
    assert.deepEqual(await beacon(made.id, { releaseToken: held.lock.releaseToken }), { status: 200, body: { result: 0, message: 'ok', data: { released: false } } })
    assert.equal((await lockOf(made.id)).by, al.user.id)
    resetReleaseLimit()
    assert.deepEqual((await beacon(made.id, { releaseToken: held.lock.releaseToken })).body.data, { released: true })
    // A body larger than a token could ever be is refused before it is read in full.
    const big = await fetch(`${h.base}/api/workflow/${made.id}/lock/release`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x'.repeat(5000) })
    assert.equal(big.status, 413)
  })
})
