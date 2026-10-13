'use strict'

/**
 * Before accounts existed every document was owned by this constant. Documents
 * that still carry it are handed to the super admin when that account is
 * created at start-up, see services/accounts.js.
 */
const LEGACY_USER = 'local'

/** Owner of what belongs to the site rather than to an account (built-in templates). */
const SYSTEM_USER = 'system'

const ROLES = Object.freeze({ OWNER: 'owner', USER: 'user' })

const RUN_STATUS = Object.freeze({
  QUEUED: 'queued',
  RUNNING: 'running',
  ARCHIVING: 'archiving',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  CANCELED: 'canceled',
})

/**
 * Roles inside a team. The team's owner (`owner`) is whoever Team.ownerId names; the
 * member rows only tell admins from plain members. Not to be confused with
 * ROLES above, which is the role of an account on the site.
 */
const TEAM_ROLES = Object.freeze({ OWNER: 'owner', ADMIN: 'admin', MEMBER: 'member' })

/** Who else in the team may see or edit a team canvas. Personal canvases carry none. */
const VISIBILITY = Object.freeze({ PRIVATE: 'private', TEAM_VIEW: 'team_view', TEAM_EDIT: 'team_edit' })

const RUN_KINDS = Object.freeze(['image', 'video', 'chat'])

/**
 * The edit lock of a team canvas (routes/workflow.js). One editing session - one browser
 * tab - holds it at a time.
 *
 *  - HEARTBEAT_MS: how often the editor renews it. 12 s.
 *  - TTL_MS: how long it lives past its last renewal. 36 s = three heartbeats, so two
 *    renewals in a row may be lost (a slow network, a laptop waking up) before the canvas
 *    is given to somebody else, and a tab that died without saying so (a crash, a lost
 *    connection) keeps others waiting for 36 s at most. A tab that is closed or navigates
 *    away says so (the release beacon) and frees the canvas at once.
 *
 * A background tab and these numbers. Browsers throttle the timers of a hidden tab: to
 * one run a second at once (Chrome, Firefox, Safari) - which a 12 s heartbeat does not
 * notice - and, in Chrome, to one run a MINUTE once the tab has been hidden for five
 * minutes. A minute is longer than TTL_MS, and that is on purpose: a tab nobody has looked
 * at for five minutes does not keep a canvas from the people who are looking. So:
 *
 *  - hidden for less than five minutes: the heartbeat keeps arriving, the lock stays;
 *  - hidden for longer: the lock runs out between two heartbeats. If nobody else wants the
 *    canvas, the next (late) heartbeat, or the one the editor sends the moment the tab is
 *    shown again, simply gets it back (`state: "reacquired"`, same lock, same release
 *    token); if somebody started editing meanwhile, that heartbeat is answered 423 with
 *    `lost: "expired"` and the tab turns read-only. Nothing is lost either way: the editor
 *    saves what is unsaved the moment its tab is hidden.
 *
 * What the people who wait are told to do:
 *
 *  - WAIT_POLL_MS: how often a read-only editor looks whether the canvas became free
 *    (GET /:id/lock), while its tab is visible. 5 s: after a closed tab's beacon the offer
 *    to start editing appears within 5 s, after a dead tab within TTL_MS + 5 s.
 *  - LIST_POLL_MS: how often a canvas list refreshes "who is editing" (GET /locks) while
 *    it is visible. 10 s.
 *
 * Clients do not hard-code these: every lock answer carries `ttlMs`, `heartbeatMs` and `pollMs`.
 */
const EDIT_LOCK = Object.freeze({ TTL_MS: 36 * 1000, HEARTBEAT_MS: 12 * 1000, WAIT_POLL_MS: 5 * 1000, LIST_POLL_MS: 10 * 1000 })

function envInt(name, dft, min, max) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return dft
  const n = Number(raw)
  return Number.isInteger(n) && n >= min && n <= max ? n : dft
}

/**
 * Monthly limits of a team (services/budget.js).
 *
 *  - NEAR_RATIO: from this share of a limit on, its state reads `near` instead of `ok`.
 *  - CHAT_RESERVE_*: what a chat run priced per token holds of a money limit while it is in
 *    flight - its real cost is known only when it is done. The reserve is the price of the
 *    input as estimated from what is sent (one token per character, a flat number per
 *    picture and per video) plus the price of CHAT_RESERVE_OUTPUT_TOKENS output tokens
 *    (the model's own `maxOutputTokens` when its spec states one). On completion the
 *    reserve is replaced by the cost worked out from the reported usage.
 *    BUDGET_CHAT_RESERVE_OUTPUT_TOKENS in the environment changes the default of 8192.
 *  - PENDING_MS: how long a reservation whose run record has not appeared yet is believed
 *    when a counter is rebuilt (the record is written milliseconds after the reservation).
 *  - STUCK_MS: a finished run that still holds its reservation after this long was left
 *    behind by a process that died in between; the next rebuild gives it back.
 *  - VERIFY_MS: before a run is refused at a limit, the counter is compared with the run
 *    records (and rebuilt when the two disagree) - at most this often per team and process.
 */
const BUDGET = Object.freeze({
  NEAR_RATIO: 0.8,
  CHAT_RESERVE_OUTPUT_TOKENS: envInt('BUDGET_CHAT_RESERVE_OUTPUT_TOKENS', 8192, 1, 1000000),
  CHAT_RESERVE_TOKENS_PER_CHAR: 1,
  CHAT_RESERVE_TOKENS_PER_IMAGE: 1500,
  CHAT_RESERVE_TOKENS_PER_VIDEO: 20000,
  PENDING_MS: 60 * 1000,
  STUCK_MS: 60 * 1000,
  VERIFY_MS: 30 * 1000,
})

module.exports = { LEGACY_USER, SYSTEM_USER, ROLES, TEAM_ROLES, VISIBILITY, RUN_STATUS, RUN_KINDS, EDIT_LOCK, BUDGET }
