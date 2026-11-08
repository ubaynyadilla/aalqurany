<script setup lang="ts">
/**
 * Render satu halaman mushaf (§3.1).
 *
 * Baris 1–15 mengikuti `line_number` asli dari data, sehingga pembagian
 * ayat-pojok identik dengan mushaf Madinah cetak. Baris yang tidak berisi kata
 * pada data = baris hiasan nama surah pada cetakan; di situ header surah
 * (dan basmalah bila surah memakainya) disisipkan pada posisi yang sama.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import SurahHeaderFrame from './SurahHeaderFrame.vue'
import MarkOverlay from './MarkOverlay.vue'
import { assignHeaderRows } from '@/services/mushafData'
import { useAutoFitText } from '@/composables/useAutoFitText'
import type { Mark, MarkShape, MushafLine, MushafPage, MushafWord, Surah } from '@/types'

const props = defineProps<{
  page: MushafPage
  linesPerPage?: number
  surahs: Surah[]
  highlightVerseKey?: string | null
  marks?: Mark[]
  markable?: boolean
  /** True saat mode Audio aktif — mengaktifkan tap di nomor ayat untuk menandai rentang */
  audioMode?: boolean
  /** verseKey-verseKey yang masuk rentang tandaan Audio (hasil expandVerseRange di store) */
  audioRangeVerses?: string[]
  audioMarking?: boolean
  audioMarkStart?: string | null
  audioMarkEnd?: string | null
  audioSessionActive?: boolean
  audioPlayedVerses?: string[]
  /**
   * verseKey ayat yang SEDANG dibaca saat ini (satu ayat, bukan seluruh
   * rentang). Dipakai untuk menggambar outline hijau tipis di sekeliling
   * kata-kata ayat aktif SAJA.
   *
   * PENDEKATAN: SATU PATH SVG MENERUS (bukan kotak terpisah per baris).
   * Saat sebuah ayat tersebar di beberapa baris, lebar kata-per-baris
   * biasanya tidak sama (karena baris itu juga diisi ayat lain / posisi
   * kata berbeda). Kotak independen per baris tidak bisa menutup loncatan
   * horizontal di titik sambungan. Solusinya: bangun satu poligon
   * ortogonal ("tangga") yang mengikuti bentuk gabungan semua baris ayat,
   * dengan titik sambungan memakai SATU nilai y yang sama persis untuk
   * sisi kanan & kiri — sehingga tidak mungkin ada celah akibat
   * pembulatan sub-piksel atau selisih lebar antar baris.
   */
  audioActiveVerse?: string | null
}>()

const linesPerPage = computed(() => props.linesPerPage ?? 15)

type Row =
  | { kind: 'text'; line: number; words: MushafWord[] }
  | { kind: 'header'; line: number; nameArabic: string; withBismillah: boolean }
  | { kind: 'bismillah'; line: number }
  | { kind: 'blank'; line: number }

const rows = computed<Row[]>(() => {
  const byLine = new Map<number, MushafLine>(props.page.lines.map((l) => [l.line, l]))
  const decorations = assignHeaderRows(props.page, props.surahs, linesPerPage.value)

  const out: Row[] = []
  for (let i = 1; i <= linesPerPage.value; i++) {
    const deco = decorations.get(i)
    if (deco?.kind === 'header') {
      out.push({
        kind: 'header',
        line: i,
        nameArabic: deco.nameArabic,
        withBismillah: deco.withBismillah,
      })
      continue
    }
    if (deco?.kind === 'bismillah') {
      out.push({ kind: 'bismillah', line: i })
      continue
    }
    const line = byLine.get(i)
    if (line) {
      out.push({ kind: 'text', line: i, words: line.words })
      continue
    }
    out.push({ kind: 'blank', line: i })
  }
  return out
})

function isHighlighted(key: string): boolean {
  return Boolean(props.highlightVerseKey) && props.highlightVerseKey === key
}

function isAudioBoundary(key: string): boolean {
  return key === props.audioMarkStart || key === props.audioMarkEnd
}

function isAudioActive(key: string): boolean {
  return Boolean(props.audioActiveVerse) && key === props.audioActiveVerse
}

const host = ref<HTMLElement | null>(null)
const { fitSize, loose, looseRatio, ready } = useAutoFitText(
  host,
  computed(() => props.page.page),
  { max: 30, min: 11 },
)

const looseWidthPct = computed(() => {
  if (!loose.value) return null
  const r = looseRatio.value
  if (r == null) return 78
  return Math.min(92, Math.max(55, r * 100 * 1.1))
})

