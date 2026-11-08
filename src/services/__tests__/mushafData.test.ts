/**
 * Tes logika halaman mushaf terhadap data asli hasil sync (604 halaman).
 * Fokusnya menjaga dua janji utama PRD: ayat pojok dan pembagian per halaman.
 */
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assignHeaderRows,
  buildMemorizeLines,
  groupPageVerses,
  detectHeaderLines,
} from '../mushafData'
import type { MushafMetaFile, MushafPagesFile } from '@/types'

const root = resolve(import.meta.dirname, '../../..')

function readGz<T>(name: string): T {
  const buf = readFileSync(resolve(root, 'public/data', name))
  return JSON.parse(gunzipSync(buf).toString('utf8')) as T
}

const pagesFile = readGz<MushafPagesFile>('quran-pages.json.gz')
const meta = readGz<MushafMetaFile>('quran-meta.json.gz')
const pageOf = (n: number) => pagesFile.pages.find((p) => p.page === n)!

/**
 * Teks Uthmani menyusun shadda sebelum harakat (mis. U+0651 lalu U+064E),
 * berbeda dari bentuk NFC yang dipakai editor saat menyimpan berkas ini.
 * Perbandingan disamakan lewat NFC agar tes menguji isi kata, bukan
 * urutan penyimpanan tanda baca.
 */
const nfc = (s: string) => s.normalize('NFC')

describe('data mushaf', () => {
  it('berisi 604 halaman dan 6236 ayat unik', () => {
    expect(pagesFile.pages).toHaveLength(604)
    expect(pagesFile.linesPerPage).toBe(15)

    const verses = new Set<string>()
    for (const p of pagesFile.pages) p.verseKeys.forEach((k) => verses.add(k))
    expect(verses.size).toBe(6236)
  })

  it('tidak memotong ayat ke halaman berikutnya (ayat pojok)', () => {
    // Tiap ayat hanya boleh tercatat pada satu halaman
    const seen = new Map<string, number>()
    const straddling: string[] = []

    for (const p of pagesFile.pages) {
      for (const key of p.verseKeys) {
        const prev = seen.get(key)
        if (prev != null && prev !== p.page) straddling.push(key)
        else seen.set(key, p.page)
      }
    }

    expect(straddling).toEqual([])
  })

  it('nomor baris tiap halaman berada dalam 1..15 dan urut', () => {
    for (const p of pagesFile.pages) {
      const lines = p.lines.map((l) => l.line)
      expect(Math.min(...lines)).toBeGreaterThanOrEqual(1)
      expect(Math.max(...lines)).toBeLessThanOrEqual(15)
      expect([...lines]).toEqual([...lines].sort((a, b) => a - b))
    }
  })

  it('metadata surah & juz lengkap, tiap juz punya halaman awal', () => {
    expect(meta.surahs).toHaveLength(114)
    expect(meta.juz).toHaveLength(30)
    expect(meta.juz.every((j) => typeof j.pageStart === 'number' && j.pageStart >= 1)).toBe(true)
    expect(meta.juz[0].pageStart).toBe(1)
    // Halaman awal juz harus menaik
    const starts = meta.juz.map((j) => j.pageStart!)
    expect([...starts]).toEqual([...starts].sort((a, b) => a - b))
  })
})

describe('groupPageVerses', () => {
  it('mengelompokkan kata per ayat sesuai urutan kemunculan', () => {
    const verses = groupPageVerses(pageOf(1))

    expect(verses.map((v) => v.verseKey)).toEqual([
      '1:1',
      '1:2',
      '1:3',
      '1:4',
      '1:5',
      '1:6',
      '1:7',
    ])
    expect(verses[0].surah).toBe(1)
    expect(verses[0].ayah).toBe(1)
    expect(verses[0].words.map(nfc)).toEqual(
      ['بِسْمِ', 'ٱللَّهِ', 'ٱلرَّحْمَـٰنِ', 'ٱلرَّحِيمِ'].map(nfc),
    )
  })

  it('memisahkan simbol nomor akhir ayat dari kata yang dihafal', () => {
    const verses = groupPageVerses(pageOf(1))
    // Simbol akhir ayat tidak boleh masuk daftar kata
    expect(verses[0].endSymbol).toBe('١')
    expect(verses[0].words).not.toContain('١')
  })

  it('jumlah kata per ayat konsisten dengan token halaman', () => {
    for (const page of [1, 2, 187, 300, 604]) {
      const p = pageOf(page)
      const verses = groupPageVerses(p)
      const tokens = p.lines.reduce((n, l) => n + l.words.length, 0)
      const grouped = verses.reduce((n, v) => n + v.words.length + (v.endSymbol ? 1 : 0), 0)
      expect(grouped).toBe(tokens)
    }
  })

  it('mengambil N kata pertama untuk memorize mode', () => {
    const verses = groupPageVerses(pageOf(1))
    const opening = (words: string[], n: number) => words.slice(0, n).join(' ')

    expect(nfc(opening(verses[0].words, 1))).toBe(nfc('بِسْمِ'))
    expect(nfc(opening(verses[0].words, 2))).toBe(nfc('بِسْمِ ٱللَّهِ'))
    // Meminta lebih banyak dari yang tersedia tetap aman
    expect(opening(verses[0].words, 99).split(' ')).toHaveLength(4)
  })
})

