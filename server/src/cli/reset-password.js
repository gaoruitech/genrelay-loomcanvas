#!/usr/bin/env node
'use strict'

/**
 * Forgotten password, for whoever runs the server (there is no email):
 *
 *   node server/src/cli/reset-password.js <username-or-email>
 *
 * Gives the account a random temporary password, prints it once and signs the
 * account out everywhere; at the next sign-in the account has to choose its
 * own password. This is also how the administrator gets back in (the ADMIN_*
 * variables are only read when that account is created). Uses the same
 * configuration as the server (server/.env or the environment); the server
 * may keep running.
 */
const mongoose = require('mongoose')

async function main() {
  const account = process.argv[2]
  if (!account || process.argv.length > 3 || account.startsWith('-')) {
    console.error('Usage: node server/src/cli/reset-password.js <username-or-email>')
    return 2
  }
  const { getConfig } = require('../config')
  const config = getConfig()
  mongoose.set('strictQuery', true)
  await mongoose.connect(config.mongodbUri, { serverSelectionTimeoutMS: 10000 })
  try {
    const accounts = require('../services/accounts')
    const user = await accounts.findByAccount(account)
    if (!user) {
      console.error(`No account with the username or email "${account}".`)
      return 1
    }
    const password = await accounts.resetPassword(user._id)
    console.log(`Account:            ${user.username}${user.email ? ` <${user.email}>` : ''}${user.disabled ? '  (disabled - the administrator has to enable it before it can sign in)' : ''}`)
    console.log(`Temporary password: ${password}`)
    console.log('All sessions of this account were signed out. Sign in with the temporary password: you will be asked to choose a new one before anything else.')
    return 0
  } finally {
    await mongoose.disconnect()
  }
}

main().then((code) => process.exit(code), (err) => {
  console.error(err && err.message ? err.message : err)
  process.exit(1)
})
