<script setup lang="ts">
/**
 * Lompat ke juz 1–30, plus lompat ke nomor halaman langsung (§3.1).
 *
 * Mengetuk sebuah juz TIDAK langsung membuka halamannya, tapi membuka daftar
 * surah yang ada di juz itu. Dari daftar itu barulah pengguna memilih surah
 * yang dituju.
 *
 * Daftar surah mengikuti isi juz apa adanya: surah yang tidak selesai dalam
 * satu juz muncul lagi di juz berikutnya, dengan rentang ayat yang menerus —
 * jadi nama surah yang sama bisa tampil di dua juz.
 */
import { computed, ref } from 'vue'
import SheetModal from './SheetModal.vue'
import { iconBack } from './icons'
import { TOTAL_PAGES, type Juz, type JuzMappingEntry, type Surah } from '@/types'

const props = defineProps<{
  juzList: Juz[]
  surahs: Surah[]
  currentJuz?: number | null
  currentPage: number
}>()

/** Halaman awal juz yang ditampilkan: sama dengan aturan di quranStore (juz 1 → 2, 7 → 122, 11 → 202) */
const START_OVERRIDE: Record<number, number> = { 1: 2, 7: 122, 11: 202 }
function startPageOf(j: Juz): number | string {
  return START_OVERRIDE[j.number] ?? j.pageStart ?? '-'
}

const emit = defineEmits<{
  close: []
  /** Lompat ke ayat awal sebuah surah di dalam juz terpilih */
  goVerse: [surah: number, ayah: number]
  goPage: [page: number]
}>()

const pageInput = ref(props.currentPage)

/** Juz yang daftar surahnya sedang dibuka; null = masih di daftar juz */
const openJuz = ref<Juz | null>(null)

function surahName(n: number): string {
  return props.surahs.find((s) => s.number === n)?.nameLatin ?? `Surah ${n}`
}

function surahNameArabic(n: number): string {
  return props.surahs.find((s) => s.number === n)?.nameArabic ?? ''
}

/** Jumlah ayat surah — untuk tahu apakah rentangnya bersambung ke juz lain */
function versesCount(n: number): number {
  return props.surahs.find((s) => s.number === n)?.versesCount ?? 0
}

const entries = computed<JuzMappingEntry[]>(() => openJuz.value?.mapping ?? [])

/**
 * Keterangan potongan surah di dalam juz ini: apakah dimulai dari awal surah,
 * dan apakah berhenti sebelum surah itu habis (berarti bersambung ke juz
 * berikutnya).
 */
function partLabel(e: JuzMappingEntry): string {
  const total = versesCount(e.surah)
  const fromStart = e.from === 1
  const toEnd = total > 0 && e.to >= total

  if (fromStart && toEnd) return 'surah penuh'
  if (fromStart) return 'awal surah, bersambung'
  if (toEnd) return 'sambungan sampai akhir surah'
  return 'sambungan'
}

function openJuzDetail(juz: Juz): void {
  openJuz.value = juz
}

function backToJuzList(): void {
  openJuz.value = null
}

function submitPage(): void {
  const p = Math.min(TOTAL_PAGES, Math.max(1, Number(pageInput.value) || 1))
  emit('goPage', p)
}

const title = computed(() =>
  openJuz.value ? `Juz ${openJuz.value.number} — pilih surah` : 'Lompat ke juz / halaman',
)
</script>

