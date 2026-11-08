<script setup lang="ts">
/**
 * Panel "Bantu": halaman mushaf ditampilkan PENUH, dan dari sini pengguna
 * memilih kalimat mana yang tampil di memorize.
 *
 * Dua keadaan saja:
 *  - "sudah tampil" — kalimat yang sekarang muncul di memorize;
 *  - "ketuk untuk tambah" — kalimat yang belum dipakai.
 *
 * Setiap ayat boleh menampung BERAPA PUN kalimat. Menambah kalimat kedua tidak
 * menghapus kalimat pertama, dan setelan "kata awal ditampilkan" di menu
 * memorize tidak mengunci pilihan di sini — tiap kalimat pilihan memakai
 * panjangnya sendiri.
 *
 * Cara memilih: ketuk kata awal kalimat, lalu ketuk kata terakhirnya, lalu
 * tekan "Tambahkan ke memorize" — langsung masuk ke tampilan memorize tanpa
 * menutup panel ini, supaya bisa lanjut memilih kalimat lain. Panel HANYA
 * ditutup lewat tombol close; tidak ada lagi cara "seret ke lembar" (dulu ada
 * container "pakai di sini" / seret, sekarang cukup ketuk & tambah).
 *
 * Menghapus kalimat bantuan yang sudah ditambahkan: ketuk LANGSUNG kalimat
 * itu di teks ayatnya (kalimat yang sudah berwarna "sudah tampil") — tidak
 * perlu mencari chip terpisah.
 */
import { computed, ref } from 'vue'
import SheetModal from './SheetModal.vue'
import { toArabicNumber } from '@/utils/arabicNumerals'
import type { HelperVerse, MemorizeLine, PageVerse } from '@/types'

const props = defineProps<{
  page: number
  verses: PageVerse[]
  memorizeLines: MemorizeLine[]
  /** Potongan pilihan pengguna pada halaman ini */
  picks: HelperVerse[]
  /** Berapa kata yang tampil bila pengguna belum memilih sendiri */
  defaultWordsShown: number
}>()

const emit = defineEmits<{
  close: []
  /** Pengguna menambah satu potongan pada sebuah ayat */
  pick: [payload: { verseKey: string; wordOffset: number; wordsShown: number }]
  /** Buang satu potongan pilihan, dikenali lewat id-nya */
  removePick: [id: number]
  /** Kembalikan ayat ke potongan bawaan: semua potongan pilihannya dibuang */
  reset: [verseKey: string]
}>()

/** Ayat yang sedang dibuka kata-demi-kata untuk dipilih kalimatnya */
const editingKey = ref<string | null>(null)
/** Rentang kata terpilih di dalam ayat itu: [awal, akhir] inklusif */
const range = ref<[number, number] | null>(null)

/** Semua potongan pilihan, dikelompokkan per ayat — satu ayat bisa punya banyak */
const picksByKey = computed(() => {
  const map = new Map<string, HelperVerse[]>()
  for (const p of props.picks) {
    const list = map.get(p.verseKey)
    if (list) list.push(p)
    else map.set(p.verseKey, [p])
  }
  return map
})

/** Ayat yang tampil di memorize karena dimulai di halaman ini */
const shownByDefault = computed(() => {
  const keys = new Set<string>()
  for (const line of props.memorizeLines) {
    for (const seg of line.segments) {
      if (seg.startsHere) keys.add(seg.verseKey)
    }
  }
  return keys
})

function isShown(verseKey: string): boolean {
  return shownByDefault.value.has(verseKey) || picksByKey.value.has(verseKey)
}

/**
 * Semua kalimat yang sekarang tampil di memorize untuk ayat ini: potongan
 * bawaan (bila ayatnya memang dimulai di halaman ini) plus setiap potongan
 * pilihan pengguna. Panjang potongan pilihan diambil dari potongan itu sendiri,
 * bukan dari setelan memorize.
 */
function shownRanges(verse: PageVerse): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = []
  const last = verse.words.length - 1

  if (shownByDefault.value.has(verse.verseKey)) {
    out.push({ from: 0, to: Math.min(last, props.defaultWordsShown - 1) })
  }

  for (const p of picksByKey.value.get(verse.verseKey) ?? []) {
    const from = Math.min(Math.max(0, p.wordOffset ?? 0), Math.max(0, last))
    const count = Math.max(1, p.wordsShown ?? props.defaultWordsShown)
    out.push({ from, to: Math.min(last, from + count - 1) })
  }

  return out
}

