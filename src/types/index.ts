/**
 * Tipe data mushaf & fitur aplikasi.
 * Bentuk ringkas (`t`, `k`, `e`) mengikuti asset hasil scripts/sync-quran.mjs
 * supaya ukuran bundel data tetap kecil (§5.3).
 */

export interface MushafWord {
  /** Teks Uthmani polos (tanpa markup tajwid) */
  t: string
  /** verse_key, format "surah:ayah" */
  k: string
  /** 1 bila token ini simbol nomor akhir ayat, bukan kata */
  e?: 1
  /**
   * Nomor kata di dalam ayatnya (bukan di dalam baris). `n === 1` menandai
   * kata pertama sebuah ayat — dipakai memorize mode untuk tahu di mana
   * potongan awal ayat dimulai pada tiap baris.
   */
  n?: number
}

export interface MushafLine {
  /** Nomor baris pada halaman mushaf, 1–15 */
  line: number
  words: MushafWord[]
}

export interface MushafPage {
  /** 1–604 */
  page: number
  lines: MushafLine[]
  /** Urutan kemunculan ayat di halaman ini, mis. ["2:25", "2:26"] */
  verseKeys: string[]
  /** Nomor surah yang muncul di halaman ini */
  surahs: number[]
}

export interface MushafPagesFile {
  version: number
  totalPages: number
  linesPerPage: number
  pages: MushafPage[]
}

export interface Surah {
  number: number
  nameArabic: string
  nameLatin: string
  nameTranslation: string
  revelationPlace: string
  versesCount: number
  bismillahPre: boolean
  pageStart?: number
  pageEnd?: number
}

export interface JuzMappingEntry {
  surah: number
  from: number
  to: number
}

export interface Juz {
  number: number
  startSurah: number
  startAyah: number
  endSurah: number
  endAyah: number
  totalVerses: number
  mapping: JuzMappingEntry[]
  pageStart: number | null
  pageEnd: number
}

export interface MushafMetaFile {
  version: number
  source: string
  syncedAt: string
  surahs: Surah[]
  juz: Juz[]
}

/** Satu ayat yang sudah dikelompokkan dari baris-baris halaman */
export interface PageVerse {
  verseKey: string
  surah: number
  ayah: number
  /** Kata-kata ayat ini pada halaman tersebut (tanpa simbol akhir ayat) */
  words: string[]
  /** Simbol nomor akhir ayat bila akhir ayat berada di halaman ini */
  endSymbol?: string
}

/**
 * Satu bagian kalimat di dalam sebuah ayat memorize.
 *
 * Sebuah ayat boleh menampilkan beberapa bagian sekaligus: potongan bawaan di
 * awal ayat, ditambah kalimat-kalimat lain yang dipilih pengguna sendiri sebagai
 * pembantu hafalan. Semuanya berdiri dalam satu deret, dipisah titik-titik —
 * mis. "ذٰلِكَ … لَا … ٱلْمُتَّقِينَ".
 */
export interface MemorizeSegmentPart {
  /** Kata-kata yang tampil pada bagian ini */
  words: string[]
  /** Indeks kata awal bagian ini di dalam ayat (0 = kata pertama) */
  offset: number
  /** True bila bagian ini kalimat pilihan pengguna, bukan potongan bawaan */
  isHelper: boolean
  /** id potongan pilihan yang membentuk bagian ini; kosong untuk bagian bawaan */
  pickIds: number[]
  /** True bila bagian ini berakhir tepat pada kata terakhir ayat */
  endsVerse: boolean
  /**
   * True bila masih ada kata yang disembunyikan sesudah bagian ini — hanya
   * ketika ini benar titik-titik digambar. Bagian yang menutup ayat langsung
   * bersambung ke nomor ayatnya tanpa titik-titik.
   */
  ellipsisAfter: boolean
}

/**
 * Satu ayat pada satu baris memorize. Bila sebuah baris mushaf memuat awal dua
 * atau tiga ayat, baris memorize-nya memuat sebanyak itu pula.
 */
export interface MemorizeSegment {
  verseKey: string
  surah: number
  ayah: number
  /**
   * Bagian-bagian kalimat yang tampil untuk ayat ini pada baris ini, urut dari
   * kata paling awal. Satu bagian untuk tampilan bawaan; lebih dari satu bila
   * pengguna menambahkan kalimat pembantu.
   */
  parts: MemorizeSegmentPart[]
  /** Semua kata yang tampil, digabung — tanpa penanda titik-titik */
  opening: string[]
  /** Teks penuh ayat pada halaman ini — dipakai saat Reveal */
  full: string[]
  /** True bila ayat ini dimulai tepat pada baris ini */
  startsHere: boolean
  /** True bila ada sedikitnya satu bagian yang dipilih sendiri oleh pengguna */
  isHelper: boolean
  /** Indeks kata awal bagian pertama di dalam ayat */
  offset: number
  /**
   * True bila bagian terakhir berakhir tepat pada kata terakhir ayat — jadi yang
   * menyusul hanyalah nomor ayat, tanpa titik-titik.
   */
  endsVerse: boolean
}

/** Satu baris memorize, sejajar dengan baris mushaf yang sama */
export interface MemorizeLine {
  /** Nomor baris pada halaman mushaf, 1–15 */
  line: number
  segments: MemorizeSegment[]
  /** Baris hiasan nama surah pada mushaf cetak */
  header?: { surahNumber: number; nameArabic: string; withBismillah: boolean }
  /** Baris khusus basmalah, tepat di bawah bingkai nama surah */
  bismillah?: boolean
}

