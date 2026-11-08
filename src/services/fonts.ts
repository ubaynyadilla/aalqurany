/**
 * Kesiapan font mushaf.
 *
 * Ukuran teks halaman dihitung dari tabel yang diukur dengan Scheherazade New,
 * jadi teks baru boleh digambar SETELAH font itu benar-benar terpasang.
 * Kalau tidak, halaman sempat tampil dengan font cadangan (lebar berbeda) lalu
 * berganti — kedipan dan teks meluber yang terlihat di HP.
 *
 * `ensureMushafFont()` idempoten: dipanggil sekali saat aplikasi dibuka
 * (App.vue) supaya font sudah siap sebelum reader dibuka, dan aman dipanggil
 * lagi dari mana saja.
 */
import { ref } from 'vue'

/** True setelah font selesai dimuat, atau setelah batas waktu (font gagal/tidak ada). */
export const mushafFontReady = ref(false)

/** Batas menunggu font: lewat dari ini teks tampil dengan font yang tersedia. */
const FONT_TIMEOUT_MS = 3000

/** Contoh teks Arab lengkap dengan tanda baca Quran, agar seluruh subset ikut dimuat. */
const SAMPLE = 'بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ ۞ ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَـٰلَمِينَ ۩ ﴿١﴾'

let pending: Promise<void> | null = null

export function ensureMushafFont(): Promise<void> {
  if (pending) return pending

  const fonts = typeof document !== 'undefined' ? document.fonts : undefined
  if (!fonts?.load) {
    mushafFontReady.value = true
    pending = Promise.resolve()
    return pending
  }

  // UthmanicHafs (bila pengguna memasangnya) dan Scheherazade New: dua-duanya
  // dimuat, dan `allSettled` supaya satu yang gagal tidak menghentikan yang lain.
  const loads = ['UthmanicHafs', '"Scheherazade New"'].map((family) =>
    fonts.load(`600 20px ${family}`, SAMPLE),
  )
  const timeout = new Promise<void>((resolve) => window.setTimeout(resolve, FONT_TIMEOUT_MS))

  pending = Promise.race([Promise.allSettled(loads).then(() => undefined), timeout]).then(() => {
    mushafFontReady.value = true
  })
  return pending
}