const fitStyle = computed(() => {
  const style: Record<string, string> = {}
  if (fitSize.value != null) style['--fit-size'] = `${fitSize.value}px`
  if (looseWidthPct.value != null) style['--loose-width'] = `${looseWidthPct.value}%`
  return Object.keys(style).length ? style : undefined
})

const emit = defineEmits<{
  settled: []
  wordTap: [payload: { verseKey: string; wordIndex: number; line: number }]
  ayahTap: [verseKey: string]
}>()

const startLineOf = computed(() => {
  const map = new Map<string, number>()
  for (const line of props.page.lines) {
    for (const w of line.words) if (!map.has(w.k)) map.set(w.k, line.line)
  }
  return map
})

const markKey = (verseKey: string, wordIndex: number): string => `${verseKey}#${wordIndex}`

const shapeByWord = computed(() => {
  const map = new Map<string, MarkShape>()
  for (const m of props.marks ?? []) map.set(markKey(m.verseKey, m.wordIndex), m.shape)
  return map
})

function shapeOf(word: MushafWord | undefined): MarkShape | undefined {
  if (!word || word.e || word.n == null) return undefined
  return shapeByWord.value.get(markKey(word.k, word.n - 1))
}

function markAt(words: MushafWord[], i: number): { shape: MarkShape; mergeStart: boolean; mergeEnd: boolean } | null {
  const shape = shapeOf(words[i])
  if (!shape) return null
  return {
    shape,
    mergeStart: shapeOf(words[i - 1]) === shape,
    mergeEnd: shapeOf(words[i + 1]) === shape,
  }
}

function onWordClick(word: MushafWord): void {
  if (!props.markable || word.e || word.n == null) return
  emit('wordTap', {
    verseKey: word.k,
    wordIndex: word.n - 1,
    line: startLineOf.value.get(word.k) ?? 1,
  })
}

function onAyahTap(verseKey: string): void {
  if (!props.audioMode) return
  emit('ayahTap', verseKey)
}

let settleFrame = 0

function announceSettled(): void {
  cancelAnimationFrame(settleFrame)
  settleFrame = requestAnimationFrame(() => {
    if (ready.value) emit('settled')
  })
}

watch([() => props.page.page, ready], announceSettled, { flush: 'post' })

/* ------------------------------------------------------------------ *
 * Outline hijau ayat Audio aktif — SATU path SVG menerus per kelompok
 * baris berurutan (lihat catatan panjang di prop `audioActiveVerse` di
 * atas untuk alasan pendekatan ini dibanding kotak terpisah per baris).
 * ------------------------------------------------------------------ */

/** Berapa px lebar outline ditambah di tiap sisi kiri/kanan melebihi batas teks. */
const BOX_EXTRA_PX = 6
/** Radius sudut outline (px). */
const BOX_RADIUS_PX = 8
/** Selisih di bawah ini dianggap "sama" dan di-snap ke nilai yang sama agar sambungan lurus. */
const SNAP_PX = 0.5

const inner = ref<HTMLElement | null>(null)
const lineEls = new Map<number, HTMLElement>()
function setLineRef(line: number, el: Element | null): void {
  if (el) lineEls.set(line, el as HTMLElement)
  else lineEls.delete(line)
}

/** Daftar `d` path SVG ayat aktif — satu string per kelompok baris ayat yang berurutan. */
const activePaths = ref<string[]>([])
let resizeObserver: ResizeObserver | null = null
let rafHandle = 0

function scheduleRecompute(): void {
  cancelAnimationFrame(rafHandle)
  rafHandle = requestAnimationFrame(recomputeActiveBoxes)
}

type Seg = { line: number; left: number; right: number; top: number; bottom: number }
type Pt = { x: number; y: number }

