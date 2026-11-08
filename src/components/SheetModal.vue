<script setup lang="ts">
/** Panel bawah (bottom sheet) untuk dialog navigasi & setelan. */
import { iconClose } from './icons'

defineProps<{ title: string }>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <div class="scrim" @click.self="emit('close')">
    <section class="sheet safe-bottom" role="dialog" aria-modal="true" :aria-label="title">
      <header class="head">
        <h2>{{ title }}</h2>
        <button type="button" class="close" aria-label="Tutup" @click="emit('close')">
          <span aria-hidden="true" v-html="iconClose" />
        </button>
      </header>
      <div class="body">
        <slot />
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
  max-height: 82vh;
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
  padding: 0.9rem 1.15rem 1.3rem;
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
</style>
