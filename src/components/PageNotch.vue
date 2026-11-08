<script setup lang="ts">
/**
 * Nomor halaman di tengah bawah layar.
 *
 * Bentuknya notch: menempel pada tepi bawah, sudut atas melengkung, berlatar
 * hijau transparan sehingga teks mushaf di belakangnya tetap terbaca. Angkanya
 * ditulis dengan angka Arab agar seragam dengan tampilan mushaf.
 *
 * Di reader, notch ini sekaligus pemanggil menu pills: `tappable` membuatnya
 * menjadi tombol. Tanpa prop itu ia tetap penunjuk halaman biasa yang tidak
 * menangkap sentuhan (dipakai di memorize).
 */
import { computed } from 'vue'
import { toArabicNumber } from '@/utils/arabicNumerals'

const props = defineProps<{
  page: number
  /** Diteruskan ke aria-label agar pembaca layar tetap menyebut angka Latin */
  total?: number
  /** True bila notch berfungsi sebagai tombol pemanggil menu */
  tappable?: boolean
  /** True saat menu sedang terbuka — dipakai untuk aria-expanded & sorotan */
  open?: boolean
  /**
   * True untuk memutar animasi petunjuk satu kali: notch memanjang naik sedikit
   * lalu kembali, menandakan bahwa nomor halaman ini adalah tombol menu.
   */
  hint?: boolean
}>()

const emit = defineEmits<{ toggle: []; hintDone: [] }>()

function onAnimationEnd(e: AnimationEvent): void {
  if (e.animationName.includes('notch-hint')) emit('hintDone')
}

const arabic = computed(() => toArabicNumber(props.page))
const base = computed(() =>
  props.total ? `Halaman ${props.page} dari ${props.total}` : `Halaman ${props.page}`,
)
const label = computed(() =>
  props.tappable ? `${base.value}. Ketuk untuk membuka menu` : base.value,
)
</script>

<template>
  <button
    v-if="tappable"
    type="button"
    class="page-notch tappable"
    :class="{ open, hint }"
    :aria-label="label"
    :aria-expanded="open"
    @click.stop="emit('toggle')"
    @animationend="onAnimationEnd"
  >
    <span class="num" aria-hidden="true">{{ arabic }}</span>
  </button>

  <div v-else class="page-notch" role="status" :aria-label="label">
    <span class="num" aria-hidden="true">{{ arabic }}</span>
  </div>
</template>

<style scoped>
.page-notch {
  position: absolute;
  z-index: 25;
  left: 50%;
  bottom: 0;
  transform: translateX(-50%);
  min-width: 3.6rem;
  display: flex;
  align-items: center;
  justify-content: center;
  padding-inline: 1rem;
  /* Ruang di dalam notch supaya angka tidak mepet bibir atasnya */
  padding-top: 0.4rem;
  /* Angka duduk pada jarak tetap dari tepi bawah (di atas area aman), sama untuk
     notch yang bisa diketuk maupun yang tidak, dan dipakai pills di sampingnya. */
  padding-bottom: calc(var(--notch-pad-bottom) + var(--safe-bottom));
  /* Notch: melengkung di sudut atas, rata dengan tepi bawah layar */
  border-top-left-radius: 1.1rem;
  border-top-right-radius: 1.1rem;
  border: 1px solid color-mix(in srgb, var(--color-accent) 34%, transparent);
  border-bottom: 0;
  background: color-mix(in srgb, var(--color-accent) 16%, transparent);
  color: color-mix(in srgb, var(--color-accent) 92%, var(--color-ink));
  backdrop-filter: blur(5px);
  /* Bayangan ke atas: notch terasa terangkat dari halaman, bukan tempelan datar */
  box-shadow: 0 -3px 14px rgb(0 0 0 / 0.18);
  pointer-events: none;
}

/* Sebagai tombol: menangkap sentuhan, dan sedikit lebih tegas saat menu terbuka */
.page-notch.tappable {
  pointer-events: auto;
  transition: background-color 0.16s ease, transform 0.16s ease;
}

.page-notch.tappable:active {
  transform: translateX(-50%) scale(0.96);
}

.page-notch.tappable.open {
  border-color: color-mix(in srgb, var(--color-accent) 60%, transparent);
  background: color-mix(in srgb, var(--color-accent) 26%, transparent);
}

/*
 * Petunjuk sekali putar saat pertama pindah halaman: notch bertambah tinggi
 * sedikit ke atas (dua denyut), lalu kembali. Yang dianimasikan padding-top;
 * notch menempel di tepi bawah, jadi tambahan tingginya tumbuh ke atas dan
 * angkanya tetap di tempat.
 */
.page-notch.hint {
  animation: notch-hint 1.5s cubic-bezier(0.3, 0.7, 0.3, 1) 1;
}

@keyframes notch-hint {
  0% {
    padding-top: 0.4rem;
  }
  28% {
    padding-top: 1.15rem;
  }
  48% {
    padding-top: 0.6rem;
  }
  68% {
    padding-top: 1.05rem;
  }
  100% {
    padding-top: 0.4rem;
  }
}

.num {
  font-family: var(--font-mushaf);
  font-size: var(--notch-num-size);
  line-height: 1.75;
  letter-spacing: 0.04em;
}

.dark .page-notch {
  border-color: color-mix(in srgb, var(--color-accent-soft) 40%, transparent);
  background: color-mix(in srgb, var(--color-accent-soft) 15%, transparent);
  color: color-mix(in srgb, var(--color-accent-soft) 88%, var(--color-night-ink));
}

.dark .page-notch {
  box-shadow: 0 -3px 14px rgb(0 0 0 / 0.55);
}

.dark .page-notch.tappable.open {
  border-color: color-mix(in srgb, var(--color-accent-soft) 62%, transparent);
  background: color-mix(in srgb, var(--color-accent-soft) 26%, transparent);
}
</style>