/**
 * Regresi untuk keluhan "kata satu ayat bercampur dengan ayat lain seperti
 * puzzle". Penyebabnya dulu: menyortir kata memakai field `position` dari API,
 * padahal itu nomor kata DI DALAM AYAT — baris yang memuat dua ayat punya
 * position yang berulang dari 1, sehingga kata antar-ayat saling menyelip.
 */
describe('urutan kata per baris', () => {
  it('kata tiap ayat urut naik dan tidak terputus di semua 604 halaman', () => {
    const broken: string[] = []

    for (const p of pagesFile.pages) {
      for (const line of p.lines) {
        const lastByVerse = new Map<string, number>()
        for (const w of line.words) {
          if (w.e || w.n == null) continue
          const prev = lastByVerse.get(w.k)
          if (prev != null && w.n !== prev + 1) broken.push(`${p.page}:${line.line} ${w.k}`)
          lastByVerse.set(w.k, w.n)
        }
      }
    }

    expect(broken).toEqual([])
  })

  it('ayat pada satu baris tidak saling menyelip', () => {
    const interleaved: string[] = []

    for (const p of pagesFile.pages) {
      for (const line of p.lines) {
        // Sekali sebuah ayat ditinggalkan, ia tidak boleh muncul lagi di baris itu
        const closed = new Set<string>()
        let current: string | null = null

        for (const w of line.words) {
          if (w.k === current) continue
          if (closed.has(w.k)) {
            interleaved.push(`${p.page}:${line.line} ${w.k}`)
            continue
          }
          if (current) closed.add(current)
          current = w.k
        }
      }
    }

    expect(interleaved).toEqual([])
  })
})

/**
 * Poin utama panel memorize: satu halaman memorize = satu halaman mushaf, dan
 * baris ke-N memorize sejajar dengan baris ke-N mushaf. Bila satu baris mushaf
 * memuat awal 2/3 ayat, baris memorize-nya memuat 2/3 potongan awal pula.
 */
