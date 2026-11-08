/**
 * Ukuran teks satu halaman mushaf, plus keputusan "pusatkan atau rata".
 *
 * Dua tahap, karena masing-masing menutup kelemahan yang lain:
 *
 * 1. TEBAKAN DARI TABEL. Lebar baris terpadat tiap halaman sudah diukur
 *    sebelumnya (services/fitTable.ts, lebar = a·s + b), jadi ukuran yang muat
 *    di kolom selebar `column` didapat dengan aritmetika. Bila font di
 *    perangkat sama dengan font pengukuran, hasilnya sudah tepat pada render
 *    pertama dan tahap 2 tidak mengubah apa pun.
 *
 * 2. PEMERIKSAAN LEBAR NYATA (dua arah). Tabel diukur dengan Scheherazade New;
 *    bila HP memakai font yang lebarnya berbeda, tebakan bisa terlalu besar
 *    (teks meluber di tepi kiri) atau terlalu kecil (teks mungil dengan celah
 *    lebar). Karena itu lebar kata yang benar-benar terpasang diperiksa, dan
 *    ukuran dikoreksi KE ATAS maupun KE BAWAH sampai baris terpadat mengisi
 *    kolom. Pemeriksaan ini hanya dipercaya bila:
 *      - font sudah selesai dimuat,
 *      - dua pembacaan di dua frame berbeda sepakat (bukan keadaan sesaat),
 *      - hasilnya masuk akal (rasio wajar).
 *    Halaman disembunyikan (`ready` = false) sampai tahap ini selesai, jadi
 *    koreksi apa pun terjadi di belakang layar — tidak ada kedipan ukuran.
 *
 * Mushaf cetak memakai satu ukuran huruf per halaman dan merenggangkan spasi
 * kata pada baris yang longgar. Itu yang ditiru:
 *
 *  - Halaman yang seluruh barisnya pendek (Al-Fatihah, awal Al-Baqarah, juz 30)
 *    tidak dipaksa rata kanan-kiri (celah antar kata bisa puluhan piksel);
 *    halaman itu ditandai `loose` dan barisnya dipusatkan.
 *  - Ukuran halaman ringan dibatasi supaya teks tidak berubah mencolok saat
 *    berpindah halaman.
 *
 * Ringkasan keadaan terakhir tersedia di `window.__fitDebug` (untuk diperiksa
 * lewat chrome://inspect bila tampilan di suatu perangkat aneh).
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { ensureMushafFont, mushafFontReady } from '@/services/fonts'
import { FIT_WIDE_A, FIT_WIDE_B } from '@/services/fitTable'
import { capSizeFor, rememberFit, tableSizeFor, type FitSizeOptions } from '@/services/fitSize'

/** Batas "halaman longgar": baris terpadat masih sisa ruang pada jarak kata pusat. */
const LOOSE_PAGE_MAX = 0.95

/** Jarak antar kata (em) pada baris yang dipusatkan; sama dengan CSS `.loose`. */
const CENTERED_GAP_EM = 0.28

/** Berapa kali koreksi ukuran boleh dilakukan per halaman */
const MAX_ADJUSTS = 4

/** Berapa kali pembacaan yang tidak sepakat boleh diulang sebelum menyerah */
const MAX_UNSTABLE = 5

/** Rasio isi/kolom yang dianggap sudah pas (tebakan tabel biasanya ±0.98) */
const FIT_OK_MIN = 0.955
const FIT_OK_MAX = 1.001

/** Rasio di luar rentang ini dianggap pembacaan rusak dan diabaikan */
const SANE_MIN = 0.3
const SANE_MAX = 3

/** Batas akhir menunggu: apa pun yang terjadi, halaman tidak tertahan tersembunyi */
const VERIFY_TIMEOUT_MS = 1500

export type AutoFitOptions = FitSizeOptions

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