function wordState(verse: PageVerse, index: number): 'shown' | 'picking' | 'plain' {
  if (editingKey.value === verse.verseKey && range.value) {
    const [a, b] = range.value
    if (index >= Math.min(a, b) && index <= Math.max(a, b)) return 'picking'
  }
  for (const r of shownRanges(verse)) {
    if (index >= r.from && index <= r.to) return 'shown'
  }
  return 'plain'
}

/** Daftar potongan pilihan sebuah ayat, siap ditampilkan sebagai pill kecil. */
function pickChips(verse: PageVerse): { id: number; label: string }[] {
  const last = verse.words.length - 1
  return (picksByKey.value.get(verse.verseKey) ?? [])
    .filter((p): p is HelperVerse & { id: number } => p.id != null)
    .map((p) => {
      const from = Math.min(Math.max(0, p.wordOffset ?? 0), Math.max(0, last))
      const count = Math.max(1, p.wordsShown ?? props.defaultWordsShown)
      return { id: p.id, label: verse.words.slice(from, from + count).join(' ') }
    })
}

const editingVerse = computed(() =>
  props.verses.find((v) => v.verseKey === editingKey.value),
)

const selection = computed(() => {
  if (!range.value) return null
  const [a, b] = range.value
  return { offset: Math.min(a, b), count: Math.abs(b - a) + 1 }
})

const selectedText = computed(() => {
  const verse = editingVerse.value
  const sel = selection.value
  if (!verse || !sel) return ''
  return verse.words.slice(sel.offset, sel.offset + sel.count).join(' ')
})

/* ------------------------------------------------------------ memilih kalimat */

/**
 * Kalimat pilihan (bukan default) yang MENCAKUP kata ke-`index` pada ayat
 * ini, kalau ada — dipakai supaya ketukan pada kalimat yang sudah dipakai
 * langsung menghapusnya, tanpa perlu mencari chip terpisah.
 */
function pickAtWord(verse: PageVerse, index: number): HelperVerse | undefined {
  const last = verse.words.length - 1
  return (picksByKey.value.get(verse.verseKey) ?? []).find((p) => {
    const from = Math.min(Math.max(0, p.wordOffset ?? 0), Math.max(0, last))
    const count = Math.max(1, p.wordsShown ?? props.defaultWordsShown)
    return index >= from && index <= from + count - 1
  })
}

/**
 * Ketukan pada sebuah kata:
 *  - kata itu bagian dari kalimat bantuan yang SUDAH ditambahkan (bukan
 *    bawaan) → hapus kalimat itu langsung, sesuai cara baru menghapus;
 *  - ayat belum terbuka untuk dipilih → kata itu jadi awal kalimat pilihan;
 *  - ayat sudah terbuka → ujung rentang digeser sampai kata itu.
 */
function onWordTap(verse: PageVerse, index: number): void {
  const existingPick = pickAtWord(verse, index)
  if (existingPick?.id != null && editingKey.value !== verse.verseKey) {
    emit('removePick', existingPick.id)
    return
  }

  if (editingKey.value !== verse.verseKey || !range.value) {
    editingKey.value = verse.verseKey
    range.value = [index, index]
    return
  }

  range.value = [range.value[0], index]
}

function cancelEditing(): void {
  editingKey.value = null
  range.value = null
}

/** Tambahkan kalimat terpilih ke memorize. Panel TETAP terbuka sesudahnya,
 *  supaya bisa langsung lanjut memilih kalimat lain tanpa buka-tutup panel. */
function applySelection(): void {
  const key = editingKey.value
  const sel = selection.value
  if (!key || !sel) return
  emit('pick', { verseKey: key, wordOffset: sel.offset, wordsShown: sel.count })
  cancelEditing()
}

const shownCount = computed(() => props.verses.filter((v) => isShown(v.verseKey)).length)

/** Berapa kalimat yang sudah ditambahkan sendiri pada halaman ini */
const pickCount = computed(() => props.picks.length)
</script>

