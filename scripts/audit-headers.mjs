/**
 * Audit alokasi baris hiasan kepala surah di seluruh 604 halaman.
 * Laporkan halaman yang basmalah-nya masih harus menumpang di baris bingkai,
 * dan halaman yang slot barisnya tidak cukup.
 */
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'

const pages = JSON.parse(
  gunzipSync(readFileSync('public/data/quran-pages.json.gz')).toString('utf8'),
)
const meta = JSON.parse(
  gunzipSync(readFileSync('public/data/quran-meta.json.gz')).toString('utf8'),
)

const emptyLinesOf = (p) => {
  const used = new Set(p.lines.map((l) => l.line))
  const out = []
  for (let i = 1; i <= 15; i++) if (!used.has(i)) out.push(i)
  return out
}

const inline = []
const noSlot = []
const twoRow = []

for (const p of pages.pages) {
  const starting = p.surahs.filter((n) => p.verseKeys.includes(`${n}:1`))
  if (!starting.length) continue

  const empty = emptyLinesOf(p)
  const need = starting.reduce((n, s) => {
    const surah = meta.surahs.find((x) => x.number === s)
    return n + (surah.bismillahPre ? 2 : 1)
  }, 0)

  const names = starting
    .map((s) => meta.surahs.find((x) => x.number === s))
    .map((s) => `${s.number} ${s.nameLatin}`)
    .join(' + ')

  if (!empty.length) {
    noSlot.push(`hal ${p.page}  ${names}  (0 baris kosong)`)
  } else if (empty.length < need) {
    inline.push(`hal ${p.page}  ${names}  butuh ${need} baris, tersedia ${empty.length}`)
  } else {
    twoRow.push(p.page)
  }
}

console.log(`halaman dengan awal surah: ${inline.length + noSlot.length + twoRow.length}`)
console.log(`  baris cukup (bingkai & basmalah terpisah): ${twoRow.length}`)
console.log(`  basmalah harus menumpang di baris bingkai: ${inline.length}`)
for (const l of inline) console.log('     ' + l)
console.log(`  tanpa slot baris sama sekali: ${noSlot.length}`)
for (const l of noSlot) console.log('     ' + l)
