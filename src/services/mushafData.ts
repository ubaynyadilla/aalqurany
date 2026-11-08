/**
 * Loader data mushaf offline.
 *
 * Asset dibundel sebagai .json.gz (§5.3) lalu didekompres di perangkat memakai
 * DecompressionStream bawaan WebView. Hasilnya di-cache di memori sehingga
 * pindah halaman tidak perlu membaca ulang berkas.
 */
import type {
  HeaderRow,
  Juz,
  MemorizeLine,
  MemorizeSegment,
  MemorizeSegmentPart,
  MushafMetaFile,
  MushafPage,
  MushafPagesFile,
  PageVerse,
  Surah,
} from '@/types'

/**
 * Alamat data mushaf, dua kemungkinan nama.
 *
 * Proses build Android (AAPT) ikut membuka berkas .gz di dalam assets dan
 * menyimpannya TANPA akhiran .gz — di dalam APK, `quran-pages.json.gz` menjadi
 * `quran-pages.json`. Karena itu nama ber-.gz dicoba lebih dulu (dev server &
 * web), lalu nama tanpa .gz (perangkat). Keduanya wajib ada di dalam paket
 * supaya aplikasi berjalan tanpa jaringan sama sekali.
 */
const PAGES_URLS = [
  `${import.meta.env.BASE_URL}data/quran-pages.json.gz`,
  `${import.meta.env.BASE_URL}data/quran-pages.json`,
]
const META_URLS = [
  `${import.meta.env.BASE_URL}data/quran-meta.json.gz`,
  `${import.meta.env.BASE_URL}data/quran-meta.json`,
]

let pagesPromise: Promise<MushafPagesFile> | null = null
let metaPromise: Promise<MushafMetaFile> | null = null

const pageIndex = new Map<number, MushafPage>()
const surahIndex = new Map<number, Surah>()
const juzIndex = new Map<number, Juz>()
/** verse_key → halaman pertama tempat ayat itu muncul */
const versePageIndex = new Map<string, number>()

/** Coba beberapa nama berkas; yang pertama berhasil dipakai. */
async function fetchFirst<T>(urls: string[]): Promise<T> {
  const errors: string[] = []
  for (const url of urls) {
    try {
      return await fetchJsonGz<T>(url)
    } catch (err) {
      errors.push(`${url}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  throw new Error(`Data mushaf tidak terbaca.\n${errors.join('\n')}`)
}

async function fetchJsonGz<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Gagal memuat ${url} (HTTP ${res.status})`)

  // Sebagian server (termasuk dev server) sudah membuka gzip sendiri lewat
  // Content-Encoding; deteksi magic byte supaya kedua kondisi tertangani.
  const buffer = await res.arrayBuffer()
  const head = new Uint8Array(buffer.slice(0, 2))
  const isGzip = head[0] === 0x1f && head[1] === 0x8b

  if (!isGzip) {
    return JSON.parse(new TextDecoder().decode(buffer)) as T
  }

  if (typeof DecompressionStream === 'undefined') {
    throw new Error('WebView tidak mendukung DecompressionStream')
  }

  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))
  const text = await new Response(stream).text()
  return JSON.parse(text) as T
}

export function loadPagesFile(): Promise<MushafPagesFile> {
  if (!pagesPromise) {
    pagesPromise = fetchFirst<MushafPagesFile>(PAGES_URLS).then((file) => {
      for (const page of file.pages) {
        pageIndex.set(page.page, page)
        for (const key of page.verseKeys) {
          if (!versePageIndex.has(key)) versePageIndex.set(key, page.page)
        }
      }
      return file
    })
  }
  return pagesPromise
}

export function loadMetaFile(): Promise<MushafMetaFile> {
  if (!metaPromise) {
    metaPromise = fetchFirst<MushafMetaFile>(META_URLS).then((file) => {
      for (const s of file.surahs) surahIndex.set(s.number, s)
      for (const j of file.juz) juzIndex.set(j.number, j)
      return file
    })
  }
  return metaPromise
}

export async function ensureMushafLoaded(): Promise<void> {
  await Promise.all([loadPagesFile(), loadMetaFile()])
}

export async function getPage(page: number): Promise<MushafPage | null> {
  await loadPagesFile()
  return pageIndex.get(page) ?? null
}

export async function getSurahs(): Promise<Surah[]> {
  const meta = await loadMetaFile()
  return meta.surahs
}

export async function getJuzList(): Promise<Juz[]> {
  const meta = await loadMetaFile()
  return meta.juz
}

