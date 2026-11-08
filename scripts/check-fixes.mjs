/**
 * Uji empat perbaikan: panel Bantu bisa menambah potongan, mark teks tersimpan,
 * tanda bisa dijatuhkan sampai baris paling bawah, dan daftar juz menampilkan
 * daftar surah dulu.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://localhost:4173'
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 412, height: 892 } })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('  !! pageerror:', e.message))
page.on('console', (m) => m.type() === 'error' && console.log('  !! console:', m.text()))

async function openMemorize(target = 1) {
  await page.goto(`${BASE}/#/memorize`, { waitUntil: 'networkidle' })
  await page.reload()
  await page.waitForSelector('.sheet .line', { timeout: 15000 })
  await page.waitForTimeout(500)
  for (let i = 1; i < target; i++) {
    await page.locator('[aria-label="Halaman berikutnya"]').click()
    await page.waitForTimeout(280)
  }
}

/* ------------------------------------------- 1. panel Bantu: pilih & pakai */
console.log('\n=== 1. Panel Bantu ===')
await openMemorize(3)
const segBefore = await page.$$eval('.segment', (e) => e.length)
await page.locator('.rail-btn', { hasText: 'Bantu' }).click()
await page.waitForTimeout(400)

const pills = await page.$$eval('.legend .chip', (e) => e.map((x) => x.textContent.trim()))
console.log('pills:', JSON.stringify(pills))

// Tekan lama kata ke-4 pada ayat pertama
const word = page.locator('.verses .verse').first().locator('.word').nth(3)
const box = await word.boundingBox()
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
await page.mouse.down()
await page.waitForTimeout(600)
await page.mouse.up()
await page.waitForTimeout(300)

const picked = await page.evaluate(() => {
  const p = document.querySelector('.picked')
  return p ? { label: p.querySelector('.picked-label')?.textContent.trim(), text: p.querySelector('.picked-text')?.textContent.trim().slice(0, 40) } : null
})
console.log('kalimat terpilih:', JSON.stringify(picked))

// Perluas rentang: ketuk kata ke-6
await page.locator('.verses .verse').first().locator('.word').nth(5).click()
await page.waitForTimeout(250)
console.log('setelah perluas:', await page.locator('.picked-label').textContent())

await page.locator('.act.ghost').click()
await page.waitForTimeout(500)
const segAfter = await page.$$eval('.segment', (e) =>
  e.map((x) => ({ t: x.textContent.trim().slice(0, 24), helper: x.classList.contains('helper') })),
)
console.log('segmen:', segBefore, '→', segAfter.length, '| helper =', segAfter.filter((s) => s.helper).length)
console.log('isi helper:', JSON.stringify(segAfter.filter((s) => s.helper)))

await page.locator('[role="dialog"] .close').click()
await page.waitForTimeout(350)

/* ------------------------------------- 2. mark teks + drop ke baris bawah */
console.log('\n=== 2. Mark teks ke baris paling bawah ===')
await page.locator('.rail-btn[aria-label="Menu tanda"]').click()
await page.waitForTimeout(350)
const trayItems = await page.$$eval('.tray-item', (e) => e.map((x) => x.textContent.trim()))
console.log('isi tray:', JSON.stringify(trayItems))

const textTool = page.locator('.tray-item', { hasText: 'Catatan' })
const tb = await textTool.boundingBox()
const rows = await page.$$eval('.sheet [data-line]', (els) =>
  els.map((e) => {
    const b = e.getBoundingClientRect()
    return { line: e.dataset.line, verse: e.dataset.verseKey, cx: b.left + b.width / 2, cy: b.top + b.height / 2 }
  }),
)
const lastRow = rows.at(-1)
console.log('baris terakhir:', JSON.stringify(lastRow))

await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2)
await page.mouse.down()
await page.mouse.move(lastRow.cx, lastRow.cy, { steps: 12 })
await page.waitForTimeout(200)
console.log('baris tersorot saat di atas baris terakhir:', await page.$$eval('.line.hover', (e) => e.map((x) => x.dataset.line)))
await page.mouse.up()
await page.waitForTimeout(400)

const dialogTitle = await page.locator('[role="dialog"]').getAttribute('aria-label').catch(() => null)
console.log('dialog terbuka:', dialogTitle)
await page.locator('.note-input').fill('waqaf lazim')
await page.locator('.note-btn.solid').click()
await page.waitForTimeout(500)

const notes = await page.$$eval('.mark.shape-text', (els) =>
  els.map((e) => ({
    text: e.textContent.trim(),
    line: e.closest('[data-line]')?.dataset.line,
  })),
)
console.log('catatan tergambar:', JSON.stringify(notes))

