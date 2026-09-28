import { chromium } from 'playwright'
import { readFileSync, mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
const major = Number(process.argv[2])
assert.ok([4, 5].includes(major), 'Pass 4 or 5')
const baseURL = `http://127.0.0.1:${major === 4 ? 1444 : 1445}`
const access = JSON.parse(readFileSync(`.local/strapi${major}/lab-access.json`))
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
// Unsaved-changes prompts on navigation are accepted: every step navigates on purpose.
page.on('dialog', dialog => dialog.accept())
const errors = []
const checks = []
page.on('pageerror', error => errors.push((error.stack || error.message).split('\n').slice(0, 4).join(' | ')))
// Console errors and warnings are recorded, not asserted: Strapi itself logs some. Read the report for ours.
const consoleMessages = new Set()
page.on('console', message => { if (['error', 'warning'].includes(message.type())) consoleMessages.add(`${message.type()}: ${message.text().split('\n')[0].slice(0, 300)}`) })
mkdirSync('artifacts', { recursive: true })
const shot = name => page.screenshot({ path: `artifacts/strapi${major}-${name}.png`, fullPage: true, animations: 'disabled' })
const step = async (name, fn) => { await fn(); checks.push(name); console.log(`  ok ${name}`) }
// API helpers reuse the lab login in memory; nothing is written to disk.
let token = ''
const api = async (method, path, body, auth = true) => {
  const res = await fetch(`${baseURL}${path}`, { method, headers: { ...(auth && token ? { Authorization: `Bearer ${token}` } : {}), ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined })
  return { status: res.status, data: await res.json().catch(() => null) }
}
const putSettings = async patch => { const { status, data } = await api('PUT', '/blockscene/settings', patch); assert.equal(status, 200, JSON.stringify(data)); return data }
const previewFile = `.local/strapi${major}/public/block-previews/blocks.text.webp`
// First aria-expanded button per <li> is the block header; nested repeatables have their own.
// Functions (not strings) so Strapi 4's CSP without unsafe-eval accepts them.
const states = () => [...document.querySelectorAll('ol[aria-describedby] > li')].map(li => li.querySelector('button[aria-expanded]')).filter(Boolean).map(b => b.getAttribute('aria-expanded'))
const expanded = () => page.evaluate(states)
const waitOpenCount = count => page.waitForFunction(count => [...document.querySelectorAll('ol[aria-describedby] > li')].map(li => li.querySelector('button[aria-expanded]')).filter(Boolean).filter(b => b.getAttribute('aria-expanded') === 'true').length === count, count)
const firstHeader = () => page.locator('ol[aria-describedby] > li').first().locator('button[aria-expanded]').first()
const rows = () => page.locator('ol[aria-describedby] > li')
// The gallery opens from the zone's native "Add a component to <zone>" button once the plugin is mounted (its capture
// listener must be in place, or Strapi's own picker opens).
const openGallery = async (zone = 'blocks') => {
  await page.locator('[data-blockscene-editor]').waitFor({ state: 'attached' })
  await page.getByRole('button', { name: new RegExp(`Add a component to ${zone}`, "i") }).click()
}
// The zone bar: one Expand all / Collapse all toggle, the "…" menu (select, paste) and, on Strapi 5, the mode menu.
const toggle = (zone = 'blocks') => page.getByTestId(`zone-toggle-${zone}`)
const zoneMenu = async (zone = 'blocks') => { await page.getByTestId(`zone-more-${zone}`).getByRole('button').click() }
const setMode = async (label) => {
  await page.getByTestId('zone-mode-menu').getByRole('button').click()
  await page.getByRole('menuitem', { name: label, exact: true }).click()
}
let uploadId = null
try {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await fetch(`${baseURL}/admin/init`).then(r => r.ok).catch(() => false)) break
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  const login = await api('POST', '/admin/login', { email: access.email, password: access.password }, false)
  token = login.data?.data?.token; assert.ok(token, 'API login')
  await step('settings endpoints reject anonymous requests', async () => {
    assert.equal((await api('GET', '/blockscene/settings', null, false)).status, 401)
    assert.equal((await api('PUT', '/blockscene/settings', { palette: { accent: '#000000' } }, false)).status, 401)
    assert.equal((await api('GET', '/blockscene/catalog', null, false)).status, 401)
  })
  await step('settings validation rejects bad payloads over HTTP', async () => {
    for (const bad of [{ palette: { accent: 'red' } }, { components: { 'blocks.nope': { template: 'generic' } } }, { components: { 'blocks.text': { mediaId: 999999 } } }, { components: { 'blocks.text': { template: 'fancy' } } }])
      assert.equal((await api('PUT', '/blockscene/settings', bad)).status, 400, JSON.stringify(bad))
  })
  await putSettings({}) // reset to defaults
  assert.equal((await api('PUT', '/blockscene/me/prefs', { starred: [], recent: [] })).status, 200, 'reset gallery prefs')
  assert.equal((await api('GET', '/blockscene/me/prefs', null, false)).status, 401)
  assert.equal((await api('PUT', '/blockscene/me/prefs', { starred: ['blocks.nope'] })).status, 400)
  rmSync(previewFile, { force: true })

  // Reuse the API session in the browser (avoids the login rate limiter on reruns; nothing is persisted to disk).
  await page.addInitScript(({ token, user }) => {
    if (!localStorage.getItem('jwtToken')) { localStorage.setItem('jwtToken', JSON.stringify(token)); localStorage.setItem('isLoggedIn', 'true'); localStorage.setItem('userInfo', JSON.stringify(user)) }
  }, { token, user: login.data.data.user })
  await page.goto('/admin/content-manager/collection-types/api::page.page/create')
  await page.getByRole('textbox', { name: /^title/i }).first().fill(`Plugin smoke ${Date.now()}`)
  await step('the native "Add a component to blocks" button opens the gallery', async () => {
    await page.getByRole('button', { name: /Add a component to blocks/i }).click()
    await page.getByTestId('blockscene-blocks.hero').waitFor()
    assert.equal(await page.getByText(/Pick one component/i).count(), 0, 'native category picker stays closed')
    await page.keyboard.press('Escape'); await page.getByTestId('blockscene-blocks.hero').waitFor({ state: 'detached' })
  })
  // Strapi 5 lab: the magnified block loads a plain page per block (the lab's static page stands in for a fixtures route).
  if (major === 5) await putSettings({ editor: { blockPreviewUrl: `${baseURL}/block-preview/index.html` } })
  await openGallery()
  await page.getByTestId('blockscene-blocks.hero').waitFor()
  await step('configured image is used and the missing automatic image falls back to a wireframe', async () => {
    await page.getByTestId('blockscene-blocks.hero').locator('[data-thumb="0"] img').waitFor()
    await page.getByTestId('blockscene-blocks.text').locator('[data-thumb="wireframe"] svg[data-wireframe="generic"]').waitFor()
  })
  await shot('gallery')
  await step('gallery header: count, typology sections, field list toggle, columns slider', async () => {
    const count = page.getByTestId('block-count-blocks'); await count.waitFor()
    assert.match(await count.textContent(), /^\d+ blocks$/, 'total count before filtering')
    await page.locator('[data-testid^="block-group-"]').first().waitFor()
    await page.getByTestId('blockscene-blocks.hero').getByTestId('block-fields').waitFor()
    const fieldsToggle = page.getByRole('dialog').getByRole('switch', { name: 'Fields' })
    await fieldsToggle.click()
    assert.equal(await page.getByTestId('blockscene-blocks.hero').getByTestId('block-fields').count(), 0, 'field list hidden by the toggle')
    await fieldsToggle.click(); await page.getByTestId('blockscene-blocks.hero').getByTestId('block-fields').waitFor()
    const slider = page.locator('input[type="range"][aria-labelledby="block-columns-blocks"]')
    await slider.fill('1'); assert.equal(await page.locator('[data-testid^="block-group-"] + div').first().evaluate(el => getComputedStyle(el).columnCount), '1')
    await slider.fill('3')
  })
  await step('gallery browser: sidebar typology, filter menu with chips, search, star, collapsed sidebar, magnified block', async () => {
    const count = page.getByTestId('block-count-blocks')
    const hero = page.getByTestId('blockscene-blocks.hero'), text = page.getByTestId('blockscene-blocks.text')
    // Sidebar: All, Recently used, Starred, then only the typologies present in the zone (the configured CLOSE is not offered).
    assert.match(await page.getByTestId('gallery-nav-all').textContent(), /\d+$/)
    assert.equal(await page.getByTestId('gallery-nav-cards').count(), 0, 'absent typologies are not listed')
    await page.getByTestId('gallery-nav-hero').click()
    assert.match(await count.textContent(), /^1 of \d+$/, 'filtered count for a typology')
    assert.equal(await page.locator('[data-testid^="block-group-"]').count(), 1, 'one section for the chosen typology')
    await text.waitFor({ state: 'detached' }); await hero.waitFor()
    await page.getByTestId('gallery-nav-all').click(); await text.waitFor()
    // Filter menu: checkbox popover, Escape closes the menu only, active values show as removable chips.
    await page.getByTestId('gallery-filter-media').getByRole('button').click()
    await page.getByTestId('gallery-option-media-image').check()
    await page.keyboard.press('Escape'); await page.getByTestId('gallery-option-media-image').waitFor({ state: 'detached' })
    assert.ok(await page.getByRole('dialog').isVisible(), 'Escape in the menu keeps the gallery open')
    await page.getByTestId('gallery-chips').waitFor(); await text.waitFor({ state: 'detached' }); await hero.waitFor()
    assert.match(await count.textContent(), /^\d+ of \d+$/)
    await page.getByTestId('gallery-filter-tags').getByRole('button').click(); await page.getByTestId('gallery-option-tags-Editorial').check()
    await count.click(); await page.getByTestId('gallery-option-tags-Editorial').waitFor({ state: 'detached' })
    assert.equal(await page.getByTestId('gallery-chips').getByRole('button', { name: /^Remove filter/ }).count(), 2, 'one chip per active value')
    await page.getByTestId('gallery-clear-all').click(); await page.getByTestId('gallery-chips').waitFor({ state: 'detached' })
    assert.match(await count.textContent(), /^\d+ blocks$/, 'clear all resets the menus')
    await page.locator('input[name="block-search-blocks"]').fill('zzz-nothing')
    await page.getByText('No blocks found.', { exact: true }).waitFor(); await page.getByRole('button', { name: 'Clear search', exact: true }).last().click()
    assert.match(await count.textContent(), /^\d+ blocks$/, 'reset clears search and filters')
    // Star: stored per admin user on the server.
    const starred = page.waitForResponse(res => res.url().endsWith('/blockscene/me/prefs') && res.request().method() === 'PUT')
    await page.getByTestId('gallery-star-blocks.hero').click(); assert.ok((await starred).ok())
    assert.equal(await page.getByTestId('gallery-star-blocks.hero').getAttribute('aria-pressed'), 'true')
    assert.deepEqual((await api('GET', '/blockscene/me/prefs')).data.starred, ['blocks.hero'])
    await page.getByTestId('gallery-nav-starred').click(); await text.waitFor({ state: 'detached' }); await hero.waitFor()
    await page.getByTestId('gallery-nav-all').click(); await text.waitFor()
    await page.getByRole('dialog').screenshot({ path: `artifacts/strapi${major}-gallery-expanded.png`, animations: 'disabled' })
    // Collapsed sidebar: icons only, remembered in this browser.
    await page.getByTestId('gallery-sidebar-toggle').click()
    await page.locator('[data-testid="gallery-sidebar-blocks"][data-collapsed="true"]').waitFor()
    assert.equal(await page.getByTestId('gallery-nav-hero').getAttribute('aria-label'), 'Hero (1)')
    assert.equal(await page.evaluate(() => localStorage.getItem('blockscene:gallery-sidebar')), 'collapsed')
    await page.getByRole('dialog').screenshot({ path: `artifacts/strapi${major}-gallery-collapsed.png`, animations: 'disabled' })
    await page.getByTestId('gallery-sidebar-toggle').click(); await page.locator('[data-testid="gallery-sidebar-blocks"][data-collapsed="false"]').waitFor()
    // Magnify: a single click lifts the card into a large panel over the grid (sidebar and toolbar stay visible); Insert is its primary action.
    await hero.locator('button').first().click()
    const detail = page.getByTestId('gallery-detail'); await detail.waitFor()
    await page.getByTestId('gallery-magnify-scrim').waitFor()
    assert.ok(await page.getByTestId('gallery-sidebar-blocks').isVisible() && await page.locator('input[name="block-search-blocks"]').isVisible(), 'sidebar and toolbar stay visible')
    await detail.locator('[data-thumb="0"] img').waitFor()
    await detail.getByTestId('gallery-detail-fields-toggle').click()
    await detail.getByTestId('gallery-detail-fields').getByText('title', { exact: true }).waitFor()
    await detail.getByTestId('gallery-insert').waitFor()
    if (major === 5) {
      await page.locator('[data-testid="gallery-detail"][data-live="ready"]').waitFor()
      assert.equal(await detail.getByTestId('gallery-magnify-frame').getAttribute('src'), `${baseURL}/block-preview/index.html`)
    } else assert.equal(await detail.getAttribute('data-live'), 'none', 'no live source: the image stays')
    await page.getByRole('dialog').screenshot({ path: `artifacts/strapi${major}-gallery-detail.png`, animations: 'disabled' })
    await page.keyboard.press('Escape'); await detail.waitFor({ state: 'detached' })
    assert.ok(await page.getByRole('dialog').isVisible(), 'Escape closes the magnified block, not the gallery')
  })
  await page.locator('input[name="block-search-blocks"]').fill('not-a-real-block')
  await page.getByText('No blocks found.', { exact: true }).waitFor()
  await page.locator('input[name="block-search-blocks"]').fill('banner')
  await step('double click inserts at once; the detail pane Insert too, and it is recorded as recently used', async () => {
    await page.getByTestId('blockscene-blocks.hero').locator('button').first().dblclick()
    await page.getByTestId('blockscene-blocks.hero').waitFor({ state: 'detached' })
    await openGallery('sidebar')
    await page.getByTestId('blockscene-blocks.text').waitFor()
    assert.equal(await page.getByTestId('blockscene-blocks.hero').count(), 0, 'Sidebar only allows text')
    await page.getByTestId('blockscene-blocks.text').locator('button').first().click()
    const recent = page.waitForResponse(res => res.url().endsWith('/blockscene/me/prefs') && res.request().method() === 'PUT')
    await page.getByTestId('gallery-detail').getByTestId('gallery-insert').click()
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    assert.ok((await recent).ok())
    assert.deepEqual((await api('GET', '/blockscene/me/prefs')).data.recent.slice(0, 2), ['blocks.text', 'blocks.hero'])
  })
  await step('accordion controls appear for a full zone too; its native add button no longer opens the gallery', async () => {
    await page.getByTestId('block-accordion-controls-sidebar').waitFor()
    await page.getByRole('button', { name: /Add a component to sidebar/i }).click(); await page.waitForTimeout(500)
    assert.equal(await page.getByTestId('gallery-sidebar-sidebar').count(), 0, 'a full zone keeps the native behaviour')
  })
  const save = page.getByRole('button', { name: 'Save', exact: true })
  const response = page.waitForResponse(res => res.url().includes('/content-manager/collection-types/api::page.page') && res.request().method() === 'POST')
  await save.click()
  const saved = await response
  assert.ok(saved.ok(), `Save returned ${saved.status()}: ${(await saved.text()).slice(0,500)}`)
  const payload = await saved.json()
  const document = payload.data || payload
  assert.equal(document.sidebar.length, 1)
  assert.equal(document.sidebar[0].__component, 'blocks.text')
  assert.equal(document.blocks[0].title, 'Hello from Strapi')
  assert.equal(document.blocks[0].visible, false)
  assert.equal(document.blocks[0].items.length, 2)
  assert.equal(document.blocks[0].items[0].label, 'Nested default')
  checks.push('gallery', 'search', 'defaults', 'nested components', 'allowed components', 'max limit', 'save')
  await page.reload()
  await page.getByTestId('block-accordion-controls-blocks').waitFor()
  const docUrl = page.url()
  // Add a second block so "open/close all" has more than one accordion in the zone.
  await openGallery()
  await page.getByTestId('blockscene-blocks.text').hover(); await page.getByTestId('gallery-quick-blocks.text').click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  const second = page.waitForResponse(res => res.url().includes('/content-manager/collection-types/api::page.page') && ['PUT', 'POST'].includes(res.request().method()) && res.ok())
  await save.click()
  await second
  await shot('saved')
  const waitState = async (value, count = 3) => {
    await page.waitForFunction(([value, count]) => { const l = [...document.querySelectorAll('ol[aria-describedby] > li')].map(li => li.querySelector('button[aria-expanded]')).filter(Boolean); return l.length >= count && l.every(b => b.getAttribute('aria-expanded') === value) }, [value, count], { timeout: 10000 })
  }
  await step('default initial state closes every accordion once after load', async () => {
    await page.goto(docUrl); await page.getByTestId('block-accordion-controls-blocks').waitFor(); await waitState('false')
  })
  await step('the expand / collapse toggle drives the native accordions per zone and follows their real state', async () => {
    const controls = page.getByTestId('block-accordion-controls-blocks')
    // Beside the native zone label pill ("Blocks (2)" with friendly labels), not in the side panel.
    assert.ok(await controls.evaluate(el => { const anchor = el.closest('[data-blockscene-zone-controls="blocks"]'); const list = anchor?.parentElement?.parentElement?.querySelector(':scope > ol[aria-describedby]'); return Boolean(list && /^blocks\s*\(\d+\)/i.test(anchor.parentElement.textContent.trim())) }), 'controls next to the zone label')
    await page.locator('[data-blockscene-zone-controls="blocks"]').evaluate(el => el.parentElement.parentElement.scrollIntoView({ block: 'center' }))
    await page.screenshot({ path: `artifacts/strapi${major}-zone-label-controls.png`, animations: 'disabled' })
    assert.equal(await toggle().innerText(), 'Expand all'); assert.equal(await toggle().getAttribute('aria-expanded'), 'false')
    await toggle().click()
    await waitOpenCount(2)
    await page.waitForFunction(() => document.querySelector('[data-testid="zone-toggle-blocks"]')?.textContent === 'Collapse all')
    assert.equal(await toggle().getAttribute('aria-expanded'), 'true')
    assert.equal((await expanded()).filter(v => v === 'false').length, 1, 'sidebar zone untouched')
    await shot('accordions-open')
    // Editing after the initial application must not re-close anything.
    await page.locator('input[name="blocks.0.title"]').fill('Edited without reapply')
    await new Promise(r => setTimeout(r, 1200))
    assert.deepEqual((await expanded()).slice(0, 2), ['true', 'true'])
    // A header closed by hand turns it back into Expand all (the rows' own state, not the last click).
    await firstHeader().click()
    await page.waitForFunction(() => document.querySelector('[data-testid="zone-toggle-blocks"]')?.textContent === 'Expand all')
    await firstHeader().click()
    await page.waitForFunction(() => document.querySelector('[data-testid="zone-toggle-blocks"]')?.textContent === 'Collapse all')
    await toggle().click()
    await waitState('false')
    await page.waitForFunction(() => document.querySelector('[data-testid="zone-toggle-blocks"]')?.textContent === 'Expand all')
  })
  await step('remember mode reuses the last explicit open/close all action', async () => {
    await putSettings({ editor: { initialState: 'remember' } })
    await toggle().click()
    await page.goto(docUrl); await page.getByTestId('block-accordion-controls-blocks').waitFor()
    await waitOpenCount(2)
    assert.equal((await expanded()).filter(v => v === 'false').length, 1, 'remembered per zone: sidebar still closed')
    const key = await page.evaluate(() => Object.keys(localStorage).find(k => k.startsWith('blockscene:v1:')))
    assert.match(key, /blockscene:v1:http:\/\/127\.0\.0\.1:\d+\/admin:\d+:api::page\.page:blocks/)
    assert.ok(!key.includes(access.email), 'no e-mail in the key')
    await page.evaluate(k => localStorage.setItem(k, 'garbage'), key)
    await page.goto(docUrl); await page.getByTestId('block-accordion-controls-blocks').waitFor(); await waitState('false')
  })
  await step('open initial state and hidden controls', async () => {
    await putSettings({ editor: { initialState: 'open', showCloseAll: false } })
    await page.goto(docUrl); await page.getByTestId('block-accordion-controls-blocks').waitFor(); await waitState('true')
    // Only "Expand all" enabled: the toggle offers that action alone, disabled while every block is open.
    await page.waitForFunction(() => document.querySelector('[data-testid="zone-toggle-blocks"]')?.disabled === true)
    assert.equal(await toggle().innerText(), 'Expand all')
    // The zone bar also holds the "…" menu (select, paste: editor.clipboard): off too, so no toggle and no menu remain
    // (Strapi 5 keeps Undo and Redo there).
    await putSettings({ editor: { showOpenAll: false, showCloseAll: false, clipboard: false } })
    await page.goto(docUrl); await page.locator('[data-blockscene-editor]').waitFor({ state: 'attached' }); await waitState('false')
    assert.equal(await toggle().count(), 0); assert.equal(await page.getByTestId('zone-more-blocks').count(), 0)
    if (major === 4) assert.equal(await page.getByTestId('block-accordion-controls-blocks').count(), 0)
    await firstHeader().click() // native header still works
    await page.waitForFunction(() => document.querySelector('ol[aria-describedby] > li').querySelector('button[aria-expanded]').getAttribute('aria-expanded') === 'true')
  })
  await step('row thumbnails follow editor.showRowThumbnails', async () => {
    await putSettings({})
    await page.goto(docUrl); await page.getByTestId('block-accordion-controls-blocks').waitFor()
    await page.locator('[data-blockscene-row-thumb]').first().waitFor({ state: 'attached' })
    await putSettings({ editor: { showRowThumbnails: false } })
    await page.goto(docUrl); await page.getByTestId('block-accordion-controls-blocks').waitFor(); await page.waitForTimeout(800)
    assert.equal(await page.locator('[data-blockscene-row-thumb]').count(), 0, 'no thumbnails when off')
    await putSettings({})
  })
  await step('panel bypass restores the native editor and keeps unsaved edits; re-enabling works', async () => {
    await putSettings({ editor: { enabled: false } })
    await page.goto(docUrl)
    await page.getByRole('button', { name: /Add a component to/i }).first().waitFor()
    assert.equal(await page.locator('[data-blockscene-editor]').count(), 0)
    assert.equal(await page.getByTestId('block-accordion-controls-blocks').count(), 0)
    if (await firstHeader().getAttribute('aria-expanded') !== 'true') await firstHeader().click()
    await page.locator('input[name="blocks.0.title"]').fill('Native edit kept')
    await putSettings({ editor: { enabled: true } })
    await new Promise(r => setTimeout(r, 1500))
    assert.equal(await page.locator('input[name="blocks.0.title"]').inputValue(), 'Native edit kept', 'settings change does not reload the form')
    await shot('bypass')
    await page.goto(docUrl); await page.getByTestId('block-accordion-controls-blocks').waitFor()
  })
  await putSettings({})
  await step('settings page: palette preview, unsaved indicator, save and persistence', async () => {
    await page.goto('/admin/settings/blockscene')
    await page.getByTestId('save-blockscene-settings').waitFor()
    assert.equal(await page.getByTestId('unsaved-indicator').count(), 0)
    await page.locator('input[name="palette-accent"]').fill('#FF0000')
    await page.getByTestId('unsaved-indicator').waitFor()
    await page.getByTestId('palette-preview').locator('rect[fill="#FF0000"]').first().waitFor()
    await page.locator('input[name="palette-accent"]').fill('nope')
    await page.getByText('Colors must use #RRGGBB.').waitFor()
    await page.locator('input[name="palette-accent"]').fill('#FF0000')
    await page.locator('input[name="palette-surface"]').fill('#00FF00')
    await page.getByTestId('save-blockscene-settings').click()
    await page.getByText('Settings saved.', { exact: true }).waitFor()
    await page.reload()
    await page.getByTestId('save-blockscene-settings').waitFor()
    assert.equal(await page.locator('input[name="palette-accent"]').inputValue(), '#FF0000')
    await page.getByTestId('source-blocks.text').getByText(/Wireframe/).waitFor()
    await page.getByTestId('source-blocks.hero').getByText(/Automatic image/).waitFor()
    // No preview route: the Settings page says so (editors get no hint in the edit view).
    if (major === 5) { await page.locator('input[name="editor-previewUrl"]').waitFor(); await page.getByTestId('preview-url-empty').waitFor() } else { await page.getByText('Strapi 5 distribution only', { exact: false }).waitFor() }
    await shot('settings')
  })
  await step('palette change reaches the gallery wireframe without rebuild', async () => {
    await page.goto(docUrl); await openGallery()
    // The generic template has no accent shape; surfaces are present in every template.
    await page.getByTestId('blockscene-blocks.text').locator('svg[data-wireframe] rect[fill="#00FF00"]').first().waitFor()
    await page.keyboard.press('Escape')
  })
  await step('manual image from the Media Library wins, then "use automatic" restores the fallback', async () => {
    // A real capture from the static example is uploaded as the custom image.
    const tmp = mkdtempSync(join(tmpdir(), 'blockscene-'))
    execFileSync(process.execPath, ['scripts/capture-previews.mjs', '--manifest', 'examples/static-preview/manifest.json', '--out', tmp, '--only', 'blocks.hero'], { stdio: 'inherit' })
    const form = new FormData()
    form.append('files', new Blob([readFileSync(join(tmp, 'blocks.hero.webp'))], { type: 'image/webp' }), 'smoke-thumb.webp')
    rmSync(tmp, { recursive: true, force: true })
    const upload = await api('POST', '/upload', form)
    assert.ok([200, 201].includes(upload.status), JSON.stringify(upload.data))
    uploadId = upload.data[0].id
    await page.goto('/admin/settings/blockscene')
    await page.getByTestId('settings-blocks.text').getByRole('button', { name: 'Choose image' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.waitFor()
    const asset = dialog.locator('[role="checkbox"], input[type="checkbox"]').first()
    await asset.waitFor()
    await asset.click({ force: true })
    await dialog.getByRole('button', { name: /^(Finish|Select)/ }).click()
    await dialog.waitFor({ state: 'hidden' })
    await page.getByTestId('source-blocks.text').getByText(/Custom image/).waitFor()
    await page.getByTestId('save-blockscene-settings').click()
    await page.getByText('Settings saved.', { exact: true }).waitFor()
    const settings = (await api('GET', '/blockscene/settings')).data
    assert.equal(settings.settings.components['blocks.text'].mediaId, uploadId)
    await page.goto(docUrl); await openGallery()
    const img = page.getByTestId('blockscene-blocks.text').locator('[data-thumb="0"] img')
    await img.waitFor(); assert.match(await img.getAttribute('src'), /\/uploads\//)
    await shot('manual-thumb')
    await page.keyboard.press('Escape')
    await page.goto('/admin/settings/blockscene')
    await page.getByTestId('settings-blocks.text').getByRole('button', { name: 'Use automatic image' }).click()
    await page.getByTestId('save-blockscene-settings').click()
    await page.getByText('Settings saved.', { exact: true }).waitFor()
    assert.equal((await api('GET', '/blockscene/settings')).data.settings.components['blocks.text'], undefined)
    await page.goto(docUrl); await openGallery()
    await page.getByTestId('blockscene-blocks.text').locator('[data-thumb="wireframe"]').waitFor()
    await page.keyboard.press('Escape')
  })
  await step('deleted media is reported and the card advances to the next source', async () => {
    await putSettings({ components: { 'blocks.text': { mediaId: uploadId, template: 'faq' } } })
    assert.equal((await api('DELETE', `/upload/files/${uploadId}`)).status, 200); uploadId = null
    await page.goto('/admin/settings/blockscene')
    await page.getByTestId('settings-blocks.text').getByText('The selected media no longer exists; the next source is used.').waitFor()
    await page.goto(docUrl); await openGallery()
    await page.getByTestId('blockscene-blocks.text').locator('[data-thumb="wireframe"] svg[data-wireframe="faq"]').waitFor()
    await page.keyboard.press('Escape')
  })
  await step('local capture output is consumed as the automatic image and a broken image recovers', async () => {
    execFileSync(process.execPath, ['scripts/capture-previews.mjs', '--manifest', 'examples/static-preview/manifest.json', '--out', `.local/strapi${major}/public/block-previews`, '--only', 'blocks.text'], { stdio: 'inherit' })
    assert.ok(existsSync(previewFile))
    await putSettings({})
    await page.goto(docUrl); await openGallery()
    const img = page.getByTestId('blockscene-blocks.text').locator('[data-thumb="0"] img')
    await img.waitFor(); assert.match(await img.getAttribute('src'), /blocks\.text\.webp/)
    await shot('captured-thumb')
    await page.keyboard.press('Escape')
  })
  if (major === 5) await step('page preview (Strapi 5): split mode, generic frontend page, select, inline title, modal text edit, media, no writes', async () => {
    const previewUrl = `${baseURL}/block-preview/index.html`
    await putSettings({ editor: { previewUrl, previewMode: 'form' } })
    await page.goto(docUrl)
    await setMode('Fields + page')
    const pane = page.getByTestId('page-preview-pane')
    await pane.waitFor()
    await page.waitForFunction(() => document.querySelector('[data-testid="page-preview-state"]')?.getAttribute('data-ready') === 'true')
    assert.equal(await page.evaluate(() => document.querySelector('[data-testid="page-preview-state"]')?.getAttribute('data-preview-source')), 'custom')
    const frame = pane.frameLocator('iframe')
    await frame.locator('[data-block-key]').nth(1).waitFor()
    assert.equal(await frame.locator('[data-block-key]').count(), 2, 'both zone rows rendered by the frontend page')
    await frame.locator('[data-block-uid="blocks.hero"] [data-block-field="title"]').waitFor()
    const cmWrites = []
    page.on('request', r => { if (r.url().includes('/content-manager/') && ['POST', 'PUT', 'DELETE'].includes(r.method())) cmWrites.push(r.url()) })
    // Select opens the accordion; inline title edit (explicitly mapped by the page) reaches the form.
    await frame.locator('[data-block-uid="blocks.text"] .bp-label').click()
    await page.waitForFunction(() => document.querySelectorAll('ol[aria-describedby] > li')[1]?.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded') === 'true')
    const title = frame.locator('[data-block-uid="blocks.hero"] [data-block-field="title"]')
    await title.click(); await page.keyboard.press('Meta+A'); await page.keyboard.type('Inline title'); await page.keyboard.press('Enter')
    if ((await expanded())[0] !== 'true') await firstHeader().click()
    await page.waitForFunction(() => document.querySelector('input[name="blocks.0.title"]')?.value === 'Inline title')
    // Side by side: a rich "body" click focuses the native textarea on the left (no dialog); typing updates the frame.
    await frame.locator('[data-block-uid="blocks.text"] [data-block-field="body"]').click()
    await page.waitForFunction(() => document.activeElement?.getAttribute('name') === 'blocks.1.body')
    assert.equal(await page.getByTestId('block-modal-bar').count(), 0, 'no block dialog in side by side')
    await page.keyboard.type('Body typed natively')
    await frame.getByText('Body typed natively', { exact: true }).waitFor()
    // Visual editor: a click on a field opens the whole block (its native form) over the page with that field focused;
    // typing reaches the frame; Done puts the block back. A click on the block label opens it too.
    await page.getByTestId('page-preview-pane').getByRole('button', { name: 'Visual editor', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('[data-testid="page-preview-state"]')?.getAttribute('data-mode') === 'preview')
    await frame.locator('[data-block-uid="blocks.text"] [data-block-field="body"]').click()
    await page.getByTestId('block-modal-bar').waitFor()
    await page.waitForFunction(() => document.activeElement?.getAttribute('name') === 'blocks.1.body' && Boolean(document.activeElement.closest('[data-bp-block-modal]')))
    await page.keyboard.press('Meta+A'); await page.keyboard.type('Body from the block dialog')
    await frame.getByText('Body from the block dialog', { exact: true }).waitFor()
    await shot('block-modal')
    await page.getByTestId('block-modal-done').click(); await page.getByTestId('block-modal-bar').waitFor({ state: 'detached' })
    assert.equal(await page.locator('[data-bp-block-modal]').count(), 0, 'block returned to the form')
    await frame.locator('[data-block-uid="blocks.hero"] .bp-label').click(); await page.getByTestId('block-modal-bar').waitFor()
    // Without a field, Done takes focus (out of the iframe), so Escape reaches the admin.
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-testid') === 'block-modal-done')
    await page.keyboard.press('Escape'); await page.getByTestId('block-modal-bar').waitFor({ state: 'detached' })
    await page.getByTestId('page-preview-pane').getByRole('button', { name: 'Fields + page', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('[data-testid="page-preview-state"]')?.getAttribute('data-mode') === 'split')
    // Media Library from the page for the hero image.
    const png = await page.screenshot({ clip: { x: 0, y: 0, width: 64, height: 48 } })
    const form = new FormData(); form.append('files', new Blob([png], { type: 'image/png' }), 'preview-media.png')
    const upload = await api('POST', '/upload', form); assert.ok([200, 201].includes(upload.status)); uploadId = upload.data[0].id
    await frame.locator('[data-block-uid="blocks.hero"]').hover()
    await frame.locator('[data-block-uid="blocks.hero"] button[data-media="image"]').click()
    const dialog = page.getByRole('dialog').filter({ hasText: /Add new assets|Media Library|Select assets|Finish/i }).first()
    await page.getByRole('dialog').first().waitFor()
    await page.locator('[role="dialog"] [role="checkbox"], [role="dialog"] input[type="checkbox"]').first().click({ force: true })
    await page.locator('[role="dialog"]').getByRole('button', { name: /^(Finish|Select)/ }).click()
    await frame.locator('[data-block-uid="blocks.hero"] img[src*="/uploads/"]').waitFor()
    // Insertion gap after the first block opens the existing picker; cancel is inert; the choice lands exactly there.
    const gap = frame.locator('[data-testid^="bp-gap-"]').nth(1)
    await gap.hover(); await gap.locator('.bp-insert:not(.bp-insert--group)').click()
    const picker = page.getByRole('dialog').filter({ hasText: 'Block gallery' })
    await picker.getByTestId('blockscene-blocks.text').waitFor()
    await page.keyboard.press('Escape'); await picker.waitFor({ state: 'hidden' })
    const zoneRows = () => page.locator('ol[aria-describedby]').first().locator(':scope > li')
    assert.equal(await zoneRows().count(), 2, 'cancel keeps the zone unchanged')
    await gap.hover(); await gap.locator('.bp-insert:not(.bp-insert--group)').click()
    await picker.getByTestId('blockscene-blocks.text').locator('button').first().dblclick(); await picker.waitFor({ state: 'hidden' })
    await page.waitForFunction(() => document.querySelector('ol[aria-describedby]').querySelectorAll(':scope > li').length === 3)
    assert.match(await zoneRows().nth(1).innerText(), /Text/, 'inserted after the first block')
    // The compact per-block preview setting persists but is hidden here: this lab has no accordion integration.
    const persisted = await putSettings({ editor: { blockPreviewInForm: true } })
    assert.equal(persisted.editor.blockPreviewInForm, true)
    assert.equal((await api('GET', '/blockscene/settings')).data.blockPreviewAvailable, false)
    await putSettings({ editor: { blockPreviewInForm: false } })
    await frame.locator('main > section').nth(2).waitFor()
    assert.deepEqual(cmWrites, [], 'no content-manager writes')
    // Compact Save on the toolbar delegates to the native action.
    const toolbarSave = page.getByTestId('page-preview-actions').getByRole('button', { name: 'Save', exact: true })
    await toolbarSave.waitFor()
    const savedByToolbar = page.waitForResponse(r => r.url().includes('/content-manager/collection-types/api::page.page') && r.request().method() === 'PUT')
    await toolbarSave.click()
    assert.ok((await savedByToolbar).ok(), 'toolbar Save used the native update')
    await shot('page-preview')
    // Preview mode covers exactly the native content area; navigation menus stay visible.
    await page.getByTestId('page-preview-pane').getByRole('button', { name: 'Visual editor', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('[data-testid="page-preview-state"]')?.getAttribute('data-mode') === 'preview')
    const geometry = await page.evaluate(() => { const r = el => { const b = el.getBoundingClientRect(); return { left: Math.round(b.left), right: Math.round(b.right), width: Math.round(b.width) } }; return { pane: r(document.querySelector('[data-testid="page-preview-pane"]')), main: r(document.getElementById('main-content')), navs: [...document.querySelectorAll('nav')].map(r).filter(n => n.width > 0) } })
    assert.ok(Math.abs(geometry.pane.left - geometry.main.left) <= 1 && Math.abs(geometry.pane.right - geometry.main.right) <= 1 && geometry.navs.every(n => n.right <= geometry.pane.left + 1), `preview pane equals the content area, menus visible ${JSON.stringify(geometry)}`)
    await page.getByTestId('page-preview-pane').getByRole('button', { name: 'Fields', exact: true }).click()
    await putSettings({})
    void dialog
  })
  if (major === 5) await step('hover sync (Strapi 5): form row -> page block, page block -> form row, edge indicator, divider reset', async () => {
    await putSettings({ editor: { previewUrl: `${baseURL}/block-preview/index.html`, previewMode: 'split' } })
    await page.goto(docUrl)
    await page.waitForFunction(() => document.querySelector('[data-testid="page-preview-state"]')?.getAttribute('data-ready') === 'true')
    const frame = page.getByTestId('page-preview-pane').frameLocator('iframe')
    await frame.locator('[data-block-key]').nth(2).waitFor()
    // Form -> page: a closed row's header marks its block (no scroll); leaving the form clears it.
    await rows().nth(1).locator('button[aria-expanded]').first().hover()
    await frame.locator('[data-block-key]').nth(1).and(frame.locator('[data-hovered]')).waitFor()
    assert.equal(await frame.locator('[data-hovered]').count(), 1)
    await page.screenshot({ path: 'artifacts/strapi5-split-hover-form.png', animations: 'disabled' })
    // Page -> form: the matching row gets the highlight attribute; the form row under the pointer is cleared on the page.
    await frame.locator('[data-block-key]').first().hover()
    await page.waitForFunction(() => document.querySelectorAll('ol[aria-describedby] > li')[0]?.hasAttribute('data-blockscene-hover'))
    await frame.locator('[data-hovered]').waitFor({ state: 'detached' })
    await page.screenshot({ path: 'artifacts/strapi5-split-hover-page.png', animations: 'disabled' })
    await frame.locator('main').hover({ position: { x: 40, y: 4 } })
    await page.waitForFunction(() => !document.querySelector('[data-blockscene-hover]'))
    // Out of view: the edge indicator scrolls the form to the row.
    await toggle().click()
    await waitOpenCount(3)
    await page.setViewportSize({ width: 1440, height: 560 })
    // The edit view scrolls inside a container (not the window): back to its top, so the last row is below the fold.
    await page.evaluate(() => { for (let el = document.querySelector('ol[aria-describedby] > li'); el; el = el.parentElement) if (/(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight) el.scrollTop = 0 })
    // Opening all blocks may still be scrolling the form: wait until the top of the form is reached and stays.
    await page.waitForFunction(() => new Promise(done => { const top = () => document.querySelector('ol[aria-describedby] > li').getBoundingClientRect().top; const a = top(); setTimeout(() => done(a === top() && a > 0), 300) }))
    await frame.locator('[data-block-key]').last().hover()
    assert.ok(await page.evaluate(() => [...document.querySelector('ol[aria-describedby]').querySelectorAll(':scope > li')].pop().getBoundingClientRect().top > innerHeight), 'last row below the fold')
    const edge = page.getByTestId('page-preview-hover-edge')
    await edge.waitFor(); assert.equal(await edge.getAttribute('data-direction'), 'down')
    await edge.click()
    await page.waitForFunction(() => { const r = [...document.querySelector('ol[aria-describedby]').querySelectorAll(':scope > li')].pop().getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight })
    await page.setViewportSize({ width: 1440, height: 1000 })
    // Divider: double click resets the split to half of the content area.
    const resizer = page.getByTestId('page-preview-resizer')
    const box = await resizer.boundingBox()
    await page.mouse.move(box.x + 6, box.y + 300); await page.mouse.down(); await page.mouse.move(box.x - 200, box.y + 300); await page.mouse.up()
    await resizer.dblclick()
    const half = await page.evaluate(() => { const m = document.getElementById('main-content').getBoundingClientRect(); return Math.abs(document.querySelector('[data-testid="page-preview-pane"]').getBoundingClientRect().width - m.width / 2) <= 2 })
    assert.ok(half, 'double click resets to 50/50')
    const at = await resizer.boundingBox()
    await page.mouse.move(at.x - 200, 300)
    await page.screenshot({ path: 'artifacts/strapi5-divider.png', clip: { x: at.x - 240, y: 0, width: 480, height: 1000 }, animations: 'disabled' })
    await resizer.hover()
    await page.screenshot({ path: 'artifacts/strapi5-divider-hover.png', clip: { x: at.x - 240, y: 0, width: 480, height: 1000 }, animations: 'disabled' })
    await putSettings({})
  })
  if (major === 5) await step('undo / redo (Strapi 5): gallery insert and field edits, buttons and keyboard, zone bar and toolbar share one history', async () => {
    await putSettings({ editor: { previewUrl: `${baseURL}/block-preview/index.html`, previewMode: 'split' } })
    await page.goto(docUrl)
    const tools = page.getByTestId('blockscene-history')
    const undoButton = tools.first().getByRole('button', { name: /^Undo/ }), redoButton = tools.first().getByRole('button', { name: /^Redo/ })
    await undoButton.waitFor(); await page.getByTestId('page-preview-pane').waitFor()
    assert.equal(await tools.count(), 2, 'zone bar and preview toolbar')
    assert.ok(await tools.first().evaluate(el => Boolean(el.closest('[data-blockscene-zone-controls="blocks"]'))), 'Undo and Redo sit in the first zone bar')
    assert.equal(await page.locator('aside h2').filter({ hasText: /^Blockscene$/i }).count(), 0, 'no Blockscene side panel without history or diagnostics')
    assert.ok(await undoButton.isDisabled() && await redoButton.isDisabled(), 'fresh history')
    const zoneRows = () => page.locator('ol[aria-describedby]').first().locator(':scope > li')
    const titleInput = page.locator('input[name="title"]')
    const original = await titleInput.inputValue(), count = await zoneRows().count()
    const expect = async (rows, title) => {
      await page.waitForFunction(([rows, title]) => document.querySelector('ol[aria-describedby]').querySelectorAll(':scope > li').length === rows && document.querySelector('input[name="title"]')?.value === title, [rows, title])
    }
    await openGallery()
    await page.getByTestId('blockscene-blocks.text').hover(); await page.getByTestId('gallery-quick-blocks.text').click()
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    await expect(count + 1, original)
    await new Promise(r => setTimeout(r, 600))
    await titleInput.fill('Undo me')
    await new Promise(r => setTimeout(r, 600))
    // Continuous typing is one step.
    await titleInput.click(); await page.keyboard.press('End'); await page.keyboard.type(' twice')
    await expect(count + 1, 'Undo me twice')
    assert.ok(!(await page.getByTestId('page-preview-pane').getByTestId('blockscene-history').getByRole('button', { name: /^Undo/ }).isDisabled()), 'toolbar shares the history')
    await page.getByTestId('page-preview-pane').screenshot({ path: 'artifacts/strapi5-undo-toolbar.png', animations: 'disabled' })
    await undoButton.click(); await expect(count + 1, 'Undo me')
    await undoButton.click(); await expect(count + 1, original)
    // Focus on a button (outside every field): the shortcut is ours.
    await page.keyboard.press('ControlOrMeta+z'); await expect(count, original)
    assert.ok(await undoButton.isDisabled(), 'back to the loaded values')
    await page.keyboard.press('ControlOrMeta+Shift+z'); await expect(count + 1, original)
    await redoButton.click(); await expect(count + 1, 'Undo me')
    await tools.first().locator('xpath=..').screenshot({ path: 'artifacts/strapi5-undo-zone-bar.png', animations: 'disabled' })
    await page.getByTestId('page-preview-pane').getByRole('button', { name: 'Fields', exact: true }).click()
    await putSettings({})
  })
  if (major === 5) await step('settings sidebar editor (Strapi 5): an item built in the UI is saved, shown in the visual editor and opens its field; reset', async () => {
    await putSettings({ editor: { previewUrl: `${baseURL}/block-preview/index.html` } })
    await page.goto('/admin/settings/blockscene')
    const uid = 'api::page.page'
    const editor = page.getByTestId(`sidebar-editor-${uid}`)
    await editor.waitFor()
    await page.getByTestId(`sidebar-add-${uid}`).click()
    await editor.getByText(/Give the item a label/).waitFor()
    assert.ok(await page.getByTestId('save-blockscene-settings').isDisabled(), 'an invalid item blocks Save')
    await editor.locator(`input[name="sidebar-label-${uid}-0"]`).fill('Page title')
    await editor.getByRole('combobox', { name: 'Icon' }).click(); await page.getByRole('option', { name: 'Text', exact: true }).click()
    await editor.getByRole('combobox', { name: 'Opens as' }).click(); await page.getByRole('option', { name: 'Modal' }).click()
    await editor.getByRole('combobox', { name: 'Sidebar position' }).click(); await page.getByRole('option', { name: 'Right' }).click()
    await editor.locator(`input[name="sidebar-field-title-${uid}-0"]`).check()
    assert.equal(await editor.getByText(/Give the item a label/).count(), 0)
    await editor.screenshot({ path: `artifacts/strapi${major}-settings-sidebar.png`, animations: 'disabled' })
    await page.getByTestId('save-blockscene-settings').click()
    await page.getByText('Settings saved.', { exact: true }).waitFor()
    assert.deepEqual((await api('GET', '/blockscene/settings')).data.settings.contentTypes[uid],
      { sidebarPosition: 'right', sidebar: [{ label: 'Page title', open: 'modal', fields: ['title'], icon: 'text' }] })
    await page.goto(docUrl)
    await setMode('Visual editor')
    await page.locator('[data-testid="page-preview-sidebar"][data-position="right"]').waitFor()
    const button = page.getByTestId('sidebar-item-0')
    assert.equal(await button.getAttribute('title'), 'Page title')
    await button.click()
    await page.getByTestId('fields-panel-bar').getByText('Page title').waitFor()
    await page.locator('[data-bp-fields="modal"] input[name="title"]').waitFor({ state: 'visible' })
    await page.getByTestId('fields-panel-done').click(); await page.getByTestId('fields-panel-bar').waitFor({ state: 'detached' })
    await page.getByTestId('page-preview-pane').getByRole('button', { name: 'Fields', exact: true }).click()
    // Reset from the page: no code defaults in the lab, so the built-in ones.
    await page.goto('/admin/settings/blockscene')
    await page.getByTestId('restore-blockscene-settings').getByText('Reset to defaults').click()
    await page.getByText('Defaults restored.', { exact: true }).waitFor()
    const after = (await api('GET', '/blockscene/settings')).data
    assert.deepEqual(after.settings.contentTypes, {}); assert.equal(after.projectDefaults, null)
  })
  if (major === 5) await step('pane toolbar (Strapi 5): Settings checklist saves an ordered subset; reduced bar, custom width, per type override', async () => {
    const previewUrl = `${baseURL}/block-preview/index.html`
    await putSettings({ editor: { previewUrl } })
    await page.goto('/admin/settings/blockscene')
    const checklist = page.getByTestId('pane-editor-editor')
    await checklist.waitFor()
    await checklist.locator('input[name="editor-previewToolbar-history"]').uncheck()
    await checklist.getByTestId('editor-toolbar-actions').getByRole('button', { name: 'Move up' }).click()
    await page.getByTestId('editor-add-width').click()
    await checklist.getByText(/Keep 1 to 8 widths/).waitFor()
    assert.ok(await page.getByTestId('save-blockscene-settings').isDisabled(), 'an unnamed width blocks Save')
    await checklist.locator('input[name="editor-device-label-4"]').fill('Laptop')
    await checklist.locator('input[name="editor-device-width-4"]').fill('1280')
    await checklist.screenshot({ path: `artifacts/strapi${major}-settings-pane.png`, animations: 'disabled' })
    await page.getByTestId('save-blockscene-settings').click()
    await page.getByText('Settings saved.', { exact: true }).waitFor()
    const saved = (await api('GET', '/blockscene/settings')).data.settings.editor
    assert.deepEqual(saved.previewToolbar, ['modes', 'devices', 'actions', 'status'])
    assert.deepEqual(saved.previewDevices, ['fit', 'mobile', 'tablet', 'desktop', { label: 'Laptop', width: 1280 }])
    // A visual-editor-only view: width menu and Save/Publish, nothing else.
    await putSettings({ editor: { previewUrl, previewMode: 'preview', previewToolbar: ['devices', 'actions'], previewDevices: ['fit', { label: 'Laptop', width: 1280 }] } })
    await page.goto(docUrl)
    const pane = page.getByTestId('page-preview-pane')
    await pane.getByTestId('page-preview-actions').getByRole('button', { name: 'Save', exact: true }).waitFor()
    assert.equal(await pane.getByTestId('page-preview-modes').count(), 0, 'no mode buttons')
    assert.equal(await pane.getByTestId('blockscene-history').count(), 0, 'no undo / redo')
    assert.equal(await pane.getByTestId('page-preview-status').count(), 0, 'no status badge')
    await pane.getByTestId('page-preview-devices').getByRole('button').click()
    assert.equal(await page.getByRole('menuitem').count(), 2, 'only the configured widths')
    await page.getByRole('menuitem', { name: /Laptop · 1280 px/ }).click()
    await page.waitForFunction(() => document.querySelector('[data-testid="page-preview-stage"]')?.getAttribute('data-device') === 'px-1280')
    assert.equal(await pane.locator('iframe').evaluate(el => el.style.width), '1280px')
    await shot('pane-toolbar-reduced')
    // The content type's own choice replaces the global one: status only, a single width (no menu).
    await putSettings({ editor: { previewUrl, previewMode: 'preview', previewToolbar: ['devices', 'actions'] },
      contentTypes: { 'api::page.page': { previewToolbar: ['status'], previewDevices: ['desktop'] } } })
    await page.goto(docUrl)
    await pane.getByTestId('page-preview-status').waitFor()
    assert.equal(await pane.getByTestId('page-preview-devices').count(), 0, 'one width: no menu')
    assert.equal(await pane.getByTestId('page-preview-actions').getByRole('button').count(), 0, 'no Save / Publish')
    assert.equal(await page.getByTestId('page-preview-stage').getAttribute('data-device'), 'desktop')
    await putSettings({})
    await page.evaluate(() => localStorage.removeItem('blockscene:page-device'))
  })
  // Needs a lab host that registers the fixture panels in .local/strapi5/src/admin/app.js bootstrap (not kept in the lab):
  //   app.getPlugin('blockscene').apis.registerPanel({ id: 'smoke-notes', label: 'Notes', icon: 'info', contentTypes: ['api::page.page'],
  //     Component: ({ values, onChange }) => <input name="smoke-title" value={values.title || ''} onChange={e => onChange('title', e.target.value)} /> })
  //   app.getPlugin('blockscene').apis.registerPanel({ id: 'smoke-crash', label: 'Crash', open: 'modal', Component: () => { throw new Error('smoke') } })
  if (major === 5 && process.env.SMOKE_PANELS) await step('registered sidebar panels (Strapi 5): a host panel opens in the drawer and edits the form; a crashing one stays contained', async () => {
    await putSettings({ editor: { previewUrl: `${baseURL}/block-preview/index.html`, previewMode: 'preview' } })
    await page.goto(docUrl)
    const button = page.getByTestId('sidebar-panel-smoke-notes')
    await button.waitFor()
    assert.equal(await button.getAttribute('title'), 'Notes')
    await button.click()
    const panel = page.getByTestId('custom-panel-smoke-notes')
    await panel.locator('input[name="smoke-title"]').waitFor({ state: 'visible' })
    const box = await panel.boundingBox(), rail = await page.getByTestId('page-preview-sidebar').boundingBox()
    assert.ok(Math.abs(box.x - (rail.x + rail.width)) <= 1, `drawer beside the rail ${JSON.stringify({ box, rail })}`)
    await panel.locator('input[name="smoke-title"]').fill('From a registered panel')
    await page.waitForFunction(() => document.querySelector('input[name="title"]')?.value === 'From a registered panel')
    await page.getByTestId('page-preview-pane').screenshot({ path: `artifacts/strapi${major}-registered-panel.png`, animations: 'disabled' })
    await page.getByTestId('fields-panel-done').click(); await panel.waitFor({ state: 'detached' })
    await page.getByTestId('sidebar-panel-smoke-crash').click()
    await page.getByTestId('custom-panel-smoke-crash').getByRole('alert').waitFor()
    await page.getByTestId('fields-panel-done').click()
    await page.getByTestId('sidebar-panel-smoke-notes').waitFor()
    assert.equal(await page.getByTestId('page-preview-pane').count(), 1, 'the editor survives a crashing panel')
    // React reports the error the boundary caught: expected here, not a runtime error of the plugin.
    errors.splice(0, errors.length, ...errors.filter(error => !error.includes('smoke panel crash')))
    await putSettings({})
  })
  await step(`row actions${major === 5 ? ' (with undo, relations and the page preview)' : ''}: confirm delete, hide on the site (REST strip / flag), duplicate, copy two blocks and paste them on another page`, async () => {
    const shots = process.env.SHOTS || 'artifacts', suffix = major === 5 ? '' : '-4'
    const create = async (title, blocks) => { const res = await api('POST', '/content-manager/collection-types/api::page.page', { title, blocks }); assert.ok([200, 201].includes(res.status), JSON.stringify(res.data)); return res.data.data || res.data }
    const idOf = d => major === 4 ? d.id : d.documentId
    const target = major === 5 ? await create(`Related ${Date.now()}`, []) : null
    const source = await create(`Rows ${Date.now()}`, [{ __component: 'blocks.text', body: 'First text', ...(target && { pages: { connect: [{ documentId: target.documentId }] } }) }, { __component: 'blocks.text', body: 'Second text' }])
    const other = await create(`Paste target ${Date.now()}`, [{ __component: 'blocks.hero', title: 'Target hero', items: [{ label: 'a' }, { label: 'b' }] }])
    // Read-only content API token (lab only), removed at the end.
    const token = await api('POST', '/admin/api-tokens', { name: `smoke ${Date.now()}`, type: 'read-only', lifespan: null, permissions: [] }); assert.equal(token.status, 201)
    const rest = async (title, extra = '') => {
      const res = await fetch(`${baseURL}/api/pages?filters[title][$eq]=${encodeURIComponent(title)}&${major === 5 ? 'status=draft' : 'publicationState=preview'}&populate${major === 5 ? '[blocks][on][blocks.text][populate]=pages&populate[blocks][on][blocks.hero][populate]=items' : '=blocks'}${extra}`, { headers: { Authorization: `Bearer ${token.data.data.accessKey}` } })
      const body = await res.json(); assert.equal(res.status, 200, JSON.stringify(body)); const entry = body.data[0]; return (major === 5 ? entry : entry.attributes).blocks
    }
    const zoneRows = () => page.locator('ol[aria-describedby]').first().locator(':scope > li')
    const trash = i => zoneRows().nth(i).locator('button[aria-expanded]').first().locator('xpath=following-sibling::*[1]').getByRole('button', { name: /^Delete/ }).first()
    const saveDoc = async () => {
      const done = page.waitForResponse(res => res.url().includes('/content-manager/collection-types/api::page.page') && ['PUT', 'POST'].includes(res.request().method()))
      await page.getByRole('button', { name: 'Save', exact: true }).first().click(); const res = await done; assert.ok(res.ok(), await res.text())
    }
    try {
      await putSettings({})
      await page.goto(`/admin/content-manager/collection-types/api::page.page/${idOf(source)}`)
      await page.getByTestId('row-actions-blocks-1').waitFor()
      assert.equal(await page.getByTestId('row-actions-blocks-0').getByRole('button').count(), 3, 'eye, duplicate, copy')
      await zoneRows().first().locator('h3, [data-strapi-accordion-toggle]').first().locator('xpath=..').screenshot({ path: `${shots}/row-actions${suffix}.png`, animations: 'disabled' })
      // Confirm delete: Cancel keeps the row, Delete runs the native removal.
      await trash(1).click()
      const dialog = page.getByTestId('row-confirm-delete'); await dialog.waitFor()
      assert.match(await dialog.innerText(), /Delete block .*Second text\?|Delete block Text\?/)
      await page.getByRole('dialog').screenshot({ path: `${shots}/confirm-delete${suffix}.png`, animations: 'disabled' })
      await page.getByTestId('row-confirm-cancel').click(); await dialog.waitFor({ state: 'detached' })
      assert.equal(await zoneRows().count(), 2, 'cancel keeps the row')
      await trash(1).click(); await page.getByTestId('row-confirm-ok').click()
      await page.waitForFunction(() => document.querySelector('ol[aria-describedby]').querySelectorAll(':scope > li').length === 1)
      if (major === 5) { // the removal went through the form: undo brings it back
        await page.getByTestId('blockscene-history').first().getByRole('button', { name: /^Undo/ }).click()
        await page.waitForFunction(() => document.querySelector('ol[aria-describedby]').querySelectorAll(':scope > li').length === 2)
      } else await page.reload()
      await page.getByTestId('row-actions-blocks-1').waitFor()
      // Hide on the site: dimmed row with a badge; the content API drops it (strip) or flags it (flag).
      await page.getByTestId('row-hide-blocks-1').click()
      await page.getByTestId('row-hidden-blocks-1').waitFor()
      assert.equal(await zoneRows().nth(1).getAttribute('data-blockscene-hidden'), '')
      assert.equal(await page.getByTestId('row-hide-blocks-1').getAttribute('aria-pressed'), 'true')
      await zoneRows().nth(1).locator('button[aria-expanded]').first().locator('xpath=..').screenshot({ path: `${shots}/row-hidden${suffix}.png`, animations: 'disabled' })
      await saveDoc()
      assert.deepEqual((await rest(source.title)).map(b => b.body), ['First text'], 'strip: the hidden block is not in the REST response')
      await putSettings({ editor: { hiddenBlocks: 'flag' } })
      assert.deepEqual((await rest(source.title)).map(b => [b.body, b.bsHidden]), [['First text', false], ['Second text', true]], 'flag: sent with the attribute')
      const admin = (await api('GET', `/content-manager/collection-types/api::page.page/${idOf(source)}`)).data
      assert.equal((admin.data || admin).blocks.length, 2, 'admin reads keep hidden rows')
      // The attribute is known to the Content Manager (5.0 to 5.44 crash on a value it has no attribute for) but is never an input.
      await page.reload(); await page.getByTestId('row-hide-blocks-1').waitFor()
      await zoneRows().nth(1).locator('button[aria-expanded]').first().click()
      await page.waitForTimeout(300)
      assert.equal(await page.locator('[name$="bsHidden"]').count(), 0, 'no input for the hidden attribute')
      if (major === 5) {
        await putSettings({ editor: { previewUrl: `${baseURL}/block-preview/index.html` } })
        await page.reload(); await setMode('Fields + page')
        const frame = page.getByTestId('page-preview-pane').frameLocator('iframe')
        await frame.locator('[data-block-key][data-hidden] .bp-hidden').waitFor()
        assert.equal(await frame.locator('[data-block-key][data-hidden]').count(), 1, 'the preview dims the hidden block')
        await page.getByTestId('page-preview-pane').getByRole('button', { name: 'Fields', exact: true }).click()
      }
      await putSettings({ editor: { hiddenBlocks: 'off' } })
      await page.reload(); await page.getByTestId('row-actions-blocks-1').waitFor()
      assert.equal(await page.getByTestId('row-hide-blocks-1').count(), 0, 'off: no eye icon')
      assert.equal((await rest(source.title)).length, 2, 'off: nothing stripped')
      await putSettings({})
      await page.reload(); await page.getByTestId('row-hide-blocks-1').waitFor()
      await page.getByTestId('row-hide-blocks-1').click(); await page.getByTestId('row-hidden-blocks-1').waitFor({ state: 'detached' })
      // Duplicate: an identical row right below (relations kept on Strapi 5), saved as a new component.
      await page.getByTestId('row-duplicate-blocks-0').click()
      await page.waitForFunction(() => document.querySelector('ol[aria-describedby]').querySelectorAll(':scope > li').length === 3)
      const names = await zoneRows().evaluateAll(l => l.map(li => li.querySelector('button[aria-expanded]').textContent.trim()))
      assert.equal(names[1], names[0], `duplicate right below: ${names.join(' | ')}`)
      await saveDoc()
      const saved = await rest(source.title)
      assert.deepEqual(saved.map(b => b.body), ['First text', 'First text', 'Second text'])
      assert.notEqual(saved[0].id, saved[1].id, 'a new component, not the same row')
      if (major === 5) assert.deepEqual(saved.map(b => (b.pages || []).map(p => p.documentId)), [[target.documentId], [target.documentId], []], 'relations kept')
      // Copy / paste: selection mode from the zone bar's "…" menu, two blocks, pasted on another page; a zone that cannot take them refuses.
      await zoneMenu(); await page.getByTestId('zone-select-blocks').click()
      // The selection bar replaces the zone tools; each row's checkbox opens its header; Escape leaves.
      await page.getByTestId('zone-selection-blocks').waitFor()
      assert.equal(await toggle().count(), 0, 'selection bar instead of the zone tools')
      assert.ok(await page.getByTestId('row-select-blocks-0').evaluate(box => box.parentElement.nextElementSibling?.matches('button[aria-expanded]')), 'checkbox before the header toggle')
      assert.ok(await page.getByTestId('zone-copy-blocks').isDisabled(), 'Copy needs a selection')
      await page.keyboard.press('Escape'); await page.getByTestId('zone-selection-blocks').waitFor({ state: 'detached' })
      assert.equal(await page.getByTestId('row-select-blocks-0').count(), 0, 'Escape leaves selection mode')
      await zoneMenu(); await page.getByTestId('zone-select-blocks').click()
      // Select all, then none (the box is indeterminate while only some are selected).
      const all = page.getByTestId('zone-select-all-blocks')
      await all.check(); assert.equal(await page.getByTestId('zone-selected-blocks').innerText(), '3 selected')
      assert.equal(await all.getAttribute('aria-label'), 'Select none')
      await all.click(); assert.equal(await page.getByTestId('zone-selected-blocks').innerText(), 'Select all')
      await page.getByTestId('row-select-blocks-0').check(); await page.getByTestId('row-select-blocks-2').check()
      assert.ok(await all.evaluate(box => box.indeterminate), 'some selected: indeterminate')
      await page.getByTestId('block-accordion-controls-blocks').locator('xpath=../..').screenshot({ path: `${shots}/zone-selection${suffix}.png`, animations: 'disabled' })
      await page.getByTestId('zone-copy-blocks').click()
      await page.getByText('2 blocks copied', { exact: false }).first().waitFor()
      assert.equal(await page.getByTestId('row-select-blocks-0').count(), 0, 'selection mode ends after copying')
      const clip = await page.evaluate(() => JSON.parse(localStorage.getItem('blockscene:clipboard:v1')))
      assert.equal(clip.v, 1); assert.deepEqual(clip.rows.map(r => r.body), ['First text', 'Second text']); assert.ok(clip.rows.every(r => r.id === undefined))
      await page.goto(`/admin/content-manager/collection-types/api::page.page/${idOf(other)}`)
      const paste = page.getByTestId('zone-paste-blocks')
      await zoneMenu(); await paste.waitFor()
      assert.match(await paste.innerText(), /Paste 2 blocks/)
      await page.screenshot({ path: `${shots}/paste${suffix}.png`, animations: 'disabled' })
      await page.keyboard.press('Escape'); await paste.waitFor({ state: 'detached' })
      // An empty zone has no label row: its bar sits right after its native add button.
      assert.ok(await page.getByTestId('zone-more-sidebar').evaluate(el => /Add a component to sidebar/i.test(el.closest('[data-blockscene-zone-controls="sidebar"]').previousElementSibling?.textContent.trim())), 'empty zone: after the add button')
      await zoneMenu('sidebar'); await page.getByTestId('zone-paste-sidebar').click() // sidebar: max 1, the two blocks do not fit
      await page.getByText('Nothing was pasted', { exact: false }).first().waitFor()
      assert.equal(await page.locator('ol[aria-describedby]').count(), 1, 'refused: the sidebar stays empty')
      await zoneMenu(); await paste.click()
      await page.waitForFunction(() => document.querySelector('ol[aria-describedby]').querySelectorAll(':scope > li').length === 3)
      await saveDoc()
      const pasted = await rest(other.title)
      assert.deepEqual(pasted.map(b => b.__component), ['blocks.hero', 'blocks.text', 'blocks.text']); assert.deepEqual(pasted.slice(1).map(b => b.body), ['First text', 'Second text'])
      if (major === 5) {
        assert.deepEqual(pasted[1].pages.map(p => p.documentId), [target.documentId], 'relations travel with the clipboard')
        // The page preview offers Paste in its seams while the clipboard holds blocks; the same all-or-nothing rules apply.
        await putSettings({ editor: { previewUrl: `${baseURL}/block-preview/index.html` } })
        await page.reload(); await setMode('Fields + page')
        const start = page.getByTestId('page-preview-pane').frameLocator('iframe').locator('[data-testid="bp-gap-start"]')
        await start.hover(); await start.locator('[data-paste]').click()
        await page.waitForFunction(() => document.querySelector('ol[aria-describedby]').querySelectorAll(':scope > li').length === 5)
        assert.deepEqual((await zoneRows().evaluateAll(l => l.map(li => li.innerText.split('\n')[0]))).slice(0, 3).map(n => n.replace(/ - .*$/, '')), ['Text', 'Text', 'Hero'], 'pasted at the start')
        await page.getByTestId('page-preview-pane').getByRole('button', { name: 'Fields', exact: true }).click()
      }
    } finally {
      await api('DELETE', `/admin/api-tokens/${token.data.data.id}`)
      for (const doc of [source, other, target].filter(Boolean)) await api('DELETE', `/content-manager/collection-types/api::page.page/${idOf(doc)}`)
      await page.evaluate(() => localStorage.removeItem('blockscene:clipboard:v1'))
      await putSettings({})
    }
  })
  const GROUPS_MODE = process.env.BLOCK_PICKER_GROUPS || '1'
  await step(`layout groups, ${GROUPS_MODE === '1' ? 'configured pair' : 'no config'}: gallery insertion, server publish guard (single, bulk), balanced documents publish${major === 5 ? ', preview group tools and diagnostics' : ''}`, async () => {
    const catalogData = (await api('GET', '/blockscene/catalog')).data
    if (GROUPS_MODE === '1') assert.deepEqual(catalogData.groups, { 'group.section': 'group.end' }, 'catalog exposes the validated map')
    else assert.equal(catalogData.groups, null, 'no config (or malformed config) means no groups')
    // Gallery, form mode: a configured OPEN brings its CLOSE in the same unsaved change; without config it is an ordinary block.
    await page.goto(docUrl); await page.getByTestId('block-accordion-controls-blocks').waitFor(); await rows().first().waitFor()
    const before = await page.locator('ol[aria-describedby]').first().locator(':scope > li').count()
    await openGallery()
    await page.getByTestId('blockscene-group.section').locator('button').first().dblclick()
    await page.waitForFunction(n => document.querySelector('ol[aria-describedby]').querySelectorAll(':scope > li').length === n, before + (GROUPS_MODE === '1' ? 2 : 1))
    // Only the `blocks` zone (the first list): the sidebar zone renders its own list on the same page.
    const rowNames = () => page.locator('ol[aria-describedby]').first().locator(':scope > li').evaluateAll(l => l.map(li => li.innerText.split('\n')[0]))
    const expectedTail = GROUPS_MODE === '1' ? [/Section \(group open\)/, /Section end/] : [/Section \(group open\)/]
    await page.waitForFunction(n => [...document.querySelector('ol[aria-describedby]').querySelectorAll(':scope > li')].slice(-n).every(li => /Section/.test(li.innerText)), expectedTail.length).catch(() => {})
    const names = await rowNames(); const tail = names.slice(-expectedTail.length)
    expectedTail.forEach((re, i) => assert.match(tail[i] || '', re, `OPEN${GROUPS_MODE === '1' ? ' then CLOSE' : ''} appended in order; rows: ${names.join(' | ')}`))
    // Trusted path: the server refuses publishing an unbalanced draft (single and bulk); balanced (incl. empty pair) publishes.
    const create = blocks => api('POST', '/content-manager/collection-types/api::page.page', { title: `Groups ${Date.now()}`, blocks })
    const idOf = res => major === 4 ? (res.data?.data?.id ?? res.data?.id) : (res.data?.data?.documentId ?? res.data?.documentId)
    const publish = id => api('POST', `/content-manager/collection-types/api::page.page/${id}/actions/publish`)
    const bulkPublish = ids => api('POST', '/content-manager/collection-types/api::page.page/actions/bulkPublish', major === 4 ? { ids } : { documentIds: ids })
    const bad = await create([{ __component: 'group.end' }, { __component: 'blocks.text', body: 'loose' }, { __component: 'group.section', note: 'orphan' }]); assert.ok([200, 201].includes(bad.status), JSON.stringify(bad.data)); const badId = idOf(bad)
    const good = await create([{ __component: 'group.section', note: 'empty' }, { __component: 'group.end' }, { __component: 'group.section' }, { __component: 'blocks.text', body: 'child' }, { __component: 'group.end' }]); const goodId = idOf(good)
    if (GROUPS_MODE === '1') {
      const single = await publish(badId); assert.equal(single.status, 400, JSON.stringify(single.data)); assert.match(single.data.error.message, /not balanced/)
      assert.deepEqual(single.data.error.details.errors.map(e => e.code), ['closeBeforeOpen', 'unclosed'])
      const bulk = await bulkPublish([badId]); assert.equal(bulk.status, 400, JSON.stringify(bulk.data))
      const still = (await api('GET', `/content-manager/collection-types/api::page.page/${badId}`)).data; assert.equal((still.data || still).publishedAt ?? null, null, 'draft stays unpublished')
    } else {
      const single = await publish(badId); assert.ok([200, 201].includes(single.status), `no config: markers are ordinary blocks (${single.status})`)
    }
    if (major === 5) {
      // Direct document-service paths (lab-only route): create/update with status 'published' run the repository's
      // internal publish, not the facade action; the guard intercepts the facade call.
      const direct = await api('POST', '/api/lab-direct/create-published', { data: { title: `Direct ${Date.now()}`, blocks: [{ __component: 'group.end' }, { __component: 'group.section' }] } }, false)
      if (GROUPS_MODE === '1') { assert.equal(direct.status, 400, JSON.stringify(direct.data).slice(0, 200)); assert.match(direct.data.message, /not balanced/); assert.deepEqual(direct.data.details.errors.map(e => e.code), ['closeBeforeOpen', 'unclosed']) }
      else { assert.equal(direct.status, 200, JSON.stringify(direct.data).slice(0, 200)); await api('DELETE', `/content-manager/collection-types/api::page.page/${direct.data.documentId}`) }
      const directOk = await api('POST', '/api/lab-direct/create-published', { data: { title: `Direct ok ${Date.now()}`, blocks: [{ __component: 'group.section' }, { __component: 'group.end' }] } }, false)
      assert.equal(directOk.status, 200, JSON.stringify(directOk.data).slice(0, 200)); assert.ok(directOk.data.publishedAt, 'balanced document created as published')
      // update with status 'published' writes the new rows and publishes them: unbalanced rows are refused, the draft stays.
      const upd = await api('POST', `/api/lab-direct/update-published/${directOk.data.documentId}`, { data: { blocks: [{ __component: 'group.section' }] } }, false)
      if (GROUPS_MODE === '1') assert.equal(upd.status, 400, JSON.stringify(upd.data).slice(0, 200)); else assert.equal(upd.status, 200)
      const updOk = await api('POST', `/api/lab-direct/update-published/${directOk.data.documentId}`, { data: { blocks: [{ __component: 'group.section' }, { __component: 'blocks.text', body: 'x' }, { __component: 'group.end' }] } }, false)
      assert.equal(updOk.status, 200, JSON.stringify(updOk.data).slice(0, 200))
      await api('DELETE', `/content-manager/collection-types/api::page.page/${directOk.data.documentId}`)
    }
    const ok = await publish(goodId); assert.ok([200, 201].includes(ok.status), JSON.stringify(ok.data))
    const okBulk = await bulkPublish([goodId]); assert.ok([200, 201].includes(okBulk.status), JSON.stringify(okBulk.data))
    if (major === 5) {
      await putSettings({ editor: { previewUrl: `${baseURL}/block-preview/index.html`, previewMode: 'form' } })
      const frame = page.getByTestId('page-preview-pane').frameLocator('iframe')
      const openSplit = async id => {
        await page.goto(`/admin/content-manager/collection-types/api::page.page/${id}`)
        await setMode('Fields + page')
        await page.waitForFunction(() => document.querySelector('[data-testid="page-preview-state"]')?.getAttribute('data-ready') === 'true')
      }
      const names = () => rows().evaluateAll(l => l.map(li => li.innerText.split('\n')[0]))
      await openSplit(goodId)
      if (GROUPS_MODE === '1') {
        // Two groups from the saved document; the first is an empty pair. "+ Group" at the start adds a third (OPEN + CLOSE, unsaved).
        await frame.locator('[data-group-key]').nth(1).waitFor()
        assert.equal(await frame.locator('[data-group-key]').count(), 2)
        const start = frame.locator('[data-testid="bp-gap-start"]'); await start.hover(); await start.locator('[data-insert-group]').click()
        await page.waitForFunction(() => document.querySelectorAll('ol[aria-describedby] > li').length === 7)
        assert.match((await names())[0], /Section \(group open\)/); assert.match((await names())[1], /Section end/)
        await frame.locator('[data-group-key]').nth(2).waitFor() // the frame re-renders ~120 ms after the form change
        const created = frame.locator('[data-group-key]').first(); const createdKey = await created.getAttribute('data-group-key')
        assert.ok(!createdKey.includes('#'), `the new (unsaved) group is first: ${createdKey}`)
        // A child through the group's inner gap lands between the pair; the whole group then moves down and is removed as one range.
        const inner = created.locator(`[data-testid="bp-gap-${createdKey}"]`); await inner.hover(); await inner.locator('.bp-insert').first().click()
        const picker = page.getByRole('dialog').filter({ hasText: 'Block gallery' })
        await picker.getByTestId('blockscene-blocks.text').locator('button').first().dblclick(); await picker.waitFor({ state: 'hidden' })
        await page.waitForFunction(() => document.querySelectorAll('ol[aria-describedby] > li').length === 8)
        const afterChild = await names(); const gapAfter = await inner.locator('.bp-insert').first().getAttribute('data-after')
        assert.match(afterChild[1], /Text/, `child between OPEN and CLOSE (created ${createdKey}, gap after ${gapAfter}); rows: ${afterChild.join(' | ')}`); assert.match(afterChild[2], /Section end/)
        // The seam picker path: choosing the configured OPEN from a gap picker also lands with its CLOSE right after it.
        const childBlock = created.locator('[data-block-uid="blocks.text"]').first()
        const childKey = await childBlock.getAttribute('data-block-key')
        const childGap = created.locator(`[data-testid="bp-gap-${childKey}"]`); await childGap.hover(); await childGap.locator('.bp-insert').first().click()
        await picker.getByTestId('blockscene-group.section').locator('button').first().dblclick(); await picker.waitFor({ state: 'hidden' })
        await page.waitForFunction(() => document.querySelector('ol[aria-describedby]').querySelectorAll(':scope > li').length === 10)
        assert.deepEqual((await names()).slice(0, 5).map(n => n.replace(/ - .*$/, '')), ['Section (group open)', 'Text', 'Section (group open)', 'Section end (group close)', 'Section end (group close)'], 'nested pair from the seam picker: OPEN, CLOSE adjacent')
        assert.equal(await page.getByTestId('page-preview-diagnostics').count(), 0, 'still balanced')
        await frame.locator(`[data-group-key="${createdKey}"] [data-group-key] [data-remove-group]`).click()
        await page.waitForFunction(() => document.querySelector('ol[aria-describedby]').querySelectorAll(':scope > li').length === 8)
        await frame.locator(`[data-group-key="${createdKey}"] [data-group-key]`).waitFor({ state: 'detached' })
        await created.locator('[data-move="down"]').first().click()
        await page.waitForFunction(() => /Section \(group open\)/.test(document.querySelectorAll('ol[aria-describedby] > li')[2]?.innerText || '') && /Text/.test(document.querySelectorAll('ol[aria-describedby] > li')[3]?.innerText || ''))
        assert.equal(await page.getByTestId('page-preview-diagnostics').count(), 0, 'balanced: no diagnostics')
        await frame.locator(`[data-group-key="${createdKey}"] [data-remove-group]`).click()
        await page.waitForFunction(() => document.querySelectorAll('ol[aria-describedby] > li').length === 5)
        await frame.locator('[data-group-key]').nth(2).waitFor({ state: 'detached' })
        assert.equal(await frame.locator('[data-group-key]').count(), 2, 'created group removed with its child; saved groups untouched')
        // Malformed saved draft: diagnostics name the rows, nothing is repaired, native Publish is refused with the server message.
        await openSplit(badId)
        const diag = page.getByTestId('page-preview-diagnostics').first(); await diag.waitFor()
        assert.match(await diag.innerText(), /2 block group problems; publishing is refused until fixed/, 'compact summary always visible')
        await diag.locator('summary').click() // details on demand
        assert.match(await diag.innerText(), /Row 1: close marker "group.end" has no open marker before it/)
        assert.match(await diag.innerText(), /Row 3: group "group.section" is not closed/)
        // Explicit repair (never automatic): the button inserts the missing close right after the group; the stray close stays for the editor.
        await diag.getByTestId('diag-insert-close-2').click()
        await page.waitForFunction(() => document.querySelector('ol[aria-describedby]').querySelectorAll(':scope > li').length === 4)
        assert.match((await names())[3], /Section end/, 'close inserted after the unclosed group')
        assert.match(await page.getByTestId('page-preview-diagnostics').first().innerText(), /1 block group problem;/, 'only the stray close remains')
        assert.equal(await frame.locator('[data-block-uid="group.end"]').count(), 1, 'stray close stays visible')
        await page.getByTestId('page-preview-actions').getByRole('button', { name: 'Publish', exact: true }).click()
        await page.getByText(/not balanced/).first().waitFor({ timeout: 15000 })
      } else {
        await frame.locator('[data-block-key]').nth(4).waitFor()
        assert.equal(await frame.locator('[data-group-key]').count(), 0, 'no config: no group boxes')
        assert.equal(await frame.locator('[data-insert-group]').count(), 0, 'no config: no "+ Group" control')
        assert.equal(await page.getByTestId('page-preview-diagnostics').count(), 0)
      }
      await putSettings({})
    }
    for (const id of [badId, goodId]) await api('DELETE', `/content-manager/collection-types/api::page.page/${id}`)
  })
  await step('admin locale drives the plugin chrome: pt-BR, fr, en and an unsupported locale (ja) falls back to English', async () => {
    const cases = [['fr', { expand: 'Tout déplier', undo: 'Annuler', split: 'Champs + page', palette: 'Palette des wireframes' }],
      ['pt-BR', { expand: 'Expandir tudo', undo: 'Desfazer', split: 'Campos + página', palette: 'Paleta dos wireframes' }],
      ['ja', { expand: 'Expand all', undo: 'Undo', split: 'Fields + page', palette: 'Wireframe palette' }],
      ['en', { expand: 'Expand all', undo: 'Undo', split: 'Fields + page', palette: 'Wireframe palette' }]]
    if (major === 5) await putSettings({ editor: { previewUrl: `${baseURL}/block-preview/index.html` } })
    for (const [locale, expect] of cases) {
      await page.evaluate(value => localStorage.setItem('strapi-admin-language', value), locale)
      await page.goto(docUrl); await toggle().waitFor(); await waitState('false') // the initial state closes every row
      await page.waitForFunction(text => document.querySelector('[data-testid="zone-toggle-blocks"]')?.textContent === text, expect.expand, { timeout: 5000 }).catch(() => {})
      assert.equal(await toggle().innerText(), expect.expand, `${locale}: zone toggle`)
      if (major === 5) {
        await page.getByTestId('blockscene-history').first().getByRole('button', { name: expect.undo, exact: true }).waitFor()
        await page.getByTestId('zone-mode-menu').getByRole('button').click()
        await page.getByRole('menuitem', { name: expect.split, exact: true }).waitFor(); await page.keyboard.press('Escape')
      }
      await page.goto('/admin/settings/blockscene'); await page.getByTestId('save-blockscene-settings').waitFor()
      await page.getByText(expect.palette, { exact: true }).first().waitFor()
      const text = await page.locator('body').innerText()
      assert.ok(!/blockscene\.[a-zA-Z]/.test(text), `${locale}: no raw message ids on the settings page`)
    }
    if (major === 5) {
      await putSettings({})
      await page.goto(docUrl); await toggle().waitFor()
      assert.equal(await page.getByTestId('zone-mode-menu').count(), 0, 'no preview route: no mode menu (the Settings page explains it)')
    }
  })
  await page.goto('/admin/settings/image-pipeline')
  await page.getByTestId('save-image-settings').waitFor()
  await page.getByLabel('Maximum dimension (px)', { exact: true }).fill('1600')
  await page.getByTestId('save-image-settings').click()
  await page.getByText('Settings saved.', { exact: true }).waitFor()
  await shot('image-settings')
  checks.push('image settings')
  assert.deepEqual(errors, [], 'Browser runtime errors')
  writeFileSync(`artifacts/strapi${major}-browser.json`, JSON.stringify({ date: new Date().toISOString(), strapi: major, passed: true, checks, runtimeErrors: errors, consoleMessages: [...consoleMessages] }, null, 2))
  console.log(`Strapi ${major}${GROUPS_MODE === '1' ? '' : ` (BLOCK_PICKER_GROUPS=${GROUPS_MODE})`}: ${checks.length} checks passed`)
} catch(error) {
  await page.screenshot({ path: `artifacts/strapi${major}-failure.png`, fullPage: true, animations: 'disabled' })
  writeFileSync(`artifacts/strapi${major}-failure.txt`, `${error.stack}\n${errors.join('\n')}\n${[...consoleMessages].join('\n')}\n${(await page.locator('body').innerText()).slice(0,7000)}`)
  throw error
} finally {
  if (token) { await api('PUT', '/blockscene/settings', {}).catch(() => {}); if (uploadId) await api('DELETE', `/upload/files/${uploadId}`).catch(() => {}) }
  rmSync(previewFile, { force: true })
  await browser.close()
}
