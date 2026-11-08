/**
 * State utama aplikasi: posisi baca, tema, mark, dan setelan memorize.
 * Semua yang perlu bertahan antar sesi ditulis ke storage lokal (§5.2).
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import * as storage from '@/services/storage'
import { fetchReciters, resolveAyahAudio, type Reciter } from '@/services/quranAudio'
import {
  buildMemorizeLines,
  ensureMushafLoaded,
  expandVerseRange,
  findPageOfJuz,
  findPageOfVerse,
  getJuzList,
  getPage,
  getSurahs,
  groupPageVerses,
} from '@/services/mushafData'
import {
  MAX_MARKS_PER_PAGE,
  TOTAL_PAGES,
  type HelperVerse,
  type Juz,
  type Mark,
  type MarkShape,
  type MemorizeLine,
  type MemorizeSettings,
  type MushafPage,
  type PageVerse,
  type Surah,
  type ThemeMode,
} from '@/types'

const DEFAULT_MEMORIZE: MemorizeSettings = { wordsShown: 2, versesPerView: 5 }

/**
 * Nama qari default yang dicoba auto-pilih pada pemutaran pertama, kalau user
 * belum pernah memilih qari sendiri (§5 perbaikan-menu-reader-2.md). Dicocokkan
 * via regex terhadap nama reciter (bukan index tetap), karena urutan daftar
 * dari API tidak dijamin stabil antar pemanggilan/waktu. Beberapa varian ejaan
 * disertakan karena API bisa memakai salah satunya.
 */
const DEFAULT_QARI_NAME_PATTERN = /misyari|mishari|alafasy/i

