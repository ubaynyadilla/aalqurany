import { chromium } from 'playwright'

const BASE = 'http://127.0.0.1:5173'
const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
})
const ctx = await browser.newContext({
  viewport: { width: 412, height: 892 },
  hasTouch: true,
  isMobile: true,
})
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('[pageerror]', String(e)))

// Reproduksi kondisi smoke test: memorize dibuka saat reader di halaman 582
await page.goto(`${BASE}/#/reader?page=582`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1000)
await page.goto(`${BASE}/#/memorize`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1000)

console.log('page label:', await page.locator('.page-label').innerText())
const verses = await page.locator('.verse').count()
console.log('verses:', verses)

for (let i = 0; i < verses; i++) {
  const box = await page.locator('.verse').nth(i).boundingBox()
  const text = await page.locator('.verse-text').nth(i).innerText()
  const ref = await page.locator('.verse-ref').nth(i).innerText()
  console.log(
    `  verse[${i}] ${ref} box=${JSON.stringify(box)} text="${text.replace(/\s+/g, ' ')}"`,
  )
}

await page.getByRole('button', { name: 'Menu tanda' }).click()
await page.waitForTimeout(400)
const trayBox = await page.locator('.tray').boundingBox()
console.log('tray box:', JSON.stringify(trayBox))

const btn = page.getByRole('button', { name: 'Tanda Bulatan' })
const b = await btn.boundingBox()
const v = await page.locator('.verse').nth(1).boundingBox()
console.log('circle btn box:', JSON.stringify(b))
console.log('target verse box:', JSON.stringify(v))

const dropX = v.x + v.width / 2
const dropY = v.y + v.height / 2
console.log('drop point:', dropX, dropY)

await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
await page.mouse.down()
await page.waitForTimeout(200)
console.log('ghost after down:', await page.locator('.ghost').count())

await page.mouse.move(dropX, dropY, { steps: 14 })
await page.waitForTimeout(250)
console.log('hover count:', await page.locator('.verse.hover').count())

const at = await page.evaluate(
  ([x, y]) => {
    const el = document.elementFromPoint(x, y)
    const row = el?.closest('[data-verse-key]')
    return { tag: el?.tagName, cls: String(el?.className).slice(0, 70), key: row?.getAttribute('data-verse-key') ?? null }
  },
  [dropX, dropY],
)
console.log('elementFromPoint:', JSON.stringify(at))

await page.mouse.up()
await page.waitForTimeout(600)
console.log('marks after drop:', await page.locator('.mark-chip').count())
console.log('notice:', (await page.locator('.notice').count()) ? await page.locator('.notice').innerText() : 'none')

await browser.close()
