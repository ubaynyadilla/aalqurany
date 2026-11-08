<script setup lang="ts">
/**
 * Memorize Mode (§3.2) — satu halaman memorize = satu halaman mushaf.
 *
 * Layout mengikuti baris mushaf: baris ke-N di sini sejajar dengan baris ke-N
 * pada halaman mushaf. Bila satu baris mushaf memuat awal dua atau tiga ayat,
 * baris memorize-nya menampilkan dua/tiga potongan awal ayat pada urutan yang
 * sama (kanan ke kiri).
 *
 * Sisi kiri: pills Mark (tray bentuk keluar ke kanan tepat di sebelah ikonnya
 * agar tidak menutupi ayat), ikon Reveal (curled corner paper), dan tombol
 * ayat bantuan.
 *
 * Mark (§ redesain): 3 bentuk saja — bulat, kotak, stabilo oranye. Tanda
 * selalu menempel PENUH pada satu kalimat (satu ayat pada satu baris),
 * ditandai dengan ketukan, bukan digeser/diubah ukuran bebas seperti
 * sebelumnya. Menekan ikon Mark lalu memilih bentuk mengaktifkan "mode mark":
 * selama mode ini aktif, ketukan pada kalimat mana pun menandainya (atau
 * melepas tandanya bila sudah bertanda dengan bentuk sama), berkali-kali,
 * tanpa perlu mengaktifkan ulang. Kalimat-kalimat bersebelahan yang bertanda
 * dengan bentuk sama otomatis tampil menyambung jadi satu bentuk memanjang
 * (lihat MarkOverlay.vue) — penyambungan ini hanya dicek di dalam satu baris
 * yang sama.
 *
 * Tanpa progress tracking apa pun (§3.2).
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import SheetModal from '@/components/SheetModal.vue'
import SurahHeaderFrame from '@/components/SurahHeaderFrame.vue'
import MarkOverlay from '@/components/MarkOverlay.vue'
import MushafPageView from '@/components/MushafPageView.vue'
import HelperVersePanel from '@/components/HelperVersePanel.vue'
import GoToVerseSheet from '@/components/GoToVerseSheet.vue'
import GoToJuzSheet from '@/components/GoToJuzSheet.vue'
import QuickPills from '@/components/QuickPills.vue'
import {
  iconBack,
  iconMark,
  iconMemorize,
  iconReveal,
  iconSettings,
  iconShapeBox,
  iconShapeCircle,
  iconShapeHighlight,
} from '@/components/icons'
import { usePageLabels } from '@/composables/usePageLabels'
import { readerFontSize } from '@/services/fitSize'
import { getPageNotes, savePageNotes } from '@/services/storage'
import { useQuranStore } from '@/stores/quranStore'
import { toArabicNumber } from '@/utils/arabicNumerals'
import { MAX_MARKS_PER_PAGE, TOTAL_PAGES, type Mark, type MarkShape, type MemorizeLine } from '@/types'

const router = useRouter()
const quran = useQuranStore()

const trayOpen = ref(false)
const revealing = ref(false)
const settingsOpen = ref(false)
const verseSheetOpen = ref(false)
const juzSheetOpen = ref(false)

// Label pills atas: sama persis dengan reader
const { headerSurah, surahLabelArabic, surahLabelLatin, juzLabelArabic, juzSheetArabic } = usePageLabels()
const helperPanelOpen = ref(false)

const notice = ref<string | null>(null)
let noticeTimer: number | undefined

const shapes: { shape: MarkShape; icon: string; label: string }[] = [
  { shape: 'circle', icon: iconShapeCircle, label: 'Bulat' },
  { shape: 'box', icon: iconShapeBox, label: 'Kotak' },
  { shape: 'highlight', icon: iconShapeHighlight, label: 'Stabilo' },
]

const marksLeft = computed(() => MAX_MARKS_PER_PAGE - quran.marksOnPage.length)

/**
 * Ayat yang menempati tiap baris mushaf — termasuk ayat yang hanya menyambung
 * dari baris sebelumnya. Dipakai supaya potongan ayat bantuan tetap bisa
 * diseret ke baris mana pun, termasuk baris hiasan dan baris kosong di bawah
 * halaman yang tidak penuh (§ fitur ayat bantuan, tidak terkait Mark).
 */
const versesByLine = computed<Map<number, string[]>>(() => {
  const map = new Map<number, string[]>()
  for (const line of quran.page?.lines ?? []) {
    const keys: string[] = []
    for (const w of line.words) {
      if (!keys.includes(w.k)) keys.push(w.k)
    }
    map.set(line.line, keys)
  }
  return map
})

/**
 * Berapa banyak baris KOSONG (tanpa segmen, bukan header/bismillah) yang
 * tersedia tepat di bawah baris ke-`lineNo`, sebelum bertemu baris yang sudah
 * berisi (ayat lain / header / bismillah) atau ujung halaman. Ini batas atas
 * berapa baris boleh direbut oleh kalimat yang kepanjangan di baris ini —
 * begitu ada baris berisi di bawahnya, perebutan berhenti di situ (§ bug
 * kalimat menabrak menu/baris lain).
 */
function emptyRoomBelow(lineNo: number): number {
  let room = 0
  for (let l = lineNo + 1; l <= 15; l++) {
    const line = quran.memorizeLines.find((x) => x.line === l)
    if (!line || line.header || line.bismillah || line.segments.length > 0) break
    room++
  }
  return room
}

/**
 * Berapa baris grid yang dipakai tiap baris verse-line setelah pengukuran
 * nyata (lihat `measureOverflow` di bawah). 1 = ukuran normal; >1 berarti
 * kalimatnya kepanjangan dan merebut sejumlah baris kosong di bawahnya.
 * Baris yang direbut (ikut di dalam span baris lain) ditandai di
 * `absorbedLines` supaya tidak dirender dobel sebagai kotak kosongnya sendiri.
 */
/**
 * Lembar disembunyikan sejak halaman baru dipasang sampai pengukuran span
 * selesai. Tanpa ini, baris halaman baru sempat tampil dengan span/potongan
 * milik halaman sebelumnya lalu melompat — kedipan yang sama seperti di
 * reader. `visibility` dipakai (bukan display) supaya tata letak tetap bisa
 * diukur.
 */
const sheetReady = ref(false)

/**
 * Ukuran huruf lembar ini = ukuran huruf reader untuk halaman yang sama (tabel
 * ukuran yang sama, atau ukuran terverifikasi bila reader sudah memeriksanya),
 * bukan lagi angka vw sendiri. Lebar layar dibaca ulang saat layar berputar
 * atau berubah ukuran.
 */
const viewportWidth = ref(typeof document === 'undefined' ? 0 : document.documentElement.clientWidth)

function onViewportResize(): void {
  viewportWidth.value = document.documentElement.clientWidth
  void nextTick(() => fitNoteFont())
}

const sheetFont = computed<number | null>(() => {
  void viewportWidth.value
  return readerFontSize(quran.currentPage)
})

const sheetStyle = computed(() =>
  sheetFont.value == null ? undefined : { '--mushaf-text': `${sheetFont.value}px` },
)

const lineSpan = ref<Map<number, number>>(new Map())
const absorbedLines = ref<Set<number>>(new Set())
/**
 * Baris yang isinya MASIH terpotong walau sudah merebut semua ruang kosong
 * yang ada di bawahnya sampai mentok baris 15 — di sinilah baru fade/potong
 * diterapkan (lihat CSS `.verse-line.clipped`). Kalau ruang yang direbut
 * sudah cukup menampung semua isi, baris ini TIDAK masuk sini sama sekali.
 */
