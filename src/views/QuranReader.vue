<script setup lang="ts">
/**
 * Reader immersive (§3.1.1).
 *
 * - Tanpa border, halaman mengisi penuh layar seperti membuka mushaf fisik.
 * - Semua menu disembunyikan; yang memanggilnya adalah KETUKAN PADA NOMOR
 *   HALAMAN di tengah bawah. Cara lama — mengetuk zona atas/bawah layar —
 *   dilepas: zona itu bertabrakan dengan ketukan biasa saat membaca sehingga
 *   menu muncul-hilang sendiri.
 * - Empat pills keluar sekaligus: Cover & tema di sisi atas (sebaris dengan
 *   pills surah dan juz), Memorize & Reminder di sisi bawah mengapit nomor
 *   halaman.
 * - Ikon lompat ayat (kiri atas) & lompat juz (kanan atas) selalu tersedia.
 * - Menu juga memuat tombol stabilo (kotak rounded, sebaris dengan pills atas).
 *   Menyalakannya = mode stabilo, sama seperti mode mark di memorize: ketuk kata
 *   untuk mewarnainya, ketuk lagi untuk melepasnya. Selama mode ini aktif menu
 *   TIDAK tertutup oleh ketukan di halaman; mengetuk nomor halaman menutup menu
 *   sekaligus mematikan mode stabilo.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import MushafPageView from '@/components/MushafPageView.vue'
import QuickPills from '@/components/QuickPills.vue'
import GoToVerseSheet from '@/components/GoToVerseSheet.vue'
import GoToJuzSheet from '@/components/GoToJuzSheet.vue'
import QariPickerSheet from '@/components/QariPickerSheet.vue'
import {
  iconAudio,
  iconHighlighter,
  iconLock,
  iconMemorize,
  iconPause,
  iconPlay,
  iconReminder,
  iconThemeCream,
  iconThemeDark,
  iconThemeForest,
  iconThemeLight,
  iconThemeWhite,
} from '@/components/icons'
import type { ThemeMode } from '@/types'
import { remindersAvailable } from '@/services/platform'
import { usePageLabels } from '@/composables/usePageLabels'
import { useQuranStore } from '@/stores/quranStore'
import { toArabicNumber } from '@/utils/arabicNumerals'
import { MAX_MARKS_PER_PAGE, TOTAL_PAGES } from '@/types'

const router = useRouter()
const route = useRoute()
const quran = useQuranStore()

const menuOpen = ref(false)
const sheet = ref<'verse' | 'juz' | null>(null)
const qariPickerOpen = ref(false)

const THEME_OPTIONS: { mode: ThemeMode; label: string; icon: string }[] = [
  { mode: 'light',  label: 'Coklat',  icon: iconThemeLight },
  { mode: 'dark',   label: 'Gelap',   icon: iconThemeDark },
  { mode: 'forest', label: 'Hutan',   icon: iconThemeForest },
  { mode: 'cream',  label: 'Krem',    icon: iconThemeCream },
  { mode: 'white',  label: 'Putih',   icon: iconThemeWhite },
]

const currentThemeIcon = computed(() =>
  THEME_OPTIONS.find((t) => t.mode === quran.theme)?.icon ?? iconThemeLight,
)
const currentThemeLabel = computed(() =>
  THEME_OPTIONS.find((t) => t.mode === quran.theme)?.label ?? 'Tema',
)

/** Mode stabilo: selama true, ketukan pada kata memberi/melepas warna */
const highlightArmed = ref(false)

/**
 * Opsi tempo pemutaran (siklik lewat satu bulatan, lihat `onTempoClick`).
 * "2x" sengaja dihapus dari daftar (§5) — kecepatan maksimum sekarang 1.5x.
 */
const TEMPO_OPTIONS = [0.75, 1, 1.25, 1.5] as const

/** Geser tempo ke opsi berikutnya secara siklik: 0.75x → 1x → 1.25x → 1.5x → 0.75x. */
function onTempoClick(): void {
  const idx = TEMPO_OPTIONS.indexOf(quran.audioTempo as (typeof TEMPO_OPTIONS)[number])
  quran.setAudioTempo(TEMPO_OPTIONS[(idx + 1) % TEMPO_OPTIONS.length])
}

/**
 * §perbaikan-wave-2: dua pendekatan sebelumnya (CSS @keyframes + custom
 * property, lalu JS requestAnimationFrame) sama-sama tidak terlihat
 * bergerak di environment app ini. Sekarang diganti dengan pendekatan yang
 * JAUH lebih sederhana dan sesuai referensi yang diberikan: animasi CSS
 * murni berbasis `transform: scaleY(...)` dengan `animation-delay` TETAP
 * per `nth-child` (bukan dihitung lewat custom property/JS) — gaya paling
 * dasar yang didukung hampir semua browser/webview, dan terbukti jalan di
 * referensi HTML yang diberikan. Tidak ada lagi state JS untuk animasinya;
 * nyala/mati cukup lewat class `.is-paused` yang di-toggle sesuai
 * `quran.isPlaying`, CSS yang mengurus sisanya.
 *
 * §perbaikan-wave-3: akar masalah "diam di app, jalan di file test"
 * ternyata BUKAN di struktur v-if/animasinya, melainkan blok
 * `@media (prefers-reduced-motion: reduce)` di bawah yang mematikan
 * animasi `.wave-bar` kalau device/WebView melaporkan preferensi tsb
 * (umum aktif di beberapa emulator/Android lewat "Remove animations").
 * File test (`test-wave.html`) tidak punya override ini sama sekali,
 * makanya selalu bergerak di device yang sama. Override itu sudah
 * dihapus.
 *
 * §perbaikan-wave-4: setelah animasinya bergerak, ternyata KECEPATANNYA
 * jauh lebih cepat dari yang diatur (`4s` di CSS terlihat seperti
 * terjadi dalam < 1 detik) — tanda bahwa durasi animasi CSS di
 * environment app ini "diperas"/di-scale oleh sesuatu di luar kendali
 * kita (WebView/Capacitor/CSS lain), bukan oleh kode di file ini. Supaya
 * kecepatan & pola bertahapnya PASTI konsisten apa pun environment-nya,
 * animasi wave sekarang dihitung sendiri lewat `requestAnimationFrame`
 * (lihat `waveStep`/`waveScales` di bawah), bukan lagi `@keyframes` CSS.
 * Dengan rAF, posisi tiap batang dihitung ulang tiap frame berdasarkan
 * `performance.now()` asli — tidak ada lagi "durasi" yang bisa diubah
 * paksa oleh pihak luar, jadi kecepatannya selalu sama persis dengan yang
 * diatur di `WAVE_PERIOD_MS` di bawah.
 */
const JUMLAH_BATANG_WAVE = 14

/** Lama satu siklus naik-turun penuh wave (ms). Kontrol penuh lewat JS. */
const WAVE_PERIOD_MS = 4000
/** Beda delay (ms) antar batang yang bersebelahan — menentukan "bertahap"nya pola. */
const WAVE_DELAY_STEP_MS = 130

/** Skala vertikal (scaleY) tiap batang wave saat ini, diperbarui tiap frame. */
const waveScales = ref<number[]>(Array(JUMLAH_BATANG_WAVE).fill(0.22))
let waveRaf = 0
let waveStartTs = 0

/** Delay batang ke-i: pola gunung simetris dari tengah (0) melebar ke tepi. */
function waveBarDelay(i: number): number {
  const center = (JUMLAH_BATANG_WAVE - 1) / 2
  return Math.abs(i - center) * WAVE_DELAY_STEP_MS
}

function waveStep(ts: number): void {
  if (!waveStartTs) waveStartTs = ts
  const elapsed = ts - waveStartTs
  for (let i = 0; i < JUMLAH_BATANG_WAVE; i++) {
    const local = ((elapsed - waveBarDelay(i)) % WAVE_PERIOD_MS + WAVE_PERIOD_MS) % WAVE_PERIOD_MS
    const phase = local / WAVE_PERIOD_MS
    // 4 naik-turun per siklus, sama seperti pola keyframe sebelumnya.
    const s = Math.sin(phase * Math.PI * 4)
    waveScales.value[i] = 0.25 + ((s + 1) / 2) * 0.75 // rentang 0.25–1
  }
  waveRaf = requestAnimationFrame(waveStep)
}

