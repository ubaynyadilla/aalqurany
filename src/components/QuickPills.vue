<script setup lang="ts">
/**
 * Deret pills atas: surah di satu sisi, juz di sisi lain, dan isi bebas di
 * tengah (slot). Dipakai reader (dengan menu di tengah) dan memorize (tanpa
 * isi tengah) supaya keduanya terlihat SATU keluarga.
 *
 * Pills surah = pintu lompat ayat, pills juz = pintu lompat juz/halaman. Pills
 * juz menampilkan lembar ke berapa di dalam juznya: "٨ | جزء ٣" (dir=ltr
 * menjaga urutan visual: nomor lembar di kiri, tanda |, lalu nama juz).
 *
 * Posisi & area aman ditentukan pemakai lewat class (mis. `top-bar safe-top`
 * di reader); komponen ini hanya mengatur isi dan tampilan pills.
 */
defineProps<{
  surahLabel: string
  juzLabel: string
  /** Nomor lembar di dalam juz (angka Arab); kosong = hanya nama juz */
  sheetLabel?: string
  surahAria: string
  juzAria: string
  /** Geser pills ke dalam sejajar garis pinggir mushaf (reader) */
  gutter?: boolean
  /** Ruang sempit: pills dirapatkan ke tepi (menu reader sedang terbuka) */
  tight?: boolean
}>()

defineEmits<{ surah: []; juz: [] }>()
</script>

<template>
  <div class="quick-bar" :class="{ gutter, tight }">
    <button type="button" class="quick-pill pill-surah" :aria-label="surahAria" @click.stop="$emit('surah')">
      <span class="pill-ar">{{ surahLabel }}</span>
    </button>

    <slot />

    <button type="button" class="quick-pill pill-juz" :aria-label="juzAria" @click.stop="$emit('juz')">
      <span class="pill-ar juz-line" dir="ltr">
        <template v-if="sheetLabel">
          <span class="juz-sheet">{{ sheetLabel }}</span>
          <span class="juz-sep" aria-hidden="true">|</span>
        </template>
        <span class="juz-name" dir="rtl">{{ juzLabel }}</span>
      </span>
    </button>
  </div>
</template>

<style scoped>
.quick-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
  padding-inline: 0.3rem;
  pointer-events: none;
}

/*
 * Dua pills (surah, juz) DITULIS oleh komponen ini sendiri, jadi selector
 * scoped biasa (`> *`) sudah mengenainya — elemen itu ikut ditandai atribut
 * scope milik QuickPills. Isi slot tengah (menu Cover/tema/stabilo di reader)
 * DITULIS oleh pemakainya (QuranReader.vue): Vue menandai elemen dengan
 * atribut scope milik KOMPONEN YANG MENULISNYA, bukan yang menampungnya, jadi
 * `> *` tidak pernah mengenai isi slot itu. Akibatnya isi slot mewarisi
 * `pointer-events: none` dari `.quick-bar` di atas dan tombolnya (Cover,
 * tema, stabilo) tidak bisa diketuk sama sekali. `:slotted()` adalah selector
 * khusus Vue untuk menembus batas ini.
 */
.quick-bar > *,
.quick-bar > :slotted(*) {
  pointer-events: auto;
}

.quick-pill {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 34vw;
  padding: 0.3rem 0.78rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid color-mix(in srgb, var(--color-ink) 14%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-ink) 6%, transparent);
  color: var(--color-ink);
  opacity: 0.72;
  backdrop-filter: blur(4px);
  touch-action: manipulation;
}

/* Sejajar garis pinggir mushaf (tepi kiri untuk surah, tepi kanan untuk juz) */
.gutter .pill-surah {
  margin-left: var(--mushaf-gutter);
  transition: margin 0.16s ease;
}

.gutter .pill-juz {
  margin-right: var(--mushaf-gutter);
  transition: margin 0.16s ease;
}

/*
 * Saat menu reader terbuka, barisnya memuat lima benda sekaligus (surah, Cover,
 * tema, stabilo, juz). Di layar HP itu tidak muat, jadi gutter di sisi pills
 * dilepas supaya surah/juz tidak terpotong jadi "سو…".
 */
.gutter.tight .pill-surah {
  margin-left: 0;
}

.gutter.tight .pill-juz {
  margin-right: 0;
}

.pill-ar {
  font-family: var(--font-mushaf);
  font-size: 0.92rem;
  font-weight: var(--mushaf-font-weight, 600);
  line-height: 1.5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.juz-line {
  display: inline-flex;
  align-items: center;
  gap: 0.4em;
}

.juz-sep {
  opacity: 0.4;
}

.juz-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dark .quick-pill {
  border-color: color-mix(in srgb, var(--color-night-ink) 16%, transparent);
  background: color-mix(in srgb, var(--color-night-ink) 9%, transparent);
  color: var(--color-night-ink);
}
</style>