// Bertahan setelah muat ulang? Posisi terakhir tersimpan, jadi navigasi
// dituntun oleh nomor halaman yang benar-benar tampil, bukan hitungan klik.
const wantPage = Number(
  (await page.locator('.page-notch').getAttribute('aria-label')).match(/\d+/)[0],
)
console.log('menandai di halaman:', wantPage)

await page.reload()
await page.waitForSelector('.sheet .line', { timeout: 15000 })
await page.waitForTimeout(700)

for (let guard = 0; guard < 20; guard++) {
  const now = Number((await page.locator('.page-notch').getAttribute('aria-label')).match(/\d+/)[0])
  if (now === wantPage) break
  await page
    .locator(now < wantPage ? '[aria-label="Halaman berikutnya"]' : '[aria-label="Halaman sebelumnya"]')
    .click()
  await page.waitForTimeout(300)
}
console.log('halaman sesudah muat ulang:', await page.locator('.page-notch').getAttribute('aria-label'))

const persisted = await page.$$eval('.mark.shape-text', (els) =>
  els.map((e) => ({ text: e.textContent.trim(), line: e.closest('[data-line]')?.dataset.line })),
)
const persistedPicks = await page.$$eval('.segment.helper', (e) =>
  e.map((x) => x.textContent.trim().slice(0, 24)),
)
console.log('setelah muat ulang → catatan:', JSON.stringify(persisted))
console.log('setelah muat ulang → potongan helper:', JSON.stringify(persistedPicks))

/* ------------------------------------------------- 3. drop bentuk ke bawah */
console.log('\n=== 3. Bentuk garis ke baris 15 ===')
await page.locator('.rail-btn[aria-label="Menu tanda"]').click()
await page.waitForTimeout(300)
const lineTool = page.locator('.tray-item', { hasText: 'Garis' })
const lb = await lineTool.boundingBox()
const rows2 = await page.$$eval('.sheet [data-line]', (els) =>
  els.map((e) => {
    const b = e.getBoundingClientRect()
    return { line: e.dataset.line, cx: b.left + b.width / 2, cy: b.top + b.height / 2 }
  }),
)
const bottom = rows2.at(-1)
await page.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2)
await page.mouse.down()
await page.mouse.move(bottom.cx, bottom.cy, { steps: 12 })
await page.mouse.up()
await page.waitForTimeout(450)
const shapesOn15 = await page.$$eval('.sheet [data-line]', (els) => {
  const last = els.at(-1)
  return { line: last.dataset.line, marks: last.querySelectorAll('.mark').length }
})
console.log('baris terakhir:', JSON.stringify(shapesOn15))

/* --------------------------------------------------- 4. juz → daftar surah */
console.log('\n=== 4. Juz menampilkan daftar surah ===')
await page.goto(`${BASE}/#/reader`, { waitUntil: 'networkidle' })
await page.reload()
await page.waitForTimeout(900)
await page.locator('.quick-pill.top-right').click()
await page.waitForTimeout(400)
console.log('judul sheet:', await page.locator('[role="dialog"]').getAttribute('aria-label'))

const pageBefore = await page.locator('.page-notch').getAttribute('aria-label')
await page.locator('.juz').nth(1).click()   // juz 2
await page.waitForTimeout(400)
const detail = await page.evaluate(() => ({
  title: document.querySelector('[role="dialog"]')?.getAttribute('aria-label'),
  masihTerbuka: Boolean(document.querySelector('[role="dialog"]')),
  surahRows: [...document.querySelectorAll('.surah-row')].map((r) => ({
    name: r.querySelector('.s-name')?.textContent.trim(),
    range: r.querySelector('.s-range')?.textContent.trim(),
  })),
}))
console.log('halaman belum berubah:', pageBefore, '→', await page.locator('.page-notch').getAttribute('aria-label'))
console.log('detail juz 2:', JSON.stringify(detail, null, 1))

// Juz 3: surah yang bersambung harus tampil dengan keterangan sambungan
await page.locator('.back').click()
await page.waitForTimeout(300)
await page.locator('.juz').nth(2).click()
await page.waitForTimeout(350)
console.log('detail juz 3:', JSON.stringify(await page.$$eval('.surah-row', (rs) => rs.map((r) => r.querySelector('.s-name')?.textContent.trim() + ' | ' + r.querySelector('.s-range')?.textContent.trim()))))

await page.locator('.surah-row').first().click()
await page.waitForTimeout(700)
console.log('setelah pilih surah → halaman:', await page.locator('.page-notch').getAttribute('aria-label'))
console.log('sheet tertutup:', (await page.locator('[role="dialog"]').count()) === 0)

await browser.close()
