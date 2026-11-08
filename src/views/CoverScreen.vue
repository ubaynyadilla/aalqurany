<script setup lang="ts">
/**
 * Halaman awal aplikasi (§3.1.1): cover Al-Qur'an.
 * Menu bawah memakai grid icon logo shape kotak rounded + label, bukan pills.
 * Shortcut "Terakhir Dibaca" berupa lingkaran semi-transparan — hanya di layar ini.
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { iconBook, iconLock, iconMemorize, iconMoon, iconReminder, iconSun } from '@/components/icons'
import { remindersAvailable } from '@/services/platform'
import { useQuranStore } from '@/stores/quranStore'
import { getLastRead } from '@/services/storage'
import { getPage } from '@/services/mushafData'
import { toArabicNumber } from '@/utils/arabicNumerals'
import type { LastRead } from '@/types'

const router = useRouter()
const quran = useQuranStore()
const lastRead = ref<LastRead | null>(null)
/** Ayat acuan bila posisi terakhir hanya tersimpan sebagai nomor halaman */
const firstVerseOfLastPage = ref<string | null>(null)

onMounted(async () => {
  // Kembali ke cover mengakhiri sesi reminder: bacaan yang terbuka dikembalikan
  // ke "terakhir dibaca" milik pengguna sendiri, bukan halaman milik reminder.
  await quran.endReminderSession()

  const saved = await getLastRead()
  lastRead.value = saved
  if (saved && !saved.verseKey) {
    const page = await getPage(saved.page)
    firstVerseOfLastPage.value = page?.verseKeys[0] ?? null
  }
})

/** Surat & ayat posisi baca terakhir, dipakai judul shortcut */
const lastVerse = computed<{ surah: number; ayah: number } | null>(() => {
  const key = lastRead.value?.verseKey ?? firstVerseOfLastPage.value
  if (!key) return null
  const [surah, ayah] = key.split(':').map(Number)
  return { surah, ayah }
})

const lastSurahName = computed(() =>
  lastVerse.value ? quran.surahName(lastVerse.value.surah) : '',
)

const lastSurahArabic = computed(() =>
  lastVerse.value ? quran.surahNameArabic(lastVerse.value.surah) : '',
)

const lastAyahArabic = computed(() =>
  lastVerse.value ? toArabicNumber(lastVerse.value.ayah) : '',
)

const lastPageArabic = computed(() =>
  lastRead.value ? toArabicNumber(lastRead.value.page) : '',
)

const lastReadLabel = computed(() => {
  if (!lastRead.value) return ''
  if (lastVerse.value) return `${lastSurahName.value} ayat ${lastVerse.value.ayah}`
  return `Halaman ${lastRead.value.page}`
})

const themeIcon = computed(() => (quran.theme === 'dark' ? iconSun : iconMoon))

async function openLastRead(): Promise<void> {
  if (justDragged) return
  if (!lastRead.value) return
  await quran.goToPage(lastRead.value.page)
  router.push('/reader')
}

/* ------------------------------------------------ geser posisi shortcut ---- */

const HOLD_MS = 420
const spot = ref<{ x: number; y: number }>({ x: 1, y: 1 })
const dragging = ref(false)
const armed = ref(false)

let holdTimer: number | undefined
let justDragged = false
let grabOffset = { x: 0, y: 0 }

onMounted(() => {
  const saved = window.localStorage.getItem('cover-last-read-spot')
  if (!saved) return
  try {
    const parsed = JSON.parse(saved) as { x: number; y: number }
    if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
      spot.value = { x: clamp01(parsed.x), y: clamp01(parsed.y) }
    }
  } catch {
    // Nilai rusak diabaikan
  }
})

const spotStyle = computed(() => ({
  left: `${spot.value.x * 100}%`,
  top: `${spot.value.y * 100}%`,
  transform: `translate(${-spot.value.x * 100}%, ${-spot.value.y * 100}%)`,
}))

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

