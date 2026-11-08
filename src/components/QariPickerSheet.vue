<script setup lang="ts">
/**
 * Pop up pilih qari (§Setting Audio). Menggantikan `<select>` lama: daftar
 * qari ditampilkan sebagai pills yang bisa di-scroll vertikal (hemat ruang,
 * tidak melebar ke samping), dengan tanda centang di sisi kiri pill yang
 * sedang aktif/terpilih.
 */
import { iconCheck, iconClose } from './icons'
import type { Reciter } from '@/services/quranAudio'

const props = defineProps<{
  reciters: Reciter[]
  selected: string | null
}>()

const emit = defineEmits<{
  close: []
  pick: [id: string]
}>()

function isActive(r: Reciter): boolean {
  return props.selected != null && String(r.id) === props.selected
}

function pick(r: Reciter): void {
  emit('pick', String(r.id))
  emit('close')
}
</script>

<template>
  <div class="scrim" @click.self="emit('close')">
    <section class="sheet safe-bottom" role="dialog" aria-modal="true" aria-label="Pilih Qari">
      <header class="head">
        <h2>Qari</h2>
        <button type="button" class="close" aria-label="Tutup" @click="emit('close')">
          <span aria-hidden="true" v-html="iconClose" />
        </button>
      </header>
      <div class="body">
        <p v-if="!reciters.length" class="state">Memuat daftar qari...</p>
        <div v-else class="pills" role="radiogroup" aria-label="Daftar qari">
          <button
            v-for="r in reciters"
            :key="r.id"
            type="button"
            class="pill"
            :class="{ on: isActive(r) }"
            role="radio"
            :aria-checked="isActive(r)"
            @click="pick(r)"
          >
            <span class="check" aria-hidden="true" v-html="isActive(r) ? iconCheck : ''" />
            <span class="name">{{ r.name }}</span>
          </button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: flex-end;
  background: rgb(0 0 0 / 0.45);
  animation: fade 0.16s ease;
}

.sheet {
  width: 100%;
  max-height: 72vh;
  display: flex;
  flex-direction: column;
  background: var(--color-paper);
  color: var(--color-ink);
  border-radius: 1.25rem 1.25rem 0 0;
  box-shadow: 0 -12px 34px rgb(0 0 0 / 0.28);
  animation: rise 0.2s ease;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 1rem 1.15rem 0.6rem;
  border-bottom: 1px solid var(--color-paper-edge);
}

.head h2 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
}

.close {
  display: inline-flex;
  width: 2rem;
  height: 2rem;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: inherit;
}

.close :deep(svg) {
  width: 1.15rem;
  height: 1.15rem;
}

.body {
  overflow-y: auto;
  padding: 0.6rem 1.15rem 1.3rem;
}

.state {
  margin: 0;
  padding: 1rem 0;
  font-size: 0.85rem;
  opacity: 0.65;
  text-align: center;
}

.pills {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.pill {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  width: 100%;
  padding: 0.6rem 0.8rem;
  border-radius: 999px;
  border: 1px solid var(--color-paper-edge);
  background: transparent;
  color: var(--color-ink);
  font-size: 0.85rem;
  text-align: start;
  touch-action: manipulation;
}

.pill .check {
  flex: 0 0 1rem;
  width: 1rem;
  height: 1rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #ff8a00;
}

.pill .check :deep(svg) {
  width: 1rem;
  height: 1rem;
}

.pill .name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pill.on {
  border-color: #ff8a00;
  background: color-mix(in srgb, #ff8a00 12%, transparent);
  color: #ff8a00;
}

@keyframes rise {
  from {
    transform: translateY(14%);
    opacity: 0.6;
  }
}

@keyframes fade {
  from {
    opacity: 0;
  }
}

.dark .sheet {
  background: var(--color-night);
  color: var(--color-night-ink);
}

.dark .head {
  border-color: var(--color-night-edge);
}

.dark .pill {
  border-color: var(--color-night-edge);
  color: var(--color-night-ink);
}

.dark .pill.on {
  border-color: #ff9d2e;
  background: color-mix(in srgb, #ff9d2e 16%, transparent);
  color: #ff9d2e;
}
</style>