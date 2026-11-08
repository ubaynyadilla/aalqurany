/** Uji "tekan lama → seret potongan dari panel Bantu ke lembar memorize". */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://localhost:4173'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 412, height: 892 } })
page.on('pageerror', (e) => console.log('!! pageerror:', e.message))

await page.goto(`${BASE}/#/memorize`, { waitUntil: 'networkidle' })
await page.reload()
await page.waitForSelector('.sheet .line', { timeout: 15000 })
await page.waitForTimeout(700)
console.log('halaman:', await page.locator('.page-notch').getAttribute('aria-label'))

const helperBefore = await page.$$eval('.segment.helper', (e) => e.length)

await page.locator('.rail-btn', { hasText: 'Bantu' }).click()
await page.waitForTimeout(400)

// tekan lama kata ke-2 pada ayat ke-2
const verse = page.locator('.verses .verse').nth(1)
const word = verse.locator('.word').nth(1)
const wb = await word.boundingBox()
await page.mouse.move(wb.x + wb.width / 2, wb.y + wb.height / 2)
await page.mouse.down()
await page.waitForTimeout(600)
await page.mouse.up()
await page.waitForTimeout(300)
console.log('terpilih:', await page.locator('.picked-label').textContent())

// seret tombol "Seret ke memorize" ke baris 12
const drag = page.locator('.act.drag')
const db = await drag.boundingBox()
await page.mouse.move(db.x + db.width / 2, db.y + db.height / 2)
await page.mouse.down()
await page.mouse.move(db.x + db.width / 2, db.y - 60, { steps: 6 })
await page.waitForTimeout(250)

const panelGone = (await page.locator('.picked').count()) === 0
const ghost = await page.evaluate(() => {
  const g = document.querySelector('.ghost-pick')
  return g ? g.textContent.trim().slice(0, 30) : null
})
console.log('panel tertutup saat diseret:', panelGone, '| hantu potongan:', JSON.stringify(ghost))

const row = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.sheet [data-line]')]
  const r = rows[11] ?? rows.at(-1)
  const b = r.getBoundingClientRect()
  return { line: r.dataset.line, cx: b.left + b.width / 2, cy: b.top + b.height / 2 }
})
await page.mouse.move(row.cx, row.cy, { steps: 10 })
await page.waitForTimeout(200)
console.log('baris tersorot:', await page.$$eval('.line.hover', (e) => e.map((x) => x.dataset.line)))
await page.mouse.up()
await page.waitForTimeout(600)

const helperAfter = await page.$$eval('.segment.helper', (e) =>
  e.map((x) => ({ t: x.textContent.trim().slice(0, 26), line: x.closest('[data-line]')?.dataset.line })),
)
console.log('potongan helper:', helperBefore, '→', helperAfter.length)
console.log(JSON.stringify(helperAfter))
console.log('pesan:', await page.locator('.notice').textContent().catch(() => '(tidak ada)'))

await browser.close()