/** Bangun path SVG tertutup dengan sudut membulat dari daftar titik poligon ortogonal. */
function roundedPath(input: Pt[], r: number): string {
  // Buang titik duplikat.
  let pts = input.filter((p, i) => {
    const q = input[(i + 1) % input.length]
    return Math.abs(p.x - q.x) > 0.01 || Math.abs(p.y - q.y) > 0.01
  })
  // Buang titik kolinear (di tengah segmen lurus) supaya sudut hanya
  // dibuat di belokan nyata.
  pts = pts.filter((p, i, arr) => {
    const a = arr[(i - 1 + arr.length) % arr.length]
    const b = arr[(i + 1) % arr.length]
    const colX = Math.abs(a.x - p.x) < 0.01 && Math.abs(b.x - p.x) < 0.01
    const colY = Math.abs(a.y - p.y) < 0.01 && Math.abs(b.y - p.y) < 0.01
    return !(colX || colY)
  })

  const n = pts.length
  if (n < 3) return ''

  let d = ''
  for (let i = 0; i < n; i++) {
    const p = pts[i]
    const a = pts[(i - 1 + n) % n]
    const b = pts[(i + 1) % n]
    const d1 = Math.hypot(a.x - p.x, a.y - p.y)
    const d2 = Math.hypot(b.x - p.x, b.y - p.y)
    const rr = Math.min(r, d1 / 2, d2 / 2)
    const sx = p.x + ((a.x - p.x) / d1) * rr
    const sy = p.y + ((a.y - p.y) / d1) * rr
    const ex = p.x + ((b.x - p.x) / d2) * rr
    const ey = p.y + ((b.y - p.y) / d2) * rr
    d += `${i === 0 ? 'M' : 'L'}${sx} ${sy}Q${p.x} ${p.y} ${ex} ${ey}`
  }
  return d + 'Z'
}

/**
 * Bangun satu path "tangga" dari sekelompok segmen baris berurutan.
 * y[i] menandai batas atas baris i, dan y[i] yang sama juga menjadi batas
 * bawah baris i-1 — satu nilai dipakai bersama oleh kedua sisi, sehingga
 * atas baris B selalu identik dengan bawah baris A (tidak ada celah).
 */
function buildPath(group: Seg[]): string {
  const n = group.length

  const y: number[] = [group[0].top]
  for (let i = 0; i < n; i++) y.push(group[i].bottom)

  // Snap selisih kecil kiri/kanan antar baris supaya sisi vertikal lurus.
  const R = group.map((g) => g.right)
  const L = group.map((g) => g.left)
  for (let i = 1; i < n; i++) {
    if (Math.abs(R[i] - R[i - 1]) < SNAP_PX) R[i] = R[i - 1]
    if (Math.abs(L[i] - L[i - 1]) < SNAP_PX) L[i] = L[i - 1]
  }

  const pts: Pt[] = []
  // Sisi kanan: turun dari baris pertama ke baris terakhir.
  for (let i = 0; i < n; i++) {
    pts.push({ x: R[i], y: y[i] }, { x: R[i], y: y[i + 1] })
  }
  // Sisi kiri: naik kembali dari baris terakhir ke baris pertama.
  for (let i = n - 1; i >= 0; i--) {
    pts.push({ x: L[i], y: y[i + 1] }, { x: L[i], y: y[i] })
  }
  return roundedPath(pts, BOX_RADIUS_PX)
}

/** Hitung daftar path SVG untuk satu verseKey (ayat aktif). */
function computePathsForVerse(verse: string | null | undefined): string[] {
  const innerEl = inner.value
  if (!verse || !innerEl) return []

  const base = innerEl.getBoundingClientRect()
  const segs: Seg[] = []

  for (const row of rows.value) {
    if (row.kind !== 'text') continue
    const lineEl = lineEls.get(row.line)
    if (!lineEl) continue
    const wordEls = lineEl.querySelectorAll<HTMLElement>(`[data-verse-key="${verse}"]`)
    if (!wordEls.length) continue

    let left = Infinity
    let right = -Infinity
    wordEls.forEach((el) => {
      const r = el.getBoundingClientRect()
      left = Math.min(left, r.left)
      right = Math.max(right, r.right)
    })
    if (left === Infinity) continue

    const lr = lineEl.getBoundingClientRect()
    segs.push({
      line: row.line,
      left: left - base.left - BOX_EXTRA_PX,
      right: right - base.left + BOX_EXTRA_PX,
      top: lr.top - base.top,
      bottom: lr.bottom - base.top,
    })
  }

  // Pecah jadi kelompok baris bersebelahan (nomor baris berurutan tanpa
  // jeda, mis. bisa putus karena disela baris header surah).
  segs.sort((a, b) => a.line - b.line)
  const groups: Seg[][] = []
  for (const s of segs) {
    const last = groups[groups.length - 1]
    if (last && last[last.length - 1].line === s.line - 1) last.push(s)
    else groups.push([s])
  }

  return groups.map(buildPath).filter(Boolean)
}

function recomputeActiveBoxes(): void {
  activePaths.value = computePathsForVerse(props.audioActiveVerse)
}

watch(
  () => props.audioActiveVerse,
  () => nextTick(scheduleRecompute),
)
watch([fitSize, loose, rows], () => nextTick(scheduleRecompute), { flush: 'post' })