const clippedLines = ref<Set<number>>(new Set())

let sheetEl: HTMLElement | null = null
let resizeObserver: ResizeObserver | null = null
let measureScheduled = false

function scheduleMeasure(): void {
  if (measureScheduled) return
  measureScheduled = true
  requestAnimationFrame(() => {
    measureScheduled = false
    measureOverflow()
  })
}

/**
 * Ukur tinggi natural tiap `.verse-line` dibanding tinggi satu baris grid.
 * Bila kalimatnya melebihi satu baris (Arabic-nya panjang), baris itu diberi
 * `grid-row: span N` sebanyak baris kosong yang tersedia di bawahnya (dibatasi
 * `emptyRoomBelow`) — sehingga ia mengisi baris-baris kosong itu, bukan
 * menabrak rail atau baris ayat lain. Baris yang diserap ditandai supaya
 * tidak dirender lagi sebagai kotak baris tersendiri. Kalau bahkan sesudah
 * merebut SEMUA ruang kosong yang ada (sampai mentok baris 15 atau baris
 * berisi berikutnya) isinya masih belum cukup tempat, baris itu ditandai
 * `clipped` supaya sisanya memudar/dipotong di CSS — inilah SATU-SATUNYA
 * kondisi konten dipotong; selama ruang kosong masih ada, semua isi
 * (termasuk kalimat bantuan yang ditambahkan) tetap ditampilkan penuh.
 */
function measureOverflow(): void {
  try {
    runMeasure()
  } finally {
    // Apa pun hasilnya, lembar boleh ditampilkan: pengukuran sudah selesai.
    sheetReady.value = true
  }
}

function runMeasure(): void {
  if (!sheetEl) return
  const rows = sheetEl.querySelectorAll<HTMLElement>('.line.verse-line')
  if (!rows.length) return

  const rowHeight = sheetEl.clientHeight > 0 ? sheetEl.clientHeight / 15 : 0
  if (!rowHeight) return

  const nextSpan = new Map<number, number>()
  const nextAbsorbed = new Set<number>()
  const nextClipped = new Set<number>()

  for (const row of rows) {
    const lineNo = Number(row.dataset.line)
    if (!lineNo || nextAbsorbed.has(lineNo)) continue

    // Ukur konten sesungguhnya (bukan tinggi kotak yang sudah dibatasi span
    // sebelumnya) lewat elemen `.line-inner` di dalamnya, yang tidak
    // dibatasi tinggi sama sekali.
    const inner = row.querySelector<HTMLElement>('.line-inner')
    const contentHeight = inner ? inner.scrollHeight : row.scrollHeight
    const neededRows = Math.max(1, Math.ceil(contentHeight / rowHeight))
    const room = emptyRoomBelow(lineNo)
    const maxSpan = 1 + room
    const span = Math.min(neededRows, maxSpan)

    if (span > 1) {
      nextSpan.set(lineNo, span)
      for (let l = lineNo + 1; l < lineNo + span; l++) nextAbsorbed.add(l)
    }
    if (neededRows > maxSpan) nextClipped.add(lineNo)
  }

  lineSpan.value = nextSpan
  absorbedLines.value = nextAbsorbed
  clippedLines.value = nextClipped
}


function verseKeyForLine(lineNo: number): string | undefined {
  const own = versesByLine.value.get(lineNo)?.[0]
  if (own) return own

  for (let l = lineNo + 1; l <= 15; l++) {
    const key = versesByLine.value.get(l)?.[0]
    if (key) return key
  }
  for (let l = lineNo - 1; l >= 1; l--) {
    const keys = versesByLine.value.get(l)
    if (keys?.length) return keys[keys.length - 1]
  }
  return undefined
}

function flash(message: string): void {
  notice.value = message
  window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => (notice.value = null), 2000)
}

async function changePage(delta: number): Promise<void> {
  const target = quran.currentPage + delta
  if (target < 1 || target > TOTAL_PAGES) return
  armedShape.value = null
  await quran.goToPage(target)
}

/* --------------------------------------------------------------- swipe halaman */
/**
 * Swipe horizontal pada lembar memorize berpindah halaman, sama seperti di
 * reader. RTL: swipe ke kanan = halaman berikutnya (meniru arah membalik
 * lembar mushaf), swipe ke kiri = halaman sebelumnya. Dinonaktifkan saat mode
 * mark aktif atau sedang menyeret potongan bantuan, supaya tidak bentrok
 * dengan gestur ketuk/seret itu.
 */
const SWIPE_MIN_X = 45
const SWIPE_MAX_Y = 80
let touchStartX = 0
let touchStartY = 0

function onSheetTouchStart(e: TouchEvent): void {
  const t = e.touches[0]
  touchStartX = t.clientX
  touchStartY = t.clientY
}

async function onSheetTouchEnd(e: TouchEvent): Promise<void> {
  if (armedShape.value) return
  const t = e.changedTouches[0]
  const dx = t.clientX - touchStartX
  const dy = t.clientY - touchStartY
  if (Math.abs(dx) > SWIPE_MIN_X && Math.abs(dy) < SWIPE_MAX_Y) {
    if (dx > 0) await changePage(1)
    else await changePage(-1)
  }
}

/* --------------------------------------------------------------------- Mark */

/** Bentuk yang sedang disiagakan — mode mark aktif selama ini terisi. */
const armedShape = ref<MarkShape | null>(null)

/** Tanda pada satu KATA tertentu (verseKey + baris + indeks kata), kalau ada. */
function markOnWord(lineNo: number, verseKey: string, wordIndex: number): Mark | undefined {
  return quran.marksOnPage.find(
    (m) => m.line === lineNo && m.verseKey === verseKey && m.wordIndex === wordIndex,
  )
}

/**
 * Daftar kata yang tampil pada satu baris, DATAR lintas semua segmen/part
 * dalam urutan baca (kanan-ke-kiri, sama seperti urutan render), masing-masing
 * dengan (verseKey, wordIndex)-nya sendiri. Dipakai untuk mengecek apakah dua
 * kata "bersebelahan dalam urutan baca" ketika mengecek penyambungan Mark —
 * termasuk dua kata dari SEGMEN BERBEDA yang duduk bersebelahan pada baris
 * yang sama (mis. akhir kalimat ayat pertama & awal kalimat ayat kedua).
 *
 * Dihitung sekali per baris lewat cache computed `flatWordsCache` di bawah —
 * bukan dihitung ulang tiap kata saat render template, supaya tidak mahal.
 */
const flatWordsCache = computed<Map<number, { verseKey: string; wordIndex: number }[]>>(() => {
  const map = new Map<number, { verseKey: string; wordIndex: number }[]>()
  for (const line of quran.memorizeLines) {
    const flat: { verseKey: string; wordIndex: number }[] = []
    for (const seg of line.segments) {
      for (const part of seg.parts) {
        for (let i = 0; i < part.words.length; i++) {
          flat.push({ verseKey: seg.verseKey, wordIndex: part.offset + i })
        }
      }
    }
    map.set(line.line, flat)
  }
  return map
})

function flatWordsOfLine(line: MemorizeLine): { verseKey: string; wordIndex: number }[] {
  return flatWordsCache.value.get(line.line) ?? []
}

