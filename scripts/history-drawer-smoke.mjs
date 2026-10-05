// Run against the isolated Strapi 5 lab after build/refresh/start; never a production database.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
const baseURL = `http://127.0.0.1:${process.env.SMOKE_PORT || 1445}`
const access = JSON.parse(readFileSync('.local/strapi5/lab-access.json'))
let token = ''
const api = async (method, path, body) => {
  const res = await fetch(baseURL + path, { method, headers: { ...(token && { Authorization: `Bearer ${token}` }), ...(body && { 'Content-Type': 'application/json' }) }, body: body && JSON.stringify(body) })
  const data = await res.json()
  assert.ok(res.ok, `${method} ${path}: ${res.status}`)
  return data
}
for (let attempt = 0; attempt < 40; attempt++) {
  if (await fetch(baseURL + '/admin/init').then(res => res.ok).catch(() => false)) break
  await new Promise(resolve => setTimeout(resolve, 500))
}
const login = await api('POST', '/admin/login', access)
token = login.data.token
const savedSettings = (await api('GET', '/blockscene/settings')).settings
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ baseURL, viewport: { width: 1600, height: 1000 } })
const page = await context.newPage()
const errors = [], checks = []
page.on('pageerror', error => errors.push(error.message))
page.on('dialog', dialog => dialog.accept())
const check = async (name, run) => { await run(); checks.push(name); console.log(`ok ${name}`) }
const docPath = '/content-manager/collection-types/api::page.page'
const payload = body => ({ title: 'History drawer smoke', blocks: [{ __component: 'blocks.text', body }], sidebar: [] })
let documentId
try {
  await api('PUT', '/blockscene/settings', { ...savedSettings, history: { ...savedSettings.history, enabled: true },
    editor: { ...savedSettings.editor, enabled: true, previewMode: 'split', previewUrl: baseURL + '/block-preview/index.html', previewToolbar: ['modes', 'history', 'versions', 'devices', 'status', 'actions'] } })
  const created = await api('POST', docPath, payload('Version 0'))
  documentId = created.data?.documentId || created.documentId
  assert.ok(documentId)
  // Many metadata rows are cheap; captured snapshots also exercise deduplication and retention availability.
  for (let i = 1; i <= 102; i++) await api('PUT', `${docPath}/${documentId}`, payload(`Version ${i}`))
  const endpoint = `/blockscene/history/api::page.page/${documentId}`
  const listed = await api('GET', endpoint)
  await check('server list has real pagination, capture counts and scoped actors beyond 100', async () => {
    assert.equal(listed.results.length, 25); assert.equal(listed.pagination.total, 103)
    assert.equal(listed.results[0].summary.blocks.total, 1)
    assert.equal((await api('GET', endpoint + '?page=5')).results.length, 3)
    assert.equal(listed.actors.length, 1)
  })
  await page.addInitScript(({ token, user }) => {
    localStorage.setItem('jwtToken', JSON.stringify(token)); localStorage.setItem('isLoggedIn', 'true'); localStorage.setItem('userInfo', JSON.stringify(user)); localStorage.setItem('strapi-admin-language', 'en')
  }, { token, user: login.data.user })
  const docUrl = `/admin${docPath}/${documentId}`
  await page.goto(docUrl)
  await page.getByTestId('versions-toggle').waitFor()
  const draftTitle = page.getByRole('textbox', { name: /^title/i }).first()
  await draftTitle.fill('UNSAVED draft title')
  await page.getByTestId('versions-toggle').click()
  const drawer = page.getByTestId('versions-drawer'), pane = page.getByTestId('page-preview-pane')
  const frame = pane.frameLocator('iframe')
  const [b, a] = listed.results
  await drawer.getByTestId(`version-${a.id}`).waitFor()
  await check('right drawer, keyboard close and focus return', async () => {
    const bounds = await drawer.boundingBox(), paneBounds = await pane.boundingBox()
    assert.ok(Math.abs(bounds.x + bounds.width - paneBounds.x - paneBounds.width) < 2)
    assert.equal(await drawer.getByRole('heading', { level: 2 }).innerText(), 'History')
    await page.keyboard.press('Escape'); await drawer.waitFor({ state: 'detached' })
    assert.equal(await page.getByTestId('versions-toggle').evaluate(el => el === document.activeElement), true)
    await page.getByTestId('versions-toggle').click()
  })
  let releaseA
  const delayed = new Promise(resolve => { releaseA = resolve })
  await page.route(`**/blockscene/history-events/${a.id}`, async route => { await delayed; await route.continue() })
  await check('A then B: slow response cannot replace the newer selection; readonly bridge has no edit controls', async () => {
    await drawer.getByTestId(`version-${a.id}`).click()
    await drawer.getByTestId(`version-${b.id}`).click()
    await frame.getByText('Version 102', { exact: true }).waitFor()
    releaseA()
    await page.waitForResponse(res => res.url().endsWith(`/history-events/${a.id}`))
    assert.equal(await drawer.getByTestId(`version-${b.id}`).getAttribute('aria-pressed'), 'true')
    assert.equal(await frame.locator('[contenteditable], .bp-tools, .bp-insert').count(), 0)
    assert.match(await page.getByTestId('versions-banner').innerText(), /read-only/)
  })
  const writes = []
  const onWrite = request => { if (request.url().includes('/content-manager/') && ['POST', 'PUT', 'DELETE'].includes(request.method())) writes.push(request.url()) }
  page.on('request', onWrite)
  await check('malicious/legacy mutation and focus messages cannot touch the live form', async () => {
    const editingFrame = page.frames().find(f => f.url().includes('/block-preview/'))
    await editingFrame.evaluate(() => {
      const channel = new URLSearchParams(location.search).get('channel')
      const key = document.querySelector('[data-block-key]').dataset.blockKey
      for (const type of ['edit', 'focus', 'select', 'hover', 'media', 'media-remove', 'insert', 'paste', 'insert-group', 'move-group', 'delete-group'])
        parent.postMessage({ protocol: 'blockscene:page-preview:v1', channel, type, key, field: 'body', value: 'BAD', direction: 'up', uid: 'group.section', after: null }, location.origin)
    })
    await page.waitForTimeout(150)
    assert.equal(await draftTitle.inputValue(), 'UNSAVED draft title')
    assert.equal(await page.getByTestId('block-modal-bar').count(), 0)
    assert.equal(await page.getByRole('dialog').count(), 0)
    assert.deepEqual(writes, [])
  })
  await page.getByRole('button', { name: 'Back to current draft' }).click()
  await frame.getByText('Version 102', { exact: true }).waitFor()
  assert.equal(await draftTitle.inputValue(), 'UNSAVED draft title')
  await check('server pagination and actor filter work in the drawer', async () => {
    await drawer.getByRole('button', { name: 'Next', exact: true }).click()
    await drawer.getByText('Page 2 of 5', { exact: true }).waitFor()
    await drawer.getByRole('combobox').click()
    await page.getByRole('option', { name: 'Local Tester', exact: true }).click()
    await drawer.getByText('Page 1 of 5', { exact: true }).waitFor()
    assert.match(await drawer.innerText(), /1 blocks/)
  })
  await drawer.getByTestId(`version-${b.id}`).click()
  await frame.getByText('Version 102', { exact: true }).waitFor()
  await page.screenshot({ path: 'artifacts/history-drawer.png', fullPage: true })
  await check('pending snapshot abandoned by returning to current does not arrive later', async () => {
    let release
    const wait = new Promise(resolve => { release = resolve })
    await page.route(`**/blockscene/history-events/${b.id}`, async route => { await wait; await route.continue() })
    await drawer.getByTestId(`version-${b.id}`).click()
    await page.getByRole('button', { name: 'Back to current draft' }).click()
    release()
    await page.waitForResponse(res => res.url().endsWith(`/history-events/${b.id}`))
    assert.equal(await page.getByTestId('versions-banner').count(), 0)
    assert.equal(await draftTitle.inputValue(), 'UNSAVED draft title')
  })
  await check('locale navigation clears historical preview and makes a new scoped list request', async () => {
    await page.unroute(`**/blockscene/history-events/${a.id}`)
    let release
    const wait = new Promise(resolve => { release = resolve })
    await page.route(`**/blockscene/history-events/${a.id}`, async route => { await wait; await route.continue() })
    const requested = page.waitForRequest(request => request.url().endsWith(`/history-events/${a.id}`))
    await drawer.getByTestId(`version-${a.id}`).click()
    await requested
    const completed = Promise.race([
      page.waitForResponse(res => res.url().endsWith(`/history-events/${a.id}`)),
      page.waitForEvent('requestfailed', { predicate: request => request.url().endsWith(`/history-events/${a.id}`) }),
    ])
    const scoped = page.waitForRequest(request => request.url().includes(`/blockscene/history/api%3A%3Apage.page/${documentId}`) && request.url().includes('locale=fr'))
    await page.evaluate(() => { history.pushState({}, '', location.pathname + '?plugins[i18n][locale]=fr'); dispatchEvent(new PopStateEvent('popstate')) })
    await scoped
    release()
    await completed
    assert.equal(await page.getByTestId('versions-banner').count(), 0)
  })
  await check('disabled history has a clear explanation and does not request versions', async () => {
    await api('PUT', '/blockscene/settings', { ...savedSettings, history: { ...savedSettings.history, enabled: false }, editor: { ...savedSettings.editor, enabled: true, previewMode: 'split', previewUrl: baseURL + '/block-preview/index.html', previewToolbar: ['modes', 'history', 'versions', 'devices', 'status', 'actions'] } })
    await page.goto(docUrl); await page.getByTestId('versions-toggle').click()
    await drawer.getByText(/History is not enabled/).waitFor()
    assert.equal(await drawer.locator('[data-testid^="version-"]').count(), 0)
  })
  await check('missing history permission is distinct from disabled history and sends no history request', async () => {
    await api('PUT', '/blockscene/settings', { ...savedSettings, history: { ...savedSettings.history, enabled: true }, editor: { ...savedSettings.editor, enabled: true, previewMode: 'split', previewUrl: baseURL + '/block-preview/index.html', previewToolbar: ['modes', 'versions'] } })
    await page.route('**/admin/users/me/permissions', async route => {
      const response = await route.fetch(), json = await response.json()
      json.data = json.data.filter(permission => permission.action !== 'plugin::blockscene.history.read')
      await route.fulfill({ response, json })
    })
    const requested = []
    const observe = request => { if (/\/blockscene\/history(?:\/|-events\/)/.test(request.url())) requested.push(request.url()) }
    page.on('request', observe)
    await page.goto(docUrl); await page.getByTestId('versions-toggle').click()
    await drawer.getByText(/Ask an administrator to grant/).waitFor()
    assert.deepEqual(requested, [])
    page.off('request', observe)
  })
  await check('dark theme keeps semantic counts plus text labels', async () => {
    await page.unroute('**/admin/users/me/permissions')
    await page.evaluate(() => localStorage.setItem('STRAPI_THEME', 'dark'))
    await page.goto(docUrl); await page.getByTestId('versions-toggle').click()
    const entry = drawer.getByTestId(`version-${b.id}`)
    await entry.getByText('~1 Changed', { exact: true }).waitFor()
    assert.notEqual(await drawer.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)')
    const colors = await Promise.all(['+0 Added', '−0 Removed', '~1 Changed'].map(label => entry.getByText(label, { exact: true }).evaluate(el => getComputedStyle(el).color)))
    assert.equal(new Set(colors).size, 3)
    await entry.click(); await frame.getByText('Version 102', { exact: true }).waitFor()
    await page.screenshot({ path: 'artifacts/history-drawer-dark.png', fullPage: true })
  })
  await check('legacy bridge renders the snapshot with interaction disabled', async () => {
    await page.route('**/block-preview/preview.js', async route => {
      const response = await route.fetch()
      await route.fulfill({ response, body: (await response.text()).replaceAll("capabilities: ['readOnly']", "capabilities: []") })
    })
    await page.goto(docUrl); await page.getByTestId('versions-toggle').click()
    await drawer.getByTestId(`version-${b.id}`).click()
    await frame.getByText('Version 102', { exact: true }).waitFor()
    await pane.getByText(/does not support read-only browsing/).waitFor()
    assert.equal(await pane.locator('iframe').evaluate(el => getComputedStyle(el).pointerEvents), 'none')
    assert.equal(await pane.locator('iframe').getAttribute('inert'), '')
  })
  assert.deepEqual(errors, [], 'no runtime errors')
} finally {
  await api('PUT', '/blockscene/settings', savedSettings)
  if (documentId) await api('DELETE', `${docPath}/${documentId}`)
  mkdirSync('artifacts', { recursive: true })
  writeFileSync('artifacts/history-drawer-smoke.json', JSON.stringify({ checks, errors }, null, 2))
  await browser.close()
}