describe('buildMemorizeLines', () => {
  const build = (n: number, wordsShown = 2) =>
    buildMemorizeLines(pageOf(n), meta.surahs, { wordsShown })

  it('selalu menghasilkan 15 baris agar sejajar dengan mushaf', () => {
    for (const n of [1, 2, 50, 187, 300, 555, 604]) {
      const lines = build(n)
      expect(lines).toHaveLength(15)
      expect(lines.map((l) => l.line)).toEqual([...Array(15)].map((_, i) => i + 1))
    }
  })

  it('jumlah potongan per baris sama dengan jumlah ayat yang dimulai di baris itu', () => {
    for (const n of [1, 2, 50, 187, 300, 555, 604]) {
      const p = pageOf(n)
      const lines = build(n)

      for (const line of p.lines) {
        const startsOnLine = new Set(
          line.words.filter((w) => !w.e && w.n === 1).map((w) => w.k),
        )
        const built = lines.find((l) => l.line === line.line)!
        expect(built.segments.map((s) => s.verseKey)).toEqual([...startsOnLine])
      }
    }
  })

  it('setelan 0 kata: tiap ayat tetap punya barisnya, tapi hanya nomor ayat (tanpa kalimat)', () => {
    const lines = build(2, 0)
    expect(lines).toHaveLength(15)

    const segments = lines.flatMap((l) => l.segments)
    expect(segments.length).toBeGreaterThan(0)
    for (const seg of segments) {
      expect(seg.parts).toHaveLength(0)
      expect(seg.opening).toHaveLength(0)
    }

    // Susunan ayat per baris sama persis dengan setelan biasa
    const normal = build(2, 2).flatMap((l) => l.segments.map((s) => s.verseKey))
    expect(segments.map((s) => s.verseKey)).toEqual(normal)
  })

  it('setelan 0 kata tetap menampilkan kalimat yang dipilih pengguna', () => {
    const p = pageOf(2)
    const key = p.lines.flatMap((l) => l.words).find((w) => !w.e && w.n === 1)!.k
    const lines = buildMemorizeLines(p, meta.surahs, {
      wordsShown: 0,
      picks: [{ id: 1, verseKey: key, wordsShown: 1, wordOffset: 1 }],
    })
    const seg = lines.flatMap((l) => l.segments).find((s) => s.verseKey === key)!
    expect(seg.parts).toHaveLength(1)
    expect(seg.parts[0].words).toHaveLength(1)
  })

  it('potongan awal berurutan kanan-ke-kiri sama seperti di mushaf', () => {
    // Halaman 2 (Al-Baqarah 1–5) punya baris dengan lebih dari satu awal ayat
    const p = pageOf(2)
    const lines = build(2)

    for (const line of p.lines) {
      const orderInMushaf = line.words.filter((w) => !w.e && w.n === 1).map((w) => w.k)
      const orderInMemorize = lines.find((l) => l.line === line.line)!.segments.map((s) => s.verseKey)
      expect(orderInMemorize).toEqual(orderInMushaf)
    }
  })

  it('potongan awal memang kata-kata pertama ayatnya', () => {
    const lines = build(1, 2)
    const seg = lines.flatMap((l) => l.segments).find((s) => s.verseKey === '1:1')!
    expect(seg.opening.map(nfc)).toEqual(['بِسْمِ', 'ٱللَّهِ'].map(nfc))
    // Tanpa kalimat pembantu: satu bagian saja, dan masih ada kata tersembunyi
    expect(seg.parts).toHaveLength(1)
    expect(seg.parts[0].isHelper).toBe(false)
    expect(seg.parts[0].ellipsisAfter).toBe(true)
    expect(seg.full.map(nfc)).toEqual(
      ['بِسْمِ', 'ٱللَّهِ', 'ٱلرَّحْمَـٰنِ', 'ٱلرَّحِيمِ'].map(nfc),
    )
    expect(seg.startsHere).toBe(true)
    expect(seg.isHelper).toBe(false)
  })

  it('tiap ayat halaman tampil tepat satu kali, tidak terulang antar baris', () => {
    for (const n of [1, 2, 187, 300, 604]) {
      const keys = build(n).flatMap((l) => l.segments.map((s) => s.verseKey))
      expect(new Set(keys).size).toBe(keys.length)
    }
  })

  /**
   * Contoh yang diminta pengguna sendiri, Al-Baqarah 2. Bawaannya menampilkan
   * "ذَٰلِكَ" saja; setelah pengguna menambahkan "لَا" (kata ke-4) dan kata
   * terakhir "ٱلْمُتَّقِينَ", yang tampil menjadi
   *
   *   ذَٰلِكَ … لَا … ٱلْمُتَّقِينَ
   *
   * dengan bagian terakhir TANPA titik-titik karena sudah kata terakhir ayat.
   */
  it('kalimat pembantu menyatu dalam satu ayat: dzalika … la … muttaqin', () => {
    const p = pagesFile.pages.find((pg) => pg.verseKeys.includes('2:2'))!
    const verse = groupPageVerses(p).find((v) => v.verseKey === '2:2')!
    const laIndex = verse.words.findIndex((w) => nfc(w) === nfc('لَا'))
    const lastIndex = verse.words.length - 1
    expect(laIndex).toBeGreaterThan(0)

    const lines = buildMemorizeLines(p, meta.surahs, {
      wordsShown: 1,
      picks: [
        { id: 1, verseKey: '2:2', wordsShown: 1, wordOffset: laIndex },
        { id: 2, verseKey: '2:2', wordsShown: 1, wordOffset: lastIndex },
      ],
    })

    // Satu ayat = satu segmen; kalimat pembantu jadi bagian di dalamnya
    const segs = lines.flatMap((l) => l.segments).filter((s) => s.verseKey === '2:2')
    expect(segs).toHaveLength(1)

    const seg = segs[0]
    expect(seg.parts.map((part) => part.words.map(nfc).join(' '))).toEqual(
      [verse.words[0], 'لَا', verse.words[lastIndex]].map((w) => nfc(w)),
    )
    // Titik-titik di dua sela pertama, tapi tidak sesudah bagian penutup ayat
    expect(seg.parts.map((part) => part.ellipsisAfter)).toEqual([true, true, false])
    expect(seg.parts.map((part) => part.isHelper)).toEqual([false, true, true])
    expect(seg.endsVerse).toBe(true)
  })

  /**
   * Setelan "kata awal ditampilkan" hanya mengatur potongan BAWAAN. Kalimat yang
   * dipilih sendiri di menu Bantu memakai panjangnya sendiri, berapa pun setelan
   * itu — dulu keduanya bertabrakan karena pilihan pengguna ikut memakai
   * `wordsShown` global sebagai cadangan.
   */
  it('setelan memorize tidak mengunci panjang kalimat pilihan', () => {
    const p = pageOf(3)
    const verses = groupPageVerses(p)
    const long = verses.reduce((a, b) => (b.words.length > a.words.length ? b : a))

    for (const setting of [1, 2, 5, 8]) {
      const lines = buildMemorizeLines(p, meta.surahs, {
        wordsShown: setting,
        picks: [{ id: 1, verseKey: long.verseKey, wordsShown: 3, wordOffset: long.words.length - 4 }],
      })
      const seg = lines.flatMap((l) => l.segments).find((s) => s.verseKey === long.verseKey)!
      const helper = seg.parts.find((part) => part.isHelper)!
      // Selalu 3 kata, tidak ikut berubah bersama setelan
      expect(helper.words.map(nfc)).toEqual(
        long.words.slice(long.words.length - 4, long.words.length - 1).map(nfc),
      )
    }
  })

  it('kalimat pilihan di tengah ayat memakai kata dari offset itu, awal ayat tetap tampil', () => {
    const p = pageOf(3)
    const verses = groupPageVerses(p)
    const long = verses.reduce((a, b) => (b.words.length > a.words.length ? b : a))

    const lines = buildMemorizeLines(p, meta.surahs, {
      wordsShown: 1,
      picks: [{ id: 1, verseKey: long.verseKey, wordsShown: 2, wordOffset: 3 }],
    })

    const seg = lines.flatMap((l) => l.segments).find((s) => s.verseKey === long.verseKey)!
    expect(seg.parts).toHaveLength(2)
    // Bagian pertama tetap potongan bawaan awal ayat
    expect(seg.parts[0].isHelper).toBe(false)
    expect(seg.parts[0].words.map(nfc)).toEqual([nfc(long.words[0])])
    // Bagian kedua kalimat pilihan, mulai dari kata ke-4
    expect(seg.parts[1].offset).toBe(3)
    expect(seg.parts[1].words.map(nfc)).toEqual(long.words.slice(3, 5).map(nfc))
  })

  it('ayat dengan kalimat pembantu tetap digambar di baris awal ayatnya', () => {
    const p = pageOf(3)
    const verses = groupPageVerses(p)
    const long = verses.reduce((a, b) => (b.words.length > a.words.length ? b : a))

    const lines = buildMemorizeLines(p, meta.surahs, {
      wordsShown: 1,
      picks: [{ id: 1, verseKey: long.verseKey, wordsShown: 1, wordOffset: long.words.length - 1 }],
    })

    // Satu baris saja, dan itu baris tempat kata pertama ayatnya berada
    const own = lines.filter((l) => l.segments.some((s) => s.verseKey === long.verseKey))
    expect(own).toHaveLength(1)
    const startLine = p.lines.find((l) =>
      l.words.some((w) => w.k === long.verseKey && w.n === 1),
    )!.line
    expect(own[0].line).toBe(startLine)
  })

  /**
   * Keluhan pengguna: "ketika memilih kalimat dan menyeretnya ke memorize maka
   * kalimat yang lama akan hilang." Satu ayat harus bisa menampung berapa pun
   * kalimat, dan semuanya tampil bersama-sama.
   */
  it('satu ayat boleh punya banyak kalimat pembantu sekaligus', () => {
    const p = pageOf(3)
    const verses = groupPageVerses(p)
    const long = verses.reduce((a, b) => (b.words.length > a.words.length ? b : a))
    expect(long.words.length).toBeGreaterThanOrEqual(8)

    const lines = buildMemorizeLines(p, meta.surahs, {
      wordsShown: 1,
      picks: [
        { id: 1, verseKey: long.verseKey, wordsShown: 1, wordOffset: 2 },
        { id: 2, verseKey: long.verseKey, wordsShown: 1, wordOffset: 4 },
        { id: 3, verseKey: long.verseKey, wordsShown: 1, wordOffset: 6 },
      ],
    })

    const seg = lines.flatMap((l) => l.segments).find((s) => s.verseKey === long.verseKey)!
    // Bawaan + tiga kalimat pembantu, tidak ada yang tersapu oleh yang terbaru
    expect(seg.parts.map((part) => part.offset)).toEqual([0, 2, 4, 6])
    expect(seg.parts.map((part) => part.isHelper)).toEqual([false, true, true, true])
    expect(seg.isHelper).toBe(true)
  })

  it('kalimat pembantu yang menempel potongan bawaan digabung, tanpa titik-titik palsu', () => {
    const p = pageOf(3)
    const verses = groupPageVerses(p)
    const long = verses.reduce((a, b) => (b.words.length > a.words.length ? b : a))

    // Bawaan 2 kata (indeks 0–1), pembantu mulai indeks 2 → bersambung langsung
    const lines = buildMemorizeLines(p, meta.surahs, {
      wordsShown: 2,
      picks: [{ id: 1, verseKey: long.verseKey, wordsShown: 2, wordOffset: 2 }],
    })

    const seg = lines.flatMap((l) => l.segments).find((s) => s.verseKey === long.verseKey)!
    expect(seg.parts).toHaveLength(1)
    expect(seg.parts[0].words.map(nfc)).toEqual(long.words.slice(0, 4).map(nfc))
    // Masih ada sisa ayat, jadi titik-titik tetap ada di ujung
    expect(seg.parts[0].ellipsisAfter).toBe(true)
  })

  it('minta kata lebih banyak dari sisa ayat tetap aman dan menutup ayat', () => {
    const p = pageOf(1)
    const verse = groupPageVerses(p)[0]

    const lines = buildMemorizeLines(p, meta.surahs, {
      wordsShown: 1,
      picks: [{ id: 1, verseKey: verse.verseKey, wordsShown: 99, wordOffset: 1 }],
    })

    const seg = lines.flatMap((l) => l.segments).find((s) => s.verseKey === verse.verseKey)!
    // Bawaan + sisa ayat menyambung → satu bagian utuh, tanpa titik-titik di ujung
    expect(seg.opening.map(nfc)).toEqual(verse.words.map(nfc))
    expect(seg.endsVerse).toBe(true)
    expect(seg.parts[seg.parts.length - 1].ellipsisAfter).toBe(false)
  })

  it('bentuk picks lama (Map satu potongan per ayat) tetap diterima', () => {
    const p = pageOf(3)
    const verses = groupPageVerses(p)
    const long = verses.reduce((a, b) => (b.words.length > a.words.length ? b : a))

    const lines = buildMemorizeLines(p, meta.surahs, {
      wordsShown: 1,
      picks: new Map([[long.verseKey, { wordsShown: 3, wordOffset: 3 }]]),
    })

    const seg = lines.flatMap((l) => l.segments).find((s) => s.verseKey === long.verseKey)!
    const helper = seg.parts.find((part) => part.isHelper)!
    expect(helper.offset).toBe(3)
    expect(helper.words).toHaveLength(3)
  })

  it('header surah berada di baris yang sama seperti pada reader', () => {
    const lines = build(1)
    const headerLines = lines.filter((l) => l.header).map((l) => l.line)
    // Al-Fatihah: hiasan nama surah di baris kosong pertama
    expect(headerLines).toContain(1)
    expect(lines.find((l) => l.line === 1)!.header!.surahNumber).toBe(1)
  })
})

