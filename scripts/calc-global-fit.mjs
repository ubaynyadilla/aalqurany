/**
 * Hitung "berat" tiap halaman: lebar teks baris terpadat pada ukuran font 1px.
 *
 * Nilai ini murni sifat halaman (jumlah & panjang kata), tidak bergantung layar.
 * Dengan menyimpannya, aplikasi bisa memakai SATU ukuran font seragam untuk
 * seluruh mushaf: ukuran terbesar yang masih memuat halaman terberat. Teks jadi
 * tidak berubah-ubah saat berpindah halaman.
 *
 * Diukur di browser karena hanya mesin teks yang tahu lebar sebenarnya tiap
 * kata Arab dengan harakatnya pada font yang dipakai.
 */
import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const pagesFile = JSON.parse(
  gunzipSync(readFileSync('public/data/quran-pages.json.gz')).toString('utf8'),
)

const browser = await chromium.launch({ executablePath: CHROME })
const page = await browser.newPage()

// Halaman pengukur: memuat font yang sama seperti aplikasi, lalu mengukur
// lebar setiap baris pada font-size 100px (lebih presisi daripada 1px).
await page.setContent(`<!doctype html><meta charset="utf-8">
<style>
  @font-face {
    font-family: 'Scheherazade New';
    src: url('${new URL('../node_modules/@fontsource/scheherazade-new/files/scheherazade-new-arabic-400-normal.woff2', import.meta.url).href}') format('woff2');
    font-weight: 400;
  }
  #probe {
    position: absolute; visibility: hidden; white-space: nowrap;
    font-family: 'Scheherazade New', serif; font-size: 100px;
  }
  #probe span { display: inline-block; }
</style>
<div id="probe" dir="rtl"></div>`)

await page.evaluate(() => document.fonts.ready)

const REF = 100 // font-size acuan (px)
const GAP_EM = 0.1 // gap antar kata pada .mushaf-line

const weights = []

for (const p of pagesFile.pages) {
  let heaviest = 0

  for (const line of p.lines) {
    const words = line.words.map((w) => w.t)
    const width = await page.evaluate(
      ({ words, gapEm, ref }) => {
        const probe = document.getElementById('probe')
        probe.innerHTML = ''
        for (const w of words) {
          const s = document.createElement('span')
          s.textContent = w
          probe.appendChild(s)
        }
        let sum = 0
        for (const s of probe.children) sum += s.getBoundingClientRect().width
        // Ditambah gap antar kata, dinyatakan kembali per 1px font
        return (sum + gapEm * ref * (words.length - 1)) / ref
      },
      { words, gapEm: GAP_EM, ref: REF },
    )

    heaviest = Math.max(heaviest, width)
  }

  weights.push({ page: p.page, w: Math.round(heaviest * 1000) / 1000 })
  if (p.page % 100 === 0) console.log(`  ...halaman ${p.page}`)
}

await browser.close()

weights.sort((a, b) => b.w - a.w)
console.log('\n10 halaman terberat (lebar per 1px font):')
for (const x of weights.slice(0, 10)) console.log(`  hal ${x.page}: ${x.w}`)
console.log('\n10 halaman teringan:')
for (const x of weights.slice(-10)) console.log(`  hal ${x.page}: ${x.w}`)

const max = weights[0].w
console.log(`\nterberat = ${max}`)
console.log('ukuran font seragam yang muat (dengan margin 2%):')
for (const col of [310, 335, 354, 380]) {
  console.log(`  kolom ${col}px → ${((col / max) * 0.98).toFixed(1)}px`)
}

writeFileSync(
  'src/services/pageWeights.json',
  JSON.stringify(
    {
      note: 'Lebar baris terpadat tiap halaman pada font-size 1px. Dihasilkan scripts/calc-global-fit.mjs',
      gapEm: GAP_EM,
      maxWeight: max,
      weights: Object.fromEntries(weights.map((x) => [x.page, x.w])),
    },
    null,
    0,
  ),
)
console.log('\nditulis: src/services/pageWeights.json')