<template>
  <SheetModal :title="title" @close="emit('close')">
    <!-- ============================ daftar juz ============================ -->
    <template v-if="!openJuz">
      <div class="grid">
        <button
          v-for="j in juzList"
          :key="j.number"
          type="button"
          class="juz"
          :class="{ active: j.number === currentJuz }"
          @click="openJuzDetail(j)"
        >
          <span class="n">Juz {{ j.number }}</span>
          <span class="from">{{ surahName(j.startSurah) }} {{ j.startAyah }}</span>
          <span class="pg">{{ j.mapping.length }} surah · hal. {{ startPageOf(j) }}</span>
        </button>
      </div>

      <div class="page-jump">
        <label>
          Halaman
          <input
            v-model.number="pageInput"
            class="field"
            type="number"
            min="1"
            :max="TOTAL_PAGES"
            inputmode="numeric"
            @keyup.enter="submitPage"
          />
          <span class="hint">/ {{ TOTAL_PAGES }}</span>
        </label>
        <button type="button" class="go" @click="submitPage">Buka halaman</button>
      </div>
    </template>

    <!-- ==================== daftar surah dalam satu juz ==================== -->
    <template v-else>
      <button type="button" class="back" @click="backToJuzList">
        <span aria-hidden="true" v-html="iconBack" />
        Semua juz
      </button>

      <p class="detail-intro">
        Ketuk nama surah untuk membukanya di ayat awal potongan juz ini.
      </p>

      <div class="surah-list">
        <button
          v-for="e in entries"
          :key="`${e.surah}-${e.from}`"
          type="button"
          class="surah-row"
          @click="emit('goVerse', e.surah, e.from)"
        >
          <span class="s-num">{{ e.surah }}</span>

          <span class="s-body">
            <span class="s-name">{{ surahName(e.surah) }}</span>
            <span class="s-range">ayat {{ e.from }}–{{ e.to }} · {{ partLabel(e) }}</span>
          </span>

          <span class="s-arabic">{{ surahNameArabic(e.surah) }}</span>
        </button>
      </div>
    </template>
  </SheetModal>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr));
  gap: 0.45rem;
  max-height: 46vh;
  overflow-y: auto;
}

.juz {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding: 0.6rem 0.7rem;
  border: 1px solid var(--color-paper-edge);
  border-radius: 0.7rem;
  background: transparent;
  color: inherit;
  text-align: left;
}

.juz.active {
  border-color: var(--color-accent);
  background: color-mix(in srgb, var(--color-accent) 14%, transparent);
}

.n {
  font-size: 0.86rem;
  font-weight: 600;
}

.from {
  font-size: 0.74rem;
  opacity: 0.7;
}

.pg {
  font-size: 0.7rem;
  opacity: 0.55;
}

/* ------------------------------------------------- daftar surah dalam juz */
.back {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  margin-bottom: 0.6rem;
  padding: 0.35rem 0.7rem 0.35rem 0.5rem;
  border: 1px solid var(--color-paper-edge);
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font-size: 0.76rem;
}

.back :deep(svg) {
  width: 0.9rem;
  height: 0.9rem;
}

.detail-intro {
  margin: 0 0 0.6rem;
  font-size: 0.76rem;
  opacity: 0.7;
}

.surah-list {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  max-height: 52vh;
  overflow-y: auto;
}

.surah-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.6rem 0.7rem;
  border: 1px solid var(--color-paper-edge);
  border-radius: 0.7rem;
  background: transparent;
  color: inherit;
  text-align: left;
}

.s-num {
  flex: 0 0 auto;
  width: 1.7rem;
  height: 1.7rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-accent) 15%, transparent);
  font-size: 0.72rem;
  font-weight: 600;
}

.s-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.05rem;
}

.s-name {
  font-size: 0.86rem;
  font-weight: 600;
}

.s-range {
  font-size: 0.7rem;
  opacity: 0.65;
}

.s-arabic {
  flex: 0 0 auto;
  font-family: var(--font-mushaf);
  font-size: 1.05rem;
  line-height: 1.6;
  opacity: 0.85;
}

/* ------------------------------------------------------------ lompat halaman */
.page-jump {
  margin-top: 1rem;
  padding-top: 0.9rem;
  border-top: 1px solid var(--color-paper-edge);
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}

.page-jump label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
}

.field {
  width: 6.5rem;
  padding: 0.6rem 0.7rem;
  border: 1px solid var(--color-paper-edge);
  border-radius: 0.7rem;
  background: rgb(255 255 255 / 0.7);
  color: inherit;
}

.hint {
  opacity: 0.6;
  font-size: 0.8rem;
}

.go {
  padding: 0.8rem 1rem;
  border: 0;
  border-radius: 0.8rem;
  background: var(--color-accent);
  color: #fff;
  font-weight: 600;
  font-size: 0.92rem;
}

.dark .juz,
.dark .field,
.dark .page-jump,
.dark .surah-row,
.dark .back {
  border-color: var(--color-night-edge);
}

.dark .field {
  background: rgb(255 255 255 / 0.06);
}

.dark .s-num {
  background: color-mix(in srgb, var(--color-accent-soft) 18%, transparent);
}

.dark .go {
  background: var(--color-accent-soft);
  color: #06120f;
}
</style>