<template>
  <SheetModal title="Pilih kalimat bantuan" @close="emit('close')">
    <p class="intro">
      Halaman {{ page }} ditampilkan penuh. <strong>Ketuk</strong> kata awal kalimat, lalu ketuk
      kata terakhirnya untuk memperpanjang, lalu tekan "Tambahkan ke memorize" — langsung tampil
      di memorize tanpa menutup panel ini, jadi bisa lanjut pilih kalimat lain. Satu ayat boleh
      menampung berapa pun kalimat. Untuk menghapus kalimat bantuan yang sudah ditambahkan,
      cukup <strong>ketuk langsung</strong> kalimat itu (yang sudah bertanda "sudah tampil").
      Pilihan tersimpan di HP.
    </p>

    <div class="legend">
      <span class="chip shown">sudah tampil ({{ shownCount }})</span>
      <span class="chip available">ketuk untuk tambah</span>
      <span v-if="pickCount" class="chip count">{{ pickCount }} kalimat ditambahkan</span>
    </div>

    <!-- Kalimat terpilih: satu tombol untuk langsung menambahkannya ke memorize -->
    <Transition name="fade">
      <div v-if="selection && editingVerse" class="picked">
        <div class="picked-head">
          <span class="picked-label">
            {{ editingVerse.surah }}:{{ editingVerse.ayah }} · {{ selection.count }} kata
          </span>
          <button type="button" class="picked-cancel" aria-label="Batal" @click="cancelEditing">
            ×
          </button>
        </div>

        <p class="picked-text" dir="rtl">{{ selectedText }}</p>

        <div class="picked-actions">
          <button type="button" class="act primary" @click="applySelection">
            Tambahkan ke memorize
          </button>
        </div>
      </div>
    </Transition>

    <div class="verses" dir="rtl">
      <div
        v-for="v in verses"
        :key="v.verseKey"
        class="verse"
        :class="{ shown: isShown(v.verseKey), editing: editingKey === v.verseKey }"
      >
        <p class="text">
          <!-- Ketuk kata awal, lalu ketuk kata akhir untuk memperpanjang pilihan.
               Kata yang sudah jadi bagian kalimat bantuan tersimpan, ketukannya
               langsung menghapus kalimat itu. -->
          <span
            v-for="(w, i) in v.words"
            :key="i"
            class="word"
            :class="wordState(v, i)"
            @click="onWordTap(v, i)"
            >{{ w }}</span
          >
          <span class="num" aria-hidden="true">{{ toArabicNumber(v.ayah) }}</span>
        </p>

        <!--
          Ringkasan kalimat bantuan yang sudah ditambahkan untuk ayat ini —
          menghapus juga bisa lewat sini (selain ketuk langsung di teks ayat).
        -->
        <div v-if="pickChips(v).length" class="picks" dir="rtl">
          <button
            v-for="chip in pickChips(v)"
            :key="chip.id"
            type="button"
            class="pick-chip"
            :aria-label="`Hapus kalimat ${chip.label}`"
            @click="emit('removePick', chip.id)"
          >
            <span class="pick-chip-text">{{ chip.label }}</span>
            <span class="pick-chip-x" aria-hidden="true">×</span>
          </button>

          <button
            type="button"
            class="reset"
            aria-label="Kembalikan ke awal ayat"
            @click="emit('reset', v.verseKey)"
          >
            bawaan
          </button>
        </div>
      </div>
    </div>
  </SheetModal>
</template>


<style scoped>
.intro {
  margin: 0 0 0.7rem;
  font-size: 0.78rem;
  opacity: 0.75;
  line-height: 1.5;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-bottom: 0.7rem;
}

.chip {
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  font-size: 0.66rem;
  border: 1px solid var(--color-paper-edge);
}

.chip.shown {
  border-color: var(--color-accent);
  background: color-mix(in srgb, var(--color-accent) 16%, transparent);
}

.chip.count {
  border-style: dashed;
  opacity: 0.75;
}

/* ------------------------------------------------------- kalimat terpilih */
.picked {
  margin-bottom: 0.7rem;
  padding: 0.6rem 0.7rem;
  border: 1px solid var(--color-accent);
  border-radius: 0.8rem;
  background: color-mix(in srgb, var(--color-accent) 10%, transparent);
}

.picked-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.picked-label {
  font-size: 0.7rem;
  opacity: 0.75;
}

.picked-cancel {
  width: 1.6rem;
  height: 1.6rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font-size: 1.1rem;
  line-height: 1;
}