/**
 * Info tampilan tanda untuk kata ke-`flatIndex` (dalam `flatWordsOfLine`) pada
 * `line`: tandanya sendiri (bila ada), plus apakah bersambung ke kata
 * sebelum/sesudahnya dalam urutan baca — dipakai MarkOverlay untuk menggambar
 * bentuk memanjang saat beberapa kata bersebelahan ditandai dengan bentuk yang
 * SAMA. Bentuk BERBEDA (mis. kotak lalu bulat) tidak digabung, tetap tergambar
 * sebagai tanda masing-masing. Penyambungan hanya dicek di DALAM baris yang
 * sama, tidak menyeberang ke baris lain.
 */
function wordMarkInfo(
  line: MemorizeLine,
  flatWords: { verseKey: string; wordIndex: number }[],
  flatIndex: number,
): { mark: Mark | undefined; mergeStart: boolean; mergeEnd: boolean } {
  const w = flatWords[flatIndex]
  const mark = markOnWord(line.line, w.verseKey, w.wordIndex)
  if (!mark) return { mark: undefined, mergeStart: false, mergeEnd: false }

  const prevW = flatIndex > 0 ? flatWords[flatIndex - 1] : undefined
  const nextW = flatIndex < flatWords.length - 1 ? flatWords[flatIndex + 1] : undefined
  const prev = prevW ? markOnWord(line.line, prevW.verseKey, prevW.wordIndex) : undefined
  const next = nextW ? markOnWord(line.line, nextW.verseKey, nextW.wordIndex) : undefined

  return { mark, mergeStart: prev?.shape === mark.shape, mergeEnd: next?.shape === mark.shape }
}

/**
 * Gabungan flatWordsOfLine + flatIndexOf + wordMarkInfo dalam satu panggilan,
 * supaya di template cukup dipanggil SEKALI per kata (bukan berkali-kali
 * seperti versi terpisahnya) untuk dapat status tanda kata itu sekaligus.
 */
function wordInfo(
  line: MemorizeLine,
  verseKey: string,
  wordIndex: number,
): { mark: Mark | undefined; mergeStart: boolean; mergeEnd: boolean } {
  const flat = flatWordsOfLine(line)
  const idx = flat.findIndex((w) => w.verseKey === verseKey && w.wordIndex === wordIndex)
  if (idx === -1) return { mark: undefined, mergeStart: false, mergeEnd: false }
  return wordMarkInfo(line, flat, idx)
}

/** Siagakan sebuah bentuk dari tray: mode mark aktif, tunggu ketukan pada kata. */
function armShape(shape: MarkShape): void {
  if (!quran.canAddMark) {
    flash(`Batas ${MAX_MARKS_PER_PAGE} tanda per halaman sudah tercapai`)
    return
  }
  armedShape.value = shape
  trayOpen.value = false
  flash('Ketuk kata yang ingin ditandai')
}

/** Tombol Mark di rail: buka/tutup tray, atau keluar dari mode bila sedang aktif. */
function toggleMarkTray(): void {
  if (armedShape.value) {
    armedShape.value = null
    return
  }
  trayOpen.value = !trayOpen.value
}

/**
 * Ketuk sebuah KATA selagi mode mark aktif: tandai dengan bentuk yang
 * disiagakan, atau — bila kata itu sudah bertanda dengan bentuk apa pun —
 * lepas tandanya. Mode TETAP aktif sesudahnya (armedShape tidak direset)
 * supaya kata lain bisa terus ditandai tanpa mengaktifkan ulang. Ketukan
 * pada kata tidak berbuat apa-apa selama mode mark tidak aktif.
 *
 * Dua kata bersebelahan yang ditandai dengan BENTUK SAMA otomatis tampil
 * menyambung jadi satu bentuk memanjang (lihat wordMarkInfo/MarkOverlay);
 * bentuk berbeda tetap berdiri sebagai tanda masing-masing kata.
 */
async function onWordTapMark(lineNo: number, verseKey: string, wordIndex: number): Promise<void> {
  const shape = armedShape.value
  if (!shape) return

  const existing = markOnWord(lineNo, verseKey, wordIndex)
  if (existing) {
    if (existing.id != null) await quran.removeMark(existing.id)
    return
  }

  const added = await quran.addMark(verseKey, lineNo, wordIndex, shape)
  if (!added) flash(`Batas ${MAX_MARKS_PER_PAGE} tanda per halaman sudah tercapai`)
}

/**
 * Baris memorize di bawah titik sentuh — TIDAK dipakai lagi untuk fitur ayat
 * bantuan (drag-drop sudah dihapus, sekarang cukup ketuk & tambah langsung
 * dari panel Bantu). Dipertahankan kosong-fungsi dihapus sepenuhnya karena
 * Mark juga sudah menempel ke elemen lewat `onWordTapMark`, tidak lagi lewat
 * koordinat bebas.
 */
async function goVerse(surah: number, ayah: number): Promise<void> {
  armedShape.value = null
  await quran.goToVerse(surah, ayah)
  verseSheetOpen.value = false
  juzSheetOpen.value = false
}

/** Lompat ke halaman tertentu dari sheet juz */
async function goPage(page: number): Promise<void> {
  armedShape.value = null
  await quran.goToPage(page)
  juzSheetOpen.value = false
}

/* ------------------------------------------------------------------ catatan */
/**
 * Kotak catatan di rail kiri (antara tombol Kata dan kembali). Tanpa tombol: ketuk kotaknya
 * untuk mengisi/mengedit, ketuk di luar kotak untuk menyimpan. Satu catatan
 * per halaman mushaf, tersimpan lokal di HP. Kotak disembunyikan selama
 * Reveal ditahan (lihat v-show di template).
 *
 * Ukuran huruf mengikuti banyaknya tulisan: sedikit → besar, banyak → kecil,
 * supaya kotak selalu terisi (lihat fitNoteFont).
 */
const NOTE_FONT_MAX = 26
const NOTE_FONT_MIN = 9

const noteBox = ref<HTMLElement | null>(null)
const noteEl = ref<HTMLTextAreaElement | null>(null)
const noteText = ref('')
const noteEditing = ref(false)

let allNotes: Record<string, string> = {}
let notePage = quran.currentPage
let noteDirty = false

/** Cari ukuran huruf terbesar yang masih memuat seluruh catatan di dalam kotak. */
function fitNoteFont(): void {
  const el = noteEl.value
  // Kotak tersembunyi (Reveal) → tidak ada ukuran yang bisa diukur
  if (!el || el.clientHeight <= 0 || el.clientWidth <= 0) return

  // Selama mengukur, kata panjang tidak boleh dipatah — kalau tidak, huruf
  // besar "lolos" karena katanya dipotong. Kata yang terlalu lebar memaksa
  // ukuran mengecil sampai muat.
  el.style.overflowWrap = 'normal'
  let lo = NOTE_FONT_MIN
  let hi = NOTE_FONT_MAX
  let best = NOTE_FONT_MIN
  for (let i = 0; i < 9; i++) {
    const mid = (lo + hi) / 2
    el.style.fontSize = `${mid}px`
    const fits = el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1
    if (fits) {
      best = mid
      lo = mid
    } else {
      hi = mid
    }
  }
  // Tampilkan 70% dari ukuran pas-muat di atas — kotak jadi punya sedikit
  // ruang kosong, tapi tulisan tidak lagi terlihat terlalu besar dibanding kotak.
  el.style.fontSize = `${best * 0.7}px`
  // Pada ukuran terkecil pun kata raksasa tetap boleh dipatah, bukan meluber
  el.style.overflowWrap = 'break-word'

  // Ruang kosong yang tersisa (karena font diperkecil ke 70%) dibagi rata ke
  // atas & bawah lewat padding, supaya blok tulisan duduk di tengah kotak
  // secara vertikal. Horizontalnya cukup text-align:center di CSS.
  el.style.paddingBlock = '0px'
  const extra = Math.max(0, el.clientHeight - el.scrollHeight)
  el.style.paddingBlock = `${extra / 2}px`
}