/** Jalankan/hentikan loop rAF cuma selagi wave benar-benar tampil (audio & playing). */
watch(
  () => quran.audioMenuOpen && quran.isPlaying,
  (active) => {
    cancelAnimationFrame(waveRaf)
    if (active) {
      waveStartTs = 0
      waveRaf = requestAnimationFrame(waveStep)
    }
  },
)

/**
 * Nomor ayat yang mengikuti ayat yang SEDANG dibaca audio (bukan sekadar
 * ayat yang sedang terlihat di halaman) — diambil dari
 * `quran.currentPlayingVerseKey` (format "surah:ayah"), jatuh kembali ke
 * ayat yang sedang ditandai bila belum ada yang diputar. Badge ini yang
 * membuat nomor ayat di sebelah wave selalu sinkron dengan audio.
 */
const currentPlayingAyahNumber = computed<string | null>(() => {
  const key = quran.currentPlayingVerseKey || quran.currentVerseKey
  if (!key) return null
  const parts = String(key).split(':')
  return parts[1] ?? parts[0] ?? null
})

/**
 * Ikon Setting Audio — slider/equalizer (tiga garis horizontal dengan knob
 * geser di posisi berbeda per garis), menggantikan ikon gerigi/gear lama.
 * Dipakai di tombol "Setting Audio" pada bar-row. Outline sederhana (bukan
 * filled) supaya senada dengan gaya ikon lain di bar (stabilo, memorize,
 * dsb.) yang semuanya line-icon.
 */
const iconSettingsSlider = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><circle cx="9" cy="6" r="2" fill="currentColor" stroke="none"/><line x1="4" y1="12" x2="20" y2="12"/><circle cx="16" cy="12" r="2" fill="currentColor" stroke="none"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="11" cy="18" r="2" fill="currentColor" stroke="none"/></svg>`

/**
 * Ikon Tempo — gauge/speedometer sederhana, dipasangkan dengan teks nilai
 * tempo ("1,75x" dsb.) di bawahnya di dalam bulatan. Sebelumnya slot Tempo
 * hanya berisi teks tanpa ikon, membuatnya tidak sejajar secara visual
 * dengan tombol lain yang semuanya berbasis ikon.
 */
const iconTempo = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 14 15.5 9.5"/><path d="M4.9 19a9 9 0 1 1 14.2 0"/><path d="M8 19h8"/></svg>`

/**
 * Ikon Ulangi — dua panah melingkar (repeat), dipasangkan dengan teks nilai
 * pengulangan ("1x", "2x", dst.) di bawahnya.
 */
