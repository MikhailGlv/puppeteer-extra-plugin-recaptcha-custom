import test from 'ava'

import RecaptchaPlugin from './index'
import * as types from './types'

const PUPPETEER_ARGS = ['--no-sandbox', '--disable-setuid-sandbox']

test('will detect captchas', async t => {
  const puppeteer = require('puppeteer-extra')
  const recaptchaPlugin = RecaptchaPlugin()
  puppeteer.use(recaptchaPlugin)

  const browser = await puppeteer.launch({
    args: PUPPETEER_ARGS,
    headless: true
  })
  const page: types.Page = (await browser.pages())[0]

  const url = 'https://www.google.com/recaptcha/api2/demo'
  await page.goto(url, { waitUntil: 'networkidle0' })

  const { captchas, error } = await page.findRecaptchas()
  t.is(error, null)
  t.is(captchas.length, 1)

  const c = captchas[0]
  t.is(c.callback, 'onSuccess')
  t.is(c.hasResponseElement, true)
  t.is(c.responseElementContent, '')
  t.is(c.url, url)
  t.true(c.sitekey && c.sitekey.length > 5)

  await browser.close()
})

// TODO: test/mock the rest