function loadNoteForPage(pageNo: number): void {
  notePage = pageNo
  noteText.value = allNotes[String(pageNo)] ?? ''
  noteDirty = false
  void nextTick(fitNoteFont)
}

async function commitNote(): Promise<void> {
  if (!noteDirty) return
  noteDirty = false
  const text = noteText.value.replace(/\s+$/, '')
  const next = { ...allNotes }
  if (text) next[String(notePage)] = text
  else delete next[String(notePage)]
  allNotes = next
  try {
    await savePageNotes(next)
  } catch (err) {
    console.error('[catatan] gagal menyimpan:', err)
  }
}

function onNoteInput(e: Event): void {
  noteText.value = (e.target as HTMLTextAreaElement).value
  noteDirty = true
  fitNoteFont()
}

function onNoteBlur(): void {
  noteEditing.value = false
  void commitNote()
}

/** Ketuk di bagian mana pun kotak (termasuk label) = mulai mengedit */
function onNoteBoxClick(): void {
  noteEl.value?.focus()
}

/**
 * Ketuk di LUAR kotak = selesai mengedit. Dipasang di tingkat dokumen karena
 * di layar sentuh (terutama iOS) mengetuk area non-interaktif tidak otomatis
 * melepas fokus textarea — tanpa ini catatan tidak tersimpan.
 */
function onDocPointerDown(e: PointerEvent): void {
  if (!noteEditing.value) return
  if (noteBox.value?.contains(e.target as Node)) return
  noteEl.value?.blur()
}

onMounted(async () => {
  document.addEventListener('pointerdown', onDocPointerDown, true)
  try {
    allNotes = await getPageNotes()
  } catch {
    allNotes = {}
  }
  loadNoteForPage(quran.currentPage)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointerDown, true)
  void commitNote()
})

// Pindah halaman: simpan catatan halaman lama dulu, baru muat milik halaman baru
watch(
  () => quran.currentPage,
  (p) => {
    noteEl.value?.blur()
    void commitNote()
    loadNoteForPage(p)
  },
)

// Kotak muncul lagi sesudah Reveal: ukur ulang (saat tersembunyi tak bisa diukur)
watch(revealing, async (on) => {
  if (on) return
  await nextTick()
  fitNoteFont()
})

/* ------------------------------------------------------ ukur ulang otomatis */
onMounted(() => {
  window.addEventListener('resize', onViewportResize)
  sheetEl = document.querySelector('.sheet')
  if (sheetEl) {
    resizeObserver = new ResizeObserver(() => scheduleMeasure())
    resizeObserver.observe(sheetEl)
  }
  scheduleMeasure()
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onViewportResize)
  resizeObserver?.disconnect()
})

// Halaman baru (objek `page` berganti, termasuk muat pertama) → sembunyikan
// lembar SEBELUM DOM-nya digambar (flush 'pre'), tampilkan setelah terukur.
watch(
  () => quran.page,
  () => {
    sheetReady.value = false
  },
  { flush: 'pre' },
)

// Ukuran huruf berganti (halaman lain punya ukuran sendiri, atau layar berubah):
// panjang baris berubah, jadi span-nya diukur ulang.
watch(sheetFont, async () => {
  await nextTick()
  scheduleMeasure()
})

// Ukur ulang setiap kali isi baris berubah: ganti halaman, setelan kata
// berubah, atau kalimat bantuan ditambah/dibuang.
watch(
  () => quran.memorizeLines,
  async () => {
    await nextTick()
    scheduleMeasure()
  },
  { deep: false },
)

/* --------------------------------------------- potongan bantuan dari panel */

/**
 * Tambahkan potongan pilihan pengguna dari panel Bantu.
 *
 * Menambah, bukan mengganti: kalimat yang sudah ada di memorize tetap di
 * tempatnya, dan panjang kalimat baru mengikuti pilihan pengguna sendiri —
 * setelan "kata awal ditampilkan" tidak ikut mengunciinya. Panel Bantu TETAP
 * terbuka setelahnya (tidak ada lagi cara "seret ke lembar" — cukup ketuk &
 * tambah, langsung tampil di memorize di baliknya).
 */
async function applyPick(payload: {
  verseKey: string
  wordOffset: number
  wordsShown: number
}): Promise<void> {
  await quran.addVersePick(payload.verseKey, {
    wordOffset: payload.wordOffset,
    wordsShown: payload.wordsShown,
  })
  flash('Kalimat ditambahkan ke memorize')
}

/** Buang satu kalimat pilihan saja. */
async function removePick(id: number): Promise<void> {
  await quran.removeVersePick(id)
}

/** Kembalikan sebuah ayat ke bawaan: semua kalimat pilihannya dibuang. */
async function resetPick(verseKey: string): Promise<void> {
  await quran.resetVersePick(verseKey)
}
</script>

