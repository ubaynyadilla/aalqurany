<script setup lang="ts">
/**
 * Bingkai nama surah, meniru hiasan kepala surah pada mushaf cetak.
 *
 * Ornamennya digambar sebagai SVG: bingkai bertakik gaya Kufi (sudut bersiku,
 * bukan lengkung), pita geometris berulang di sisi kanan-kiri, dan rozet
 * bersegi delapan di kedua ujung. Semua garis memakai `currentColor` sehingga
 * ikut warna tinta pada Light/Dark Mode tanpa aturan tambahan.
 *
 * Tinggi bingkai ditentukan isinya sendiri (bukan `height: 100%`), supaya tidak
 * ikut mengempis ketika baris induknya kekurangan ruang.
 */
const props = defineProps<{
  nameArabic: string
  /**
   * Melebar memenuhi baris dengan pita ornamen memanjang di kedua sisi —
   * dipakai reader agar sama seperti mushaf cetak. Tanpa ini bingkai hanya
   * selebar namanya, cukup untuk panel memorize.
   */
  full?: boolean
  /** Ukuran ringkas untuk panel memorize yang barisnya lebih pendek */
  compact?: boolean
}>()
</script>

<template>
  <div class="surah-frame" :class="{ full: props.full, compact: props.compact }">
    <!-- Pita ornamen kiri, hanya pada versi lebar penuh -->
    <svg
      v-if="props.full"
      class="band"
      viewBox="0 0 48 32"
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      <!--
        Motif Kufi: siku bersambung yang berulang. Digambar sebagai path agar
        tetap tajam pada segala ukuran.
      -->
      <path class="stroke" d="M2 6h44M2 26h44" stroke-width="1.4" stroke-linecap="square" />
      <path class="stroke" d="M6 6v6h6v8h6v-8h6v8h6v-8h6v6" stroke-width="1.2" />
      <path class="stroke" d="M30 20v6" stroke-width="1.2" />
    </svg>

    <!-- Rozet bersegi delapan, penanda pangkal bingkai -->
    <svg class="rosette" viewBox="0 0 24 24" aria-hidden="true">
      <path
        class="stroke"
        d="M12 2.6 17 5.2 19.4 10.2 19.4 13.8 17 18.8 12 21.4 7 18.8 4.6 13.8 4.6 10.2 7 5.2Z"
        stroke-width="1.3"
      />
      <path class="stroke" d="M12 6.6 15.2 12 12 17.4 8.8 12Z" stroke-width="1.1" />
      <circle class="fill" cx="12" cy="12" r="1.5" />
    </svg>

    <span class="name">سورة {{ nameArabic }}</span>

    <svg class="rosette" viewBox="0 0 24 24" aria-hidden="true">
      <path
        class="stroke"
        d="M12 2.6 17 5.2 19.4 10.2 19.4 13.8 17 18.8 12 21.4 7 18.8 4.6 13.8 4.6 10.2 7 5.2Z"
        stroke-width="1.3"
      />
      <path class="stroke" d="M12 6.6 15.2 12 12 17.4 8.8 12Z" stroke-width="1.1" />
      <circle class="fill" cx="12" cy="12" r="1.5" />
    </svg>

    <!-- Pita ornamen kanan: motif yang sama, dicerminkan -->
    <svg
      v-if="props.full"
      class="band mirror"
      viewBox="0 0 48 32"
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      <path class="stroke" d="M2 6h44M2 26h44" stroke-width="1.4" stroke-linecap="square" />
      <path class="stroke" d="M6 6v6h6v8h6v-8h6v8h6v-8h6v6" stroke-width="1.2" />
      <path class="stroke" d="M30 20v6" stroke-width="1.2" />
    </svg>
  </div>
</template>

<style scoped>
.surah-frame {
  position: relative;
  /* Selebar isinya saja; reader memakai varian .full untuk memanjang */
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  /* Tinggi ditentukan isi + padding, jadi tidak bisa mengempis */
  padding: 0.3rem 0.7rem;
  border: 1.6px solid color-mix(in srgb, var(--color-accent) 52%, transparent);
  border-radius: 0.2rem;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--color-accent) 9%, transparent),
    transparent 70%
  );
  color: color-mix(in srgb, var(--color-accent) 72%, var(--color-ink));
}

/* Garis dalam kedua, memberi kesan bingkai berlapis seperti cetakan */
.surah-frame::before {
  content: '';
  position: absolute;
  inset: 0.17rem;
  border: 0.8px solid color-mix(in srgb, var(--color-accent) 30%, transparent);
  border-radius: 0.12rem;
  pointer-events: none;
}

.full {
  display: flex;
  width: 100%;
}

.stroke {
  stroke: currentColor;
  fill: none;
  opacity: 0.72;
}

.fill {
  fill: currentColor;
  stroke: none;
  opacity: 0.72;
}

/* Pita hanya memanjang pada versi .full */
.band {
  flex: 1 1 auto;
  min-width: 1rem;
  height: 1.05em;
  opacity: 0.85;
}

.mirror {
  transform: scaleX(-1);
}

.rosette {
  flex: 0 0 auto;
  width: 1.05em;
  height: 1.05em;
}

.name {
  flex: 0 0 auto;
  padding-inline: 0.2rem;
  font-family: var(--font-mushaf);
  /* Mengikuti ukuran teks halaman (--fit-size bila di dalam mushaf), supaya
     nama surah tidak pernah tampak lebih besar dari ayatnya */
  font-size: var(--fit-size, var(--mushaf-text));
  line-height: 1.6;
  letter-spacing: 0.02em;
  white-space: nowrap;
  color: var(--color-ink);
}

/* Versi ringkas untuk baris memorize yang tingginya lebih kecil */
.compact {
  gap: 0.3rem;
  padding: 0.18rem 0.5rem;
}

.compact .name {
  font-size: var(--mushaf-text-sm);
  line-height: 1.5;
}

.compact .rosette {
  width: 0.9em;
  height: 0.9em;
}

.dark .surah-frame {
  border-color: color-mix(in srgb, var(--color-accent-soft) 48%, transparent);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--color-accent-soft) 10%, transparent),
    transparent 70%
  );
  color: color-mix(in srgb, var(--color-accent-soft) 78%, var(--color-night-ink));
}

.dark .surah-frame::before {
  border-color: color-mix(in srgb, var(--color-accent-soft) 26%, transparent);
}

.dark .name {
  color: var(--color-night-ink);
}
</style>