export async function getSurah(number: number): Promise<Surah | null> {
  await loadMetaFile()
  return surahIndex.get(number) ?? null
}

/** Halaman mushaf tempat sebuah ayat berada — dipakai "lompat ke ayat" & deep link reminder. */
export async function findPageOfVerse(surah: number, ayah: number): Promise<number | null> {
  await loadPagesFile()
  const exact = versePageIndex.get(`${surah}:${ayah}`)
  if (exact) return exact

  // Ayat di luar jangkauan surah: mundur ke ayat terdekat yang ada
  for (let a = ayah - 1; a >= 1; a--) {
    const found = versePageIndex.get(`${surah}:${a}`)
    if (found) return found
  }
  const s = surahIndex.get(surah)
  return s?.pageStart ?? null
}

export async function findPageOfJuz(juz: number): Promise<number | null> {
  await loadMetaFile()
  const j = juzIndex.get(juz)
  if (j?.pageStart) return j.pageStart
  if (!j) return null
  return findPageOfVerse(j.startSurah, j.startAyah)
}

/**
 * Semua verseKey di antara dua ayat (termasuk keduanya), urut bacaan
 * Qur'an — surah menaik, lalu ayah menaik. TIDAK bergantung halaman:
 * urutan surah→ayah bersifat linear (tidak ada interleaving), jadi cukup
 * pakai `versesCount` tiap surah dari quran-meta.json untuk tahu di mana
 * sebuah surah berakhir. Ini membuat rentang otomatis benar walau
 * melintasi batas halaman (dipakai mode Audio: menandai ayat awal/akhir
 * yang bisa 1/2/3 halaman).
 *
 * Kedua ayat boleh diberikan dalam urutan apa pun — fungsi ini yang
 * menentukan mana yang lebih dulu dibaca.
 */
export function expandVerseRange(keyA: string, keyB: string, surahs: Surah[]): string[] {
  const versesCount = new Map(surahs.map((s) => [s.number, s.versesCount]))

  const parse = (key: string): [number, number] => {
    const [s, a] = key.split(':').map(Number)
    return [s, a]
  }

  let [s1, a1] = parse(keyA)
  let [s2, a2] = parse(keyB)

  // Urutkan supaya (s1, a1) selalu tidak lebih akhir dari (s2, a2)
  if (s1 > s2 || (s1 === s2 && a1 > a2)) {
    ;[s1, a1, s2, a2] = [s2, a2, s1, a1]
  }

  const out: string[] = []
  for (let s = s1; s <= s2; s++) {
    const count = versesCount.get(s)
    if (count == null) continue // surah tidak dikenal di data meta — lewati, bukan crash
    const from = s === s1 ? a1 : 1
    const to = Math.min(s === s2 ? a2 : count, count)
    for (let a = from; a <= to; a++) out.push(`${s}:${a}`)
  }
  return out
}

/**
 * Kelompokkan baris halaman menjadi daftar ayat berurutan.
 * Dipakai memorize mode: butuh kata-per-ayat, bukan kata-per-baris.
 */
export function groupPageVerses(page: MushafPage): PageVerse[] {
  const order: string[] = []
  const map = new Map<string, PageVerse>()

  for (const line of page.lines) {
    for (const word of line.words) {
      let verse = map.get(word.k)
      if (!verse) {
        const [surah, ayah] = word.k.split(':').map(Number)
        verse = { verseKey: word.k, surah, ayah, words: [] }
        map.set(word.k, verse)
        order.push(word.k)
      }
      if (word.e) {
        verse.endSymbol = word.t
      } else {
        verse.words.push(word.t)
      }
    }
  }

  return order.map((key) => map.get(key)!)
}

/** Satu potongan pilihan pengguna, apa adanya dari penyimpanan. */
export interface HelperPick {
  id?: number
  verseKey: string
  /** Berapa kata yang tampil; null = ikut setelan memorize */
  wordsShown: number | null
  /** Kata ke berapa potongan ini dimulai (0 = awal ayat) */
  wordOffset: number
}

/**
 * Bentuk masukan `picks` yang diterima. Daftar adalah bentuk utamanya — satu ayat
 * boleh punya banyak potongan. Bentuk Map lama (satu potongan per ayat) masih
 * diterima supaya tes dan pemanggil lama tetap berjalan.
 */
export type HelperPickInput =
  | HelperPick[]
  | Map<string, { wordsShown: number | null; wordOffset: number }>