<template>
  <main class="memorize no-select">
    <!-- ============ SISI KIRI: pills Mark, Reveal, ayat bantuan ============ -->
    <aside class="left-rail safe-top safe-bottom">
      <div class="rail-spacer" />

      <div class="rail-group">
        <div class="mark-zone">
          <button
            type="button"
            class="rail-btn"
            :class="{ on: trayOpen || armedShape }"
            :aria-expanded="trayOpen"
            aria-label="Menu tanda"
            @click="toggleMarkTray"
          >
            <span aria-hidden="true" v-html="iconMark" />
            <span class="rail-label">Mark</span>
          </button>

          <!--
            Tray bentuk keluar KE KANAN dari ikon Mark, menempel di sebelahnya,
            bukan dari tepi kanan layar — supaya tidak menutupi teks ayat.
          -->
          <Transition name="tray">
            <div v-if="trayOpen" class="tray">
              <button
                v-for="s in shapes"
                :key="s.shape"
                type="button"
                class="tray-item"
                :class="{ armed: armedShape === s.shape }"
                :aria-label="`Tanda ${s.label}`"
                @click="armShape(s.shape)"
              >
                <span aria-hidden="true" v-html="s.icon" />
                <span class="tray-label">{{ s.label }}</span>
              </button>
              <p class="tray-quota">sisa {{ marksLeft }}</p>
            </div>
          </Transition>
        </div>

        <button
          type="button"
          class="rail-btn reveal"
          :class="{ on: revealing }"
          aria-label="Tampilkan teks penuh halaman ini"
          @pointerdown="revealing = true"
          @pointerup="revealing = false"
          @pointerleave="revealing = false"
          @pointercancel="revealing = false"
        >
          <span aria-hidden="true" v-html="iconReveal" />
          <span class="rail-label">Reveal</span>
        </button>

        <!-- Poin 3: pilih ayat bantuan lewat panel mushaf penuh -->
        <button
          type="button"
          class="rail-btn"
          :class="{ on: helperPanelOpen }"
          aria-label="Pilih ayat bantuan"
          @click="helperPanelOpen = true"
        >
          <span aria-hidden="true" v-html="iconMemorize" />
          <span class="rail-label">Bantu</span>
        </button>

        <button type="button" class="rail-btn" aria-label="Setelan memorize" @click="settingsOpen = true">
          <span aria-hidden="true" v-html="iconSettings" />
          <span class="rail-label">Kata</span>
        </button>
      </div>

      <!--
        Kotak catatan: di tengah ruang kosong antara tombol Kata dan tombol
        kembali. Tanpa tombol — ketuk untuk menulis/mengedit, ketuk di luar
        kotak untuk menyimpan. Hilang selama Reveal ditahan.
      -->
      <div class="rail-spacer note-slot">
        <div
          v-show="!revealing"
          ref="noteBox"
          class="memo-note"
          :class="{ editing: noteEditing }"
          dir="ltr"
          @click="onNoteBoxClick"
        >
          <span class="memo-label">catatan :</span>
          <textarea
            ref="noteEl"
            class="memo-text"
            :value="noteText"
            maxlength="600"
            spellcheck="false"
            aria-label="Catatan halaman ini"
            @focus="noteEditing = true"
            @input="onNoteInput"
            @blur="onNoteBlur"
          />
        </div>
      </div>

      <button type="button" class="rail-btn back" aria-label="Kembali" @click="router.back()">
        <span aria-hidden="true" v-html="iconBack" />
      </button>
    </aside>

    <!-- ====== SISI KANAN: halaman memorize, sejajar baris demi baris ====== -->
    <section class="right-panel safe-top">
      <!--
        Pills surah (kanan-kiri) seperti di reader: surah di satu sisi = pintu
        lompat ayat, juz di sisi lain (dengan lembar ke berapa di juznya) =
        pintu lompat juz/halaman. Pindah halaman: geser lembar, atau lompat lewat pills.
      -->
      <QuickPills
        class="mem-pills"
        :surah-label="surahLabelArabic"
        :juz-label="juzLabelArabic"
        :sheet-label="juzSheetArabic"
        :surah-aria="`Surah ${surahLabelLatin}. Ketuk untuk lompat ke ayat`"
        :juz-aria="`Juz ${quran.currentJuz ?? ''}, halaman ke-${quran.currentJuzSheet ?? ''} di juz ini. Ketuk untuk lompat ke juz`"
        @surah="verseSheetOpen = true"
        @juz="juzSheetOpen = true"
      />

      <!--
        Reveal: menampilkan halaman mushaf yang asli, sama seperti di reader —
        bukan versi per-baris memorize yang teksnya dipanjangkan. Jadi saat ragu,
        yang terlihat adalah halaman yang memang dihafal bentuknya.
      -->
      <div v-if="revealing" class="reveal-page" dir="rtl">
        <MushafPageView
          v-if="quran.page"
          :page="quran.page"
          :lines-per-page="15"
          :surahs="quran.surahs"
        />
      </div>

      <!-- Satu halaman memorize = satu halaman mushaf, 15 baris -->
      <div
        v-show="!revealing"
        class="sheet"
        :class="{ arming: armedShape, pending: !sheetReady }"
        :style="sheetStyle"
        dir="rtl"
        @touchstart.passive="onSheetTouchStart"
        @touchend.passive="onSheetTouchEnd"
      >
        <template v-for="line in quran.memorizeLines" :key="line.line">
          <!-- Baris hiasan nama surah — tidak menerima tanda, hanya jangkar
               untuk fitur ayat bantuan (data-line/data-verse-key) -->
          <div
            v-if="line.header"
            class="line header-line"
            :style="{ gridRow: String(line.line) }"
            :data-line="line.line"
            :data-verse-key="verseKeyForLine(line.line)"
          >
            <SurahHeaderFrame :name-arabic="line.header.nameArabic" compact />
          </div>

          <!-- Baris basmalah, sejajar dengan mushaf -->
          <div
            v-else-if="line.bismillah"
            class="line bismillah-line"
            :style="{ gridRow: String(line.line) }"
            :data-line="line.line"
            :data-verse-key="verseKeyForLine(line.line)"
          >
            <span class="bismillah">بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ</span>
          </div>

          <!--
            Baris kosong (bagian tengah ayat panjang, tanpa segmen sendiri):
            dirender sebagai kotak kosong SEKALI SAJA — kecuali sedang diserap
            (grid-row-span) oleh baris berisi di atasnya, dalam hal ini tidak
            usah dirender sama sekali supaya tidak menggandakan tinggi baris.
          -->
          <div
            v-else-if="line.segments.length === 0"
            v-show="!absorbedLines.has(line.line)"
            class="line"
            :style="{ gridRow: String(line.line) }"
            :data-line="line.line"
            :data-verse-key="verseKeyForLine(line.line)"
          />

          <div
            v-else
            class="line verse-line"
            :class="{
              spanning: (lineSpan.get(line.line) ?? 1) > 1,
              clipped: clippedLines.has(line.line),
            }"
            :style="{ gridRow: `${line.line} / span ${lineSpan.get(line.line) ?? 1}` }"
            :data-line="line.line"
            :data-verse-key="verseKeyForLine(line.line)"
          >
            <!--
              `.line-inner` adalah elemen yang benar-benar diukur tingginya
              (lihat measureOverflow) — dipisah dari `.line` supaya wrapping
              flex-wrap tidak terganggu oleh tinggi kotak grid yang sudah
              ditetapkan lebih dulu.

              Mark sekarang menempel PER-KATA (bukan per-ayat): tiap kata
              adalah target ketukannya sendiri. Dua kata bersebelahan dalam
              urutan baca yang ditandai bentuk SAMA tampil menyambung jadi
              satu bentuk memanjang (mergeStart/mergeEnd dari wordMarkInfo,
              dihitung lewat flatWordsOfLine agar juga menyambung lintas
              segmen/ayat dalam baris yang sama); bentuk berbeda tetap
              berdiri sebagai tanda masing-masing kata.
            -->
            <div class="line-inner">
              <template v-for="seg in line.segments" :key="seg.verseKey">
                <!--
                  Dibungkus per-part (bukan v-for langsung di <span class="seg-part">)
                  supaya titik-titik bisa disisipkan SETELAH tiap bagian, termasuk di
                  CELAH ANTARA dua bagian (mis. potongan bawaan lalu kalimat Bantu yang
                  tidak menempel langsung) — bukan cuma sesudah bagian terakhir.
                  Dulu titik-titik hanya dicek pada bagian terakhir saja, jadi celah di
                  tengah (sebelum kalimat Bantu yang ditambahkan) tidak bertitik-titik
                  dan kalimat itu terlihat seperti nempel langsung/samar.
                -->
                <template v-for="(part, j) in seg.parts" :key="`${seg.verseKey}:${part.offset}:${j}`">
                  <span class="seg-part" :class="{ helper: part.isHelper }">
                    <span
                      v-for="(word, k) in part.words"
                      :key="`${seg.verseKey}:${part.offset + k}`"
                      class="word"
                      :class="{ marked: wordInfo(line, seg.verseKey, part.offset + k).mark }"
                      @click="onWordTapMark(line.line, seg.verseKey, part.offset + k)"
                    >
                      <MarkOverlay
                        v-if="wordInfo(line, seg.verseKey, part.offset + k).mark"
                        :shape="wordInfo(line, seg.verseKey, part.offset + k).mark!.shape"
                        :merge-start="wordInfo(line, seg.verseKey, part.offset + k).mergeStart"
                        :merge-end="wordInfo(line, seg.verseKey, part.offset + k).mergeEnd"
                      />
                      {{ word }}
                    </span>
                  </span>
                  <span v-if="part.ellipsisAfter" class="seg-ellipsis" aria-hidden="true">…</span>
                </template>
                <span class="seg-num" aria-hidden="true">{{ toArabicNumber(seg.ayah) }}</span>
              </template>
            </div>
          </div>
        </template>

        <p v-if="!quran.memorizeLines.length" class="empty" dir="ltr">Memuat halaman...</p>
      </div>
    </section>

    <!-- Bulatan nomor halaman, bentuk & warna sama seperti di reader -->
    <div
      class="page-circle-static"
      role="status"
      :aria-label="`Halaman ${quran.currentPage} dari ${TOTAL_PAGES}`"
    >
      <span class="num" aria-hidden="true">{{ toArabicNumber(quran.currentPage) }}</span>
    </div>

    <!-- Mode mark aktif: sebutkan apa yang harus dilakukan, dengan tombol Selesai -->
    <Transition name="fade">
      <div v-if="armedShape" class="arming-bar safe-bottom" role="status">
        <span>Ketuk kalimat yang ingin ditandai</span>
        <button type="button" class="arming-cancel" @click="armedShape = null">Selesai</button>
      </div>
    </Transition>

    <Transition name="fade">
      <p v-if="notice && !armedShape" class="notice safe-bottom" role="status">{{ notice }}</p>
    </Transition>

    <SheetModal v-if="settingsOpen" title="Setelan memorize" @close="settingsOpen = false">
      <label class="setting">
        <span class="setting-head">
          Kata awal ditampilkan
          <strong>{{ quran.memorize.wordsShown === 0 ? 'Hanya nomor ayat' : quran.memorize.wordsShown }}</strong>
        </span>
        <input
          type="range"
          min="0"
          max="8"
          :value="quran.memorize.wordsShown"
          @input="quran.updateMemorize({ wordsShown: Number(($event.target as HTMLInputElement).value) })"
        />
        <span class="setting-hint">
          0 = hanya nomor ayat, tanpa kalimat. Kalimat yang Anda tambahkan lewat Bantu tetap tampil.
        </span>
      </label>

      <p class="setting-note">
        Susunan baris mengikuti halaman mushaf, jadi jumlah ayat per baris menyesuaikan mushaf
        dan tidak diatur di sini. Aplikasi juga tidak melacak progres hafalan — tanda hanya
        penanda visual buatan Anda sendiri.
      </p>
    </SheetModal>

    <HelperVersePanel
      v-if="helperPanelOpen"
      :page="quran.currentPage"
      :verses="quran.verses"
      :memorize-lines="quran.memorizeLines"
      :picks="quran.helpersOnPage"
      :default-words-shown="quran.memorize.wordsShown"
      @close="helperPanelOpen = false"
      @pick="applyPick"
      @remove-pick="removePick"
      @reset="resetPick"
    />

    <GoToVerseSheet
      v-if="verseSheetOpen"
      :surahs="quran.surahs"
      :initial-surah="headerSurah?.number"
      @close="verseSheetOpen = false"
      @go="goVerse"
    />
    <GoToJuzSheet
      v-if="juzSheetOpen"
      :juz-list="quran.juzList"
      :surahs="quran.surahs"
      :current-juz="quran.currentJuz"
      :current-page="quran.currentPage"
      @close="juzSheetOpen = false"
      @go-verse="goVerse"
      @go-page="goPage"
    />
  </main>
