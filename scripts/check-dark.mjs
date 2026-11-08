/**
 * Cek dark mode secara nyata: klik tombol tema di cover, lalu baca warna
 * yang benar-benar dipakai browser di cover, reader, dan memorize.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://localhost:4173'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 412, height: 892 } })

const logs = []
page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`))
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`))

async function probe(label) {
  return page.evaluate((label) => {
    const root = document.documentElement
    const first = document.querySelector('.cover, .reader, .memorize')
    return {
      label,
      htmlClass: root.className,
      colorScheme: root.style.colorScheme,
      rootEl: first?.className ?? '(none)',
      bg: first ? getComputedStyle(first).backgroundColor : '(none)',
      bgImage: first ? getComputedStyle(first).backgroundImage.slice(0, 60) : '(none)',
      color: first ? getComputedStyle(first).color : '(none)',
    }
  }, label)
}

await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' })
await page.waitForTimeout(600)

console.log('sebelum:', await probe('cover-light'))

const toggle = page.locator('.theme-toggle')
console.log('tombol tema terlihat:', await toggle.count(), await toggle.isVisible().catch(() => false))
await toggle.click()
await page.waitForTimeout(400)
console.log('sesudah klik:', await probe('cover-dark'))

// Apakah kelas .dark bertahan setelah pindah halaman?
await page.goto(`${BASE}/#/reader`, { waitUntil: 'networkidle' })
await page.reload()
await page.waitForTimeout(900)
console.log('reader:', await probe('reader-dark'))

await page.goto(`${BASE}/#/memorize`, { waitUntil: 'networkidle' })
await page.reload()
await page.waitForTimeout(900)
console.log('memorize:', await probe('memorize-dark'))

if (logs.length) console.log('\nkonsol:\n' + logs.join('\n'))
await browser.close()