function normalizePicks(input: HelperPickInput | undefined): HelperPick[] {
  if (!input) return []
  if (Array.isArray(input)) {
    return input.map((p) => ({ ...p, wordOffset: Math.max(0, p.wordOffset ?? 0) }))
  }
  return [...input].map(([verseKey, p]) => ({
    verseKey,
    wordsShown: p.wordsShown,
    wordOffset: Math.max(0, p.wordOffset ?? 0),
  }))
}

/**
 * Susun halaman memorize yang sejajar baris-per-baris dengan mushaf.
 *
 * Satu halaman memorize = satu halaman mushaf. Bila sebuah baris mushaf memuat
 * awal dua atau tiga ayat, baris memorize-nya memuat sebanyak itu pula, pada
 * urutan yang sama (kanan ke kiri).
 *
 * Yang tampil di sebuah baris: ayat yang DIMULAI di baris itu (kata pertamanya
 * ada di baris tersebut). Ayat yang hanya melanjutkan dari baris sebelumnya tidak
 * diulang.
 *
 * KALIMAT PEMBANTU. Sebuah ayat boleh menampilkan lebih dari satu kalimat
 * sekaligus, semuanya menyatu dalam satu deret pada ayat itu. Bawaannya hanya
 * potongan awal ayat; setiap kalimat yang dipilih pengguna di menu Bantu
 * DITAMBAHKAN ke deret itu, tidak menggantikannya. Contoh pada Al-Baqarah 2 —
 * mula-mula tampil "ذٰلِكَ", lalu pengguna menambahkan "لَا" dan "ٱلْمُتَّقِينَ",
 * sehingga yang tampil menjadi:
 *
 *   ذٰلِكَ … لَا … ٱلْمُتَّقِينَ ٢
 *
 * Titik-titik hanya berdiri di antara bagian yang memang ada kata tersembunyi di
 * sela-selanya; bagian yang berakhir tepat di kata terakhir ayat langsung
 * bersambung ke nomor ayatnya tanpa titik-titik.
 *
 * Berapa pun jumlah kalimat boleh ditambahkan, dan panjang tiap kalimat mengikuti
 * pilihan pengguna sendiri — setelan `wordsShown` di menu memorize hanya mengatur
 * potongan bawaan, tidak pernah mengunci kalimat pilihan.
 */
export function buildMemorizeLines(
  page: MushafPage,
  surahs: Surah[],
  opts: {
    wordsShown: number
    /**
     * Potongan pilihan pengguna. Bentuk daftar (bukan satu per ayat) supaya satu
     * ayat bisa memuat banyak kalimat sekaligus. Bentuk lama — Map verseKey → satu
     * potongan — tetap diterima agar pemanggil lama tidak perlu ikut berubah.
     */
    picks?: HelperPickInput
  } = { wordsShown: 2 },
  linesPerPage = 15,
): MemorizeLine[] {
  const picks = normalizePicks(opts.picks)
  const verses = groupPageVerses(page)
  const verseByKey = new Map(verses.map((v) => [v.verseKey, v]))

  const headerByLine = assignHeaderRows(page, surahs, linesPerPage)
  const wordsByLine = new Map(page.lines.map((l) => [l.line, l.words]))

  /** Kalimat pilihan pengguna, dikelompokkan per ayat */
  const picksByVerse = new Map<string, HelperPick[]>()
  for (const pick of picks) {
    const list = picksByVerse.get(pick.verseKey)
    if (list) list.push(pick)
    else picksByVerse.set(pick.verseKey, [pick])
  }

  const out: MemorizeLine[] = []

  // Selalu keluarkan 15 baris — termasuk baris yang tidak memulai ayat baru —
  // supaya baris ke-N di memorize sejajar dengan baris ke-N di mushaf.
  for (let lineNo = 1; lineNo <= linesPerPage; lineNo++) {
    const segments: MemorizeSegment[] = []
    const seen = new Set<string>()

    // Ayat yang dimulai di baris ini, urut kanan-ke-kiri seperti mushaf
    for (const word of wordsByLine.get(lineNo) ?? []) {
      if (word.e) continue
      if (seen.has(word.k)) continue
      if (word.n !== 1) continue
      seen.add(word.k)

      const verse = verseByKey.get(word.k)
      if (!verse) continue

      segments.push(
        buildSegment(verse, picksByVerse.get(word.k) ?? [], opts.wordsShown),
      )
    }

    const decoration = headerByLine.get(lineNo)
    out.push({
      line: lineNo,
      segments,
      header: decoration?.kind === 'header' ? decoration : undefined,
      bismillah: decoration?.kind === 'bismillah',
    })
  }

  return out
}