export const useQuranStore = defineStore('quran', () => {
  const ready = ref(false)
  const loadError = ref<string | null>(null)
  const storageError = ref<string | null>(null)

  const theme = ref<ThemeMode>('light')
  const currentPage = ref(1)
  const currentVerseKey = ref<string | null>(null)

  const readingSource = ref<'normal' | 'reminder'>('normal')

  const page = ref<MushafPage | null>(null)
  const surahs = ref<Surah[]>([])
  const juzList = ref<Juz[]>([])
  const marks = ref<Mark[]>([])
  const helpers = ref<HelperVerse[]>([])
  const memorize = ref<MemorizeSettings>({ ...DEFAULT_MEMORIZE })

  const verses = computed<PageVerse[]>(() => (page.value ? groupPageVerses(page.value) : []))

  const memorizeLines = computed<MemorizeLine[]>(() => {
    if (!page.value) return []
    const picks = helpers.value
      .filter((h) => h.page === currentPage.value)
      .map((h) => ({
        id: h.id,
        verseKey: h.verseKey,
        wordsShown: h.wordsShown,
        wordOffset: h.wordOffset ?? 0,
      }))
    return buildMemorizeLines(page.value, surahs.value, {
      wordsShown: memorize.value.wordsShown,
      picks,
    })
  })

  const helpersOnPage = computed<HelperVerse[]>(() =>
    helpers.value.filter((h) => h.page === currentPage.value),
  )

  const surahsOnPage = computed<Surah[]>(() => {
    if (!page.value) return []
    return page.value.surahs
      .map((n) => surahs.value.find((s) => s.number === n))
      .filter((s): s is Surah => Boolean(s))
  })

  const JUZ_START_PAGE_OVERRIDE: Record<number, number> = { 1: 2, 7: 122, 11: 202 }

  function juzStartPage(j: Juz): number | null {
    if (j.pageStart == null) return null
    return JUZ_START_PAGE_OVERRIDE[j.number] ?? j.pageStart
  }

  const currentJuzInfo = computed<Juz | null>(() => {
    const p = currentPage.value
    let found: Juz | null = null
    for (const j of juzList.value) {
      const start = juzStartPage(j)
      if (start == null) continue
      if (p >= start && (!found || j.number > found.number)) found = j
    }
    return found
  })

  const currentJuz = computed<number | null>(() => currentJuzInfo.value?.number ?? null)

  const currentJuzSheet = computed<number | null>(() => {
    const j = currentJuzInfo.value
    if (!j) return null
    const start = juzStartPage(j)
    if (start == null) return null
    return currentPage.value - start + 1
  })

  const marksOnPage = computed<Mark[]>(() => marks.value.filter((m) => m.page === currentPage.value))

  const canAddMark = computed(() => marksOnPage.value.length < MAX_MARKS_PER_PAGE)

  /* ------------------------------------------------------------ mode Audio
   *
   * State ini sengaja ditaruh di store (bukan lokal QuranReader.vue) supaya
   * "mode Audio tetap nyala sampai user klik ulang ikon Audio" bertahan
   * walau pengguna pindah halaman atau route lain (sesuai spesifikasi), dan
   * ini SEKALIGUS menjawab pertanyaan "bagaimana kalau user pindah halaman
   * waktu baru set ayat awal": karena markingStart/markingEnd ada di store
   * (bukan di-reset oleh loadPage/goToPage), rentang yang baru separuh
   * ditandai tetap "pending" apa pun halaman yang sedang dibuka, sampai
   * ayat akhir ditekan-lama (di halaman manapun) atau mode Audio dimatikan.
   */
  const audioMenuOpen = ref(false)
  const audioSettingsOpen = ref(false)

  const markingStart = ref<string | null>(null)
  const markingEnd = ref<string | null>(null)

  const audioRangeVerses = ref<string[]>([])

  const isPlaying = ref(false)

  const markingComplete = computed(() => Boolean(markingStart.value && markingEnd.value))

  const audioQari = ref<string | null>(null)
  const audioTempo = ref<number>(1)

  /**
   * Jumlah pengulangan pemutaran (rentang ayat atau satu halaman penuh)
   * sebelum pemutaran benar-benar berhenti. 1 = tanpa pengulangan (default).
   * Opsi siklik: 1x, 2x, 3x, 4x (lihat REPEAT_OPTIONS & cycleAudioRepeat).
   */
  const audioRepeat = ref<number>(1)

  const REPEAT_OPTIONS = [1, 3, 5, 10, 15] as const

  /**
   * Penghitung sisa pengulangan untuk SESI pemutaran yang sedang berjalan.
   * Sengaja non-reaktif (bukan ref) — sama pola dengan elA/elB/playlist
   * internal: cuma dipakai sebagai state kontrol di dalam onActiveEnded,
   * tidak pernah dibaca langsung oleh UI (UI pakai audioRepeat sebagai
   * "setelan", bukan ini sebagai "sisa saat ini").
   */
  let repeatsRemaining = 1

  /** Daftar qari dari UmmahAPI (lihat services/quranAudio.ts) — dimuat sekali, di-cache di modul itu sendiri. */
  const reciters = ref<Reciter[]>([])
  const audioLoading = ref(false)
  const audioError = ref<string | null>(null)
  /** verseKey yang SEDANG diputar dalam playlist saat ini — null kalau tidak sedang play. */
  const currentPlayingVerseKey = ref<string | null>(null)

  /**
   * Muat daftar qari (sekali saja — hasil di-cache di modul ini lewat guard
   * `reciters.value.length` di bawah). Begitu fetch sukses DAN user belum
   * pernah memilih/menyimpan qari sendiri (`audioQari` masih kosong), coba
   * auto-pilih qari yang namanya cocok `DEFAULT_QARI_NAME_PATTERN` (Misyari
   * Rasyid Al-Afasy — qari paling umum), supaya user bisa langsung play
   * tanpa wajib membuka Setting Audio dulu (§5 perbaikan-menu-reader-2.md).
   *
   * - Dicari lewat nama (regex), bukan index tetap, karena urutan API tidak
   *   dijamin stabil.
   * - Pilihan ini ikut di-`persistAudioSettings()` seperti pilihan manual,
   *   supaya tersimpan dan tidak diulang pada load berikutnya (pada load
   *   berikutnya `audioQari` sudah terisi dari storage, jadi guard di bawah
   *   otomatis mencegah override).
   * - Kalau nama itu tidak ditemukan di daftar (API berubah), `audioQari`
   *   dibiarkan tetap null seperti semula — fallback ke pesan
   *   "Pilih qari dulu di Setting Audio" pada `togglePlaying()`.
   */
  async function loadReciters(): Promise<void> {
    if (reciters.value.length) return
    try {
      reciters.value = await fetchReciters()
    } catch (err) {
      audioError.value = err instanceof Error ? err.message : String(err)
      return
    }

    if (!audioQari.value && reciters.value.length) {
      const defaultQari = reciters.value.find((r) => DEFAULT_QARI_NAME_PATTERN.test(r.name))
      if (defaultQari) {
        audioQari.value = String(defaultQari.id)
        persistAudioSettings()
      }
    }
  }

  /*
   * Elemen <audio> (elA/elB, dideklarasikan di bawah dekat mesin crossfade)
   * & playlist TIDAK reaktif (bukan ref) — cukup state JS modul, karena
   * isinya cuma dibaca lewat efek samping (play/pause), tidak pernah
   * dirender langsung. isPlaying & currentPlayingVerseKey (di atas) adalah
   * "proyeksi" reaktifnya untuk UI.
   */
  /**
   * Reaktif (beda dari versi sebelumnya) karena sekarang dipakai UI untuk
   * menggambar progres pemutaran: ayat yang sudah lewat/sedang dibaca tetap
   * terang, yang belum lewat didimkan (§ indikator progres playback).
   */
  const playlist = ref<{ verseKey: string; url: string }[]>([])
  const playlistIndex = ref(0)

  /** Ada sesi pemutaran aktif (termasuk saat di-pause) — dipakai UI untuk tahu kapan harus menggambar progres dim/terang, bukan cuma warna hijau statis. */
  const audioSessionActive = computed(() => playlist.value.length > 0)

  /** Semua verseKey yang sudah lewat ATAU sedang dibaca saat ini (inklusif) dalam playlist berjalan. */
  const audioPlayedVerses = computed<string[]>(() =>
    playlist.value.slice(0, playlistIndex.value + 1).map((t) => t.verseKey),
  )

  /** Lama jeda (ms) begitu satu putaran penuh selesai sebelum mulai lagi dari awal. */
  const REPEAT_PAUSE_MS = 900

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms))
  }

  /**
   * §fix-crossfade: dulu pemutaran pakai SATU elemen `<audio>` yang
   * `src`-nya diganti begitu ayat sebelumnya `ended` — betapapun cepatnya
   * file berikutnya di-preload, selalu ada momen hening sesaat (silent gap)
   * di antara dua ayat, dan itu yang terasa "terpotong".
   *
   * Sekarang dipakai DUA elemen `<audio>` bergantian (`elA`/`elB`): satu
   * "aktif" (sedang didengar), satu lagi sudah siaga dengan ayat
   * BERIKUTNYA (sudah di-preload via `preloadStandby`). Begitu ayat aktif
   * tinggal `CROSSFADE_SEC` detik lagi (dipantau lewat loop
   * requestAnimationFrame, lihat `checkCrossfadeTrigger`), elemen siaga
   * mulai diputar DARI VOLUME PENUH (lihat §fix-crossfade-asimetris di
   * bawah — ayat berikutnya TIDAK fade-in, langsung "hadir"), lalu selama
   * durasi crossfade volume elemen LAMA SAJA diturunkan bertahap ke 0 —
   * persis seperti "sisa ayat sebelumnya masih ada, langsung ditimpa audio
   * ayat baru yang sudah penuh". Begitu crossfade selesai, peran kedua
   * elemen ditukar (`activeIsA`), dan siklus berulang untuk ayat
   * sesudahnya.
   *
   * `onActiveEnded` (listener `ended`) cuma jadi JARING PENGAMAN untuk
   * kasus track terlalu pendek sehingga crossfade belum sempat terpicu,
   * atau untuk ayat TERAKHIR dalam satu putaran (yang memang sengaja tidak
   * di-crossfade — ke situ dipakai jeda `REPEAT_PAUSE_MS` yang sudah ada,
   * bukan crossfade, supaya jeda antar-PUTARAN tetap terasa sebagai jeda).
   */
  const CROSSFADE_SEC = 0.4
  const CROSSFADE_STEPS = 12

  /**
   * §fix-trigger-delay: titik AMBANG deteksi (`remain <= CROSSFADE_SEC`)
   * sendiri tidak diubah, tapi begitu ambang itu tersentuh, crossfade
   * TIDAK langsung dieksekusi saat itu juga — ditunda `TRIGGER_DELAY_MS`
   * dulu via `setTimeout`, baru `startCrossfade()` benar-benar dipanggil.
   * Nilai ini dinaikkan 0,4 detik (dari 400ms → 800ms) karena crossfade
   * terasa "terpotong": pada 400ms, delay + durasi crossfade (CROSSFADE_SEC
   * = 0,8 detik) nyaris menyentuh/pas melebihi sisa track saat ambang
   * tersentuh untuk beberapa berkas, jadi fade-out ayat lama belum sempat
   * tuntas sebelum `ended` benar-benar terjadi dan jaring pengaman
   * `onActiveEnded` ikut nimbrung. Dengan jeda lebih panjang ini, crossfade
   * mulai lebih belakangan (lebih dekat ke ujung track), sehingga transisi
   * terasa utuh sampai habis.
   * `triggerArmed` mencegah penjadwalan dobel selama rAF terus berjalan
   * tiap frame sebelum delay itu selesai. Kalau user pause / crossfade
   * sudah lebih dulu terpicu dengan cara lain / sesi berganti di tengah
   * delay ini, eksekusi dibatalkan oleh pengecekan di awal callback-nya.
   */
  const TRIGGER_DELAY_MS = 100
  let triggerArmed = false
  let triggerTimeoutId = 0

  /**
   * verseKey ayat yang sedang "masuk" (jadi target) selama crossfade
   * berlangsung — null kalau tidak sedang crossfade. Reaktif, khusus
   * dibaca UI (lihat `audioNextVerse` di MushafPageView.vue) supaya border
   * hijau ayat aktif ikut memudar-masuk sinkron dengan audio: border ayat
   * lama turun sambil border ayat ini naik, selama `CROSSFADE_SEC` yang
   * sama dengan crossfade suaranya.
   */
  const crossfadeTargetVerseKey = ref<string | null>(null)

  let elA: HTMLAudioElement | null = null
  let elB: HTMLAudioElement | null = null
  let activeIsA = true
  let crossfadeStarted = false

  /**
   * §fix-crossfade-presisi: titik mulai crossfade dideteksi lewat loop
   * `requestAnimationFrame` (presisi ~16ms) selama track aktif sedang
   * diputar, bukan lewat event `timeupdate` yang di browser cuma menembak
   * kira-kira tiap ~250ms.
   */
  let crossfadeWatchRaf = 0

  function startCrossfadeWatch(): void {
    cancelAnimationFrame(crossfadeWatchRaf)
    const tick = (): void => {
      checkCrossfadeTrigger()
      crossfadeWatchRaf = requestAnimationFrame(tick)
    }
    crossfadeWatchRaf = requestAnimationFrame(tick)
  }

  function stopCrossfadeWatch(): void {
    cancelAnimationFrame(crossfadeWatchRaf)
    crossfadeWatchRaf = 0
    clearTimeout(triggerTimeoutId)
    triggerArmed = false
  }

  function checkCrossfadeTrigger(): void {
    if (!isPlaying.value || crossfadeStarted || triggerArmed) return
    const el = activeEl()
    if (playlistIndex.value + 1 >= playlist.value.length) return // ayat terakhir putaran ini — tidak di-crossfade
    const remain = el.duration - el.currentTime
    if (!Number.isFinite(remain) || remain > CROSSFADE_SEC || remain <= 0) return

    // Ambang sudah tersentuh — jadwalkan eksekusi crossfade TRIGGER_DELAY_MS
    // dari sekarang, bukan langsung sekarang.
    triggerArmed = true
    triggerTimeoutId = window.setTimeout(() => {
      triggerArmed = false
      if (!isPlaying.value || crossfadeStarted) return
      void startCrossfade()
    }, TRIGGER_DELAY_MS)
  }

  function makeAudioEl(): HTMLAudioElement {
    const el = new Audio()
    el.addEventListener('ended', () => {
      if (el !== activeEl()) return // elemen lama yang sengaja dipause saat crossfade, abaikan
      void onActiveEnded()
    })
    el.addEventListener('error', () => {
      if (el !== activeEl()) return
      audioError.value = 'Gagal memutar berkas audio'
      isPlaying.value = false
    })
    return el
  }

  function activeEl(): HTMLAudioElement {
    if (activeIsA) return elA ?? (elA = makeAudioEl())
    return elB ?? (elB = makeAudioEl())
  }

  function standbyEl(): HTMLAudioElement {
    if (activeIsA) return elB ?? (elB = makeAudioEl())
    return elA ?? (elA = makeAudioEl())
  }

  /** Siapkan elemen siaga dengan ayat SETELAH `playlistIndex` sekarang, volume 0, siap di-crossfade-in. */
  function preloadStandby(): void {
    const next = playlist.value[playlistIndex.value + 1]
    const el = standbyEl()
    if (!next) return
    if (el.src !== next.url) {
      el.src = next.url
      el.load()
    }
    el.volume = 0
    el.playbackRate = audioTempo.value
  }

  /** Jalankan crossfade dari ayat aktif sekarang ke ayat berikutnya. */
  async function startCrossfade(): Promise<void> {
    crossfadeStarted = true
    const nextIndex = playlistIndex.value + 1
    const next = playlist.value[nextIndex]
    if (!next) {
      crossfadeStarted = false
      return
    }
    const fromEl = activeEl()
    const toEl = standbyEl()
    if (toEl.src !== next.url) {
      toEl.src = next.url
      toEl.load()
    }
    toEl.playbackRate = audioTempo.value
    // §fix-crossfade-asimetris: ayat BERIKUTNYA (yang belum mulai) langsung
    // diputar di volume PENUH sejak detik pertama — TIDAK fade-in sama
    // sekali. Cuma ayat LAMA yang fade-out secara halus di bawah ini.
    toEl.volume = 1
    try {
      await toEl.play()
    } catch {
      // Gagal mulai duluan — batalkan crossfade, biarkan `onActiveEnded`
      // jadi jaring pengaman (pindah tanpa fade begitu ayat lama habis).
      crossfadeStarted = false
      return
    }

    // Tandai ayat berikutnya sebagai "sedang masuk" — border-nya di UI mulai
    // menyala dari sini, bersamaan dengan suaranya (tanpa transisi fade,
    // karena ayat ini sendiri memang tidak fade-in).
    crossfadeTargetVerseKey.value = next.verseKey

    const stepMs = (CROSSFADE_SEC * 1000) / CROSSFADE_STEPS
    for (let i = 1; i <= CROSSFADE_STEPS; i++) {
      await sleep(stepMs)
      if (!isPlaying.value) {
        crossfadeTargetVerseKey.value = null
        return // user pause di tengah crossfade
      }
      const t = i / CROSSFADE_STEPS
      fromEl.volume = Math.max(0, 1 - t)
      // toEl TETAP di volume 1 sepanjang crossfade — tidak ikut difade.
    }

    fromEl.pause()
    fromEl.currentTime = 0
    fromEl.volume = 1
    activeIsA = !activeIsA
    playlistIndex.value = nextIndex
    currentPlayingVerseKey.value = next.verseKey
    crossfadeTargetVerseKey.value = null
    crossfadeStarted = false
    preloadStandby()
  }

  /**
   * Jaring pengaman: dipanggil saat elemen AKTIF benar-benar `ended` TANPA
   * sempat di-crossfade (track terlalu pendek, atau memang ayat terakhir
   * dalam satu putaran).
   */
  async function onActiveEnded(): Promise<void> {
    if (crossfadeStarted) return
    const nextIndex = playlistIndex.value + 1
    if (nextIndex < playlist.value.length) {
      // Fallback tanpa fade — seharusnya jarang kejadian (lihat komentar di atas).
      playlistIndex.value = nextIndex
      await startTrack(nextIndex)
      return
    }
    repeatsRemaining--
    if (repeatsRemaining > 0) {
      playlistIndex.value = 0
      // Jeda singkat antar PUTARAN (beda dari antar AYAT, yang sekarang
      // di-crossfade, bukan dijeda) — supaya tidak langsung "nyelonong"
      // ke awal lagi begitu putaran sebelumnya selesai.
      await sleep(REPEAT_PAUSE_MS)
      if (!isPlaying.value) return
      await startTrack(0)
      return
    }
    stopPlayback()
  }

  /** Mulai memutar track pada index tertentu di elemen AKTIF, dan siapkan elemen siaga untuk ayat berikutnya. */
  async function startTrack(index: number): Promise<void> {
    const track = playlist.value[index]
    if (!track) return
    currentPlayingVerseKey.value = track.verseKey
    const el = activeEl()
    if (el.src !== track.url) {
      el.src = track.url
      el.load()
    }
    el.volume = 1
    el.playbackRate = audioTempo.value
    crossfadeStarted = false
    preloadStandby()
    try {
      await el.play()
      startCrossfadeWatch()
    } catch {
      audioError.value = 'Gagal memutar audio'
      isPlaying.value = false
    }
  }

  /** Hentikan total (beda dari pause: playlist & posisi ikut direset). */
  function stopPlayback(): void {
    stopCrossfadeWatch()
    elA?.pause()
    elB?.pause()
    if (elA) elA.volume = 1
    if (elB) elB.volume = 1
    crossfadeStarted = false
    crossfadeTargetVerseKey.value = null
    isPlaying.value = false
    currentPlayingVerseKey.value = null
    playlist.value = []
    playlistIndex.value = 0
  }

  /** Ayat yang diputar kalau ▶️ ditekan: rentang yang ditandai (kalau lengkap), kalau belum ada tanda → satu halaman penuh. */
  function versesToPlay(): string[] {
    if (markingComplete.value) return audioRangeVerses.value
    return page.value?.verseKeys ?? []
  }

  function toggleAudioMenu(): void {
    audioMenuOpen.value = !audioMenuOpen.value
    if (!audioMenuOpen.value) {
      audioSettingsOpen.value = false
      markingStart.value = null
      markingEnd.value = null
      audioRangeVerses.value = []
      stopPlayback()
    }
  }

  function toggleAudioSettings(): void {
    audioSettingsOpen.value = !audioSettingsOpen.value
  }

  function markRangeStart(verseKey: string): void {
    markingStart.value = verseKey
    markingEnd.value = null
    audioRangeVerses.value = []
    stopPlayback()
  }

  function markRangeEnd(verseKey: string): void {
    if (!markingStart.value) return
    markingEnd.value = verseKey
    audioRangeVerses.value = expandVerseRange(markingStart.value, verseKey, surahs.value)
  }

  function clearAudioRange(): void {
    markingStart.value = null
    markingEnd.value = null
    audioRangeVerses.value = []
    stopPlayback()
  }

  /** Qari, tempo & repeat disimpan sebagai satu objek (§ Setting Audio: "qari berlaku global"). */
  function persistAudioSettings(): void {
    void storage.saveAudioSettings({
      qari: audioQari.value,
      tempo: audioTempo.value,
      repeat: audioRepeat.value,
    })
  }

  function setAudioQari(id: string): void {
    audioQari.value = id
    persistAudioSettings()
  }

  function setAudioTempo(t: number): void {
    audioTempo.value = t
    persistAudioSettings()
    // Berlaku langsung ke track yang sedang jalan MAUPUN yang sedang siaga
    // untuk crossfade berikutnya, supaya tidak ada "lompatan" tempo pas
    // crossfade terjadi tak lama setelah tempo diubah.
    if (elA) elA.playbackRate = t
    if (elB) elB.playbackRate = t
  }

  /** Geser audioRepeat ke opsi berikutnya secara siklik: 1x → 2x → 3x → 4x → 1x. */
  function cycleAudioRepeat(): void {
    const idx = REPEAT_OPTIONS.indexOf(audioRepeat.value as (typeof REPEAT_OPTIONS)[number])
    audioRepeat.value = REPEAT_OPTIONS[(idx + 1) % REPEAT_OPTIONS.length]
    persistAudioSettings()
  }

  /**
   * Play/pause sungguhan. Dipanggil dari tombol pada nomor halaman saat mode
   * Audio aktif (lihat onAudioPlayClick di QuranReader.vue, yang sudah
   * menangani kasus "baru ayat awal ditandai" sebelum memanggil ini).
   */
  async function togglePlaying(): Promise<void> {
    if (isPlaying.value) {
      // Pause KEDUA elemen — kalau sedang di tengah crossfade, standby-nya
      // ikut terhenti juga (loop crossfade sendiri akan berhenti lewat
      // guard `if (!isPlaying.value) return` di `startCrossfade`).
      stopCrossfadeWatch()
      activeEl().pause()
      standbyEl().pause()
      isPlaying.value = false
      return
    }

    if (!audioQari.value) {
      audioError.value = 'Pilih qari dulu di Setting Audio'
      return
    }
    audioError.value = null

    // Resume (bukan mulai ulang) kalau ada sesi (playlist) yang sedang di-pause
    if (audioSessionActive.value && currentPlayingVerseKey.value && activeEl().src) {
      isPlaying.value = true
      try {
        await activeEl().play()
        startCrossfadeWatch()
      } catch {
        isPlaying.value = false
        audioError.value = 'Gagal memutar audio'
      }
      return
    }

    const verseKeys = versesToPlay()
    if (!verseKeys.length) return

    audioLoading.value = true
    try {
      playlist.value = await resolveAyahAudio(verseKeys, Number(audioQari.value))
    } catch (err) {
      audioError.value = err instanceof Error ? err.message : String(err)
      audioLoading.value = false
      return
    }
    audioLoading.value = false

    if (!playlist.value.length) {
      audioError.value = 'Audio ayat ini tidak tersedia dari qari yang dipilih'
      return
    }

    playlistIndex.value = 0
    activeIsA = true
    repeatsRemaining = audioRepeat.value
    isPlaying.value = true
    await startTrack(0)
  }

  async function init(): Promise<void> {
    if (ready.value) return
    try {
      await storage.initStorage()
      storageError.value = storage.getStorageInitError()

      const savedTheme = await storage.getTheme()
      if (savedTheme) theme.value = savedTheme
      applyThemeClass()

      const savedMemorize = await storage.getMemorizeSettings()
      if (savedMemorize) memorize.value = { ...DEFAULT_MEMORIZE, ...savedMemorize }

      const savedAudio = await storage.getAudioSettings()
      if (savedAudio) {
        audioQari.value = savedAudio.qari
        audioTempo.value = savedAudio.tempo
        // Fallback 1 untuk data lama yang disimpan sebelum field repeat ada.
        audioRepeat.value = savedAudio.repeat ?? 1
      }

      await ensureMushafLoaded()
      surahs.value = await getSurahs()
      juzList.value = await getJuzList()
      marks.value = await storage.listMarks()
      helpers.value = await storage.listHelperVerses()

      const last = await storage.getLastRead()
      if (last) {
        currentPage.value = last.page
        currentVerseKey.value = last.verseKey
      }

      await loadPage(currentPage.value, { persist: false })
      ready.value = true
    } catch (err) {
      loadError.value = err instanceof Error ? err.message : String(err)
    }
  }

  const THEME_NAV_COLOR: Record<ThemeMode, string> = {
    light:  '#f6f1e4',
    dark:   '#0e0f11',
    forest: '#0d1f12',
    cream:  '#fdf8f0',
    white:  '#ffffff',
  }

  function applyThemeClass(): void {
    const root = document.documentElement
    const t = theme.value
    root.classList.remove('dark', 'forest', 'cream', 'white-mode')
    if (t === 'dark') {
      root.classList.add('dark')
    } else if (t === 'forest') {
      root.classList.add('dark', 'forest')
    } else if (t === 'cream') {
      root.classList.add('cream')
    } else if (t === 'white') {
      root.classList.add('white-mode')
    }
    root.style.colorScheme = (t === 'dark' || t === 'forest') ? 'dark' : 'light'

    void applyNavBarColor(t)
  }

  async function applyNavBarColor(t: ThemeMode): Promise<void> {
    const { Capacitor } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform()) return
    try {
      const color = THEME_NAV_COLOR[t] ?? '#f6f1e4'
      let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])')
      if (!meta) {
        meta = document.createElement('meta')
        meta.name = 'theme-color'
        document.head.appendChild(meta)
      }
      meta.content = color

      const { StatusBar, Style } = await import('@capacitor/status-bar')
      const isDark = t === 'dark' || t === 'forest'
      await StatusBar.setBackgroundColor({ color })
      await StatusBar.setStyle({ style: isDark ? Style.Dark : Style.Light })
    } catch {
      // Plugin tidak tersedia — abaikan
    }
  }

  async function setTheme(mode: ThemeMode): Promise<void> {
    theme.value = mode
    applyThemeClass()
    await storage.setTheme(mode)
  }

  async function toggleTheme(): Promise<void> {
    const cycle: ThemeMode[] = ['light', 'dark', 'forest', 'cream', 'white']
    const idx = cycle.indexOf(theme.value)
    await setTheme(cycle[(idx + 1) % cycle.length])
  }

  async function loadPage(n: number, opts: { persist?: boolean } = {}): Promise<void> {
    const target = Math.min(TOTAL_PAGES, Math.max(1, n))
    const data = await getPage(target)
    page.value = data
    currentPage.value = target
    if (opts.persist !== false && readingSource.value === 'normal') await persistLastRead()
  }

  async function openFromReminder(surah: number, ayah: number): Promise<boolean> {
    readingSource.value = 'reminder'
    return goToVerse(surah, ayah)
  }

  async function endReminderSession(): Promise<void> {
    if (readingSource.value === 'normal') return
    readingSource.value = 'normal'

    const last = await storage.getLastRead()
    if (!last) return
    currentVerseKey.value = last.verseKey
    await loadPage(last.page, { persist: false })
  }

  async function goToPage(n: number): Promise<void> {
    if (n === currentPage.value) return
    currentVerseKey.value = null
    await loadPage(n)
  }

  async function nextPage(): Promise<void> {
    if (currentPage.value < TOTAL_PAGES) await goToPage(currentPage.value + 1)
  }

  async function prevPage(): Promise<void> {
    if (currentPage.value > 1) await goToPage(currentPage.value - 1)
  }

  async function goToVerse(surah: number, ayah: number): Promise<boolean> {
    const target = await findPageOfVerse(surah, ayah)
    if (!target) return false
    currentVerseKey.value = `${surah}:${ayah}`
    await loadPage(target)
    return true
  }

  async function goToJuz(juz: number): Promise<boolean> {
    const entry = juzList.value.find((j) => j.number === juz)
    const target = (entry ? juzStartPage(entry) : null) ?? (await findPageOfJuz(juz))
    if (!target) return false
    currentVerseKey.value = null
    await loadPage(target)
    return true
  }

  async function persistLastRead(): Promise<void> {
    await storage.setLastRead({
      page: currentPage.value,
      verseKey: currentVerseKey.value,
      updatedAt: new Date().toISOString(),
    })
  }

  async function addMark(
    verseKey: string,
    line: number,
    wordIndex: number,
    shape: MarkShape,
  ): Promise<Mark | null> {
    if (!canAddMark.value) return null
    const mark = await storage.addMark(currentPage.value, verseKey, line, wordIndex, shape)
    marks.value = [...marks.value, mark]
    return mark
  }

  async function removeMark(id: number): Promise<void> {
    await storage.deleteMark(id)
    marks.value = marks.value.filter((m) => m.id !== id)
  }

  function marksForVerse(verseKey: string): Mark[] {
    return marks.value.filter((m) => m.page === currentPage.value && m.verseKey === verseKey)
  }

  async function addVersePick(
    verseKey: string,
    pick: { wordsShown?: number | null; wordOffset?: number } = {},
  ): Promise<HelperVerse> {
    const helper = await storage.addHelperVerse(
      currentPage.value,
      verseKey,
      pick.wordsShown ?? null,
      pick.wordOffset ?? 0,
    )
    const already = helpers.value.some((h) => h.id === helper.id)
    if (!already) helpers.value = [...helpers.value, helper]
    return helper
  }

  const setVersePick = addVersePick

  async function removeVersePick(id: number): Promise<void> {
    await storage.deleteHelperVerseById(id)
    helpers.value = helpers.value.filter((h) => h.id !== id)
  }

  async function resetVersePick(verseKey: string): Promise<void> {
    await storage.deleteHelperVerse(verseKey)
    helpers.value = helpers.value.filter((h) => h.verseKey !== verseKey)
  }

  function versePicks(verseKey: string): HelperVerse[] {
    return helpers.value.filter((h) => h.verseKey === verseKey && h.page === currentPage.value)
  }

  function versePick(verseKey: string): HelperVerse | undefined {
    return versePicks(verseKey)[0]
  }

  async function updateMemorize(patch: Partial<MemorizeSettings>): Promise<void> {
    memorize.value = { ...memorize.value, ...patch }
    await storage.saveMemorizeSettings(memorize.value)
  }

  function surahName(n: number): string {
    return surahs.value.find((s) => s.number === n)?.nameLatin ?? `Surah ${n}`
  }

  function surahNameArabic(n: number): string {
    return surahs.value.find((s) => s.number === n)?.nameArabic ?? ''
  }

  function surahByNumber(n: number): Surah | undefined {
    return surahs.value.find((s) => s.number === n)
  }

  return {
    ready,
    loadError,
    storageError,
    theme,
    currentPage,
    currentVerseKey,
    page,
    surahs,
    juzList,
    marks,
    helpers,
    memorize,
    verses,
    memorizeLines,
    helpersOnPage,
    surahsOnPage,
    currentJuz,
    juzStartPage,
    currentJuzSheet,
    readingSource,
    marksOnPage,
    canAddMark,
    audioMenuOpen,
    audioSettingsOpen,
    markingStart,
    markingEnd,
    audioRangeVerses,
    isPlaying,
    markingComplete,
    audioQari,
    audioTempo,
    audioRepeat,
    reciters,
    audioLoading,
    audioError,
    currentPlayingVerseKey,
    crossfadeTargetVerseKey,
    audioSessionActive,
    audioPlayedVerses,
    loadReciters,
    toggleAudioMenu,
    toggleAudioSettings,
    markRangeStart,
    markRangeEnd,
    clearAudioRange,
    stopPlayback,
    setAudioQari,
    setAudioTempo,
    cycleAudioRepeat,
    togglePlaying,
    init,
    setTheme,
    toggleTheme,
    goToPage,
    nextPage,
    prevPage,
    goToVerse,
    goToJuz,
    openFromReminder,
    endReminderSession,
    addMark,
    removeMark,
    marksForVerse,
    addVersePick,
    setVersePick,
    removeVersePick,
    resetVersePick,
    versePick,
    versePicks,
    updateMemorize,
    surahName,
    surahNameArabic,
    surahByNumber,
  }
})