export function useAutoFitText(
  container: Ref<HTMLElement | null>,
  /** Nomor halaman (1–604) */
  pageNumber: Ref<number>,
  options: AutoFitOptions = {},
) {
  const max = options.max ?? 30
  const min = options.min ?? 11
  const safety = options.safety ?? 0.02
  const spread = options.spread ?? 1.18

  /** Lebar kolom teks (px) = lebar baris; 0 selama belum terukur */
  const column = ref(0)

  /** Koreksi dari pemeriksaan lebar nyata; null bila tebakan tabel sudah pas */
  const adjusted = ref<number | null>(null)

  /** Keputusan "longgar" dari lebar nyata; null = pakai tabel */
  const looseMeasured = ref<boolean | null>(null)

  /**
   * Rasio isi/kolom (dengan jarak kata "dipusatkan") yang terukur nyata pada
   * halaman longgar — dipakai untuk menyempitkan kolom halaman itu (lihat
   * `looseRatio` di bawah) alih-alih memusatkan barisnya. `null` sebelum ada
   * pengukuran nyata.
   */
  const measuredWideRatio = ref<number | null>(null)

  /** True setelah pemeriksaan lebar nyata selesai untuk halaman & lebar ini */
  const verified = ref(false)

  let adjusts = 0
  let unstable = 0
  let token = 0
  let guardTimer = 0

  const sizing = { max, min, safety, spread }

  /** Batas atas ukuran (px) untuk kolom ini: kenyamanan baca & halaman ringan */
  const capSize = computed(() => capSizeFor(column.value, sizing))

  /** Tebakan dari tabel untuk halaman & lebar kolom saat ini */
  const tableSize = computed<number | null>(() => tableSizeFor(pageNumber.value, column.value, sizing))

  /** Ukuran yang dipakai: koreksi bila ada, kalau tidak tebakan tabel */
  const fitSize = computed<number | null>(() => adjusted.value ?? tableSize.value)

  /** True bila seluruh baris halaman ini pendek → dipusatkan, tidak direnggangkan */
  const loose = computed(() => {
    if (looseMeasured.value != null) return looseMeasured.value
    const s = fitSize.value
    const c = column.value
    const i = pageNumber.value - 1
    if (s == null || !c) return false
    return (FIT_WIDE_A[i] ?? Infinity) * s + (FIT_WIDE_B[i] ?? 0) <= LOOSE_PAGE_MAX * c
  })

  /**
   * Perkiraan rasio isi/kolom halaman longgar, dipakai MushafPageView untuk
   * menyempitkan lebar kolom (bukan memusatkan baris) supaya teks tetap
   * rata kanan-kiri tapi tidak merenggang sampai tepi. Sebelum lebar nyata
   * terukur, dipakai tebakan tabel (rumus sama dengan `loose` di atas);
   * setelah terukur, dipakai rasio nyata yang lebih akurat.
   */
  const looseRatio = computed<number | null>(() => {
    if (measuredWideRatio.value != null) return measuredWideRatio.value
    const s = fitSize.value
    const c = column.value
    const i = pageNumber.value - 1
    if (s == null || !c) return null
    return ((FIT_WIDE_A[i] ?? Infinity) * s + (FIT_WIDE_B[i] ?? 0)) / c
  })

  /** Siap digambar: font terpasang, kolom diketahui, dan lebar nyata sudah diperiksa. */
  const ready = computed(
    () => mushafFontReady.value && column.value > 0 && fitSize.value != null && verified.value,
  )

  /* ------------------------------------------------------------ lebar kolom */
  let observer: ResizeObserver | null = null

  function readColumn(): void {
    const host = container.value
    if (!host) return
    const w = Math.round(host.clientWidth)
    if (w > 0 && w !== column.value) column.value = w
  }

  onMounted(() => {
    // Idempoten: bila App.vue sudah memulainya, ini tidak berbuat apa-apa
    void ensureMushafFont()
    readColumn()
    if (typeof ResizeObserver !== 'undefined' && container.value) {
      observer = new ResizeObserver(readColumn)
      observer.observe(container.value)
    }
    // Font berganti belakangan (mis. dimuat ulang): periksa lagi dari awal
    document.fonts?.addEventListener?.('loadingdone', restart)
  })

  onBeforeUnmount(() => {
    observer?.disconnect()
    document.fonts?.removeEventListener?.('loadingdone', restart)
    window.clearTimeout(guardTimer)
    token++
  })

  /* -------------------------------------------------- pemeriksaan lebar nyata */

  /**
   * Rasio isi/kolom terbesar di antara baris, dari lebar kata yang benar-benar
   * terpasang. `wide` = rasio yang sama bila baris diberi jarak "dipusatkan".
   */
  function readRatios(host: HTMLElement, size: number): { ratio: number; wide: number } | null {
    let ratio = 0
    let wide = 0
    let lines = 0
    for (const line of host.querySelectorAll<HTMLElement>('[data-fit-line]')) {
      const kids = [...line.children] as HTMLElement[]
      const available = line.clientWidth
      if (!kids.length || available <= 0) continue

      let sum = 0
      for (const k of kids) sum += k.getBoundingClientRect().width
      const gap = parseFloat(getComputedStyle(line).columnGap || '0') || 0
      const gaps = Math.max(0, kids.length - 1)
      ratio = Math.max(ratio, (sum + gap * gaps) / available)
      wide = Math.max(wide, (sum + CENTERED_GAP_EM * size * gaps) / available)
      lines++
    }
    return lines ? { ratio, wide } : null
  }

  function finish(t: number): void {
    if (t !== token) return
    window.clearTimeout(guardTimer)
    verified.value = true
    // Catat ukuran final supaya memorize memakai ukuran huruf yang sama
    if (fitSize.value != null && column.value > 0) {
      rememberFit(pageNumber.value, column.value, fitSize.value)
    }
  }

  async function verify(): Promise<void> {
    const t = ++token
    window.clearTimeout(guardTimer)
    guardTimer = window.setTimeout(() => finish(t), VERIFY_TIMEOUT_MS)

    // Font masih dimuat → lebar kata belum final; tunggu sampai selesai
    if (document.fonts?.status === 'loading') {
      await document.fonts.ready.catch(() => undefined)
    }
    await nextTick()
    await nextFrame()
    if (t !== token) return

    const host = container.value
    const size = fitSize.value
    if (!host || size == null) return finish(t)

    // Dua pembacaan di dua frame berbeda harus sepakat: satu pembacaan bisa
    // jatuh pada keadaan sesaat (font/tata letak belum menetap).
    const r1 = readRatios(host, size)
    await nextFrame()
    if (t !== token) return
    const r2 = readRatios(host, size)

    if (!r1 || !r2) return finish(t)

    if (Math.abs(r1.ratio - r2.ratio) > 0.01) {
      if (++unstable <= MAX_UNSTABLE) return void verify()
      return finish(t) // tetap tidak stabil: pakai tebakan tabel apa adanya
    }

    const ratio = Math.max(r1.ratio, r2.ratio)
    if (ratio < SANE_MIN || ratio > SANE_MAX) return finish(t) // pembacaan rusak

    // Sudah pas? (kasus normal: font sama dengan font pengukuran tabel)
    const tooBig = ratio > FIT_OK_MAX
    const tooSmall = ratio < FIT_OK_MIN && size < capSize.value - 0.05
    if (!(tooBig || tooSmall) || adjusts >= MAX_ADJUSTS) {
      if (adjusted.value != null) {
        measuredWideRatio.value = Math.max(r1.wide, r2.wide)
        looseMeasured.value = measuredWideRatio.value <= LOOSE_PAGE_MAX
      }
      return finish(t)
    }

    // Lebar teks ≈ sebanding dengan ukuran font → skala menuju isi (1 − safety)
    const target = size * ((1 - safety) / ratio)
    const next = Math.round(Math.max(min, Math.min(capSize.value, target)) * 100) / 100
    if (Math.abs(next - size) < 0.05) {
      if (adjusted.value != null) {
        measuredWideRatio.value = Math.max(r1.wide, r2.wide)
        looseMeasured.value = measuredWideRatio.value <= LOOSE_PAGE_MAX
      }
      return finish(t)
    }

    adjusts++
    adjusted.value = next // memicu render ulang → watcher di bawah memeriksa lagi
  }

  function reset(): void {
    adjusted.value = null
    looseMeasured.value = null
    measuredWideRatio.value = null
    verified.value = false
    adjusts = 0
    unstable = 0
    token++
  }

  /**
   * Font selesai dimuat/berganti: periksa ulang lebar nyata. Sengaja TIDAK
   * menyembunyikan halaman lagi (tidak menyentuh `verified`) — bila tak ada yang
   * berubah, layar tidak berkedip; bila memang berubah, koreksinya dipasang.
   */
  function restart(): void {
    if (!mushafFontReady.value || column.value <= 0 || fitSize.value == null) return
    adjusts = 0
    unstable = 0
    void nextTick().then(verify).then(publishDebug)
  }

  // Halaman atau lebar berganti → mulai dari tebakan tabel lagi. `pre` supaya
  // keadaan sudah bersih sebelum DOM halaman baru digambar.
  watch([pageNumber, column], reset, { flush: 'pre' })

  // Sesudah DOM terpasang: periksa lebar nyata pada ukuran yang sedang dipakai.
  watch(
    [pageNumber, column, mushafFontReady, fitSize],
    () => {
      if (!mushafFontReady.value || column.value <= 0 || fitSize.value == null) return
      void verify().then(publishDebug)
    },
    { flush: 'post' },
  )

  function publishDebug(): void {
    if (typeof window === 'undefined') return
    const faces: string[] = []
    document.fonts?.forEach((f) => faces.push(`${f.family} ${f.weight} ${f.status}`))
    ;(window as unknown as { __fitDebug?: unknown }).__fitDebug = {
      page: pageNumber.value,
      column: column.value,
      table: tableSize.value,
      adjusted: adjusted.value,
      size: fitSize.value,
      cap: capSize.value,
      loose: loose.value,
      verified: verified.value,
      adjusts,
      unstable,
      fontsStatus: document.fonts?.status,
      faces,
      viewport: window.innerWidth,
      dpr: window.devicePixelRatio,
    }
  }

  return { fitSize, loose, looseRatio, ready, centeredGapEm: CENTERED_GAP_EM }
}