/**
 * Susun tampilan sebuah ayat di memorize: potongan bawaan di awal ayat, ditambah
 * setiap kalimat pilihan pengguna, semuanya dalam satu deret berurutan.
 *
 * Rentang kata yang saling menempel atau bertumpuk digabung menjadi satu bagian,
 * sehingga tidak ada titik-titik yang berdiri di tempat yang sebenarnya tidak
 * memotong apa pun. Titik-titik hanya digambar bila memang ada kata yang
 * disembunyikan sesudah sebuah bagian — termasuk sesudah bagian terakhir, kecuali
 * bagian itu sudah menutup ayat.
 */
function buildSegment(
  verse: PageVerse,
  picks: HelperPick[],
  defaultWordsShown: number,
): MemorizeSegment {
  const total = verse.words.length
  const lastIndex = Math.max(0, total - 1)

  /** Rentang [awal, akhir) beserta asalnya */
  type Range = { from: number; to: number; isHelper: boolean; pickIds: number[] }
  const ranges: Range[] = []

  const clampRange = (offset: number, count: number): { from: number; to: number } => {
    const from = Math.min(Math.max(0, offset), lastIndex)
    const to = Math.min(total, from + Math.max(1, count))
    return { from, to }
  }

  // Potongan bawaan: awal ayat, sepanjang setelan memorize. Setelan 0 berarti
  // "hanya nomor ayat": tidak ada potongan bawaan sama sekali, sehingga baris
  // hanya memuat penanda ayatnya (ditambah kalimat pilihan pengguna, bila ada).
  if (defaultWordsShown >= 1) {
    const base = clampRange(0, defaultWordsShown)
    ranges.push({ from: base.from, to: base.to, isHelper: false, pickIds: [] })
  }

  // Kalimat pilihan pengguna: masing-masing memakai panjangnya sendiri
  for (const pick of picks) {
    // `defaultWordsShown` bisa 0 (hanya nomor ayat); kalimat pilihan tetap minimal 1 kata
    const r = clampRange(pick.wordOffset, pick.wordsShown ?? Math.max(1, defaultWordsShown))
    ranges.push({
      from: r.from,
      to: r.to,
      isHelper: true,
      pickIds: pick.id != null ? [pick.id] : [],
    })
  }

  // Gabungkan rentang yang menempel/bertumpuk supaya deretnya bersih
  ranges.sort((a, b) => a.from - b.from || a.to - b.to)
  const merged: Range[] = []
  for (const r of ranges) {
    const prev = merged[merged.length - 1]
    if (prev && r.from <= prev.to) {
      prev.to = Math.max(prev.to, r.to)
      prev.isHelper = prev.isHelper || r.isHelper
      prev.pickIds = [...prev.pickIds, ...r.pickIds]
      continue
    }
    merged.push({ ...r })
  }

  const parts: MemorizeSegmentPart[] = merged.map((r, i) => {
    const next = merged[i + 1]
    const endsVerse = r.to >= total
    return {
      words: verse.words.slice(r.from, r.to),
      offset: r.from,
      isHelper: r.isHelper,
      pickIds: r.pickIds,
      endsVerse,
      // Ada kata tersembunyi sesudah bagian ini? Bila bagian berikutnya menyusul,
      // celah di antaranya memang ada kata (karena yang menempel sudah digabung).
      ellipsisAfter: next ? true : !endsVerse,
    }
  })

  const lastPart = parts[parts.length - 1]

  return {
    verseKey: verse.verseKey,
    surah: verse.surah,
    ayah: verse.ayah,
    parts,
    opening: parts.flatMap((p) => p.words),
    full: verse.words,
    startsHere: true,
    isHelper: parts.some((p) => p.isHelper),
    offset: parts[0]?.offset ?? 0,
    endsVerse: lastPart?.endsVerse ?? false,
  }
}

/**
 * Tentukan isi baris-baris hiasan kepala surah pada sebuah halaman.
 *
 * Mushaf cetak menyisakan satu baris untuk bingkai nama surah dan — bila surah
 * itu dibuka basmalah — satu baris lagi khusus basmalah. Pada data, baris-baris
 * itu tampak sebagai `line_number` yang tidak terpakai. Jadi bila tersedia dua
 * baris kosong berurutan tepat di atas ayat pertama, keduanya dipakai terpisah:
 * bingkai di baris atas, basmalah di baris bawah. Kalau hanya ada satu baris,
 * basmalah menumpang di baris bingkai (`withBismillah`).
 *
 * Reader dan memorize memakai fungsi yang sama agar nomor barisnya tetap
 * sejajar satu-satu.
 */
