import { chromium } from 'playwright'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const browser = await chromium.launch({ executablePath: CHROME })
const ctx = await browser.newContext({
  viewport: { width: 412, height: 892 },
  hasTouch: true,
  isMobile: true,
})
const page = await ctx.newPage()
await page.goto('http://127.0.0.1:5173/#/reader', { waitUntil: 'networkidle' })
await page.waitForTimeout(1000)

await page.mouse.click(206, 60)
await page.waitForTimeout(300)

console.log('menu open:', await page.locator('.menu-layer').count())
for (const sel of ['.menu.top', '.menu.bottom', '.pager', '.quick.top-left', '.quick.top-right']) {
  const box = await page.locator(sel).boundingBox().catch(() => null)
  console.log(`  ${sel}:`, box ? `x=${Math.round(box.x)}-${Math.round(box.x + box.width)} y=${Math.round(box.y)}-${Math.round(box.y + box.height)}` : 'absent')
}

// Apa yang tertekan pada beberapa titik kandidat saat menu TERBUKA
for (const [x, y] of [[206, 20], [206, 60], [206, 130], [60, 840], [206, 840], [206, 800]]) {
  const el = await page.evaluate(
    ([px, py]) => {
      const e = document.elementFromPoint(px, py)
      return { tag: e?.tagName, cls: String(e?.className).slice(0, 45), btn: e?.closest('button')?.textContent?.trim().slice(0, 20) ?? null }
    },
    [x, y],
  )
  console.log(`  point(${x},${y}) → ${el.tag}.${el.cls}${el.btn ? ` [button: ${el.btn}]` : ''}`)
}

console.log('\nroute now:', page.url())
await page.mouse.click(206, 60)
await page.waitForTimeout(400)
console.log('after 2nd tap at (206,60) → route:', page.url())
console.log('  reader visible:', await page.locator('.reader').count())

await browser.close()
