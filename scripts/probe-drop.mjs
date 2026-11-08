/**
 * Cari tahu baris mana di lembar memorize yang benar-benar menerima tanda.
 *
 * Keluhan pengguna: baris ke-3 sampai paling bawah tidak bisa ditandai. Skrip
 * ini menjatuhkan satu bentuk ke tengah setiap baris (1–15) dan melaporkan
 * hasilnya, plus elemen apa yang sebenarnya berada di bawah titik jatuh —
 * supaya penyebabnya terlihat, bukan dikira-kira.
 *
 *   node scripts/probe-drop.mjs [baseUrl] [halaman]
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://127.0.0.1:5173'
const PAGE_NO = Number(process.argv[3] ?? 3)

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
  return chromium.launch().catch(() => {
    throw err ?? new Error('Browser tidak ditemukan')
  })
}

const browser = await launch()
const context = await browser.newContext({
  viewport: { width: 412, height: 892 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
})
const page = await context.newPage()
page.on('pageerror', (e) => console.log('  pageerror:', String(e).slice(0, 160)))

await page.goto(`${BASE}/#/memorize`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1300)

// Bersihkan tanda halaman ini supaya batas 20 tanda tidak ikut mengganggu
await page.evaluate(() => localStorage.removeItem('CapacitorStorage.marks'))
await page.evaluate(() => localStorage.clear())
await page.goto(`${BASE}/#/memorize`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1300)

// Pergi ke halaman uji
for (let i = 0; i < 40; i++) {
  const now = await page.locator('.page-notch').getAttribute('aria-label')
  const n = Number(now?.match(/Halaman (\d+)/)?.[1] ?? 0)
  if (n === PAGE_NO) break
  await page.getByRole('button', { name: n < PAGE_NO ? 'Halaman berikutnya' : 'Halaman sebelumnya' }).click()
  await page.waitForTimeout(260)
}

const rows = await page.evaluate(() => {
  const out = []
  for (const el of document.querySelectorAll('.sheet [data-line]')) {
    const b = el.getBoundingClientRect()
    out.push({
      line: Number(el.dataset.line),
      verseKey: el.dataset.verseKey ?? null,
      top: Math.round(b.top),
      bottom: Math.round(b.bottom),
      cx: Math.round(b.left + b.width / 2),
      cy: Math.round(b.top + b.height / 2),
    })
  }
  return out
})

console.log(`Halaman ${PAGE_NO}: ${rows.length} baris ber-data-line`)
const sheetBox = await page.locator('.sheet').boundingBox()
console.log(
  `Lembar: y ${Math.round(sheetBox.y)}..${Math.round(sheetBox.y + sheetBox.height)}, ` +
    `x ${Math.round(sheetBox.x)}..${Math.round(sheetBox.x + sheetBox.width)}`,
)

for (const r of rows) {
  // Apa yang ada di bawah titik tengah baris ini?
  const under = await page.evaluate(
    ({ x, y }) => {
      const el = document.elementFromPoint(x, y)
      if (!el) return 'null'
      const row = el.closest('[data-line]')
      return `${el.tagName.toLowerCase()}.${el.className || '-'}${row ? ` (row ${row.dataset.line})` : ' (TANPA row)'}`
    },
    { x: r.cx, y: r.cy },
  )
  console.log(
    `  baris ${String(r.line).padStart(2)}  y=${r.cy}  key=${String(r.verseKey).padEnd(7)}  di bawah titik: ${under}`,
  )
}

/* ------------------------------------------- coba jatuhkan bentuk ke tiap baris */
console.log('\nUji jatuhkan bentuk Bulatan ke tiap baris:')
for (const r of rows) {
  await page.getByRole('button', { name: 'Menu tanda' }).click()
  await page.waitForTimeout(240)

  const btn = page.getByRole('button', { name: 'Tanda Bulatan' })
  const box = await btn.boundingBox()
  if (!box) {
    console.log(`  baris ${r.line}: tray tidak terbuka`)
    continue
  }

  const before = await page.locator('.mark').count()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(r.cx, r.cy, { steps: 12 })
  await page.waitForTimeout(160)
  const hovered = await page.locator('.line.hover').count()
  const hoveredLine = hovered
    ? await page.locator('.line.hover').first().getAttribute('data-line')
    : '-'
  await page.mouse.up()
  await page.waitForTimeout(420)
  const after = await page.locator('.mark').count()

  console.log(
    `  baris ${String(r.line).padStart(2)}: ${after > before ? 'OK  ' : 'GAGAL'}` +
      `  sorot=${hoveredLine}  tanda ${before}->${after}`,
  )

  // Bersihkan agar tidak kena batas 20 tanda
  if (after > before) {
    await page.evaluate(() => {
      const raw = localStorage.getItem('CapacitorStorage.marks')
      if (raw) localStorage.setItem('CapacitorStorage.marks', '[]')
    })
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForTimeout(1000)
  }
}

await context.close()
await browser.close()
