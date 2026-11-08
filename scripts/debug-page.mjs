/** Periksa struktur satu halaman: node scripts/debug-page.mjs 106 */
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'

const n = Number(process.argv[2] ?? 106)
const pages = JSON.parse(
  gunzipSync(readFileSync('public/data/quran-pages.json.gz')).toString('utf8'),
)
const meta = JSON.parse(
  gunzipSync(readFileSync('public/data/quran-meta.json.gz')).toString('utf8'),
)

const p = pages.pages.find((x) => x.page === n)
console.log(`halaman ${n}`)
console.log('  surahs   :', p.surahs)
console.log('  verseKeys:', p.verseKeys.join(', '))
console.log('  baris terpakai:', p.lines.map((l) => l.line).join(', '))

const used = new Set(p.lines.map((l) => l.line))
const empty = []
for (let i = 1; i <= 15; i++) if (!used.has(i)) empty.push(i)
console.log('  baris kosong (slot header):', empty.join(', ') || '(tidak ada)')

const starting = p.surahs.filter((s) => p.verseKeys.includes(`${s}:1`))
console.log('  surah yang MULAI di halaman ini:', starting.join(', ') || '(tidak ada)')
for (const s of starting) {
  const surah = meta.surahs.find((x) => x.number === s)
  console.log(`     ${s} = ${surah.nameLatin} / ${surah.nameArabic}  bismillahPre=${surah.bismillahPre}`)
}

console.log('\n  isi baris:')
for (const line of p.lines) {
  const keys = []
  for (const w of line.words) if (!keys.includes(w.k)) keys.push(w.k)
  const text = line.words.map((w) => w.t).join(' ')
  console.log(
    `   ${String(line.line).padStart(2)}  [${keys.join(' ')}]  ${line.words.length} kata`,
  )
  console.log(`       ${text}`)
}