function onPointerDown(event: PointerEvent): void {
  justDragged = false
  const el = event.currentTarget as HTMLElement
  const box = el.getBoundingClientRect()
  grabOffset = {
    x: event.clientX - (box.left + box.width / 2),
    y: event.clientY - (box.top + box.height / 2),
  }

  window.clearTimeout(holdTimer)
  holdTimer = window.setTimeout(() => {
    armed.value = true
    dragging.value = true
    if ('vibrate' in navigator) navigator.vibrate?.(12)
  }, HOLD_MS)

  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp, { once: true })
  window.addEventListener('pointercancel', onPointerUp, { once: true })
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging.value) {
    window.clearTimeout(holdTimer)
    return
  }
  event.preventDefault()
  justDragged = true

  const host = document.querySelector<HTMLElement>('.cover')
  if (!host) return
  const box = host.getBoundingClientRect()
  const size = 8.6 * 16
  const half = size / 2

  const cx = event.clientX - grabOffset.x - box.left
  const cy = event.clientY - grabOffset.y - box.top
  const spanX = Math.max(1, box.width - size)
  const spanY = Math.max(1, box.height - size)

  spot.value = {
    x: clamp01((cx - half) / spanX),
    y: clamp01((cy - half) / spanY),
  }
}

function onPointerUp(): void {
  window.clearTimeout(holdTimer)
  window.removeEventListener('pointermove', onPointerMove)

  if (dragging.value) {
    window.localStorage.setItem('cover-last-read-spot', JSON.stringify(spot.value))
    window.setTimeout(() => (justDragged = false), 60)
  }
  dragging.value = false
  armed.value = false
}
</script>

<template>
  <main class="cover no-select">
    <!-- Toggle tema: ikon dengan shape kotak rounded di belakangnya -->
    <button
      type="button"
      class="theme-toggle safe-top"
      :aria-label="quran.theme === 'dark' ? 'Mode terang' : 'Mode gelap'"
      @click="quran.toggleTheme()"
    >
      <span class="theme-icon-wrap" aria-hidden="true">
        <span class="theme-icon-bg" />
        <span class="theme-icon-svg" v-html="themeIcon" />
      </span>
    </button>

    <div class="art" aria-hidden="true">
      <div class="frame">
        <div class="frame-inner">
          <p class="title-ar">ٱلْقُرْآنُ ٱلْكَرِيمُ</p>
          <div class="rule" />
          <p class="title-latin">Al-Qur'an al-Karim</p>
          <p class="subtitle">Mushaf Madinah · 604 halaman</p>
        </div>
      </div>
    </div>

    <!-- Grid menu: icon logo kotak rounded + label di bawahnya -->
    <div class="icon-menu">
      <button
        type="button"
        class="icon-btn"
        aria-label="Buka Mushaf"
        @click="router.push('/reader')"
      >
        <span class="icon-box" aria-hidden="true" v-html="iconBook" />
        <span class="icon-label">Baca</span>
      </button>

      <button
        type="button"
        class="icon-btn"
        aria-label="Memorize"
        @click="router.push('/memorize')"
      >
        <span class="icon-box" aria-hidden="true" v-html="iconMemorize" />
        <span class="icon-label">Memorize</span>
      </button>

      <button
        type="button"
        class="icon-btn"
        aria-label="Reminder"
        @click="router.push('/reminder')"
      >
        <span class="icon-box" aria-hidden="true" v-html="remindersAvailable ? iconReminder : iconLock" />
        <span class="icon-label">Reminder</span>
      </button>
    </div>

    <!--
      Shortcut terakhir dibaca: draggable, default di kanan bawah.
    -->
    <button
      v-if="lastRead"
      type="button"
      class="last-read"
      :class="{ dragging, armed }"
      :style="spotStyle"
      :aria-label="`Lanjut baca ${lastReadLabel}. Tekan agak lama untuk memindahkan`"
      @pointerdown="onPointerDown"
      @click="openLastRead"
      @contextmenu.prevent
    >
      <span class="halo halo-outer" aria-hidden="true" />
      <span class="halo halo-inner" aria-hidden="true" />
      <span class="lr-core" aria-hidden="true" dir="rtl">
        <template v-if="lastVerse">
          <span class="lr-surah">{{ lastSurahArabic }}</span>
          <span class="lr-ayah">{{ lastAyahArabic }}</span>
        </template>
        <template v-else>
          <span class="lr-surah">صفحة</span>
          <span class="lr-ayah">{{ lastPageArabic }}</span>
        </template>
      </span>
    </button>
  </main>
