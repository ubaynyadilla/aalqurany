<script setup lang="ts">
/**
 * Hiasan visual satu tanda pada satu kalimat (segmen ayat) di memorize mode.
 *
 * Dulu komponen ini mewakili SATU tanda yang bebas diletakkan & diubah ukuran
 * di mana saja pada baris (posisi x/y, skala lebar/tinggi tersendiri). Sekarang
 * tanda selalu menempel penuh pada kotak kalimatnya — parent (`.segment` di
 * MemorizeMode.vue) yang menentukan ukuran & posisi lewat layout biasa;
 * komponen ini murni gambar dekoratifnya saja, `inset` mengisi kotak itu.
 *
 * `mergeStart`/`mergeEnd` dipakai saat kalimat tetangga (sebelum/sesudahnya
 * dalam urutan baca) bertanda dengan bentuk yang SAMA: sisi yang bersambung
 * diratakan dan direnggangkan sedikit ke arah tetangga, supaya dua tanda
 * terlihat sebagai satu bentuk memanjang, bukan dua bentuk terpisah yang
 * kebetulan berdekatan. Dipakai lewat properti logis (inline-start/end)
 * supaya otomatis benar di tata letak kanan-ke-kiri tanpa perlu tahu mana
 * "kiri" atau "kanan" sungguhan.
 */
import type { MarkShape } from '@/types'

defineProps<{
  shape: MarkShape
  /** Menyambung ke kalimat SEBELUMNYA (urutan baca) yang bertanda sama */
  mergeStart?: boolean
  /** Menyambung ke kalimat BERIKUTNYA (urutan baca) yang bertanda sama */
  mergeEnd?: boolean
}>()
</script>

<template>
  <span
    class="mark-decor"
    :class="[shape, { 'merge-start': mergeStart, 'merge-end': mergeEnd }]"
    aria-hidden="true"
  />
</template>

<style scoped>
/*
 * WARNA TANDA SENGAJA OPAK (dicampur dengan warna kertas), bukan transparan.
 * Dua tanda bersebelahan yang bersambung saling menumpuk di daerah
 * sambungannya; dengan warna transparan, daerah tumpukan itu tampil lebih pekat
 * — pita oranye yang lebih tebal di tengah stabilo yang seharusnya satu bentuk.
 * Warna opak yang sama dari kedua sisi menumpuk tanpa terlihat. Hasil akhirnya
 * sama dengan warna transparan di atas kertas, jadi tampilannya tak berubah.
 *
 * Semua tanda tergambar di bawah SEMUA teks pada barisnya (baris adalah
 * stacking context, lihat `isolation` pada .line / .mushaf-line), jadi tumpukan
 * itu tak pernah menutupi huruf kata tetangga.
 */
.mark-decor {
  --mark-line: color-mix(in srgb, var(--color-accent) 78%, var(--color-paper));
  --mark-fill: color-mix(in srgb, var(--color-accent) 8%, var(--color-paper));
  --mark-highlight: color-mix(in srgb, #ff8a00 38%, var(--color-paper));
  position: absolute;
  /*
   * Tinggi tanda SENGAJA di dalam kotak kata, bukan keluar dari atas/bawahnya.
   * Kotak kata sudah setinggi line-height (1.9em + padding), sehingga dulu
   * inset negatif membuat tanda lebih tinggi dari barisnya sendiri dan sisi
   * atas/bawah bulat & kotak terpotong oleh `overflow: hidden` pada `.line`
   * (paling parah pada baris yang membungkus ke beberapa baris grid). Dengan
   * inset positif, tanda setinggi ±1.7em: cukup menutup harakat di atas dan
   * bawah huruf, dan tidak pernah melewati batas baris.
   */
  inset: 0.15em -0.22em;
  /* z-index negatif + isolation:isolate pada .segment (parent) supaya
     dekorasi ini pasti tergambar DI BAWAH teks ayat, tapi tetap terkurung di
     dalam kotak kalimatnya sendiri — tidak bocor menimpa kalimat lain. */
  z-index: -1;
  pointer-events: none;
  border-radius: 0.9em;
}

.mark-decor.circle,
.mark-decor.box {
  border: 2px solid var(--mark-line);
  background: var(--mark-fill);
}

.mark-decor.circle {
  border-radius: 999px;
}

.mark-decor.box {
  border-radius: 0.35em;
}

.mark-decor.highlight {
  border-radius: 0.35em;
  background: var(--mark-highlight);
}

/* Sisi yang menyambung ke tetangga bertanda sama: diratakan & direnggangkan
   separuh jarak antar-kalimat supaya tidak ada celah di sambungannya. Dua
   aturan ini sengaja ditulis SETELAH .circle/.box/.highlight di atas supaya
   menang saat keduanya cocok bersamaan (spesifisitas selector-nya sama). */
.mark-decor.merge-start {
  border-start-start-radius: 0;
  border-end-start-radius: 0;
  border-inline-start: none;
  margin-inline-start: -0.4em;
}

.mark-decor.merge-end {
  border-start-end-radius: 0;
  border-end-end-radius: 0;
  border-inline-end: none;
  margin-inline-end: -0.4em;
}

.dark .mark-decor {
  --mark-line: color-mix(in srgb, var(--color-accent-soft) 85%, var(--color-night));
  --mark-fill: color-mix(in srgb, var(--color-accent-soft) 14%, var(--color-night));
  --mark-highlight: color-mix(in srgb, #ff9d2e 42%, var(--color-night));
}
</style>
