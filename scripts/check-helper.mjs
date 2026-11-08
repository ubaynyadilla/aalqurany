/**
 * Cek alur "Bantu": buka panel ayat bantuan, ketuk satu ayat, lalu lihat
 * apakah potongan awalnya benar-benar muncul di panel memorize.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://localhost:4173'
const PAGE = process.env.PAGE ?? '3'

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 412, height: 892 } })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('pageerror:', e.message))
page.on('console', (m) => {
  if (m.type() === 'error') console.log('console.error:', m.text())
})

await page.goto(`${BASE}/#/memorize?page=${PAGE}`, { waitUntil: 'networkidle' })
await page.reload()
await page.waitForSelector('.sheet .line', { timeout: 15000 })
await page.waitForTimeout(600)

// Route memorize belum tentu membaca ?page= — maju lewat tombol seperti pengguna
const want = Number(PAGE)
for (let i = 1; i < want; i++) {
  await page.locator('[aria-label="Halaman berikutnya"]').click()
  await page.waitForTimeout(320)
}
const notch = await page.locator('.page-notch').getAttribute('aria-label')
console.log('halaman aktif:', notch)

const before = await page.$$eval('.segment', (els) =>
  els.map((e) => ({ text: e.textContent.trim().slice(0, 28), helper: e.classList.contains('helper') })),
)
console.log('segmen sebelum:', before.length, JSON.stringify(before.slice(0, 3)))

// Buka panel Bantu
await page.locator('.rail-btn', { hasText: 'Bantu' }).click()
await page.waitForTimeout(400)

const panel = await page.evaluate(() => {
  const verses = [...document.querySelectorAll('.verses .verse')]
  return {
    total: verses.length,
    perState: verses.reduce((acc, v) => {
      const s = v.classList.contains('default')
        ? 'default'
        : v.classList.contains('helper')
          ? 'helper'
          : 'available'
      acc[s] = (acc[s] ?? 0) + 1
      return acc
    }, {}),
    firstAvailable: verses.find((v) => v.classList.contains('available'))?.textContent.trim().slice(0, 40) ?? null,
  }
})
console.log('panel:', JSON.stringify(panel))

const available = page.locator('.verses .verse.available').first()
if ((await available.count()) === 0) {
  console.log('TIDAK ADA ayat yang bisa ditambahkan di halaman ini')
} else {
  await available.click()
  await page.waitForTimeout(500)
  const afterPanel = await page.evaluate(
    () => document.querySelectorAll('.verses .verse.helper').length,
  )
  console.log('ayat bertanda helper di panel setelah klik:', afterPanel)

  // Tutup panel, lihat panel memorize
  await page.locator('.sheet-close, [aria-label="Tutup"]').first().click().catch(() => {})
  await page.keyboard.press('Escape').catch(() => {})
  await page.waitForTimeout(500)

  const after = await page.$$eval('.segment', (els) =>
    els.map((e) => ({
      text: e.textContent.trim().slice(0, 28),
      helper: e.classList.contains('helper'),
    })),
  )
  console.log('segmen sesudah:', after.length, 'helper =', after.filter((s) => s.helper).length)
  console.log(JSON.stringify(after.filter((s) => s.helper)))
}

await browser.close()