.picked-text {
  margin: 0.3rem 0 0.5rem;
  font-family: var(--font-mushaf);
  font-size: var(--mushaf-text-sm);
  line-height: 1.9;
}

.picked-actions {
  display: flex;
  gap: 0.4rem;
}

.act {
  flex: 1;
  padding: 0.55rem 0.6rem;
  border-radius: 0.7rem;
  font-size: 0.78rem;
  font-weight: 600;
  border: 1px solid var(--color-accent);
  background: transparent;
  color: inherit;
}

.act.primary {
  border-color: transparent;
  background: var(--color-accent);
  color: #fff;
}

/* ---------------------------------------------------------- daftar ayat */
.verses {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  max-height: 48vh;
  overflow-y: auto;
}

.verse {
  position: relative;
  padding: 0.55rem 0.7rem;
  border: 1px solid var(--color-paper-edge);
  border-radius: 0.7rem;
}

.verse.shown {
  border-color: color-mix(in srgb, var(--color-accent) 55%, transparent);
}

.verse.editing {
  border-color: var(--color-accent);
  background: color-mix(in srgb, var(--color-accent) 7%, transparent);
}

.text {
  margin: 0;
  font-family: var(--font-mushaf);
  font-size: var(--mushaf-text);
  line-height: 2.05;
}

/*
 * Tiap kata jadi target sentuh sendiri.
 *
 * `touch-action: manipulation` — bukan `none`: dengan `none`, browser tidak
 * membangkitkan event klik dari sentuhan, sehingga ketukan pada kata tidak
 * pernah sampai ke handler dan kalimat mustahil dipilih. `manipulation` tetap
 * mematikan ketuk-ganda-untuk-zoom, tapi ketukan biasa tetap terkirim.
 */
.word {
  display: inline-block;
  padding-inline: 0.12em;
  border-radius: 0.2rem;
  touch-action: manipulation;
}

.word.shown {
  background: color-mix(in srgb, var(--color-accent) 18%, transparent);
  box-shadow: inset 0 -0.09em 0 color-mix(in srgb, var(--color-accent) 55%, transparent);
}

.word.picking {
  background: var(--color-accent);
  color: #fff;
}

.num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.65em;
  min-height: 1.65em;
  margin-inline-start: 0.2em;
  font-size: 0.68em;
  border: 2px solid color-mix(in srgb, currentColor 75%, transparent);
  border-radius: 999px;
}

/*
 * Daftar kalimat yang sudah ditambahkan pada sebuah ayat. Mengalir di bawah
 * teks ayatnya (bukan menumpang di atasnya) supaya berapa pun jumlah kalimat
 * yang ditambahkan tetap terbaca semuanya.
 */
.picks {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem;
  margin-top: 0.35rem;
  padding-top: 0.35rem;
  border-top: 1px dashed color-mix(in srgb, currentColor 14%, transparent);
}

.pick-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  max-width: 100%;
  padding: 0.12rem 0.3rem 0.12rem 0.5rem;
  border: 1px solid color-mix(in srgb, var(--color-accent) 55%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  color: inherit;
}

.pick-chip-text {
  font-family: var(--font-mushaf);
  font-size: 0.8rem;
  line-height: 1.7;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pick-chip-x {
  flex: 0 0 auto;
  font-size: 0.85rem;
  line-height: 1;
  opacity: 0.65;
}

.reset {
  padding: 0.1rem 0.45rem;
  border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font-size: 0.6rem;
  opacity: 0.7;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.16s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.dark .verse,
.dark .chip {
  border-color: var(--color-night-edge);
}

.dark .verse.shown {
  border-color: color-mix(in srgb, var(--color-accent-soft) 55%, transparent);
}

.dark .chip.shown,
.dark .picked {
  border-color: var(--color-accent-soft);
  background: color-mix(in srgb, var(--color-accent-soft) 14%, transparent);
}

.dark .word.shown {
  background: color-mix(in srgb, var(--color-accent-soft) 20%, transparent);
}

.dark .pick-chip {
  border-color: color-mix(in srgb, var(--color-accent-soft) 55%, transparent);
  background: color-mix(in srgb, var(--color-accent-soft) 16%, transparent);
}

.dark .word.picking,
.dark .act.primary {
  background: var(--color-accent-soft);
  color: #06120f;
}

.dark .act {
  border-color: var(--color-accent-soft);
}
</style>