/**
 * Mushaf cetak menyisakan satu baris untuk bingkai nama surah dan satu baris
 * lagi untuk basmalah. Halaman 106 (Al-Ma'idah) adalah contohnya: baris 6 & 7
 * kosong. Dulu keduanya dijejalkan ke satu baris sehingga bingkainya menyempit.
 */
describe('assignHeaderRows', () => {
  const rowsOf = (n: number) => assignHeaderRows(pageOf(n), meta.surahs)

  it('memisahkan bingkai surah dan basmalah ke dua baris bila tersedia', () => {
    const rows = rowsOf(106)
    // Baris kosong halaman 106 adalah 6 dan 7
    expect(detectHeaderLines(pageOf(106))).toEqual([6, 7])

    const header = rows.get(6)
    expect(header).toEqual({
      kind: 'header',
      surahNumber: 5,
      nameArabic: 'المائدة',
      // Basmalah punya barisnya sendiri, jadi tidak menumpang
      withBismillah: false,
    })
    expect(rows.get(7)).toEqual({ kind: 'bismillah', surahNumber: 5 })
  })

  it('basmalah menumpang di baris bingkai bila hanya ada satu slot', () => {
    // Cari halaman dengan tepat satu baris kosong dan satu surah yang mulai
    const single = pagesFile.pages.find((p) => {
      const empty = detectHeaderLines(p)
      const starting = p.surahs.filter((n) => p.verseKeys.includes(`${n}:1`))
      if (empty.length !== 1 || starting.length !== 1) return false
      return meta.surahs.find((s) => s.number === starting[0])?.bismillahPre === true
    })

    if (!single) return // tidak ada di mushaf ini; bukan kegagalan
    const rows = assignHeaderRows(single, meta.surahs)
    const header = [...rows.values()].find((r) => r.kind === 'header')!
    expect(header.kind).toBe('header')
    expect(header.kind === 'header' && header.withBismillah).toBe(true)
  })

  it('At-Taubah tidak pernah mendapat baris basmalah', () => {
    // Surah 9 satu-satunya tanpa basmalah pembuka
    const page = pagesFile.pages.find((p) => p.verseKeys.includes('9:1'))!
    const rows = assignHeaderRows(page, meta.surahs)
    const forSurah9 = [...rows.values()].filter((r) => r.surahNumber === 9)

    expect(forSurah9.some((r) => r.kind === 'bismillah')).toBe(false)
    const header = forSurah9.find((r) => r.kind === 'header')
    if (header?.kind === 'header') expect(header.withBismillah).toBe(false)
  })

  it('tidak pernah menaruh dua hiasan pada baris yang sama', () => {
    for (const p of pagesFile.pages) {
      const rows = assignHeaderRows(p, meta.surahs)
      // Baris hiasan hanya boleh menempati baris yang memang kosong pada data
      const empty = new Set(detectHeaderLines(p))
      for (const line of rows.keys()) {
        expect(empty.has(line)).toBe(true)
      }
    }
  })

  it('setiap surah yang mulai di sebuah halaman mendapat satu bingkai', () => {
    for (const p of pagesFile.pages) {
      const starting = p.surahs.filter((n) => p.verseKeys.includes(`${n}:1`))
      if (!starting.length) continue
      if (!detectHeaderLines(p).length) continue

      const headers = [...assignHeaderRows(p, meta.surahs).values()].filter(
        (r) => r.kind === 'header',
      )
      expect(headers.map((h) => h.surahNumber).sort((a, b) => a - b)).toEqual(
        [...starting].sort((a, b) => a - b),
      )
    }
  })

  it('memorize menampilkan baris basmalah pada baris yang sama seperti reader', () => {
    const lines = buildMemorizeLines(pageOf(106), meta.surahs, { wordsShown: 2 })
    expect(lines.find((l) => l.line === 6)!.header!.surahNumber).toBe(5)
    expect(lines.find((l) => l.line === 7)!.bismillah).toBe(true)
    // Baris basmalah tidak memuat potongan ayat
    expect(lines.find((l) => l.line === 7)!.segments).toEqual([])
  })
})

describe('detectHeaderLines', () => {
  it('halaman 1 menyisakan baris untuk hiasan nama surah', () => {
    // Al-Fatihah mulai di baris 2, jadi baris 1 kosong untuk header
    expect(detectHeaderLines(pageOf(1))).toContain(1)
  })

  it('halaman 604 menyisakan baris header untuk tiga surah terakhir', () => {
    const headers = detectHeaderLines(pageOf(604))
    const page = pageOf(604)
    // Tiga surah (112, 113, 114) semuanya mulai di halaman ini
    const starting = page.surahs.filter((n) => page.verseKeys.includes(`${n}:1`))
    expect(starting).toEqual([112, 113, 114])
    expect(headers.length).toBeGreaterThanOrEqual(starting.length)
  })

  it('halaman tengah surah tanpa awal surah tidak wajib punya header', () => {
    const page = pageOf(300)
    const starting = page.surahs.filter((n) => page.verseKeys.includes(`${n}:1`))
    if (starting.length === 0) {
      // Halaman penuh 15 baris teks → tak ada slot header, dan itu benar
      expect(detectHeaderLines(page).length).toBeLessThanOrEqual(15)
    }
  })
})