export function assignHeaderRows(
  page: MushafPage,
  surahs: Surah[],
  linesPerPage = 15,
): Map<number, HeaderRow> {
  const result = new Map<number, HeaderRow>()

  const emptyLines = new Set(detectHeaderLines(page, linesPerPage))
  if (!emptyLines.size) return result

  const firstLineOfSurah = new Map<number, number>()
  for (const line of page.lines) {
    for (const w of line.words) {
      const surahNo = Number(w.k.split(':')[0])
      if (!firstLineOfSurah.has(surahNo)) firstLineOfSurah.set(surahNo, line.line)
    }
  }

  const startingSurahs = page.surahs.filter((n) => page.verseKeys.includes(`${n}:1`))
  const taken = new Set<number>()

  for (const surahNo of startingSurahs) {
    const surah = surahs.find((s) => s.number === surahNo)
    if (!surah) continue
    const firstLine = firstLineOfSurah.get(surahNo) ?? 1

    // Blok baris kosong berurutan yang berakhir tepat sebelum ayat pertama
    const block: number[] = []
    for (let l = firstLine - 1; l >= 1; l--) {
      if (!emptyLines.has(l) || taken.has(l)) break
      block.unshift(l)
    }

    if (!block.length) {
      // Tidak ada baris kosong di atasnya (mis. surah membuka halaman):
      // pakai baris kosong pertama yang masih bebas.
      const fallback = [...emptyLines].filter((l) => !taken.has(l)).sort((a, b) => a - b)[0]
      if (fallback == null) continue
      block.push(fallback)
    }

    // Dua baris terbawah dari blok adalah yang menempel pada ayat pertama
    const wantsOwnBismillahRow = surah.bismillahPre && block.length >= 2
    const headerLine = wantsOwnBismillahRow ? block[block.length - 2] : block[block.length - 1]

    taken.add(headerLine)
    result.set(headerLine, {
      kind: 'header',
      surahNumber: surah.number,
      nameArabic: surah.nameArabic,
      // Basmalah ikut di baris bingkai hanya bila tak punya baris sendiri
      withBismillah: surah.bismillahPre && !wantsOwnBismillahRow,
    })

    if (wantsOwnBismillahRow) {
      const bismillahLine = block[block.length - 1]
      taken.add(bismillahLine)
      result.set(bismillahLine, { kind: 'bismillah', surahNumber: surah.number })
    }
  }

  return result
}

/**
 * Baris yang memuat bingkai nama surah saja — dipakai memorize agar posisi
 * header di panel hafalan sejajar dengan mushaf.
 */
export function headerLineAssignments(
  page: MushafPage,
  surahs: Surah[],
  linesPerPage = 15,
): Map<number, { surahNumber: number; nameArabic: string; withBismillah: boolean }> {
  const result = new Map<
    number,
    { surahNumber: number; nameArabic: string; withBismillah: boolean }
  >()

  for (const [line, row] of assignHeaderRows(page, surahs, linesPerPage)) {
    if (row.kind !== 'header') continue
    result.set(line, {
      surahNumber: row.surahNumber,
      nameArabic: row.nameArabic,
      withBismillah: row.withBismillah,
    })
  }

  return result
}

/**
 * Nomor baris yang kosong pada data = baris hiasan nama surah pada mushaf cetak
 * (dan basmalah). Dipakai reader untuk menyisipkan header surah di posisi
 * yang sama seperti mushaf fisik, sehingga layout tetap 1:1.
 */
export function detectHeaderLines(page: MushafPage, linesPerPage = 15): number[] {
  const used = new Set(page.lines.map((l) => l.line))
  const headers: number[] = []
  for (let i = 1; i <= linesPerPage; i++) {
    if (!used.has(i)) headers.push(i)
  }
  return headers
}

/** Ayat pertama pada halaman untuk tiap surah yang muncul di halaman itu. */
export function firstVerseOfSurahOnPage(page: MushafPage, surah: number): number | null {
  for (const key of page.verseKeys) {
    const [s, a] = key.split(':').map(Number)
    if (s === surah) return a
  }
  return null
}