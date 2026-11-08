/**
 * Ukur kepadatan baris mushaf pada beberapa halaman contoh.
 *
 * Dua hal yang mau dijawab dengan angka, bukan kira-kira:
 *  1. Berapa besar celah antar kata pada halaman longgar (Al-Fatihah, awal
 *     Al-Baqarah) — pemicu keluhan "terlalu berjarak".
 *  2. Apakah ada baris yang isinya masih melebihi lebar kolom setelah
 *     useAutoFitText bekerja — pemicu keluhan "melebihi jarak kanan kiri".
 *
 *   node scripts/measure-lines.mjs [baseUrl] [halaman...]
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://127.0.0.1:5173'
const PAGES = process.argv.slice(3).map(Number).filter(Boolean)
const TARGETS = PAGES.length ? PAGES : [1, 2, 3, 42, 293, 576, 604]

const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
]

async function launch() {
  let err
  for (const executablePath of CHROME_PATHS) {
    try {
      return await chromium.launch({ executablePath })
    } catch (e) {
      err = e
    }
  }
  try {
    return await chromium.launch()
  } catch {
    throw err ?? new Error('Browser tidak ditemukan')
  }
}

const browser = await launch()
const context = await browser.newContext({
  viewport: { width: 412, height: 892 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
})
const page = await context.newPage()

await page.goto(`${BASE}/#/reader`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1400)

for (const target of TARGETS) {
  await page.evaluate((p) => {
    location.hash = `#/reader?page=${p}`
  }, target)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1100)

  const info = await page.evaluate(() => {
    const host = document.querySelector('.mushaf')
    if (!host) return null
    const fit = getComputedStyle(host).getPropertyValue('--fit-size').trim()

    const rows = []
    for (const line of host.querySelectorAll('[data-fit-line]')) {
      const words = [...line.children]
      if (!words.length) continue
      let sum = 0
      for (const w of words) sum += w.getBoundingClientRect().width
      const available = line.clientWidth
      const gapCount = Math.max(1, words.length - 1)
      rows.push({
        words: words.length,
        // Rasio isi terhadap lebar kolom: >1 berarti meluber
        fill: Number((sum / available).toFixed(3)),
        // Celah rata-rata antar kata dalam px — inilah "jarak" yang dikeluhkan
        gap: Number(((available - sum) / gapCount).toFixed(1)),
      })
    }
    return { fit, rows }
  })

  if (!info) {
    console.log(`hal ${target}: tidak terbaca`)
    continue
  }

  const fills = info.rows.map((r) => r.fill)
  const gaps = info.rows.map((r) => r.gap)
  const maxFill = Math.max(...fills)
  const minFill = Math.min(...fills)
  const maxGap = Math.max(...gaps)

  console.log(
    `hal ${String(target).padStart(3)}  fit=${info.fit.padEnd(8)}` +
      `  baris=${String(info.rows.length).padStart(2)}` +
      `  isi=${minFill.toFixed(2)}..${maxFill.toFixed(2)}` +
      `  celah_maks=${maxGap.toFixed(1)}px` +
      (maxFill > 1 ? '  <-- MELUBER' : '') +
      (maxGap > 18 ? '  <-- RENGGANG' : ''),
  )
  for (const r of info.rows) {
    if (r.fill > 1 || r.gap > 18) {
      console.log(`      ${String(r.words).padStart(2)} kata  isi=${r.fill}  celah=${r.gap}px`)
    }
  }
}

await context.close()
await browser.close()
