import { chromium } from 'playwright'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const browser = await chromium.launch({ executablePath: CHROME })
const ctx = await browser.newContext({
  viewport: { width: 412, height: 892 },
  hasTouch: true,
  isMobile: true,
})
const page = await ctx.newPage()
await page.goto('http://127.0.0.1:5173/#/memorize', { waitUntil: 'networkidle' })
await page.waitForTimeout(1100)

// --- Reveal: bandingkan teks sebelum, saat ditahan, dan sesudah
const before = await page.locator('.verse-text').first().innerText()
const btn = page.getByRole('button', { name: /Tampilkan teks penuh/ })
await btn.hover()
await page.mouse.down()
await page.waitForTimeout(400)
const during = await page.locator('.verse-text').first().innerText()
const revealedClass = await page.locator('.verse-text.revealed').count()
await page.mouse.up()
await page.waitForTimeout(300)
const after = await page.locator('.verse-text').first().innerText()

console.log('BEFORE:', JSON.stringify(before), before.length)
console.log('DURING:', JSON.stringify(during), during.length, 'revealedClass=', revealedClass)
console.log('AFTER :', JSON.stringify(after), after.length)

console.log('\n--- reveal kedua tanpa hover ulang (persis urutan smoke test) ---')
await page.mouse.down()
await page.waitForTimeout(300)
console.log('revealed count:', await page.locator('.verse-text.revealed').count())
await page.mouse.up()
await page.waitForTimeout(200)

console.log('\n--- tray + drag setelah reveal ---')
await page.getByRole('button', { name: 'Menu tanda' }).click()
await page.waitForTimeout(400)
console.log('tray visible:', await page.locator('.tray').isVisible())
const b = await page.getByRole('button', { name: 'Tanda Bulatan' }).boundingBox()
const v = await page.locator('.verse').nth(1).boundingBox()
await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
await page.mouse.down()
await page.waitForTimeout(150)
await page.mouse.move(v.x + v.width / 2, v.y + v.height / 2, { steps: 14 })
await page.waitForTimeout(200)
await page.mouse.up()
await page.waitForTimeout(500)
console.log('marks:', await page.locator('.mark-chip').count())

console.log('\n--- jumlah baris render ---')
for (const p of [1, 300, 582]) {
  await page.goto(`http://127.0.0.1:5173/#/reader?page=${p}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  const lines = await page.locator('.mushaf-line').count()
  const headers = await page.locator('.surah-header').count()
  console.log(`page ${p}: mushaf-line=${lines} surah-header=${headers} total=${lines + headers}`)
}

await browser.close()
