/**
 * Sync data mushaf dari UmmahAPI ke asset offline (§5.1.1 PRD).
 *
 * Dijalankan sekali saat build/persiapan rilis, bukan saat runtime:
 *   node scripts/sync-quran.mjs
 *
 * Output (public/data/):
 *   - quran-pages.json.gz  → 604 halaman word-by-word (Uthmani polos, tanpa tajweed)
 *   - quran-meta.json.gz   → daftar surah + rentang halaman juz
 *
 * Field tajweed HTML dari API sengaja dibuang (§1.2: tanpa marka tajwid),
 * begitu juga seluruh data audio & terjemahan (di luar cakupan).
 */
import { createWriteStream } from 'node:fs'
import { mkdir, writeFile, stat } from 'node:fs/promises'
import { gzip } from 'node:zlib'
import { promisify } from 'node:util'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const gzipAsync = promisify(gzip)
const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(__dirname, '../public/data')

const BASE = process.env.QURAN_API_BASE ?? 'https://ummahapi.com/api/quran'
const TOTAL_PAGES = 604
const TOTAL_JUZ = 30
const CONCURRENCY = 6
const RETRIES = 4

async function fetchJson(url, attempt = 1) {
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = await res.json()
    if (body?.success === false) throw new Error(`API success=false`)
    return body.data ?? body
  } catch (err) {
    if (attempt > RETRIES) throw new Error(`${url} gagal setelah ${RETRIES}x: ${err.message}`)
    const backoff = 400 * 2 ** (attempt - 1)
    await new Promise((r) => setTimeout(r, backoff))
    return fetchJson(url, attempt + 1)
  }
}

/** Jalankan task berbatch supaya tetap jauh di bawah rate limit (5000 req/15 menit). */
async function mapPool(items, limit, fn) {
  const out = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++
      out[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return out
}

/**
 * Ubah words flat dari API jadi struktur per baris → per ayat.
 * `line_number` (1–15) dipakai apa adanya supaya pembagian ayat-pojok
 * mushaf Madinah tetap presisi seperti cetak.
 */
function normalizePage(raw, pageNumber) {
  const lines = new Map()

  // PENTING: `position` dari API adalah nomor kata DI DALAM AYAT, bukan di
  // dalam baris. Baris yang memuat dua ayat punya posisi yang berulang dari 1,
  // jadi menyortir kata berdasarkan position akan menyelipkan kata antar-ayat.
  // Urutan array asli dari API sudah benar (kanan ke kiri), jadi dipertahankan.
  for (const w of raw.words ?? []) {
    const lineNo = w.line_number
    if (!lines.has(lineNo)) lines.set(lineNo, [])
    lines.get(lineNo).push({
      t: w.text_uthmani,
      k: w.verse_key,
      // 'end' = simbol nomor akhir ayat, bukan kata yang dihafal
      e: w.char_type_name === 'end' ? 1 : undefined,
      // Posisi kata di dalam ayatnya — dipakai memorize mode untuk mengenali
      // kata mana yang merupakan awal ayat.
      n: w.position,
    })
  }

  const orderedLines = [...lines.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([line, words]) => ({ line, words }))

  // Urutan kemunculan ayat di halaman ini (dipakai memorize mode)
  const verseKeys = []
  for (const l of orderedLines) {
    for (const w of l.words) {
      if (!verseKeys.includes(w.k)) verseKeys.push(w.k)
    }
  }

  const surahNumbers = [...new Set(verseKeys.map((k) => Number(k.split(':')[0])))]

  return {
    page: pageNumber,
    lines: orderedLines,
    verseKeys,
    surahs: surahNumbers,
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })

  console.log(`Sync mushaf dari ${BASE}`)
  console.log(`1/3 Ambil ${TOTAL_PAGES} halaman (concurrency ${CONCURRENCY})...`)

  const pageNumbers = Array.from({ length: TOTAL_PAGES }, (_, i) => i + 1)
  let done = 0
  const pages = await mapPool(pageNumbers, CONCURRENCY, async (n) => {
    const raw = await fetchJson(`${BASE}/page/${n}`)
    done++
    if (done % 50 === 0 || done === TOTAL_PAGES) {
      process.stdout.write(`   ${done}/${TOTAL_PAGES} halaman\n`)
    }
    return normalizePage(raw, n)
  })

  console.log('2/3 Ambil metadata surah & juz...')
  const surahData = await fetchJson(`${BASE}/surahs`)
  const surahs = (surahData.surahs ?? []).map((s) => ({
    number: s.number,
    nameArabic: s.name_arabic,
    nameLatin: s.name_english,
    nameTranslation: s.name_translation,
    revelationPlace: s.revelation_place,
    versesCount: s.verses_count,
    bismillahPre: Boolean(s.bismillah_pre),
    pageStart: Array.isArray(s.pages) ? s.pages[0] : undefined,
    pageEnd: Array.isArray(s.pages) ? s.pages[1] : undefined,
  }))

  const juzNumbers = Array.from({ length: TOTAL_JUZ }, (_, i) => i + 1)
  const juzList = await mapPool(juzNumbers, 4, async (n) => {
    const d = await fetchJson(`${BASE}/juz/${n}`)
    const mapping = d.verses_mapping ?? {}
    const entries = Object.entries(mapping).map(([surah, range]) => {
      const [from, to] = String(range).split('-')
      return { surah: Number(surah), from: Number(from), to: Number(to ?? from) }
    })
    const first = entries[0]
    const last = entries[entries.length - 1]
    return {
      number: n,
      startSurah: first?.surah,
      startAyah: first?.from,
      endSurah: last?.surah,
      endAyah: last?.to,
      totalVerses: d.total_verses,
      mapping: entries,
    }
  })

  // Halaman awal tiap juz diturunkan dari data halaman (bukan tebakan),
  // supaya "lompat ke juz" mendarat tepat di halaman mushaf yang benar.
  const firstPageOfVerse = new Map()
  for (const p of pages) {
    for (const k of p.verseKeys) {
      if (!firstPageOfVerse.has(k)) firstPageOfVerse.set(k, p.page)
    }
  }
  for (const j of juzList) {
    j.pageStart = firstPageOfVerse.get(`${j.startSurah}:${j.startAyah}`) ?? null
  }
  for (let i = 0; i < juzList.length; i++) {
    const next = juzList[i + 1]
    juzList[i].pageEnd = next?.pageStart ? next.pageStart : TOTAL_PAGES
  }

  console.log('3/3 Tulis asset terkompresi...')
  const pagesPayload = { version: 1, totalPages: TOTAL_PAGES, linesPerPage: 15, pages }
  const metaPayload = {
    version: 1,
    source: BASE,
    syncedAt: new Date().toISOString(),
    surahs,
    juz: juzList,
  }

  await writeGzip('quran-pages.json.gz', pagesPayload)
  await writeGzip('quran-meta.json.gz', metaPayload)

  console.log('\nSelesai. Asset siap dibundel ke APK (100% offline).')
}

async function writeGzip(name, payload) {
  const json = JSON.stringify(payload)
  const gz = await gzipAsync(json, { level: 9 })
  const path = resolve(OUT_DIR, name)
  await writeFile(path, gz)
  const kb = (gz.length / 1024).toFixed(0)
  const rawKb = (Buffer.byteLength(json) / 1024).toFixed(0)
  console.log(`   ${name}: ${kb} KB (gzip) dari ${rawKb} KB mentah`)
}

main().catch((err) => {
  console.error('\nSync gagal:', err.message)
  process.exitCode = 1
})