</template>

<style scoped>
.memorize {
  position: fixed;
  inset: 0;
  display: flex;
  overflow: hidden;
  background: var(--color-paper);
  color: var(--color-ink);
}

/* ------------------------------------------------------------------ sisi kiri */
.left-rail {
  flex: 0 0 4.1rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.45rem;
  padding: 0.7rem 0.35rem;
  border-right: 1px solid var(--color-paper-edge);
  background: color-mix(in srgb, var(--color-ink) 3%, transparent);
}

.rail-btn {
  width: 3.2rem;
  min-height: 3.1rem;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.1rem;
  padding: 0.35rem 0.2rem;
  border: 1px solid var(--color-paper-edge);
  border-radius: 0.8rem;
  background: var(--color-paper);
  color: var(--color-ink);
}

.rail-btn :deep(svg) {
  width: 1.2rem;
  height: 1.2rem;
}

.rail-label {
  font-size: 0.58rem;
}

.rail-btn.on {
  border-color: var(--color-accent);
  background: color-mix(in srgb, var(--color-accent) 18%, transparent);
}

.rail-btn.back {
  min-height: 2.4rem;
  margin-bottom: 0.9rem;
}

/*
 * Bulatan nomor halaman: sama persis dengan .page-circle di reader
 * (bentuk bulat, warna background reader), hanya saja di sini bersifat
 * penunjuk statis (bukan tombol), sesuai perilaku sebelumnya.
 */
.page-circle-static {
  position: absolute;
  z-index: 25;
  left: 50%;
  bottom: calc(0.6rem + var(--safe-bottom));
  transform: translateX(-50%);
  width: 3.2rem;
  height: 3.2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--color-paper-edge);
  border-radius: 50%;
  background: var(--color-paper);
  color: var(--color-ink);
  box-shadow: 0 6px 16px rgb(0 0 0 / 0.32);
}

.page-circle-static .num {
  font-family: var(--font-mushaf);
  font-size: 1.15rem;
  line-height: 1;
}

/*
 * Kotak catatan: duduk di tengah ruang kosong rail kiri (antara tombol Kata dan
 * tombol kembali), dan sengaja lebih lebar dari rail — melebar ke kanan ke atas
 * area lembar yang kosong. `.note-slot` diberi z-index supaya tergambar di atas
 * lembar memorize yang berada sesudahnya.
 */
.note-slot {
  position: relative;
  z-index: 24;
  align-self: stretch;
}

.memo-note {
  position: absolute;
  left: 0.15rem;
  top: 50%;
  transform: translateY(-50%);
  width: 42vw;
  aspect-ratio: 254 / 180;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  /* Jarak tulisan ke garis tepi kotak */
  padding: 0.45rem 0.65rem 0.55rem;
  border: 1px solid var(--color-paper-edge);
  border-radius: 1rem;
  background: var(--color-paper);
  color: var(--color-ink);
  font-family: Georgia, 'Noto Serif', 'Times New Roman', serif;
  font-style: italic;
  overflow: hidden;
  touch-action: manipulation;
}

.memo-note.editing {
  border-color: var(--color-accent);
}

.memo-label {
  flex: 0 0 auto;
  align-self: flex-start;
  font-size: 0.58rem;
  line-height: 1.1;
  opacity: 0.65;
  pointer-events: none;
}

.memo-text {
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  outline: none;
  resize: none;
  background: transparent;
  color: inherit;
  caret-color: var(--color-accent);
  font: inherit;
  font-size: 1.6rem; /* nilai awal; diatur ulang oleh fitNoteFont */
  line-height: 1.2;
  text-align: center;
  overflow-x: hidden;
  overflow-y: auto;
  overflow-wrap: break-word;
  scrollbar-width: none;
  /* .no-select di induk mematikan seleksi; textarea tetap harus bisa diketik */
  user-select: text;
  -webkit-user-select: text;
  -webkit-touch-callout: default;
}

