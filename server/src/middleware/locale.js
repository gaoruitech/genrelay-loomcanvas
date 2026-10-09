'use strict'

/** Sets req.locale, the language every message of this request is rendered in. */
const settings = require('../services/settings')
const { resolveLocale } = require('../i18n')

function locale(req, _res, next) {
  req.locale = resolveLocale(req.headers, settings.get('defaultLocale'))
  next()
}

module.exports = { locale }
