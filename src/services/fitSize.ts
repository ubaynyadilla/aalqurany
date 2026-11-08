/**
 * Ukuran teks mushaf yang muat di sebuah kolom, dipakai bersama oleh reader
 * (useAutoFitText) dan memorize — supaya huruf di kedua layar SAMA besar.
 *
 * Tabel lebar baris terpadat tiap halaman (fitTable.ts) mengubah "berapa px
 * yang muat di kolom selebar ini" menjadi aritmetika sederhana.
 */
import { FIT_A, FIT_B } from './fitTable'

/**
 * Acuan "halaman terpadat": halaman ringan boleh lebih besar dari itu, tapi
 * hanya sampai `spread` kali, supaya ukuran huruf tidak berubah mencolok antar
 * halaman.
 */
export const HEAVIEST_LINE_PER_PX = 20.94

export interface FitSizeOptions {
  /** Ukuran terbesar yang diizinkan (px) — batas kenyamanan baca */
  max?: number
  /** Ukuran terkecil yang diizinkan (px) — di bawah ini teks terlalu kecil */
  min?: number
  /** Sisa ruang yang disisakan agar tidak mepet, 0.02 = 2% */
  safety?: number
  /** Sejauh mana halaman ringan boleh lebih besar dari halaman terpadat */
  spread?: number
}

/** Batas atas ukuran (px) untuk kolom selebar `column`. */
export function capSizeFor(column: number, opts: FitSizeOptions = {}): number {
  const max = opts.max ?? 30
  const safety = opts.safety ?? 0.02
  const spread = opts.spread ?? 1.18
  if (!column) return max
  return Math.min(max, (column / HEAVIEST_LINE_PER_PX) * (1 - safety) * spread)
}

/** Tebakan ukuran (px) dari tabel untuk halaman `page`; null bila belum bisa dihitung. */
export function tableSizeFor(page: number, column: number, opts: FitSizeOptions = {}): number | null {
  const min = opts.min ?? 11
  const safety = opts.safety ?? 0.02
  const i = page - 1
  const a = FIT_A[i]
  if (!column || !a) return null

  const fitted = ((column - (FIT_B[i] ?? 0)) / a) * (1 - safety)
  const clamped = Math.max(min, Math.min(capSizeFor(column, opts), fitted))
  return Math.round(clamped * 100) / 100
}

/* -------------------------------------------------------- ukuran terverifikasi */

/**
 * Ukuran yang sudah DIPERIKSA pada lebar nyata di perangkat ini (bisa berbeda
 * dari tebakan tabel bila fontnya berlainan). Reader mencatatnya di sini,
 * memorize membacanya — jadi huruf di memorize sama dengan reader bahkan pada
 * perangkat yang fontnya menuntut koreksi.
 */
const verified = new Map<string, number>()

const keyOf = (page: number, column: number): string => `${page}@${column}`

export function rememberFit(page: number, column: number, size: number): void {
  verified.set(keyOf(page, column), size)
}

export function recallFit(page: number, column: number): number | undefined {
  return verified.get(keyOf(page, column))
}

/* -------------------------------------------------------- lebar kolom reader */

/**
 * Lebar kolom teks di reader: lebar layar dikurangi gutter kiri-kanan. Gutter
 * dibaca dari variabel CSS `--mushaf-gutter` (main.css) — satu-satunya tempat
 * nilainya ditetapkan — bukan diketik ulang di sini.
 */
export function readerColumnWidth(viewportWidth: number = document.documentElement.clientWidth): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--mushaf-gutter').trim()
  const n = parseFloat(raw)
  let gutter = viewportWidth * 0.07
  if (Number.isFinite(n)) {
    if (raw.endsWith('vw')) gutter = (n * viewportWidth) / 100
    else if (raw.endsWith('rem')) gutter = n * (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16)
    else if (raw.endsWith('px')) gutter = n
  }
  return Math.max(0, Math.round(viewportWidth - 2 * gutter))
}

/**
 * Ukuran huruf reader untuk `page`, sebagaimana yang akan dipakai reader pada
 * layar ini: ukuran terverifikasi bila sudah tercatat, kalau belum tebakan tabel.
 */
export function readerFontSize(page: number, opts: FitSizeOptions = {}): number | null {
  const column = readerColumnWidth()
  return recallFit(page, column) ?? tableSizeFor(page, column, opts)
}
