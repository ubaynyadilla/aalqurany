/** Ukur apakah 15 baris memorize benar-benar berada di dalam layar. */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://localhost:4173'
const browser = await chromium.launch()

for (const vp of [
  { width: 360, height: 760, name: '19:9 sempit' },
  { width: 412, height: 892, name: '19.5:9' },
]) {
  const page = await browser.newPage({ viewport: vp })
  await page.goto(`${BASE}/#/memorize`, { waitUntil: 'networkidle' })
  await page.reload()
  await page.waitForSelector('.sheet .line', { timeout: 15000 })
  await page.waitForTimeout(500)
  // maju ke halaman yang penuh 15 baris
  for (let i = 0; i < 4; i++) {
    await page.locator('[aria-label="Halaman berikutnya"]').click()
    await page.waitForTimeout(250)
  }

  const info = await page.evaluate(() => {
    const sheet = document.querySelector('.sheet')
    const rows = [...document.querySelectorAll('.sheet .line')]
    const sb = sheet.getBoundingClientRect()
    const last = rows.at(-1)?.getBoundingClientRect()
    const notch = document.querySelector('.page-notch')?.getBoundingClientRect()
    return {
      viewportH: innerHeight,
      sheet: { top: +sb.top.toFixed(1), bottom: +sb.bottom.toFixed(1), h: +sb.height.toFixed(1) },
      sheetScrollH: sheet.scrollHeight,
      sheetClientH: sheet.clientHeight,
      rows: rows.length,
      lastRow: last && { top: +last.top.toFixed(1), bottom: +last.bottom.toFixed(1), h: +last.height.toFixed(1) },
      notchTop: notch && +notch.top.toFixed(1),
      // baris yang tertutup notch atau keluar layar
      hidden: rows
        .map((r, i) => ({ i: i + 1, b: r.getBoundingClientRect().bottom, t: r.getBoundingClientRect().top }))
        .filter((r) => r.b > innerHeight || (notch && r.b > notch.top))
        .map((r) => r.i),
    }
  })
  console.log(vp.name, JSON.stringify(info, null, 1))

  // Uji nyata: bisakah titik di baris terakhir di-hit?
  const hit = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.sheet .line[data-line]')]
    const out = []
    for (const r of rows.slice(-4)) {
      const b = r.getBoundingClientRect()
      const cx = b.left + b.width / 2
      const cy = b.top + b.height / 2
      const el = document.elementFromPoint(cx, cy)
      out.push({
        line: r.dataset.line,
        y: +cy.toFixed(0),
        hitRow: el?.closest('[data-line]')?.dataset.line ?? null,
        topEl: el?.className?.toString().slice(0, 30) ?? null,
      })
    }
    return out
  })
  console.log('  hit-test baris bawah:', JSON.stringify(hit))
  await page.close()
}
await browser.close()