onMounted(() => {
  if (host.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => scheduleRecompute())
    resizeObserver.observe(host.value)
  }
  nextTick(scheduleRecompute)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(settleFrame)
  cancelAnimationFrame(rafHandle)
  resizeObserver?.disconnect()
})
</script>

<template>
  <div
    ref="host"
    class="mushaf no-select"
    :class="{ pending: !ready, markable }"
    :style="fitStyle"
    dir="rtl"
  >
    <div ref="inner" class="mushaf-inner" :class="{ loose }">
      <svg v-if="activePaths.length" class="audio-active-outline" aria-hidden="true">
        <!--
          §fix-border-fade-simple: disederhanakan jadi SATU lapis outline
          saja, dibungkus <Transition> dan di-`:key` per verseKey — begitu
          `audioActiveVerse` ganti, Vue otomatis fade-out kelompok path
          lama & fade-in kelompok path baru (CSS murni, lihat
          `.outline-fade-*` di bawah). Tidak ada lagi dua lapis yang saling
          tumpang tindih; cuma fade halus biasa.
        -->
        <Transition name="outline-fade">
          <g :key="audioActiveVerse ?? ''">
            <path v-for="(d, i) in activePaths" :key="i" :d="d" />
          </g>
        </Transition>
      </svg>

      <template v-for="row in rows" :key="row.line">
        <div v-if="row.kind === 'header'" class="surah-header">
          <SurahHeaderFrame :name-arabic="row.nameArabic" full />
          <div v-if="row.withBismillah" class="bismillah inline">
            بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ
          </div>
        </div>

        <div v-else-if="row.kind === 'bismillah'" class="mushaf-line bismillah-line">
          <span class="bismillah">بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ</span>
        </div>

        <div
          v-else-if="row.kind === 'text'"
          class="mushaf-line"
          data-fit-line
          :ref="(el) => setLineRef(row.line, el as Element | null)"
        >
          <span
            v-for="(word, idx) in row.words"
            :key="`${row.line}-${idx}`"
            :data-verse-key="isAudioActive(word.k) ? word.k : undefined"
            :class="[
              word.e ? 'ayah-end' : 'word',
              isHighlighted(word.k) ? 'highlight' : '',
              word.e && isAudioActive(word.k) ? 'audio-marked' : '',
              word.e && isAudioBoundary(word.k) ? 'audio-boundary' : '',
            ]"
            @click="word.e && audioMode ? onAyahTap(word.k) : onWordClick(word)"
            ><MarkOverlay
              v-if="markAt(row.words, idx)"
              :shape="markAt(row.words, idx)!.shape"
              :merge-start="markAt(row.words, idx)!.mergeStart"
              :merge-end="markAt(row.words, idx)!.mergeEnd"
            />{{ word.t }}</span
          >
        </div>

        <div v-else class="mushaf-line blank" />
      </template>
    </div>
  </div>
</template>

<style scoped>
.mushaf {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  font-family: var(--font-mushaf);
  font-weight: var(--mushaf-font-weight, 600);
  color: var(--color-ink);
  --fit-size: var(--mushaf-text);
}

.mushaf.pending {
  visibility: hidden;
}

.mushaf-inner {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  gap: 0;
}

.mushaf-inner.loose {
  width: var(--loose-width, 100%);
  margin-inline: auto;
}

/* Outline SVG menerus untuk ayat Audio aktif — digambar di belakang teks. */
.audio-active-outline {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
  z-index: 0;
}

.audio-active-outline path {
  fill: none;
  stroke: #2e7d32;
  stroke-width: 1px;
  stroke-linejoin: round;
  shape-rendering: geometricPrecision;
}

.dark .audio-active-outline path {
  stroke: #66bb6a;
}

/* Fade halus setiap kali outline ayat aktif berpindah ke ayat lain. */
.outline-fade-enter-active,
.outline-fade-leave-active {
  transition: opacity 0.4s ease;
}

.outline-fade-enter-from,
.outline-fade-leave-to {
  opacity: 0;
}

/* Kedua outline (lama & baru) boleh tumpang tindih sesaat selama fade,
   jadi posisi keduanya absolute di dalam SVG yang sama — default <Transition>
   (tanpa mode="out-in") sudah merender keduanya bersamaan selama animasi. */

.mushaf-line {
  position: relative;
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.1em;
  font-size: var(--fit-size);
  line-height: 1.9;
  white-space: nowrap;
  isolation: isolate;
  padding-block: 0.075rem;
  box-sizing: border-box;
}

.mushaf-line.blank {
  justify-content: center;
}

