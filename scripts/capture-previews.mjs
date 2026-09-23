// Local thumbnail capture. Development tool only: Playwright never runs inside
// Strapi or the admin bundle. Framework-independent contract, see
// examples/static-preview/manifest.json and README "Automatic images".
//
//   node scripts/capture-previews.mjs --manifest <file> --out <dir> [--viewport 1280x720] [--timeout 15000] [--only uid,uid]
//
// Manifest: { "baseUrl"?: "http://127.0.0.1:3000", "selector"?: "[data-block-preview]",
//             "blocks": { "<uid>": { "url": "/preview/hero", "selector"?: "..." } } }
// Relative URLs resolve against baseUrl, or against the manifest file (file://) when absent.
// The page marks completion with `data-preview-ready="true"` on the captured element
// (or on <html>); fonts and images inside the element are awaited as well.
import { chromium } from 'playwright'
import { readFileSync, mkdirSync, writeFileSync, renameSync, rmSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const args = Object.fromEntries(process.argv.slice(2).map((arg, i, all) => arg.startsWith('--') ? [arg.slice(2), all[i + 1]] : []).filter(Boolean))
if (!args.manifest || !args.out) { console.error('Usage: --manifest <file> --out <dir> [--viewport WxH] [--timeout ms] [--only uid,uid]'); process.exit(2) }
const manifestPath = resolve(args.manifest)
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const [width, height] = (args.viewport || '1280x720').split('x').map(Number)
const timeout = Number(args.timeout || 15000)
const only = args.only ? new Set(args.only.split(',')) : null
const base = manifest.baseUrl || pathToFileURL(manifestPath).href
const out = resolve(args.out)
mkdirSync(out, { recursive: true })

const browser = await chromium.launch({ channel: process.env.CHROME_CHANNEL || 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, reducedMotion: 'reduce' })
const report = { date: new Date().toISOString(), viewport: `${width}x${height}`, results: [] }
for (const [uid, block] of Object.entries(manifest.blocks || {})) {
  if (only && !only.has(uid)) continue
  const target = join(out, `${uid}.webp`)
  const temporary = join(out, `.${uid}.${process.pid}.tmp.webp`)
  const page = await context.newPage()
  page.setDefaultTimeout(timeout)
  const started = Date.now()
  try {
    const url = new URL(block.url, base).href
    const selector = block.selector || manifest.selector || '[data-block-preview]'
    await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' }).catch(() => {})
    await page.goto(url, { waitUntil: 'load' })
    await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }' })
    const element = page.locator(selector).first()
    await element.waitFor({ state: 'visible' })
    // Lazy images below the fold never complete in a headless viewport: load every image of the element eagerly.
    await page.evaluate(sel => { document.querySelectorAll(`${sel} img[loading="lazy"]`).forEach(img => { img.loading = 'eager'; if (img.dataset.src) img.src = img.dataset.src }) }, selector).catch(() => {})
    await page.waitForFunction(sel => {
      const root = document.querySelector(sel)
      const ready = root?.getAttribute('data-preview-ready') === 'true' || document.documentElement.getAttribute('data-preview-ready') === 'true'
      const images = [...root.querySelectorAll('img')].every(img => img.complete)
      return ready && images && document.fonts.status === 'loaded'
    }, selector)
    const box = await element.boundingBox()
    if (!box || box.width < 8 || box.height < 8 || box.height > 6000) throw new Error(`Unusable element size ${JSON.stringify(box)}`)
    const png = await element.screenshot({ type: 'png', animations: 'disabled' })
    // Chromium encodes WebP through canvas, so no image library is needed.
    const webp = await page.evaluate(async data => {
      const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode()
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
      canvas.getContext('2d').drawImage(image, 0, 0)
      return canvas.toDataURL('image/webp', 0.9).split(',')[1]
    }, png.toString('base64'))
    writeFileSync(temporary, Buffer.from(webp, 'base64'))
    renameSync(temporary, target)
    report.results.push({ uid, status: 'ok', file: target, width: Math.round(box.width), height: Math.round(box.height), ms: Date.now() - started })
    console.log(`ok    ${uid} (${Math.round(box.width)}x${Math.round(box.height)})`)
  } catch (error) {
    rmSync(temporary, { force: true })
    report.results.push({ uid, status: 'error', error: error.message.split('\n')[0], kept: existsSync(target), ms: Date.now() - started })
    console.log(`error ${uid}: ${error.message.split('\n')[0]}${existsSync(target) ? ' (previous file kept)' : ''}`)
  } finally { await page.close() }
}
await browser.close()
writeFileSync(join(out, 'capture-report.json'), JSON.stringify(report, null, 2))
const failed = report.results.filter(r => r.status !== 'ok').length
console.log(`${report.results.length - failed} captured, ${failed} failed. Report: ${join(out, 'capture-report.json')}`)
process.exit(failed ? 1 : 0)