.memo-text::-webkit-scrollbar {
  display: none;
}

.rail-group {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.45rem;
}

.rail-spacer {
  flex: 1;
}

/* Tray keluar ke kanan, menempel di sebelah ikon Mark */
.mark-zone {
  position: relative;
  display: flex;
}

.tray {
  position: absolute;
  top: 0;
  left: calc(100% + 0.4rem);
  z-index: 45;
  display: flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.4rem 0.45rem;
  border: 1px solid var(--color-paper-edge);
  border-radius: 0.85rem;
  background: var(--color-paper);
  box-shadow: 6px 0 20px rgb(0 0 0 / 0.16);
}

.tray-item {
  width: 2.7rem;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 0.1rem;
  padding: 0.35rem 0.15rem;
  border: 1px solid var(--color-paper-edge);
  border-radius: 0.6rem;
  background: rgb(255 255 255 / 0.75);
  color: inherit;
  touch-action: manipulation;
}

.tray-item :deep(svg) {
  width: 1.1rem;
  height: 1.1rem;
}

/* Bentuk yang sedang disiagakan: terlihat jelas mana yang menunggu ditaruh */
.tray-item.armed {
  border-color: var(--color-accent);
  background: color-mix(in srgb, var(--color-accent) 20%, transparent);
}

.tray-label {
  font-size: 0.55rem;
}

.tray-quota {
  margin: 0;
  padding-inline: 0.15rem;
  font-size: 0.56rem;
  opacity: 0.6;
  writing-mode: vertical-rl;
}

.tray-enter-active,
.tray-leave-active {
  transition: transform 0.18s ease, opacity 0.18s ease;
  transform-origin: left center;
}

.tray-enter-from,
.tray-leave-to {
  transform: scaleX(0.7) translateX(-12%);
  opacity: 0;
}

/* ----------------------------------------------------------------- sisi kanan */
.right-panel {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

/* Pills surah/juz di atas lembar: menempel ke atas seperti di reader (top: 0.5rem) */
.mem-pills {
  flex: 0 0 auto;
  padding: 0.5rem 0.5rem 0.25rem;
}

/*
 * Halaman mushaf asli saat Reveal ditahan. Mengisi ruang yang sama dengan
 * lembar memorize supaya tidak ada pergeseran letak saat berganti tampilan.
 */
.reveal-page {
  flex: 1;
  min-height: 0;
  display: flex;
  padding: 0.5rem 0.9rem 2.4rem;
}

/* Lembar memorize: grid 15 baris tetap, sejajar baris demi baris dengan
   halaman mushaf. Grid (bukan flex) dipilih supaya baris yang kepanjangan
   bisa diberi grid-row-span dan merebut baris-baris kosong tepat di
   bawahnya, tanpa mendorong baris-baris sesudahnya yang sudah berisi. */
.sheet {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-rows: repeat(15, 1fr);
  gap: 0.12rem;
  /* Ruang bawah disisakan untuk notch nomor halaman */
  padding: 0.5rem 1.1rem 2.4rem;
  /* Baris tidak boleh pernah menabrak/menutupi rail kiri (Mark/Reveal/Bantu) —
     apa pun yang melebihi lebar panel disembunyikan, bukan meluber. */
  overflow: hidden;
  /*
   * `--mushaf-text` dihitung dari lebar VIEWPORT (vw), bukan lebar wadahnya.
   * Reader memakai lebar viewport penuh, tapi lembar memorize ini dipersempit
   * oleh rail kiri (~4.1rem) di sampingnya — dengan angka font yang sama,
   * teks di sini jadi terlihat lebih besar/penuh karena ruangnya lebih
   * sempit. Diperkecil sedikit di sini saja supaya ukuran terasa SAMA
   * dengan reader secara visual, tanpa mengubah variabel global aslinya.
   */
  --mushaf-text: clamp(0.86rem, 4vw, 1.42rem);
}

/*
 * Ukuran di atas hanya cadangan. Yang dipakai adalah ukuran huruf reader untuk
 * halaman ini, dipasang lewat style inline (`sheetStyle`) — supaya huruf di
 * memorize dan reader SAMA besar.
 */

.line {
  position: relative;
  min-height: 0;
  max-width: 100%;
  display: flex;
  align-items: center;
  /*
   * Rata KANAN (awal bacaan RTL) secara default. PENTING: dalam flexbox,
   * "flex-end" itu istilah LOGIS mengikuti reading direction, bukan sisi
   * visual — untuk `direction: rtl` (diwariskan dari dir="rtl" di .sheet),
   * flex-start-lah yang berarti kanan secara visual, dan flex-end berarti
   * KIRI. Memakai flex-end di sini (seperti sebelumnya) membuat konten malah
   * menempel kiri — persis bug yang dilaporkan. flex-start yang benar.
   */
  justify-content: flex-start;
  gap: 0.55rem;
  border-radius: 0.4rem;
  overflow: hidden;
  /* Stacking context per BARIS: semua MarkOverlay (z-index negatif) pada baris ini
     tergambar di bawah semua teks baris ini, dan di atas latar baris sendiri. */
  isolation: isolate;
  transition: background-color 0.15s ease;
}

/* Menunggu pengukuran span baris: tata letak jalan, belum digambar */
.sheet.pending {
  visibility: hidden;
}

/* Baris yang membungkus ke beberapa baris grid: isi dimulai dari ATAS kotak
   span-nya (bukan di-center secara vertikal di tengah seluruh kotak span),
   supaya baris pertama tetap sejajar posisi normal dan sisanya mengalir ke
   bawah secara alami. */
/*
 * Ruang napas di kiri-kanan baris ayat. Tanda (bulat/kotak/stabilo) sengaja
 * melebar sedikit melewati tepi kata, dan `.line` memotong apa pun di luarnya.
 * Kata pertama sebuah baris menempel di tepi kanan, jadi sisi kanan tandanya
 * dulu ikut terpotong dan bentuknya tidak pernah menutup. Dengan padding ini
 * tanda punya tempat untuk tergambar penuh.
 */
.verse-line {
  padding-inline: calc(var(--mushaf-text) * 0.34);
}

.line.spanning {
  align-items: flex-start;
}

/*
 * Baris yang merebut lebih dari satu baris grid (kalimat kepanjangan) perlu
 * membungkus ke bawah, bukan dipotong horizontal seperti baris normal — teks
 * Arab-nya sendiri tetap satu deret per segmen, tapi deretnya boleh pindah
 * baris. `.line-inner` yang diukur tingginya (lihat measureOverflow) dibuat
 * bebas tinggi (tanpa batas) supaya scrollHeight-nya mencerminkan kebutuhan
 * ruang sesungguhnya.
 */
.line-inner {
  width: 100%;
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  /*
   * SELALU wrap (bukan hanya saat span > 1) — kalau tidak, tinggi konten
   * (scrollHeight) tidak pernah terukur lebih dari satu baris pada
   * pengukuran PERTAMA (measureOverflow), karena nowrap membuatnya melebar
   * ke samping, bukan turun ke bawah. Akibatnya kebutuhan span salah
   * dihitung 1 terus dan baris tidak pernah membungkus ke baris kosong di
   * bawahnya. Pembatasan sisi (fade/potong) untuk baris yang TIDAK boleh
   * membungkus (tidak ada ruang kosong sama sekali) ditangani lewat
   * max-height + mask di bawah, bukan lewat nowrap.
   */
  flex-wrap: wrap;
  align-items: center;
  /* Sama seperti .line di atas: flex-start = kanan visual untuk RTL. */
  justify-content: flex-start;
  gap: 0.15rem 0.55rem;
}

/*
 * Baris kalimat dibaca RTL dan boleh membungkus turun ke baris-baris kosong
 * di bawahnya (lihat measureOverflow/emptyRoomBelow di <script>). Kelebihan
 * baru dipotong & memudar — di sisi BAWAH, karena sekarang teks membungkus
 * ke bawah bukan melebar ke kiri — kalau sudah mentok baris terakhir halaman
 * (baris 15) dan masih belum cukup tempat. Baris yang punya ruang kosong
 * cukup untuk menampung semuanya (span-nya sama dengan kebutuhannya) tidak
 * dipotong sama sekali.
 */
.verse-line.clipped {
  mask-image: linear-gradient(to top, transparent 0, #000 1.6em);
  -webkit-mask-image: linear-gradient(to top, transparent 0, #000 1.6em);
}

/*
 * Panel memorize dibaca kanan-ke-kiri (dir="rtl"), jadi hiasan surah cukup
 * menempel di sisi kanan selebar namanya — tidak perlu memanjang sampai tepi
 * kiri seperti pada mushaf, karena baris memorize memang tidak penuh.
 * `.line` sudah rata kanan (flex-start) secara default, jadi di sini tidak
 * perlu override justify-content lagi — cukup pastikan lebarnya tidak
 * dipaksa penuh (flex: 0 0 auto).
 */
.header-line,
.bismillah-line {
  flex: 0 0 auto;
  padding-block: 0.1rem;
}

.bismillah-line {
  padding-bottom: 0.3rem;
}

/* Basmalah seukuran teks memorize, dengan aksen sedikit lebih tebal */
.bismillah {
  font-family: var(--font-mushaf);
  font-size: var(--mushaf-text);
  line-height: 1.9;
  font-weight: var(--mushaf-font-weight, 600);
  white-space: nowrap;
}

/*
 * MarkOverlay (z-index negatif) berpijak pada stacking context BARIS (`.line`),
 * jadi semua tanda pada satu baris tergambar di bawah semua teks baris itu.
 * Target ketukan & posisi tanda tetap per-kata (`.word`, position: relative).
 */
.seg-part {
  display: inline-flex;
  align-items: center;
  gap: 0.32em;
  font-family: var(--font-mushaf);
  font-size: var(--mushaf-text);
  font-weight: var(--mushaf-font-weight, 600);
  line-height: 1.9;
  white-space: nowrap;
}

.word {
  position: relative;
  display: inline-flex;
  padding: 0.05em 0.14em;
  touch-action: manipulation;
}

/* Selama mode mark aktif, kata mana pun terlihat bisa diketuk */
.sheet.arming .word {
  cursor: copy;
  outline: 1px dashed color-mix(in srgb, var(--color-accent) 35%, transparent);
  outline-offset: 0.05em;
  border-radius: 0.3em;
}

.sheet.arming .word.marked {
  outline-style: solid;
}

/* Hanya bagian yang dipilih pengguna yang bergaris — bukan seluruh ayat */
.seg-part.helper {
  border-bottom: 1.5px dotted color-mix(in srgb, var(--color-accent) 70%, transparent);
}

.seg-ellipsis {
  opacity: 0.32;
}

/* Nomor ayat dilingkari, konsisten dengan tampilan mushaf */
.seg-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.6em;
  min-height: 1.6em;
  font-size: 0.6em;
  border: 2px solid color-mix(in srgb, currentColor 72%, transparent);
  border-radius: 999px;
  opacity: 0.9;
}

.empty {
  margin: auto;
  font-size: 0.85rem;
  opacity: 0.6;
}

/*
 * Penunjuk mode mark aktif.
 *
 * `pointer-events: none` penting: bar ini berdiri tepat di atas baris terbawah,
 * dan bila ia ikut menangkap sentuhan maka ketukan pada baris 15 mendarat di bar
 * — bukan di kalimatnya — sehingga baris paling bawah mustahil ditandai. Hanya
 * tombol Selesai di dalamnya yang boleh disentuh.
 */
.arming-bar {
  position: absolute;
  z-index: 60;
  left: 50%;
  bottom: 3.2rem;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.4rem 0.5rem 0.4rem 0.9rem;
  border-radius: 999px;
  background: var(--color-accent);
  color: #fff;
  font-size: 0.72rem;
  white-space: nowrap;
  pointer-events: none;
}

.arming-cancel {
  pointer-events: auto;
  padding: 0.25rem 0.6rem;
  border: 1px solid rgb(255 255 255 / 0.5);
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font-size: 0.68rem;
}

.notice {
  position: absolute;
  z-index: 60;
  left: 50%;
  bottom: 3.2rem;
  transform: translateX(-50%);
  margin: 0;
  padding: 0.45rem 0.85rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-ink) 82%, transparent);
  color: var(--color-paper);
  font-size: 0.72rem;
}