const iconRepeat = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2 21 6 17 10"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22 3 18 7 14"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`

/** Buka panel Setting Audio sekaligus memuat daftar qari (sekali saja, di-cache di quranAudio.ts). */
function onToggleAudioSettings(): void {
  quran.toggleAudioSettings()
  if (quran.audioSettingsOpen) void quran.loadReciters()
}

/** Petunjuk singkat di bawah halaman (batas tanda tercapai, mode stabilo, dsb.) */
const notice = ref<string | null>(null)
let noticeTimer: number | undefined

/**
 * Animasi petunjuk pada nomor halaman: diputar sekali per pembukaan aplikasi,
 * saat pertama kali pindah halaman. Statusnya disimpan di sessionStorage (bukan
 * variabel komponen) supaya tidak terulang tiap kali reader dibuka dari cover.
 */
const notchHint = ref(false)
const HINT_KEY = 'aalqurany:notchHintSeen'

function hintAlreadyShown(): boolean {
  try {
    return sessionStorage.getItem(HINT_KEY) === '1'
  } catch {
    return false
  }
}

function markHintShown(): void {
  try {
    sessionStorage.setItem(HINT_KEY, '1')
  } catch {
    // Penyimpanan tidak tersedia: petunjuk tampil sekali per reader, tidak masalah
  }
}


const animating = ref<'next' | 'prev' | null>(null)

const SWIPE_MIN_X = 45
const SWIPE_MAX_Y = 80

let startX = 0
let startY = 0
let startTime = 0

const { headerSurah, surahLabelLatin, surahLabelArabic, juzLabelArabic, juzSheetArabic } = usePageLabels()

/** Hanya tanda stabilo yang digambar di reader; bentuk lain milik memorize */
const readerMarks = computed(() => quran.marksOnPage.filter((m) => m.shape === 'highlight'))

onMounted(async () => {
  // Deep link dari notifikasi reminder: /reader?surah=2&ayah=14
  const s = Number(route.query.surah)
  const a = Number(route.query.ayah)
  if (s && a) {
    // Deep link hanya datang dari reminder: buka tanpa menyentuh "terakhir dibaca"
    await quran.openFromReminder(s, a)
    return
  }
  const p = Number(route.query.page)
  if (p) await quran.goToPage(p)
})

function onTouchStart(e: TouchEvent): void {
  const t = e.touches[0]
  startX = t.clientX
  startY = t.clientY
  startTime = Date.now()
}

async function onTouchEnd(e: TouchEvent): Promise<void> {
  const t = e.changedTouches[0]
  const dx = t.clientX - startX
  const dy = t.clientY - startY
  const elapsed = Date.now() - startTime

  // Swipe horizontal → ganti halaman. RTL: swipe kanan = halaman berikutnya,
  // meniru arah membalik lembar mushaf.
  if (Math.abs(dx) > SWIPE_MIN_X && Math.abs(dy) < SWIPE_MAX_Y) {
    if (dx > 0) await turn('next')
    else await turn('prev')
    return
  }

  // Ketukan singkat tanpa geser → tutup menu bila sedang terbuka
  if (elapsed < 350 && Math.abs(dx) < 12 && Math.abs(dy) < 12) {
    handleTap()
  }
}

function onClick(e: MouseEvent): void {
  // Fallback untuk pengujian di browser desktop
  if (e.detail === 0) return
  handleTap()
}

/**
 * Ketukan di badan halaman hanya menutup menu, tidak pernah membukanya. Yang
 * membuka menu satu-satunya adalah nomor halaman — sehingga membaca tidak lagi
 * memunculkan menu tanpa diminta.
 */
function handleTap(): void {
  // Saat mode stabilo aktif, ketukan di halaman adalah untuk mewarnai kata —
  // menu (dan tombol stabilo di dalamnya) harus tetap terlihat.
  if (menuOpen.value && !highlightArmed.value) menuOpen.value = false
}

function flash(message: string): void {
  notice.value = message
  window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => (notice.value = null), 2000)
}

onBeforeUnmount(() => {
  window.clearTimeout(noticeTimer)
  clearHoldTimer()
  cancelAnimationFrame(waveRaf)
})

/**
 * Tutup menu. Mode stabilo TIDAK ikut mati: selama aktif, tombol stabilo tetap
 * tampil di baris atas (lihat template) sebagai penanda mode sedang menyala, dan
 * hanya tombol itu sendiri yang mematikannya.
 */
function closeMenu(): void {
  menuOpen.value = false
}

function toggleMenu(): void {
  if (menuOpen.value) closeMenu()
  else menuOpen.value = true
}

function toggleHighlight(): void {
  highlightArmed.value = !highlightArmed.value
  if (highlightArmed.value) flash('Ketuk kata untuk memberi stabilo')
}

/**
 * Nyalakan/matikan mode Audio. Begitu dinyalakan, tampilkan toast instruksi
 * (spesifikasi: "tekan lama nomor ayat awal untuk mulai menandai"). Mematikan
 * mode Audio tidak perlu toast — perubahan UI (ikon & bar collapse) sudah
 * cukup terlihat.
 */
/**
 * Klik indikator audio (badge ayat + wave) di atas: lompat ke halaman ayat
 * yang SEDANG diputar. Berguna karena mode Audio sengaja tetap jalan di
 * latar belakang walau user pindah halaman (lihat komentar `audioMenuOpen`
 * di quranStore.ts) — jadi badge ini jadi "jalan pintas" balik ke posisi
 * audio tanpa harus cari manual.
 */
async function onAudioIndicatorClick(): Promise<void> {
  const key = quran.currentPlayingVerseKey
  if (!key) return
  // Sudah di halaman yang sama — tidak perlu apa-apa.
  if (quran.page?.verseKeys?.includes(key)) return
  const [s, a] = String(key).split(':').map(Number)
  if (!s || !a) return
  await quran.goToVerse(s, a)
}

function onToggleAudioMenu(): void {
  quran.toggleAudioMenu()
  if (quran.audioMenuOpen) flash('Tap nomor ayat awal untuk mulai menandai')
}

/**
 * Ketuk kata selagi mode stabilo aktif — logika sama dengan mark di memorize:
 * kata yang sudah distabilo dilepas; kata lain distabilo. Kata yang membawa
 * bentuk lain (bulat/kotak dari memorize) diganti stabilo, karena satu kata
 * hanya boleh punya satu tanda. Mode tetap aktif setelahnya.
 */
async function onWordTap(p: { verseKey: string; wordIndex: number; line: number }): Promise<void> {
  if (!highlightArmed.value) return

  const existing = quran.marksOnPage.find(
    (m) => m.verseKey === p.verseKey && m.wordIndex === p.wordIndex,
  )

  if (existing?.shape === 'highlight') {
    if (existing.id != null) await quran.removeMark(existing.id)
    return
  }
  if (existing?.id != null) await quran.removeMark(existing.id)

  const added = await quran.addMark(p.verseKey, p.line, p.wordIndex, 'highlight')
  if (!added) flash(`Batas ${MAX_MARKS_PER_PAGE} tanda per halaman sudah tercapai`)
}

/**
 * Tap nomor ayat saat mode Audio aktif (dulu tekan-lama — lihat §6: badan
 * halaman sekarang sudah ditandai overlay dim selama mode Audio aktif,
 * jadi tak perlu lagi tekan-lama untuk membedakan dari ketukan baca biasa).
 * Komponen ini yang memutuskan apakah tap ini menandai ayat AWAL atau ayat
 * AKHIR, berdasarkan state marking yang ada di store — MushafPageView cuma
 * melapor ayat mana yang di-tap.
 *
 * - Belum ada ayat awal (atau rentang sebelumnya sudah lengkap) → tap ini
 *   jadi ayat awal baru (menimpa rentang lama bila ada).
 * - Sudah ada ayat awal, rentang belum lengkap → tap ini jadi ayat akhir.
 */
function onAyahTap(verseKey: string): void {
  if (!quran.audioMenuOpen) return

  if (!quran.markingStart || quran.markingComplete) {
    quran.markRangeStart(verseKey)
    flash('Ayat awal ditandai. Tap ayat akhir untuk menyelesaikan rentang.')
  } else {
    quran.markRangeEnd(verseKey)
    flash('Rentang ayat ditandai.')
  }
}

/**
 * Klik pada nomor halaman SELAMA mode Audio aktif. Tombol ini menggantikan
 * fungsi toggle-menu biasa (lihat `onPageCircleClick`) dan jadi kontrol
 * play/pause, dengan 3 kondisi sesuai status marking:
 *  - Rentang lengkap (awal & akhir sama-sama ditandai) → play/pause rentang itu.
 *  - Baru ayat awal yang ditandai (akhir belum) → toast "silakan tap ayat
 *    akhir", TIDAK memutar apa pun.
 *  - Belum ada tanda sama sekali → play/pause satu halaman penuh.
 * Tombol ini TIDAK PERNAH mematikan mode Audio — hanya ikon menu Audio
 * sendiri yang mematikannya (lihat `onToggleAudioMenu`).
 */
/**
 * Jeda singkat antara menekan play dan audio benar-benar terdengar (decode,
 * fetch, render) — selama jeda ini `isPlaying` belum tentu true, jadi kalau
 * tidak diberi penanda, tombol terlihat diam/tidak merespons. `audioBuffering`
 * dinyalakan tepat saat mulai MEMUTAR (bukan saat jeda/pause, yang memang
 * instan) dan dimatikan begitu `togglePlaying()` selesai, dengan `isPlaying`
 * juga dipantau terpisah (lihat watcher di bawah) sebagai jaring pengaman
 * kalau render selesai lebih lambat dari promise-nya.
 */
const audioBuffering = ref(false)

async function onAudioPlayClick(): Promise<void> {
  if (quran.markingStart && !quran.markingComplete) {
    flash('Silakan tap ayat akhir')
    return
  }
  const starting = !quran.isPlaying
  if (starting) audioBuffering.value = true
  try {
    await quran.togglePlaying()
    if (quran.audioError) flash(quran.audioError)
  } finally {
    audioBuffering.value = false
  }
}

// Jaring pengaman: begitu audio benar-benar berhenti (pause/stop), pastikan
// indikator loading ikut padam, meski karena alasan apa pun belum sempat
// dimatikan oleh `onAudioPlayClick`.
watch(
  () => quran.isPlaying,
  (playing) => {
    if (!playing) audioBuffering.value = false
  },
)

/**
 * Nomor halaman (di dua tempat: dalam bar terbuka & bulatan berdiri sendiri
 * saat bar tertutup) punya tiga fungsi tergantung mode, dicek berurutan:
 *  - Mode Setting Audio aktif → keluar dari mode setting (kembali ke bar
 *    menu utama). Bulatan ini TETAP menampilkan nomor halaman selama mode
 *    ini (lihat `pageCircleIcon()`), jadi tombolnya terlihat sama seperti
 *    mode normal — cuma fungsinya "kembali ke menu" alih-alih "buka/tutup
 *    menu".
 *  - Mode Audio aktif (tanpa settings) → kontrol play/pause (lihat `onAudioPlayClick`).
 *  - Selain itu → toggle buka/tutup menu lewat TEKAN-TAHAN (lihat
 *    `onPageCirclePointerDown`) — ketukan singkat di luar dua mode di atas
 *    sengaja diabaikan di sini.
 * Setting Audio dicek LEBIH DULU karena kedua mode bisa aktif bersamaan
 * (Audio tetap nyala di belakang layar selagi user membuka Setting Audio).
 *
 * §7 revisi 3: klik ini dibatalkan (early return) kalau hold BARU SAJA
 * men-trigger toggle menu (lihat `suppressNextClick` & `onPageCirclePointerUp`)
 * — supaya satu aksi "tekan-tahan lalu lepas" tidak dihitung dobel sebagai
 * hold (buka/tutup menu) DAN klik (play/pause atau keluar setting).
 */
function onPageCircleClick(): void {
  if (suppressNextClick) {
    suppressNextClick = false
    return
  }
  if (quran.audioSettingsOpen) {
    onToggleAudioSettings()
    return
  }
  if (quran.audioMenuOpen) {
    void onAudioPlayClick()
    return
  }
  // Tidak melakukan apa-apa: buka/tutup menu sekarang lewat hold, bukan klik.
}

/** Lama tekan-tahan (ms) sebelum menu dianggap "di-hold" dan toggle terjadi. */
const HOLD_MS = 450
let holdTimer: number | null = null

/**
 * Begitu timer hold BERHASIL men-trigger `toggleMenu()` (lihat
 * `onPageCirclePointerDown`), flag ini diset true supaya event `click` native
 * yang menyusul setelah jari diangkat (pointerup → click, dua jalur event
 * terpisah di browser/webview) DIABAIKAN sekali — mencegah hold dan klik
 * sama-sama memicu aksi untuk satu tekan-tahan yang sama (§7 revisi 2:
 * "timer hold dibatalkan begitu toggle oleh timer terjadi, supaya tidak
 * dobel trigger klik setelahnya"). Direset begitu dipakai sekali di
 * `onPageCircleClick`.
 */
let suppressNextClick = false

function clearHoldTimer(): void {
  if (holdTimer != null) {
    window.clearTimeout(holdTimer)
    holdTimer = null
  }
}

/**
 * Mulai hitung tekan-tahan begitu jari/pointer menyentuh nomor halaman.
 *
 * §7 revisi 3: PERBAIKAN BUG — pada revisi 2, komentar sudah menyatakan hold
 * harus aktif di SEMUA kondisi (termasuk mode Audio & Setting Audio), tapi
 * baris kode `if (quran.audioSettingsOpen || quran.audioMenuOpen) return`
 * yang menonaktifkannya di kedua mode itu TIDAK PERNAH benar-benar dihapus —
 * jadi hold selama ini tetap mati di mode Audio/Setting, berlawanan dengan
 * yang diklaim komentar. Itulah sebabnya tekan-tahan untuk buka/tutup bottom
 * menu tidak berfungsi saat audio menyala. Guard itu sekarang BENAR-BENAR
 * dihapus: hold selalu mulai menghitung begitu jari menyentuh, di mode apa
 * pun. Ini tetap aman untuk ketukan singkat (play/pause, atau kembali ke
 * menu dari Setting Audio): kalau jari lepas sebelum `HOLD_MS` tercapai,
 * `onPageCirclePointerUp` membatalkan timer ini lebih dulu, sehingga
 * `toggleMenu()` tidak sempat terpanggil dan event `click` native tetap
 * berjalan normal lewat `onPageCircleClick`. Hold hanya "menang" kalau jari
 * benar-benar ditahan sampai `HOLD_MS`.
 */
function onPageCirclePointerDown(): void {
  clearHoldTimer()
  holdTimer = window.setTimeout(() => {
    holdTimer = null
    suppressNextClick = true
    toggleMenu()
  }, HOLD_MS)
}

/** Jari/pointer lepas sebelum batas waktu tercapai → batal, dianggap tak terjadi apa-apa. */
function onPageCirclePointerUp(): void {
  clearHoldTimer()
}

/** Label aksesibilitas nomor halaman, menyesuaikan fungsi di atas. */
function pageCircleLabel(expanded: boolean): string {
  if (quran.audioSettingsOpen) {
    return `Halaman ${quran.currentPage}. Ketuk untuk kembali ke menu, tekan-tahan untuk menutup menu`
  }
  if (quran.audioMenuOpen) {
    const action = quran.isPlaying
      ? 'Jeda audio'
      : quran.markingComplete
        ? 'Putar rentang ayat yang ditandai'
        : `Putar halaman ${quran.currentPage}`
    return `${action}. Tekan-tahan untuk ${expanded ? 'menutup' : 'membuka'} menu`
  }
  return expanded
    ? `Halaman ${quran.currentPage}. Tekan-tahan untuk menutup menu`
    : `Halaman ${quran.currentPage} dari ${TOTAL_PAGES}. Tekan-tahan untuk membuka menu`
}

/**
 * Isi ikon di dalam bulatan nomor halaman.
 *
 * Revisi: saat panel Setting Audio terbuka, bulatan TIDAK lagi menampilkan
 * ikon gear — tetap menampilkan NOMOR HALAMAN biasa (return null di sini),
 * supaya tombolnya terlihat identik dengan mode normal dan jelas berfungsi
 * sebagai "kembali ke menu utama" (lihat `onPageCircleClick`), bukan sebagai
 * indikator "lagi di setting".
 */
function pageCircleIcon(): string | null {
  if (quran.audioMenuOpen && !quran.audioSettingsOpen) return quran.isPlaying ? iconPause : iconPlay
  return null // null = tampilkan angka nomor halaman, bukan ikon
}

/**
 * Pindah halaman dengan transisi yang utuh.
 */
const settling = ref(false)
let settleResolve: (() => void) | null = null

/** Dipanggil MushafPageView setiap kali penataan halaman selesai. */
function onPageSettled(): void {
  settleResolve?.()
  settleResolve = null
}

/** Tunggu penataan halaman, dengan batas waktu supaya tidak pernah menggantung. */
function waitForSettle(timeout = 1500): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      resolve()
    }
    settleResolve = finish
    window.setTimeout(finish, timeout)
  })
}

let turning = false

async function turn(dir: 'next' | 'prev'): Promise<void> {
  if (turning) return

  const atEdge =
    (dir === 'next' && quran.currentPage >= TOTAL_PAGES) ||
    (dir === 'prev' && quran.currentPage <= 1)
  if (atEdge) return

  turning = true
  try {
    // 1. Halaman lama memudar sampai benar-benar tak terlihat.
    settling.value = true
    await nextTick()
    await sleep(FADE_OUT_MS)

    // 2. Ganti isi HANYA saat stage sudah transparan, dan pasang penunggu
    //    penataan SEBELUM ganti — kalau dipasang sesudahnya, sinyal selesai
    //    bisa terlewat dan tampilan menunggu habis batas waktu.
    const settled = waitForSettle()
    if (dir === 'next') await quran.nextPage()
    else await quran.prevPage()
    await settled

    // 3. Baru sekarang, ketika ukuran teks sudah final, halaman ditampilkan.
    settling.value = false
    animating.value = dir
    await new Promise((r) => window.setTimeout(r, TURN_MS))
    animating.value = null

    // Pindah halaman pertama kali: kedipkan nomor halaman sekali sebagai petunjuk
    // bahwa itu tombol menu.
    if (!hintAlreadyShown()) {
      markHintShown()
      notchHint.value = true
    }
  } finally {
    turning = false
  }
}

/** Lama animasi masuk; harus sama dengan durasi keyframe di CSS. */
const TURN_MS = 320

/** Lama halaman lama memudar; harus sama dengan transisi `.stage.settling`. */
const FADE_OUT_MS = 160

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

async function goVerse(surah: number, ayah: number): Promise<void> {
  await quran.goToVerse(surah, ayah)
  sheet.value = null
  closeMenu()
}

async function goPage(page: number): Promise<void> {
  await quran.goToPage(page)
  sheet.value = null
  closeMenu()
}

</script>

<template>
  <main
    class="reader no-select"
    @touchstart.passive="onTouchStart"
    @touchend.passive="onTouchEnd"
    @click="onClick"
  >
    <!--
      Baris atas: satu deret pills.
      Pills surah (kiri, geser sedikit ke kanan) dan juz (kanan, geser sedikit ke kiri)
      agar tidak terlalu mepet ke tepi.
    -->
    <QuickPills
      class="top-bar safe-top"
      gutter
      :surah-label="surahLabelArabic"
      :juz-label="juzLabelArabic"
      :sheet-label="juzSheetArabic"
      :surah-aria="`Surah ${surahLabelLatin}. Ketuk untuk lompat ke ayat`"
      :juz-aria="`Juz ${quran.currentJuz ?? ''}, halaman ke-${quran.currentJuzSheet ?? ''} di juz ini. Ketuk untuk lompat ke juz`"
      @surah="sheet = 'verse'"
      @juz="sheet = 'juz'"
    />

    <!-- Indikator audio: muncul di antara pills Juz & Surah selama mode Audio
         aktif. TANPA pill pembungkus dan TANPA tulisan "Ayat" — badge
         oranye hanya berisi ANGKA ayat yang SEDANG DIPUTAR
         (`currentPlayingAyahNumber`), mengikuti progres audio secara
         otomatis.

         Dua keadaan dirender sebagai elemen YANG BENAR-BENAR BERBEDA
         (bukan sekadar dibekukan lewat CSS class seperti sebelumnya, yang
         ternyata bisa membuat wave terlihat diam/tidak jelas statusnya):
          - SEDANG MEMUTAR (`quran.isPlaying`) → batang wave, animasi satu
            siklus penuh 4 detik (`waveform`, lihat CSS), diulang terus
            menerus TANPA JEDA selama masih playing.
          - BELUM MULAI / SEDANG DIJEDA → cukup "...." statis, menandai
            audio siap tapi belum/tidak sedang bersuara. -->
    <Transition name="fade">
      <button
        v-if="quran.audioMenuOpen"
        type="button"
        class="audio-indicator safe-top"
        :class="{ clickable: !!quran.currentPlayingVerseKey }"
        aria-label="Lompat ke halaman ayat yang sedang diputar"
        @click.stop="onAudioIndicatorClick"
      >
        <span v-if="currentPlayingAyahNumber" class="ayah-badge" aria-hidden="true">
          <span class="ayah-badge-num">{{ currentPlayingAyahNumber }}</span>
        </span>
        <span v-if="quran.isPlaying" class="sound-wave" aria-hidden="true">
          <span
            v-for="n in JUMLAH_BATANG_WAVE"
            :key="n"
            class="wave-bar"
            :style="{ transform: `scaleY(${waveScales[n - 1]})` }"
          ></span>
        </span>
        <span v-else class="sound-wave" aria-hidden="true">
          <span v-for="n in JUMLAH_BATANG_WAVE" :key="n" class="wave-bar idle"></span>
        </span>
      </button>
    </Transition>

    <div class="stage" :class="[animating ? `turn-${animating}` : '', settling ? 'settling' : '']">
      <MushafPageView
        v-if="quran.page"
        :page="quran.page"
        :lines-per-page="15"
        :surahs="quran.surahs"
        :highlight-verse-key="quran.currentVerseKey"
        :marks="readerMarks"
        :markable="highlightArmed"
        :audio-mode="quran.audioMenuOpen"
        :audio-range-verses="quran.audioRangeVerses"
        :audio-marking="!!quran.markingStart && !quran.markingComplete"
        :audio-mark-start="quran.markingStart"
        :audio-mark-end="quran.markingEnd"
        :audio-session-active="quran.audioSessionActive"
        :audio-played-verses="quran.audioPlayedVerses"
        :audio-active-verse="quran.currentPlayingVerseKey"
        :audio-next-verse="quran.crossfadeTargetVerseKey"
        @word-tap="onWordTap"
        @ayah-tap="onAyahTap"
        @settled="onPageSettled"
      />
      <p v-else-if="quran.loadError" class="state error">{{ quran.loadError }}</p>
      <p v-else class="state">Memuat mushaf...</p>
    </div>

    <!--
      Dim layar HANYA saat menandai ayat (§2 revisi 2) — tidak lagi dim
      global di sini. MushafPageView.vue sudah punya overlay dim sendiri
      (`.marking-dim-overlay`, dikontrol prop `audio-marking` yang sudah
      benar: nyala hanya saat markingStart ada & markingComplete belum,
      otomatis mati begitu rentang lengkap/audio play) — dim global di
      level ini dulu salah kondisi (nyala selama audioMenuOpen, termasuk
      saat sedang play) dan dobel dengan dim internal itu, jadi dihapus.
    -->

    <!--
      Bar bawah tunggal (menggantikan menu 3-atas + 2-bawah lama): tertutup ia
      hanya berupa bulatan nomor halaman; ketuk untuk membuka lima ikon
      sekaligus (stabilo · memorize · nomor halaman · reminder · darkmode),
      dengan bulatan nomor halaman tetap di tengah, terangkat di atas bar.
      Memorize diberi aksen oranye karena menu ini yang paling sering dipakai.
    -->
    <Transition name="fade">
      <p v-if="notice" class="notice safe-bottom" role="status">{{ notice }}</p>
    </Transition>

    <div class="bottom-bar safe-bottom" :class="{ open: menuOpen }" @touchend.stop>
      <!--
        Panel Setting Audio: menggantikan TOTAL isi bar normal (bukan salah
        satu item di dalamnya) selama audioSettingsOpen. Tampil kapan pun
        menuOpen true, lepas dari status audioMenuOpen — user bisa membuka
        Setting Audio langsung dari bar biasa tanpa harus mengaktifkan mode
        Audio dulu (qari/tempo/ulangi adalah setelan, bukan kontrol pemutaran).

        §redesign-2: qari sekarang jadi pil FLEKSIBEL (mengisi sisa ruang,
        bukan lebar tetap 8.4rem) supaya 4 slot (qari | nomor halaman | tempo
        | ulangi) selalu muat pas di dalam bar tanpa overflow — lebar tetap
        sebelumnya membuat total lebar melebihi bar di layar sempit sehingga
        Tempo/Ulangi terdorong keluar dan tampak hilang. Tempo & Ulangi kini
        juga memakai ikon (gauge & repeat) di atas nilainya, sejajar secara
        visual dengan gaya tombol lain di bar.
      -->
      <Transition name="fade">
        <div v-if="menuOpen && quran.audioSettingsOpen" class="bar-row-scroll settings">
          <div class="bar-row settings-row">
            <!-- Qari: pil fleksibel, mengisi sisa ruang di sebelah kiri -->
            <button
              type="button"
              class="bar-item qari-item"
              aria-haspopup="dialog"
              :aria-label="`Qari: ${quran.reciters.find((r) => String(r.id) === quran.audioQari)?.name ?? 'Pilih qari'}. Ketuk untuk memilih`"
              @click.stop="qariPickerOpen = true"
            >
              <span class="bar-icon wide">
                {{ quran.reciters.find((r) => String(r.id) === quran.audioQari)?.name ?? (quran.reciters.length ? 'Pilih qari' : 'Memuat...') }}
              </span>
              <span class="bar-label">Qari</span>
            </button>

            <!--
              Placeholder kosong: cuma menjaga jarak (gap) di tempat tombol
              page-circle mengambang (SATU elemen, lihat markup setelah
              penutup div `.bottom-bar`) — bulatan yang mengambang di sini
              sekarang menampilkan NOMOR HALAMAN (bukan gear) dan berfungsi
              sebagai tombol kembali ke menu utama (lihat `pageCircleIcon`
              & `onPageCircleClick`).
            -->
            <div class="bar-item page-circle-slot" aria-hidden="true"></div>

            <!-- Tempo: bulatan bar-icon dengan ikon gauge + nilai tempo -->
            <div class="bar-item">
              <button
                type="button"
                class="bar-icon"
                aria-label="Tempo pemutaran"
                @click.stop="onTempoClick"
              >
                <span aria-hidden="true" class="bar-icon-glyph" v-html="iconTempo" />
                <span class="bar-icon-value">{{ quran.audioTempo }}x</span>
              </button>
              <span class="bar-label">Tempo</span>
            </div>

            <!-- Ulangi: bulatan bar-icon dengan ikon repeat + nilai ulangi -->
            <div class="bar-item">
              <button
                type="button"
                class="bar-icon"
                aria-label="Ulangi"
                @click.stop="quran.cycleAudioRepeat"
              >
                <span aria-hidden="true" class="bar-icon-glyph" v-html="iconRepeat" />
                <span class="bar-icon-value">{{ quran.audioRepeat }}x</span>
              </button>
              <span class="bar-label">Ulangi</span>
            </div>
          </div>
        </div>
      </Transition>

      <Transition name="fade">
        <!--
          §bottom-menu revisi 3: bar-row sekarang berisi 8 slot = 6 ikon + 2
          placeholder page-circle-slot, dibagi PERSIS jadi dua grup 4-slot:
            Grup 1 (terlihat saat scroll di posisi awal):
              stabilo · memorize · [slot nomor halaman] · audio
            Grup 2 (terlihat setelah digeser ke kanan):
              reminder · [slot nomor halaman] · tema · setting audio
          Dulu cuma ADA SATU slot (antara memorize & audio), jadi saat
          digeser ke posisi kedua, nomor halaman (yang mengambang tetap di
          tengah viewport, lihat `.page-circle.floating`) malah menimpa
          salah satu ikon asli (reminder jadi tertutup) karena tidak ada
          "lubang" yang disediakan di sana. Slot kedua ini menyediakan lubang
          itu, persis sebelum tema — sehingga nomor halaman selalu jatuh di
          ATAS SEBUAH SLOT KOSONG, bukan di atas ikon, di KEDUA posisi.
          `scroll-snap` (lihat `.bar-row-scroll`) + class `snap-start` pada
          item pertama tiap grup (stabilo, reminder) memastikan swipe/scroll
          selalu berhenti TEPAT di salah satu dari dua grup ini, tidak pernah
          berhenti di posisi tanggung di antaranya.
        -->
        <div v-if="menuOpen && !quran.audioSettingsOpen" class="bar-row-scroll">
          <div class="bar-row">
            <div class="bar-item snap-start">
              <button
                type="button"
                class="bar-icon"
                :class="{ on: highlightArmed }"
                :aria-pressed="highlightArmed"
                aria-label="Stabilo. Ketuk lalu ketuk kata untuk mewarnainya"
                @click.stop="toggleHighlight"
              >
                <span aria-hidden="true" v-html="iconHighlighter" />
              </button>
              <span class="bar-label">Stabilo</span>
            </div>
            <div class="bar-item">
              <button
                type="button"
                class="bar-icon accent"
                aria-label="Memorize"
                @click.stop="router.push('/memorize')"
              >
                <span aria-hidden="true" v-html="iconMemorize" />
              </button>
              <span class="bar-label">Memorize</span>
            </div>
            <!--
              Slot kosong GRUP 1 — nomor halaman jatuh di sini (antara
              Memorize & Audio) saat bar baru dibuka / belum digeser.
            -->
            <div class="bar-item page-circle-slot" aria-hidden="true"></div>
            <div class="bar-item">
              <button
                type="button"
                class="bar-icon"
                :class="{ on: quran.audioMenuOpen }"
                :aria-pressed="quran.audioMenuOpen"
                aria-label="Audio"
                @click.stop="onToggleAudioMenu"
              >
                <span aria-hidden="true" v-html="iconAudio" />
              </button>
              <span class="bar-label">Audio</span>
            </div>
            <div class="bar-item snap-start">
              <button
                type="button"
                class="bar-icon"
                :aria-label="remindersAvailable ? 'Reminder' : 'Reminder (terkunci)'"
                @click.stop="router.push('/reminder')"
              >
                <span aria-hidden="true" v-html="remindersAvailable ? iconReminder : iconLock" />
              </button>
              <span class="bar-label">Reminder</span>
            </div>
            <!--
              Slot kosong GRUP 2 — nomor halaman jatuh di sini (antara
              Reminder & Tema) setelah bar digeser ke kanan. Tanpa slot ini,
              Reminder yang akan tertutup bulatan nomor halaman.
            -->
            <div class="bar-item page-circle-slot" aria-hidden="true"></div>
            <div class="bar-item">
              <button
                type="button"
                class="bar-icon"
                :aria-label="`Tema: ${currentThemeLabel}. Ketuk untuk ganti tema`"
                @click.stop="quran.toggleTheme()"
              >
                <span aria-hidden="true" v-html="currentThemeIcon" />
              </button>
              <span class="bar-label">{{ currentThemeLabel }}</span>
            </div>
            <div class="bar-item">
              <button
                type="button"
                class="bar-icon"
                :class="{ on: quran.audioSettingsOpen }"
                :aria-pressed="quran.audioSettingsOpen"
                aria-label="Setting Audio"
                @click.stop="onToggleAudioSettings"
              >
                <span aria-hidden="true" v-html="iconSettingsSlider" />
              </button>
              <span class="bar-label">Setting Audio</span>
            </div>
          </div>
        </div>
      </Transition>

      <!--
        Satu-satunya tombol nomor halaman, dirender SEKALI untuk SEMUA mode
        (bar tertutup, bar biasa terbuka, maupun panel Setting Audio
        terbuka) — posisi absolute, dikunci tengah lewat left:50% +
        translateX(-50%) relatif ke `.bottom-bar` sendiri (bukan sticky
        relatif ke container scroll, dan bukan hasil flex-layout yang bisa
        bergeser kalau kolom kiri/kanannya tidak simetris). Karena cuma ada
        satu elemen, posisinya pasti identik di tiga kondisi sekaligus —
        tidak ada percabangan logic per mode (§1 perbaikan-menu-reader-2.md).

        §7 revisi 3: pointerdown/pointerup (hold) sekarang BENAR-BENAR aktif
        TANPA syarat mode — lihat `onPageCirclePointerDown`. Klik native
        tetap berfungsi sesuai mode (play/pause saat Audio aktif, kembali ke
        menu utama saat Setting Audio aktif), dan dicegah dobel-trigger
        dengan hold lewat `suppressNextClick` (lihat komentar di
        `onPageCircleClick`).
      -->
      <button
        type="button"
        class="page-circle floating"
        :class="{ hint: notchHint && !menuOpen, playing: quran.audioMenuOpen && quran.isPlaying, buffering: audioBuffering }"
        :aria-label="pageCircleLabel(menuOpen)"
        :aria-expanded="menuOpen"
        @click.stop="onPageCircleClick"
        @pointerdown.stop="onPageCirclePointerDown"
        @pointerup.stop="onPageCirclePointerUp"
        @pointercancel.stop="onPageCirclePointerUp"
        @pointerleave.stop="onPageCirclePointerUp"
        @animationend="notchHint = false"
      >
        <span v-if="pageCircleIcon()" class="num" aria-hidden="true" v-html="pageCircleIcon()" />
        <span v-else class="num" aria-hidden="true">{{ toArabicNumber(quran.currentPage) }}</span>
        <!--
          Petunjuk jeda render audio: titik-titik kecil di bawah ikon
          play/pause, muncul hanya selagi audio baru ditekan play dan belum
          benar-benar terdengar (lihat `audioBuffering` di script). Tanpa
          ini tombol terlihat diam/tidak merespons selama jeda decode/fetch.
        -->
        <span v-if="audioBuffering" class="loading-dots" aria-hidden="true">
          <span class="dot"></span>
          <span class="dot"></span>
          <span class="dot"></span>
        </span>
      </button>
    </div>

    <GoToVerseSheet
      v-if="sheet === 'verse'"
      :surahs="quran.surahs"
      :initial-surah="headerSurah?.number"
      @close="sheet = null"
      @go="goVerse"
    />
    <GoToJuzSheet
      v-if="sheet === 'juz'"
      :juz-list="quran.juzList"
      :surahs="quran.surahs"
      :current-juz="quran.currentJuz"
      :current-page="quran.currentPage"
      @close="sheet = null"
      @go-verse="goVerse"
      @go-page="goPage"
    />

    <QariPickerSheet
      v-if="qariPickerOpen"
      :reciters="quran.reciters"
      :selected="quran.audioQari"
      @close="qariPickerOpen = false"
      @pick="quran.setAudioQari"
    />
  </main>
</template>

<style scoped>
.reader {
  position: fixed;
  inset: 0;
  overflow: hidden;
  background: var(--color-paper);
  color: var(--color-ink);
}

.stage {
  position: absolute;
  inset: 0;
  padding-top: calc(3.9rem + var(--safe-top));
  padding-bottom: calc(3.2rem + var(--safe-bottom));
  padding-inline: var(--mushaf-gutter);
  display: flex;
}

.stage.settling {
  opacity: 0;
  transition: opacity 0.16s ease-out;
}

.turn-next,
.turn-prev {
  animation: page-fade-in 0.32s ease-out both;
}

@keyframes page-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.state {
  margin: auto;
  font-size: 0.9rem;
  opacity: 0.7;
}

.state.error {
  color: #b3261e;
}

.top-bar {
  position: absolute;
  z-index: 30;
  top: 0.5rem;
  left: 0;
  right: 0;
}

/* Indikator audio (badge ayat + wave): diselipkan di antara pills juz &
   surah (QuickPills sudah justify-content: space-between), diposisikan
   absolute center di atas top-bar, pada baris yang sama. Dibungkus satu
   pill background supaya badge ayat & wave terlihat sebagai satu kesatuan. */
.audio-indicator {
  position: absolute;
  z-index: 31;
  top: 0.5rem;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 0.45rem;
  height: 1.8rem;
  /* Reset tampilan default <button> — elemen ini dulu <div>, sekarang
     <button> supaya bisa diklik untuk lompat ke halaman audio aktif. */
  border: 0;
  background: transparent;
  padding: 0 0.3rem;
  touch-action: manipulation;
}

.audio-indicator.clickable {
  cursor: pointer;
}

.audio-indicator.clickable:active {
  transform: translateX(-50%) scale(0.95);
}

/* Badge nomor ayat: kotak rounded gradien oranye berisi angka saja (tanpa
   label "Ayat", tanpa pill pembungkus) — isinya mengikuti ayat yang SEDANG
   DIPUTAR (`currentPlayingAyahNumber` di script), jadi otomatis berganti
   seiring audio berpindah ayat. */
.ayah-badge {
  flex: 0 0 auto;
  width: 1.6rem;
  height: 1.6rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 0.6rem;
  background: linear-gradient(to bottom right, #ff8a00, #ffb347);
  box-shadow: 0 3px 8px rgb(255 138 0 / 0.35);
  line-height: 1;
}

/* Dark mode: samakan dengan warna accent yang dipakai ikon aktif/Memorize
   di bottom menu (#ff9d2e), bukan warna oranye terang biasa. */
.dark .ayah-badge {
  background: linear-gradient(to bottom right, #ff9d2e, #ffc066);
  box-shadow: 0 3px 8px rgb(255 157 46 / 0.35);
}

.dark .wave-bar {
  background: linear-gradient(to top, #ff9d2e, #ffc066);
}

.ayah-badge-num {
  font-size: 0.72rem;
  font-weight: 700;
  color: #fff;
}

/* Wave: batang-batang tipis dengan animasi CSS murni `transform: scaleY()`,
   gaya yang sama dengan referensi yang diberikan dan terbukti bergerak di
   berbagai browser/webview — jauh lebih sederhana dan tidak bergantung pada
   custom property atau JavaScript. */
.sound-wave {
  display: flex;
  align-items: center;
  gap: 0.15rem;
  height: 1.3rem;
  pointer-events: none;
}

.wave-bar {
  flex: 0 0 auto;
  width: 0.15rem;
  height: 1.3rem;
  background: linear-gradient(to top, #ff8a00, #ffb347);
  border-radius: 999px;
  transform-origin: center;
  /*
   * §perbaikan-wave-4: tidak lagi pakai `animation`/`@keyframes` CSS —
   * `transform: scaleY(...)` sekarang di-bind langsung dari `waveScales`
   * di script (lihat `waveStep`, rAF loop), supaya kecepatannya tidak bisa
   * ikut "diperas" oleh scaling durasi animasi CSS di environment mana pun.
   * Transition pendek di sini cuma menghaluskan lompatan antar frame rAF
   * (~16ms), bukan mengatur kecepatan wave itu sendiri.
   */
  transition: transform 0.08s linear;
}

@media (prefers-reduced-motion: reduce) {
  .wave-bar {
    transition: none;
  }
}

/* Keadaan belum mulai / sedang dijeda: batang wave yang sama, tapi statis
   pendek semua (bukan lagi titik-titik "...."), supaya bentuknya tetap
   terasa sebagai wave yang sedang "diam", bukan elemen lain. */
.wave-bar.idle {
  transform: scaleY(0.22);
  transition: none;
}

.bottom-bar {
  position: absolute;
  z-index: 30;
  left: calc(var(--mushaf-gutter) + 0.4rem);
  right: calc(var(--mushaf-gutter) + 0.4rem);
  bottom: 0.6rem;
  height: 3.1rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.bar-row-scroll {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  border-radius: 1.55rem;
  border: 1px solid var(--color-paper-edge);
  background: rgb(255 255 255 / 0.92);
  box-shadow: 0 6px 20px rgb(0 0 0 / 0.14);
  backdrop-filter: blur(6px);
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
  /*
   * Scroll-snap: bar-row (lihat komentar di template) berisi dua grup
   * 4-slot persis. Tanpa snap, swipe bisa berhenti di posisi tanggung
   * (misalnya separuh antara grup 1 & grup 2), membuat bulatan nomor
   * halaman yang mengambang tetap di tengah viewport (`.page-circle.
   * floating`) jatuh menimpa SEBAGIAN ikon, bukan pas di slot kosongnya.
   * `scroll-snap-align: start` pada item pertama tiap grup (lihat
   * `.bar-item.snap-start`) memaksa swipe selalu "menempel" ke salah satu
   * dari dua posisi yang benar saja.
   *
   * Catatan: fade/gradient di tepi kanan sebagai penanda "masih ada menu
   * lain" SENGAJA DIHAPUS (dulu lewat mask-image) — bentuk bar sekarang
   * selalu tampil penuh/solid, tanpa indikator transparansi di ujung.
   */
  scroll-snap-type: x mandatory;
}

/* Panel Setting Audio: qari sekarang berlebar TETAP (blok 2-slot, serasi
   dengan Stabilo+Memorize di menu utama), jadi pada layar sempit total
   lebar 4 slot (qari | nomor halaman | tempo | ulangi) bisa melebihi lebar
   bar. Supaya Tempo/Ulangi tidak pernah "hilang" tertutup/terpotong seperti
   sebelumnya, baris ini dibuat scrollable (sama seperti bar menu utama) —
   tidak perlu snap karena cuma satu grup, cukup geser bebas. */
.bar-row-scroll.settings {
  overflow-x: auto;
  scroll-snap-type: none;
}

.bar-row-scroll::-webkit-scrollbar {
  display: none;
}

.bar-row {
  /*
   * §fix-jarak-menu: sebelumnya ada `min-width: 100%` di sini. Di layar
   * yang CUKUP SEMPIT sehingga lebar total 8 slot (dalam rem, jadi ikut
   * mengecil bareng ukuran font root perangkat) kebetulan lebih kecil dari
   * lebar kontainer bar yang tersedia, `min-width: 100%` memaksa bar
   * melebar penuh — tapi karena tidak ada `justify-content` (default
   * flex-start), semua ikon tetap menempel rapat di satu sisi dan SISA
   * RUANG KOSONG menumpuk di ujung lain, bukan tersebar merata. Itu yang
   * kelihatan seperti "jarak antar menu tidak rata": bukan gap antar-ikon
   * yang beda-beda, tapi ada satu blok kosong besar di satu sisi.
   *
   * Fix: bar SELALU selebar kontennya sendiri (`width: max-content` saja,
   * tanpa dipaksa minimal 100%), dan dipusatkan (`margin-inline: auto`)
   * kalau kebetulan lebih sempit dari kontainer. Hasilnya gap antar ikon
   * selalu rata 0.2rem di layar manapun, dan kalaupun ada kelonggaran,
   * kelonggaran itu terbagi rata di KEDUA sisi (tersentris), bukan
   * menumpuk di satu sisi saja.
   */
  width: max-content;
  margin-inline: auto;
  height: 100%;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 0.2rem;
  padding-inline: 0.45rem;
}

/* Panel Setting Audio pakai struktur `.bar-row` yang sama persis dengan
   menu utama, hanya isinya beda (qari/tempo/ulangi, bukan 6 ikon). `width:
   100%` (bukan `max-content`) karena isinya cuma 4 slot dan harus pas
   mengisi lebar bar, tidak overflow. */
.settings-row {
  width: 100%;
}

/*
 * Qari: pil dengan lebar TETAP yang setara gabungan 2 slot ikon biasa —
 * blok yang sama persis seperti Stabilo + Memorize yang digabung jadi satu
 * area di bar menu utama (2 × 4.1rem bar-item + 1 gap di antaranya =
 * 8.4rem), supaya ritme visual Setting Audio serasi dengan bar menu utama.
 * Dulu sempat dibuat fleksibel (menyusut otomatis) untuk menghindari
 * overflow, tapi itu membuat lebarnya tidak konsisten dengan blok ikon
 * lain — sekarang overflow ditangani lewat scroll di `.bar-row-scroll.
 * settings` (lihat di bawah), bukan dengan menyusutkan qari.
 */
.bar-item.qari-item {
  flex: 0 0 8.4rem;
  width: 8.4rem;
}

.bar-icon.wide {
  width: 100%;
  height: 2rem;
  border-radius: 999px;
  font-size: 0.68rem;
  font-weight: 600;
  padding: 0 0.7rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  background: color-mix(in srgb, var(--color-ink) 9%, transparent);
  box-sizing: border-box;
}

.dark .bar-icon.wide {
  background: color-mix(in srgb, var(--color-night-ink) 14%, transparent);
}

/*
 * Placeholder kosong — cuma menjaga jarak di tempat yang dulu diisi tombol
 * page-circle sendiri. Lebarnya ikut `.bar-item` (4.1rem, sama seperti ikon
 * lain) di KEDUA konteks (bar-row menu utama maupun settings-row) supaya
 * tombol page-circle yang mengambang di atasnya selalu jatuh pas di tengah
 * slot kosong, bukan menimpa ikon/label di kiri-kanannya.
 */
.page-circle-slot {
  flex: 0 0 0;
  width: 0;
  min-width: 0;
}

.bar-item {
  /* Lebar tetap (bukan flex:1 1 0) — supaya ikon tidak dipadatkan untuk
     memaksa 6 item muat sekaligus. Dengan lebar tetap, total lebar 6 item
     otomatis melebihi lebar bar pada layar HP biasa, sehingga hanya ~4 yang
     terlihat dan 2 sisanya baru muncul lewat scroll/swipe ke kanan. */
  flex: 0 0 4.1rem;
  width: 4.1rem;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.14rem;
  border: 0;
  background: transparent;
  padding: 0;
}

.bar-item.page-circle-slot {
  flex: 0 0 4.1rem;
  width: 4.1rem;
}

.bar-item.snap-start {
  scroll-snap-align: start;
}

.bar-label {
  font-size: 0.56rem;
  line-height: 1;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-ink);
  opacity: 0.62;
}

.bar-icon {
  flex: 0 0 auto;
  width: 2rem;
  height: 2rem;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.05rem;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--color-ink);
  opacity: 0.72;
  font-size: 0.68rem;
  font-weight: 600;
  touch-action: manipulation;
  transition:
    transform 0.15s ease,
    background-color 0.2s ease,
    opacity 0.2s ease;
}

.bar-icon:active {
  transform: scale(0.92);
}

.bar-icon :deep(svg) {
  width: 1.2rem;
  height: 1.2rem;
}

/* Tempo & Ulangi: ikon kecil + nilai teks di bawahnya, dalam satu bulatan
   bar-icon yang sedikit lebih besar supaya muat keduanya. */
.bar-icon-glyph :deep(svg),
.bar-icon-glyph {
  width: 1rem;
  height: 1rem;
}

.bar-icon:has(.bar-icon-glyph) {
  width: 2.3rem;
  height: 2.3rem;
  font-size: 0.56rem;
}

.bar-icon-value {
  line-height: 1;
}

.bar-icon.on {
  opacity: 1;
  color: #ff8a00;
  background: color-mix(in srgb, #ff8a00 16%, transparent);
}

.bar-icon.accent {
  opacity: 1;
  color: #ff8a00;
  background: color-mix(in srgb, #ff8a00 14%, transparent);
}

.page-circle {
  flex: 0 0 auto;
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
  touch-action: manipulation;
  transition: transform 0.15s ease, background-color 0.2s ease;
}

/*
 * Satu-satunya tombol page-circle (§1 revisi 2): mengambang di tengah
 * `.bottom-bar` (yang sudah `position: absolute`, jadi ini jadi containing
 * block-nya), tidak ikut flex-layout bar-row/settings-row sama sekali.
 * Posisi ini sama persis baik bar tertutup, bar biasa terbuka, maupun saat
 * panel Setting Audio terbuka — tidak ada mekanisme berbeda per mode.
 * z-index di atas `.bar-row-scroll` (yang tak ber-z / auto) supaya selalu
 * tampak di atas panel mana pun yang sedang terbuka.
 */
.page-circle.floating {
  position: absolute;
  z-index: 35;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
}

.page-circle.floating:active {
  transform: translate(-50%, -50%) scale(0.94);
}

.page-circle .num {
  font-family: var(--font-mushaf);
  font-size: 1.15rem;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.page-circle .num :deep(svg) {
  width: 1.3rem;
  height: 1.3rem;
}

.page-circle.playing {
  color: #2e7d32;
  border-color: color-mix(in srgb, #2e7d32 55%, var(--color-paper-edge));
}

.dark .page-circle.playing {
  color: #66bb6a;
  border-color: color-mix(in srgb, #66bb6a 55%, var(--color-night-ink));
}

.page-circle.hint {
  animation: circle-hint 1.5s cubic-bezier(0.3, 0.7, 0.3, 1) 1;
}

/*
 * Saat `audioBuffering` aktif, ikon play/pause digeser sedikit ke atas
 * supaya ada ruang untuk titik-titik loading di bawahnya tanpa membuat
 * bulatan nomor halaman harus membesar.
 */
.page-circle.buffering .num {
  transform: translateY(-0.32rem);
}

.loading-dots {
  position: absolute;
  left: 50%;
  bottom: 0.5rem;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 0.16rem;
  pointer-events: none;
}

.loading-dots .dot {
  width: 0.2rem;
  height: 0.2rem;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.35;
  animation: loading-dot-pulse 1s ease-in-out infinite;
}

.loading-dots .dot:nth-child(2) {
  animation-delay: 0.15s;
}

.loading-dots .dot:nth-child(3) {
  animation-delay: 0.3s;
}

@keyframes loading-dot-pulse {
  0%, 80%, 100% { opacity: 0.25; transform: scale(0.8); }
  40% { opacity: 1; transform: scale(1.15); }
}

/*
 * Tombol page-circle sekarang selalu posisi absolute tengah lewat
 * translate(-50%, -50%) (lihat `.page-circle.floating`), jadi tiap keyframe
 * di sini HARUS menyertakan offset itu juga — kalau cuma translateY(...)
 * seperti dulu, animasi akan menimpa transform dasarnya dan tombol melompat
 * keluar dari posisi tengah selama animasi berlangsung.
 */
@keyframes circle-hint {
  0%, 100% { transform: translate(-50%, -50%) translateY(0); }
  28% { transform: translate(-50%, -50%) translateY(-0.5rem); }
  48% { transform: translate(-50%, -50%) translateY(-0.15rem); }
  68% { transform: translate(-50%, -50%) translateY(-0.4rem); }
}

.notice {
  position: absolute;
  z-index: 40;
  left: 50%;
  bottom: 3.6rem;
  transform: translateX(-50%);
  margin: 0;
  padding: 0.45rem 0.85rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-ink) 82%, transparent);
  color: var(--color-paper);
  font-size: 0.72rem;
  white-space: nowrap;
  pointer-events: none;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.22s cubic-bezier(0.4, 0, 0.2, 1);
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.dark .reader {
  background: var(--color-night);
  color: var(--color-night-ink);
}

.dark .bar-row-scroll {
  border-color: var(--color-night-edge);
  background: rgb(28 30 34 / 0.92);
  box-shadow: 0 6px 20px rgb(0 0 0 / 0.45);
}

.dark .bar-icon {
  color: var(--color-night-ink);
}

.dark .bar-icon.on,
.dark .bar-icon.accent {
  color: #ff9d2e;
  background: color-mix(in srgb, #ff9d2e 18%, transparent);
}

.dark .page-circle {
  border-color: color-mix(in srgb, var(--color-night-ink) 24%, transparent);
  background: var(--color-night);
  color: var(--color-night-ink);
  box-shadow: 0 6px 16px rgb(0 0 0 / 0.55);
}

.dark .bar-label {
  color: var(--color-night-ink);
}

.dark .notice {
  background: color-mix(in srgb, var(--color-night-ink) 86%, transparent);
  color: var(--color-night);
}

</style>