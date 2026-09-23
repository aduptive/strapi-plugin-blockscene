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
  rmSync(previewFile, { force: true })

  // Reuse the API session in the browser (avoids the login rate limiter on reruns; nothing is persisted to disk).
  await page.addInitScript(({ token, user }) => {
    if (!localStorage.getItem('jwtToken')) { localStorage.setItem('jwtToken', JSON.stringify(token)); localStorage.setItem('isLoggedIn', 'true'); localStorage.setItem('userInfo', JSON.stringify(user)) }
  }, { token, user: login.data.data.user })
  await page.goto('/admin/content-manager/collection-types/api::page.page/create')
  await page.getByRole('textbox', { name: /^title/i }).first().fill(`Plugin smoke ${Date.now()}`)
  await step('the native "Add a component to blocks" button opens the gallery', async () => {
    await page.getByRole('button', { name: /Add a component to blocks/ }).click()
    await page.getByTestId('blockscene-blocks.hero').waitFor()
    assert.equal(await page.getByText(/Pick one component/i).count(), 0, 'native category picker stays closed')
    await page.keyboard.press('Escape'); await page.getByTestId('blockscene-blocks.hero').waitFor({ state: 'detached' })
  })
  await page.getByTestId('open-gallery-blocks').click()
  await page.getByTestId('blockscene-blocks.hero').waitFor()
  await step('configured image is used and the missing automatic image falls back to a wireframe', async () => {
    await page.getByTestId('blockscene-blocks.hero').locator('[data-thumb="0"] img').waitFor()
    await page.getByTestId('blockscene-blocks.text').locator('[data-thumb="wireframe"] svg[data-wireframe="generic"]').waitFor()
  })
  await shot('gallery')
  await step('gallery header: count, category sections, field list toggle, columns slider, search combined with the category filter', async () => {
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
    const select = page.getByTestId('block-category-blocks')
    if (await select.count()) {
      await select.getByRole('combobox').click(); const option = page.getByRole('option').nth(1); const optionText = await option.textContent(); await option.click()
      assert.match(await count.textContent(), /^\d+ of \d+$/, 'filtered count while a category is selected')
      const chosen = optionText.replace(/ \(\d+\)$/, '')
      assert.equal(await page.locator('[data-testid^="block-group-"]').count(), 1, 'one section for the chosen category'); assert.ok((await page.locator('[data-testid^="block-group-"]').first().textContent()).startsWith(chosen))
      await page.locator('input[name="block-search-blocks"]').fill('zzz-nothing')
      await page.getByText('No blocks found.', { exact: true }).waitFor(); await page.getByRole('button', { name: 'Clear search', exact: true }).last().click()
      assert.match(await count.textContent(), /^\d+ blocks$/, 'reset clears search and category')
    }
  })
  await page.locator('input[name="block-search-blocks"]').fill('not-a-real-block')
  await page.getByText('No blocks found.', { exact: true }).waitFor()
  await page.locator('input[name="block-search-blocks"]').fill('banner')
  await page.getByTestId('blockscene-blocks.hero').click()
  await page.getByTestId('open-gallery-sidebar').click()
  assert.equal(await page.getByTestId('blockscene-blocks.hero').count(), 0, 'Sidebar only allows text')
  await page.getByTestId('blockscene-blocks.text').click()
  await page.getByTestId('open-gallery-sidebar').waitFor({ state: 'detached' })
  await step('accordion controls appear for a full zone too', async () => { await page.getByTestId('block-accordion-controls-sidebar').waitFor() })
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
  await page.getByTestId('open-gallery-blocks').waitFor()
  const docUrl = page.url()
  // Add a second block so "open/close all" has more than one accordion in the zone.
  await page.getByTestId('open-gallery-blocks').click()
  await page.getByTestId('blockscene-blocks.text').click()
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
  await step('open all / close all drive the native accordions per zone', async () => {
    const controls = page.getByTestId('block-accordion-controls-blocks')
    await controls.getByRole('button', { name: 'Open all blocks' }).click()
    await waitOpenCount(2)
    assert.equal((await expanded()).filter(v => v === 'false').length, 1, 'sidebar zone untouched')
    await shot('accordions-open')
    // Editing after the initial application must not re-close anything.
    await page.locator('input[name="blocks.0.title"]').fill('Edited without reapply')
    await new Promise(r => setTimeout(r, 1200))
    assert.deepEqual((await expanded()).slice(0, 2), ['true', 'true'])
    await controls.getByRole('button', { name: 'Close all blocks' }).click()
    await waitState('false')
  })
  await step('remember mode reuses the last explicit open/close all action', async () => {
    await putSettings({ editor: { initialState: 'remember' } })
    await page.getByTestId('block-accordion-controls-blocks').getByRole('button', { name: 'Open all blocks' }).click()
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
    assert.equal(await page.getByRole('button', { name: 'Close all blocks' }).count(), 0)
    await putSettings({ editor: { showOpenAll: false, showCloseAll: false } })
    await page.goto(docUrl); await page.getByTestId('open-gallery-blocks').waitFor(); await waitState('false')
    assert.equal(await page.getByTestId('block-accordion-controls-blocks').count(), 0)
    await firstHeader().click() // native header still works
    await page.waitForFunction(() => document.querySelector('ol[aria-describedby] > li').querySelector('button[aria-expanded]').getAttribute('aria-expanded') === 'true')
  })
  await step('panel bypass restores the native editor and keeps unsaved edits; re-enabling works', async () => {
    await putSettings({ editor: { enabled: false } })
    await page.goto(docUrl)
    await page.getByRole('button', { name: /Add a component to/i }).first().waitFor()
    assert.equal(await page.getByTestId('open-gallery-blocks').count(), 0)
    assert.equal(await page.getByTestId('block-accordion-controls-blocks').count(), 0)
    if (await firstHeader().getAttribute('aria-expanded') !== 'true') await firstHeader().click()
    await page.locator('input[name="blocks.0.title"]').fill('Native edit kept')
    await putSettings({ editor: { enabled: true } })
    await new Promise(r => setTimeout(r, 1500))
    assert.equal(await page.locator('input[name="blocks.0.title"]').inputValue(), 'Native edit kept', 'settings change does not reload the form')
    await shot('bypass')
    await page.goto(docUrl); await page.getByTestId('open-gallery-blocks').waitFor()
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
    if (major === 5) { await page.locator('input[name="editor-previewUrl"]').waitFor() } else { await page.getByText('Strapi 5 distribution only', { exact: false }).waitFor() }
    await shot('settings')
  })
  await step('palette change reaches the gallery wireframe without rebuild', async () => {
    await page.goto(docUrl); await page.getByTestId('open-gallery-blocks').click()
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
    await page.goto(docUrl); await page.getByTestId('open-gallery-blocks').click()
    const img = page.getByTestId('blockscene-blocks.text').locator('[data-thumb="0"] img')
    await img.waitFor(); assert.match(await img.getAttribute('src'), /\/uploads\//)
    await shot('manual-thumb')
    await page.keyboard.press('Escape')
    await page.goto('/admin/settings/blockscene')
    await page.getByTestId('settings-blocks.text').getByRole('button', { name: 'Use automatic image' }).click()
    await page.getByTestId('save-blockscene-settings').click()
    await page.getByText('Settings saved.', { exact: true }).waitFor()
    assert.equal((await api('GET', '/blockscene/settings')).data.settings.components['blocks.text'], undefined)
    await page.goto(docUrl); await page.getByTestId('open-gallery-blocks').click()
    await page.getByTestId('blockscene-blocks.text').locator('[data-thumb="wireframe"]').waitFor()
    await page.keyboard.press('Escape')
  })
  await step('deleted media is reported and the card advances to the next source', async () => {
    await putSettings({ components: { 'blocks.text': { mediaId: uploadId, template: 'faq' } } })
    assert.equal((await api('DELETE', `/upload/files/${uploadId}`)).status, 200); uploadId = null
    await page.goto('/admin/settings/blockscene')
    await page.getByTestId('settings-blocks.text').getByText('The selected media no longer exists; the next source is used.').waitFor()
    await page.goto(docUrl); await page.getByTestId('open-gallery-blocks').click()
    await page.getByTestId('blockscene-blocks.text').locator('[data-thumb="wireframe"] svg[data-wireframe="faq"]').waitFor()
    await page.keyboard.press('Escape')
  })
  await step('local capture output is consumed as the automatic image and a broken image recovers', async () => {
    execFileSync(process.execPath, ['scripts/capture-previews.mjs', '--manifest', 'examples/static-preview/manifest.json', '--out', `.local/strapi${major}/public/block-previews`, '--only', 'blocks.text'], { stdio: 'inherit' })
    assert.ok(existsSync(previewFile))
    await putSettings({})
    await page.goto(docUrl); await page.getByTestId('open-gallery-blocks').click()
    const img = page.getByTestId('blockscene-blocks.text').locator('[data-thumb="0"] img')
    await img.waitFor(); assert.match(await img.getAttribute('src'), /blocks\.text\.webp/)
    await shot('captured-thumb')
    await page.keyboard.press('Escape')
  })
  if (major === 5) await step('page preview (Strapi 5): split mode, generic frontend page, select, inline title, modal text edit, media, no writes', async () => {
    const previewUrl = `${baseURL}/block-preview/index.html`
    await putSettings({ editor: { previewUrl, previewMode: 'form' } })
    await page.goto(docUrl)
    const modes = page.getByTestId('page-preview-modes').first()
    await modes.getByRole('button', { name: 'Fields + page' }).click()
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
    // Side by side: a rich "body" click focuses the native textarea on the left (no modal); typing updates the frame.
    const modal = page.getByTestId('field-editor-modal')
    await frame.locator('[data-block-uid="blocks.text"] [data-block-field="body"]').click()
    await page.waitForFunction(() => document.activeElement?.getAttribute('name') === 'blocks.1.body')
    assert.equal(await modal.count(), 0, 'no modal in side by side')
    await page.keyboard.type('Body typed natively')
    await frame.getByText('Body typed natively', { exact: true }).waitFor()
    // Preview-only mode keeps the modal: Cancel discards, Apply updates form and frame.
    await page.getByTestId('page-preview-pane').getByRole('button', { name: 'Visual editor', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('[data-testid="page-preview-state"]')?.getAttribute('data-mode') === 'preview')
    await frame.locator('[data-block-uid="blocks.text"] [data-block-field="body"]').click()
    await modal.waitFor()
    await modal.locator('textarea[name="value"], input[name="value"]').first().fill('discard me')
    await page.getByRole('button', { name: 'Cancel', exact: true }).click(); await modal.waitFor({ state: 'hidden' })
    assert.equal(await frame.getByText('discard me').count(), 0)
    await frame.locator('[data-block-uid="blocks.text"] select[data-fields]').selectOption('body')
    await modal.waitFor()
    await modal.locator('textarea[name="value"], input[name="value"]').first().fill('Body from the modal')
    await page.getByTestId('field-editor-apply').click(); await modal.waitFor({ state: 'hidden' })
    await frame.getByText('Body from the modal', { exact: true }).waitFor()
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
    await picker.getByTestId('blockscene-blocks.text').click(); await picker.waitFor({ state: 'hidden' })
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
  const GROUPS_MODE = process.env.BLOCK_PICKER_GROUPS || '1'
  await step(`layout groups, ${GROUPS_MODE === '1' ? 'configured pair' : 'no config'}: gallery insertion, server publish guard (single, bulk), balanced documents publish${major === 5 ? ', preview group tools and diagnostics' : ''}`, async () => {
    const catalogData = (await api('GET', '/blockscene/catalog')).data
    if (GROUPS_MODE === '1') assert.deepEqual(catalogData.groups, { 'group.section': 'group.end' }, 'catalog exposes the validated map')
    else assert.equal(catalogData.groups, null, 'no config (or malformed config) means no groups')
    // Gallery, form mode: a configured OPEN brings its CLOSE in the same unsaved change; without config it is an ordinary block.
    await page.goto(docUrl); await page.getByTestId('open-gallery-blocks').waitFor(); await rows().first().waitFor()
    const before = await page.locator('ol[aria-describedby]').first().locator(':scope > li').count()
    await page.getByTestId('open-gallery-blocks').click()
    await page.getByTestId('blockscene-group.section').click()
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
        await page.getByTestId('page-preview-modes').first().getByRole('button', { name: 'Fields + page' }).click()
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
        await picker.getByTestId('blockscene-blocks.text').click(); await picker.waitFor({ state: 'hidden' })
        await page.waitForFunction(() => document.querySelectorAll('ol[aria-describedby] > li').length === 8)
        const afterChild = await names(); const gapAfter = await inner.locator('.bp-insert').first().getAttribute('data-after')
        assert.match(afterChild[1], /Text/, `child between OPEN and CLOSE (created ${createdKey}, gap after ${gapAfter}); rows: ${afterChild.join(' | ')}`); assert.match(afterChild[2], /Section end/)
        // The seam picker path: choosing the configured OPEN from a gap picker also lands with its CLOSE right after it.
        const childBlock = created.locator('[data-block-uid="blocks.text"]').first()
        const childKey = await childBlock.getAttribute('data-block-key')
        const childGap = created.locator(`[data-testid="bp-gap-${childKey}"]`); await childGap.hover(); await childGap.locator('.bp-insert').first().click()
        await picker.getByTestId('blockscene-group.section').click(); await picker.waitFor({ state: 'hidden' })
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
    const cases = [['fr', { add: 'Ajouter un bloc', openAll: 'Ouvrir tous les blocs', split: 'Champs + page', palette: 'Palette des wireframes' }],
      ['pt-BR', { add: 'Adicionar bloco', openAll: 'Abrir todos os blocos', split: 'Campos + página', palette: 'Paleta dos wireframes' }],
      ['ja', { add: 'Add block', openAll: 'Open all blocks', split: 'Fields + page', palette: 'Wireframe palette' }],
      ['en', { add: 'Add block', openAll: 'Open all blocks', split: 'Fields + page', palette: 'Wireframe palette' }]]
    for (const [locale, expect] of cases) {
      await page.evaluate(value => localStorage.setItem('strapi-admin-language', value), locale)
      await page.goto(docUrl); await page.getByTestId('open-gallery-blocks').waitFor()
      assert.match(await page.getByTestId('open-gallery-blocks').innerText(), new RegExp(expect.add), `${locale}: gallery button`)
      await page.getByRole('button', { name: expect.openAll, exact: true }).first().waitFor()
      if (major === 5) await page.getByTestId('page-preview-modes').first().getByRole('button', { name: expect.split, exact: true }).waitFor()
      await page.goto('/admin/settings/blockscene'); await page.getByTestId('save-blockscene-settings').waitFor()
      await page.getByText(expect.palette, { exact: true }).first().waitFor()
      const text = await page.locator('body').innerText()
      assert.ok(!/blockscene\.[a-zA-Z]/.test(text), `${locale}: no raw message ids on the settings page`)
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
  writeFileSync(`artifacts/strapi${major}-browser.json`, JSON.stringify({ date: new Date().toISOString(), strapi: major, passed: true, checks, runtimeErrors: errors }, null, 2))
  console.log(`Strapi ${major}${GROUPS_MODE === '1' ? '' : ` (BLOCK_PICKER_GROUPS=${GROUPS_MODE})`}: ${checks.length} checks passed`)
} catch(error) {
  await page.screenshot({ path: `artifacts/strapi${major}-failure.png`, fullPage: true, animations: 'disabled' })
  writeFileSync(`artifacts/strapi${major}-failure.txt`, `${error.stack}\n${errors.join('\n')}\n${(await page.locator('body').innerText()).slice(0,7000)}`)
  throw error
} finally {
  if (token) { await api('PUT', '/blockscene/settings', {}).catch(() => {}); if (uploadId) await api('DELETE', `/upload/files/${uploadId}`).catch(() => {}) }
  rmSync(previewFile, { force: true })
  await browser.close()
}
