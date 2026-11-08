/** Ubah angka Latin ke angka Arab-Indic (٠١٢٣٤٥٦٧٨٩) agar seragam dengan teks mushaf. */
const DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩']

export function toArabicNumber(value: number): string {
  return String(Math.trunc(Math.abs(value)))
    .split('')
    .map((d) => DIGITS[Number(d)] ?? d)
    .join('')
}
