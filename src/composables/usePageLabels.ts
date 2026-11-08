/**
 * Label pills atas untuk halaman yang sedang dibuka — dipakai reader dan
 * memorize supaya keduanya menampilkan tulisan yang sama persis.
 */
import { computed } from 'vue'
import { useQuranStore } from '@/stores/quranStore'
import { toArabicNumber } from '@/utils/arabicNumerals'

export function usePageLabels() {
  const quran = useQuranStore()

  /** Surah yang mendapat pills: yang pertama tampil di halaman ini */
  const headerSurah = computed(() => quran.surahsOnPage[0])

  // Label memakai tulisan Arab agar seragam dengan tampilan mushaf
  const surahLabelArabic = computed(() =>
    headerSurah.value ? `سورة ${headerSurah.value.nameArabic}` : 'سورة',
  )
  const surahLabelLatin = computed(() => headerSurah.value?.nameLatin ?? '')

  const juzLabelArabic = computed(() =>
    quran.currentJuz ? `جزء ${toArabicNumber(quran.currentJuz)}` : 'جزء',
  )

  /** Lembar ke berapa di dalam juz ini (1–20), angka Arab: "٨ | جزء ٣" */
  const juzSheetArabic = computed(() =>
    quran.currentJuzSheet ? toArabicNumber(quran.currentJuzSheet) : '',
  )

  return { headerSurah, surahLabelArabic, surahLabelLatin, juzLabelArabic, juzSheetArabic }
}
