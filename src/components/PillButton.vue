<script setup lang="ts">
withDefaults(
  defineProps<{
    label: string
    icon?: string
    active?: boolean
    compact?: boolean
  }>(),
  { icon: undefined, active: false, compact: false },
)
</script>

<template>
  <button
    type="button"
    class="pill no-select"
    :class="[active ? 'pill-active' : '', compact ? 'pill-compact' : '']"
  >
    <span v-if="icon" class="pill-icon" aria-hidden="true" v-html="icon" />
    <span>{{ label }}</span>
  </button>
</template>

<style scoped>
.pill {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.6rem 1.05rem;
  border-radius: 999px;
  border: 1px solid var(--color-paper-edge);
  background: rgb(255 255 255 / 0.92);
  color: var(--color-ink);
  font-size: 0.85rem;
  font-weight: 500;
  line-height: 1;
  box-shadow: 0 6px 18px rgb(0 0 0 / 0.12);
  backdrop-filter: blur(6px);
  transition:
    transform 0.15s ease,
    background-color 0.2s ease;
}

.pill:active {
  transform: scale(0.96);
}

.pill-compact {
  padding: 0.45rem 0.8rem;
  font-size: 0.78rem;
}

.pill-active {
  background: var(--color-accent);
  border-color: var(--color-accent);
  color: #fff;
}

.pill-icon {
  display: inline-flex;
  width: 1.05rem;
  height: 1.05rem;
}

.pill-icon :deep(svg) {
  width: 100%;
  height: 100%;
}

.dark .pill {
  border-color: var(--color-night-edge);
  background: rgb(28 30 34 / 0.92);
  color: var(--color-night-ink);
  box-shadow: 0 6px 18px rgb(0 0 0 / 0.45);
}

.dark .pill-active {
  background: var(--color-accent-soft);
  border-color: var(--color-accent-soft);
  color: #06120f;
}
</style>