/**
 * Isi sebuah baris hiasan di halaman mushaf: bingkai nama surah, atau baris
 * khusus basmalah di bawahnya. Dipakai reader dan memorize bersama-sama.
 */
export type HeaderRow =
  | {
      kind: 'header'
      surahNumber: number
      nameArabic: string
      /** True hanya bila basmalah menumpang di baris yang sama (slot tunggal) */
      withBismillah: boolean
    }
  | { kind: 'bismillah'; surahNumber: number }

export type ThemeMode = 'light' | 'dark' | 'forest' | 'cream' | 'white'

/**
 * Bentuk penanda manual di memorize mode (§3.2): dua bentuk garis (bulat,
 * kotak) dan satu stabilo warna.
 */
export type MarkShape = 'circle' | 'box' | 'highlight'

export interface Mark {
  id?: number
  page: number
  verseKey: string
  /**
   * Baris mushaf (1–15) tempat kalimat ini berada. Bersama `verseKey` dan
   * `wordIndex`, ketiganya menunjuk tepat SATU KATA yang ditandai.
   */
  line: number
  /**
   * Indeks kata di dalam ayat (0 = kata pertama ayat) yang ditandai. Mark
   * sekarang menempel per-kata (bukan per-ayat lagi): dua kata bersebelahan
   * dalam urutan baca yang ditandai dengan bentuk SAMA otomatis tampil
   * menyambung sebagai satu bentuk memanjang (lihat MarkOverlay.vue);
   * bentuk berbeda tetap tergambar sebagai tanda masing-masing.
   */
  wordIndex: number
  shape: MarkShape
  createdAt: string
}

/**
 * Potongan pilihan pengguna untuk sebuah ayat di memorize mode.
 *
 * Dua kegunaan, keduanya tersimpan lokal:
 *  - mengubah kalimat yang tampil untuk ayat yang memang sudah tampil
 *    (default awal ayat, bisa digeser ke kalimat mana pun di tengah ayat);
 *  - menambah potongan kalimat yang dipilih dari tampilan mushaf penuh.
 */
export interface HelperVerse {
  id?: number
  page: number
  verseKey: string
  /** Berapa kata yang ditampilkan; null = ikut setelan global */
  wordsShown: number | null
  /**
   * Kata ke berapa potongan ini dimulai (0 = awal ayat). Dipakai saat pengguna
   * memilih kalimat di tengah ayat, bukan pembukanya.
   */
  wordOffset: number
  createdAt: string
}

export type RepeatUnit = 'hour' | 'day' | 'week' | 'month'

/**
 * Hari dalam seminggu, 0 = Ahad … 6 = Sabtu — mengikuti `Date.getDay()`
 * sehingga tidak perlu konversi saat menjadwalkan notifikasi.
 */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

/** Label pendek hari: S S R K J S M (Senin … Minggu), diurut mulai Senin */
export const WEEKDAY_CHIPS: { day: Weekday; short: string; name: string }[] = [
  { day: 1, short: 'S', name: 'Senin' },
  { day: 2, short: 'S', name: 'Selasa' },
  { day: 3, short: 'R', name: 'Rabu' },
  { day: 4, short: 'K', name: 'Kamis' },
  { day: 5, short: 'J', name: "Jum'at" },
  { day: 6, short: 'S', name: 'Sabtu' },
  { day: 0, short: 'M', name: 'Minggu' },
]

export interface Reminder {
  id?: number
  /** Judul bebas yang diketik pengguna (§3.3) */
  title: string
  surah: number
  ayahFrom: number
  ayahTo: number
  /** ISO string waktu tayang pertama */
  scheduledAt: string
  repeatEvery: number | null
  repeatUnit: RepeatUnit | null
  /**
   * Hari-hari terpilih untuk pengulangan mingguan. Bila terisi, tanggal pada
   * `scheduledAt` tidak lagi menentukan kapan reminder tayang — hanya jamnya
   * yang dipakai, dan reminder berulang pada hari-hari ini. Karena itu memilih
   * hari otomatis mengosongkan `repeatEvery`/`repeatUnit`, dan sebaliknya.
   */
  weekdays: Weekday[]
  enabled: boolean
  notificationId?: number
  createdAt: string
}

export interface MemorizeSettings {
  /** Jumlah kata awal tiap ayat yang ditampilkan */
  wordsShown: number
  /** Berapa ayat ditampilkan sekaligus di sisi kanan */
  versesPerView: number
}

export interface LastRead {
  page: number
  verseKey: string | null
  updatedAt: string
}

/** Batas mark per halaman (§3.2) */
/**
 * Batas ini dulu dihitung per AYAT (satu tanda = satu kalimat/ayat penuh).
 * Sejak Mark menempel per-KATA, satuannya berubah jadi kata — dengan rata-rata
 * ±30 kata per baris x 15 baris pada halaman padat, 20 tanda kata terlalu
 * sedikit untuk kegunaan nyata (menandai kata-kata sulit tersebar satu
 * halaman), maka dinaikkan.
 */
export const MAX_MARKS_PER_PAGE = 80
export const TOTAL_PAGES = 604