/* ------------------------------------------------------------------ setelan */
.setting {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding: 0.7rem 0;
}

.setting-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  font-size: 0.88rem;
}

.setting-hint {
  font-size: 0.72rem;
  opacity: 0.6;
}

.setting input[type='range'] {
  width: 100%;
  accent-color: var(--color-accent);
}

.setting-note {
  margin: 0.6rem 0 0;
  padding-top: 0.7rem;
  border-top: 1px solid var(--color-paper-edge);
  font-size: 0.72rem;
  opacity: 0.65;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.16s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* --------------------------------------------------------------------- dark */
.dark .memorize {
  background: var(--color-night);
  color: var(--color-night-ink);
}

.dark .left-rail {
  border-color: var(--color-night-edge);
  background: color-mix(in srgb, var(--color-night-ink) 4%, transparent);
}

.dark .rail-btn {
  border-color: var(--color-night-edge);
  background: var(--color-night);
  color: var(--color-night-ink);
}

.dark .page-circle-static {
  border-color: color-mix(in srgb, var(--color-night-ink) 24%, transparent);
  background: var(--color-night);
  color: var(--color-night-ink);
  box-shadow: 0 6px 16px rgb(0 0 0 / 0.55);
}

.dark .memo-note {
  border-color: color-mix(in srgb, var(--color-night-ink) 24%, transparent);
  background: var(--color-night);
  color: var(--color-night-ink);
}

.dark .memo-note.editing {
  border-color: var(--color-accent-soft);
}

.dark .tray-item {
  border-color: var(--color-night-edge);
  background: rgb(255 255 255 / 0.06);
}

.dark .rail-btn.on {
  border-color: var(--color-accent-soft);
  background: color-mix(in srgb, var(--color-accent-soft) 20%, transparent);
}

.dark .tray,
.dark .setting-note {
  border-color: var(--color-night-edge);
}

.dark .tray {
  background: var(--color-night);
}

.dark .notice {
  background: color-mix(in srgb, var(--color-night-ink) 86%, transparent);
  color: var(--color-night);
}

.dark .arming-bar {
  background: var(--color-accent-soft);
  color: #06120f;
}

.dark .arming-cancel {
  border-color: rgb(6 18 15 / 0.45);
}

.dark .tray-item.armed {
  border-color: var(--color-accent-soft);
  background: color-mix(in srgb, var(--color-accent-soft) 22%, transparent);
}
</style>