.mushaf-line[data-squeezed] {
  transform: scaleX(var(--squeeze, 1));
  transform-origin: right center;
}

.word,
.ayah-end {
  display: inline-block;
}

.word {
  position: relative;
}

.mushaf.markable .word {
  cursor: pointer;
  touch-action: manipulation;
  outline: 1px dashed color-mix(in srgb, var(--color-accent) 32%, transparent);
  outline-offset: 0.06em;
  border-radius: 0.3em;
}

.ayah-end {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.68em;
  min-height: 1.68em;
  padding: 0.06em;
  font-size: 0.72em;
  line-height: 1;
  border: 2px solid color-mix(in srgb, currentColor 78%, transparent);
  border-radius: 999px;
  opacity: 1;
}

.highlight {
  box-shadow: inset 0 -0.09em 0 color-mix(in srgb, var(--color-accent) 55%, transparent);
  animation: highlight-fade 4s ease-out forwards;
}

@keyframes highlight-fade {
  0%, 55% {
    box-shadow: inset 0 -0.09em 0 color-mix(in srgb, var(--color-accent) 55%, transparent);
  }
  100% {
    box-shadow: inset 0 -0.09em 0 transparent;
  }
}

.ayah-end.audio-marked {
  border-color: #2e7d32;
  border-width: 1px;
  background: transparent;
}

.ayah-end.audio-boundary {
  z-index: 4;
  border-color: #ff8a00;
  border-width: 3px;
}

/*
 * §fix-stabilo-merge-clip: SEBELUMNYA ada `z-index: 1` di sini. Itu membuat
 * SETIAP KATA jadi stacking context sendiri (position != static + z-index
 * != auto = stacking context baru). Akibatnya satu kata (teks + overlay
 * MarkOverlay di dalamnya) dicat sebagai SATU LAPISAN UTUH relatif terhadap
 * kata tetangganya — urutan menang/kalahnya mengikuti urutan DOM, dan
 * karena larik kata mengikuti urutan baca (kanan → kiri), kata yang lebih
 * KIRI selalu belakangan di DOM sehingga dicat PALING ATAS.
 *
 * Begitu dua kata bertetangga sama-sama distabilo (merge-start/merge-end di
 * MarkOverlay menambah margin negatif supaya overlay menjorok ke kata
 * sebelah demi sambungan mulus), overlay kata KIRI yang menjorok ke area
 * kata KANAN ikut terbawa sebagai bagian dari "lapisan kata kiri" yang
 * menang urutan cat — sehingga MENUTUPI sebagian TEKS kata kanan di titik
 * sambungan. Itulah bug "kata kanan kepotong".
 *
 * Fix: hapus z-index di sini. `.word`/`.ayah-end` cukup `position: relative`
 * (sebagai containing block untuk MarkOverlay yang `position: absolute`),
 * TANPA z-index eksplisit — supaya kata TIDAK membentuk stacking context
 * sendiri. Dengan begitu, overlay (`z-index: -1` di MarkOverlay.vue) dan
 * teks semua kata resolve ke stacking context `.mushaf-line` (yang sudah
 * `isolation: isolate`) sebagai SATU kelompok rata: semua overlay otomatis
 * di bawah SEMUA teks sepanjang baris, apa pun urutan/posisi katanya —
 * tidak ada lagi kata yang bisa "menang" menimpa kata lain.
 */
.word,
.ayah-end {
  position: relative;
}

.surah-header {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.15rem;
  padding-block: 0.12rem;
}

.bismillah-line {
  justify-content: center;
  flex: 0 0 auto;
  padding-block: 0.14rem 0.4rem;
}

.bismillah {
  font-size: var(--fit-size);
  line-height: 1.9;
  font-weight: 600;
  letter-spacing: 0.01em;
  white-space: nowrap;
}

.bismillah.inline {
  font-size: calc(var(--fit-size) * 0.8);
  line-height: 1.5;
}

.dark .mushaf {
  color: var(--color-night-ink);
}

.dark .highlight {
  box-shadow: inset 0 -0.09em 0 color-mix(in srgb, var(--color-accent-soft) 60%, transparent);
  animation: highlight-fade-dark 4s ease-out forwards;
}

@keyframes highlight-fade-dark {
  0%, 55% {
    box-shadow: inset 0 -0.09em 0 color-mix(in srgb, var(--color-accent-soft) 60%, transparent);
  }
  100% {
    box-shadow: inset 0 -0.09em 0 transparent;
  }
}

.dark .ayah-end.audio-marked {
  border-color: #66bb6a;
  background: transparent;
}
</style>