</template>

<style scoped>
.cover {
  position: relative;
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2rem;
  padding: 2rem 1.25rem;
  background:
    radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, var(--color-accent) 12%, transparent), transparent 70%),
    var(--color-paper);
  color: var(--color-ink);
}

/* ---------------------------------------------------------------- theme toggle */
.theme-toggle {
  position: absolute;
  top: 0;
  right: 0;
  margin: 0.9rem;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

/* Wrapper: icon SVG duduk di atas background shape */
.theme-icon-wrap {
  position: relative;
  width: 2.6rem;
  height: 2.6rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

/* Background shape kotak rounded — pas mengelilingi ikon */
.theme-icon-bg {
  position: absolute;
  inset: 0;
  border-radius: 0.65rem;
  border: 1px solid var(--color-paper-edge);
  background: color-mix(in srgb, var(--color-ink) 7%, var(--color-paper));
  backdrop-filter: blur(6px);
}

.theme-icon-svg {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.theme-icon-svg :deep(svg) {
  width: 1.2rem;
  height: 1.2rem;
}

/* ------------------------------------------------------------------ art frame */
.art {
  width: min(78vw, 20rem);
  aspect-ratio: 3 / 4;
  display: flex;
}

.frame {
  flex: 1;
  padding: 0.55rem;
  border-radius: 0.9rem;
  border: 2px solid color-mix(in srgb, var(--color-accent) 55%, transparent);
  background: linear-gradient(
    160deg,
    color-mix(in srgb, var(--color-accent) 16%, var(--color-paper)),
    var(--color-paper)
  );
  box-shadow: 0 18px 44px rgb(0 0 0 / 0.18);
}

.frame-inner {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
  border: 1px solid color-mix(in srgb, var(--color-accent) 38%, transparent);
  border-radius: 0.6rem;
  padding: 1.2rem;
  text-align: center;
}

.title-ar {
  margin: 0;
  font-family: var(--font-mushaf);
  font-size: clamp(1.6rem, 8vw, 2.4rem);
  font-weight: var(--mushaf-font-weight, 600);
  line-height: 1.6;
}

.rule {
  width: 55%;
  height: 1px;
  background: color-mix(in srgb, var(--color-ink) 30%, transparent);
}

.title-latin {
  margin: 0;
  font-size: 0.95rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.subtitle {
  margin: 0;
  font-size: 0.78rem;
  opacity: 0.65;
}

/* ------------------------------------------------------------------ icon menu */
/*
 * Grid tiga kolom icon-box + label di bawahnya.
 * Menggantikan pills menu sebelumnya.
 */
.icon-menu {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  gap: 1.2rem;
}

.icon-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.45rem;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--color-ink);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

/* Kotak icon: shape rounded dengan aksen */
.icon-box {
  width: 3.5rem;
  height: 3.5rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 1rem;
  border: 1px solid color-mix(in srgb, var(--color-accent) 30%, transparent);
  background: color-mix(in srgb, var(--color-accent) 10%, var(--color-paper));
  box-shadow: 0 2px 8px rgb(0 0 0 / 0.08);
  transition: transform 0.12s ease, background 0.12s ease;
}

.icon-btn:active .icon-box {
  transform: scale(0.93);
  background: color-mix(in srgb, var(--color-accent) 20%, var(--color-paper));
}

.icon-box :deep(svg) {
  width: 1.45rem;
  height: 1.45rem;
  color: var(--color-accent);
}

/* Label di bawah icon */
.icon-label {
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  opacity: 0.8;
}

/* ------------------------------------------------------------------ last-read shortcut */
.last-read {
  position: absolute;
  width: 8.6rem;
  height: 8.6rem;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  touch-action: none;
  transition: filter 0.16s ease;
}

.last-read.armed .lr-core {
  transform: scale(1.06);
  box-shadow: 0 12px 30px rgb(0 0 0 / 0.3);
}

.last-read.dragging {
  filter: drop-shadow(0 6px 14px rgb(0 0 0 / 0.28));
  cursor: grabbing;
}

.last-read.armed .halo {
  animation: halo-pulse 1.1s ease-in-out infinite;
}

@keyframes halo-pulse {
  50% {
    opacity: 0.55;
  }
}

.halo {
  position: absolute;
  border-radius: 999px;
  pointer-events: none;
}

.halo-outer {
  width: 100%;
  height: 100%;
  border: 1px solid color-mix(in srgb, var(--color-accent) 16%, transparent);
  background: color-mix(in srgb, var(--color-accent) 9%, transparent);
}

.halo-inner {
  width: 71%;
  height: 71%;
  border: 1px solid color-mix(in srgb, var(--color-accent) 26%, transparent);
  background: color-mix(in srgb, var(--color-accent) 20%, transparent);
}

.lr-core {
  position: relative;
  z-index: 1;
  width: 4.5rem;
  height: 4.5rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.1rem;
  padding: 0.3rem;
  border: 1px solid color-mix(in srgb, #fff 32%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-accent) 62%, transparent);
  color: #fff;
  box-shadow: 0 8px 22px rgb(0 0 0 / 0.22);
  backdrop-filter: blur(4px);
  overflow: hidden;
  transition: transform 0.16s ease, box-shadow 0.16s ease;
}

.lr-surah {
  max-width: 100%;
  font-family: var(--font-mushaf);
  font-size: 0.86rem;
  font-weight: var(--mushaf-font-weight, 600);
  line-height: 1.35;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lr-ayah {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.5em;
  min-height: 1.5em;
  font-family: var(--font-mushaf);
  font-size: 0.8rem;
  font-weight: var(--mushaf-font-weight, 600);
  line-height: 1;
  border: 1.5px solid color-mix(in srgb, #fff 65%, transparent);
  border-radius: 999px;
}

/* ------------------------------------------------------------------ dark mode */
.dark .cover {
  background:
    radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, var(--color-accent-soft) 14%, transparent), transparent 70%),
    var(--color-night);
  color: var(--color-night-ink);
}

.dark .theme-icon-bg {
  border-color: var(--color-night-edge);
  background: color-mix(in srgb, var(--color-night-ink) 8%, var(--color-night));
}

.dark .frame {
  border-color: color-mix(in srgb, var(--color-accent-soft) 45%, transparent);
  background: linear-gradient(
    160deg,
    color-mix(in srgb, var(--color-accent-soft) 12%, var(--color-night)),
    var(--color-night)
  );
}

.dark .frame-inner {
  border-color: color-mix(in srgb, var(--color-accent-soft) 30%, transparent);
}

.dark .rule {
  background: color-mix(in srgb, var(--color-night-ink) 30%, transparent);
}

.dark .icon-btn {
  color: var(--color-night-ink);
}

.dark .icon-box {
  border-color: color-mix(in srgb, var(--color-accent-soft) 30%, transparent);
  background: color-mix(in srgb, var(--color-accent-soft) 12%, var(--color-night));
  box-shadow: 0 2px 8px rgb(0 0 0 / 0.22);
}

.dark .icon-btn:active .icon-box {
  background: color-mix(in srgb, var(--color-accent-soft) 22%, var(--color-night));
}

.dark .icon-box :deep(svg) {
  color: var(--color-accent-soft);
}

.dark .halo-outer {
  border-color: color-mix(in srgb, var(--color-accent-soft) 18%, transparent);
  background: color-mix(in srgb, var(--color-accent-soft) 10%, transparent);
}

.dark .halo-inner {
  border-color: color-mix(in srgb, var(--color-accent-soft) 28%, transparent);
  background: color-mix(in srgb, var(--color-accent-soft) 20%, transparent);
}

.dark .lr-core {
  border-color: color-mix(in srgb, #06120f 30%, transparent);
  background: color-mix(in srgb, var(--color-accent-soft) 66%, transparent);
  color: #06120f;
}

.dark .lr-ayah {
  border-color: color-mix(in srgb, #06120f 55%, transparent);
}
</style>
