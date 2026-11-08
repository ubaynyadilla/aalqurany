<script setup lang="ts">
/** Lompat ke ayat tertentu: pilih surah + nomor ayat (§3.1.1). */
import { computed, ref } from 'vue'
import SheetModal from './SheetModal.vue'
import type { Surah } from '@/types'

const props = defineProps<{ surahs: Surah[]; initialSurah?: number }>()
const emit = defineEmits<{ close: []; go: [surah: number, ayah: number] }>()

const surah = ref(props.initialSurah ?? 1)
const ayah = ref(1)
const query = ref('')

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return props.surahs
  return props.surahs.filter(
    (s) =>
      s.nameLatin.toLowerCase().includes(q) ||
      s.nameArabic.includes(q) ||
      String(s.number) === q,
  )
})

const selected = computed(() => props.surahs.find((s) => s.number === surah.value))
const maxAyah = computed(() => selected.value?.versesCount ?? 286)

function pickSurah(n: number): void {
  surah.value = n
  ayah.value = 1
}

function submit(): void {
  const a = Math.min(Math.max(1, Number(ayah.value) || 1), maxAyah.value)
  emit('go', surah.value, a)
}
</script>

<template>
  <SheetModal title="Lompat ke ayat" @close="emit('close')">
    <input v-model="query" class="field" type="search" placeholder="Cari surah..." />

    <div class="list" role="listbox">
      <button
        v-for="s in filtered"
        :key="s.number"
        type="button"
        class="row"
        :class="{ active: s.number === surah }"
        role="option"
        :aria-selected="s.number === surah"
        @click="pickSurah(s.number)"
      >
        <span class="num">{{ s.number }}</span>
        <span class="names">
          <span class="latin">{{ s.nameLatin }}</span>
          <span class="meta">{{ s.versesCount }} ayat</span>
        </span>
        <span class="arabic">{{ s.nameArabic }}</span>
      </button>
    </div>

    <div class="foot">
      <label class="ayah-label">
        Ayat
        <input
          v-model.number="ayah"
          class="field ayah"
          type="number"
          min="1"
          :max="maxAyah"
          inputmode="numeric"
          @keyup.enter="submit"
        />
        <span class="hint">/ {{ maxAyah }}</span>
      </label>
      <button type="button" class="go" @click="submit">
        Buka {{ selected?.nameLatin }} : {{ ayah }}
      </button>
    </div>
  </SheetModal>
</template>

<style scoped>
.field {
  width: 100%;
  padding: 0.65rem 0.85rem;
  border: 1px solid var(--color-paper-edge);
  border-radius: 0.7rem;
  background: rgb(255 255 255 / 0.7);
  color: inherit;
  font-size: 0.9rem;
}

.list {
  margin-top: 0.7rem;
  max-height: 42vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.row {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  width: 100%;
  padding: 0.55rem 0.6rem;
  border: 0;
  border-radius: 0.6rem;
  background: transparent;
  color: inherit;
  text-align: left;
}

.row.active {
  background: color-mix(in srgb, var(--color-accent) 16%, transparent);
}

.num {
  flex: 0 0 1.8rem;
  font-size: 0.78rem;
  opacity: 0.65;
}

.names {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.latin {
  font-size: 0.9rem;
  font-weight: 500;
}

.meta {
  font-size: 0.72rem;
  opacity: 0.6;
}

.arabic {
  font-family: var(--font-mushaf);
  font-size: 1.1rem;
}

.foot {
  margin-top: 0.9rem;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}

.ayah-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
}

.ayah {
  width: 6rem;
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
  font-size: 0.92rem;
  font-weight: 600;
}

.dark .field {
  border-color: var(--color-night-edge);
  background: rgb(255 255 255 / 0.06);
}

.dark .go {
  background: var(--color-accent-soft);
  color: #06120f;
}
</style>
