/**
 * Integrasi audio UmmahAPI (§ Menu Audio / Setting Audio).
 *
 * Bentuk response ini diambil dari hasil fetch SUNGGUHAN (bukan dokumentasi —
 * dokumentasi UmmahAPI tidak merinci skema `data`), supaya nama field di sini
 * dijamin cocok:
 *
 *   GET /api/quran/reciters
 *   → { success, data: { total, reciters: [{ id, name, name_arabic, style }] } }
 *
 *   GET /api/quran/audio/{surah}?reciter={id}
 *   → { success, data: {
 *         surah: { number, name_arabic, name_english },
 *         reciter: { id, name, name_arabic, style },
 *         full_surah_audio: string,
 *         ayah_by_ayah: [{ verse_key, ayah, audio_url }]
 *       } }
 *
 * CATATAN: audio_url mp3 di-hosting di everyayah.com / quranicaudio.com /
 * mp3quran.net (bukan domain ummahapi.com sendiri) — CDN pihak ketiga, bukan
 * bug. Tidak butuh endpoint /audio/{surah}/{ayah} (per-ayat lintas-qari)
 * karena /audio/{surah}?reciter=.. sudah memberi breakdown per-ayat untuk
 * satu qari, yang justru itu yang kita perlukan untuk playlist rentang ayat.
 */
const BASE = 'https://ummahapi.com/api/quran'

export interface Reciter {
  id: number
  name: string
  nameArabic: string
  style: string
}

export interface AyahAudio {
  verseKey: string
  url: string
}

let recitersCache: Reciter[] | null = null

export async function fetchReciters(): Promise<Reciter[]> {
  if (recitersCache) return recitersCache
  const res = await fetch(`${BASE}/reciters`)
  if (!res.ok) throw new Error(`Gagal memuat daftar qari (HTTP ${res.status})`)
  const json = await res.json()
  const list = json?.data?.reciters
  if (!Array.isArray(list)) throw new Error('Format respons daftar qari tidak dikenali')
  recitersCache = list.map((r: any) => ({
    id: r.id,
    name: r.name,
    nameArabic: r.name_arabic,
    style: r.style,
  }))
  return recitersCache
}

/** Cache per (surah, reciter) — satu surah yang sama tidak di-fetch ulang tiap pindah halaman. */
const surahAudioCache = new Map<string, Map<string, string>>()

async function fetchSurahAyahAudio(surah: number, reciterId: number): Promise<Map<string, string>> {
  const cacheKey = `${surah}:${reciterId}`
  const cached = surahAudioCache.get(cacheKey)
  if (cached) return cached

  const res = await fetch(`${BASE}/audio/${surah}?reciter=${reciterId}`)
  if (!res.ok) throw new Error(`Gagal memuat audio surah ${surah} (HTTP ${res.status})`)
  const json = await res.json()
  const ayahs = json?.data?.ayah_by_ayah
  if (!Array.isArray(ayahs)) throw new Error(`Format respons audio surah ${surah} tidak dikenali`)

  const map = new Map<string, string>()
  for (const a of ayahs) {
    if (a?.verse_key && a?.audio_url) map.set(a.verse_key, a.audio_url)
  }
  surahAudioCache.set(cacheKey, map)
  return map
}

/**
 * Susun playlist URL audio untuk sederet verseKey (boleh lintas surah — mis.
 * rentang Audio yang menandai akhir satu surah sampai awal surah berikutnya),
 * URUT SESUAI `verseKeys` yang diberikan, bukan urutan response per-surah.
 *
 * verseKey yang tidak ketemu (mis. qari tidak merekam ayat itu) dilewati
 * dengan diam-diam — lebih baik daripada memutus seluruh playback karena satu
 * ayat hilang.
 */
export async function resolveAyahAudio(
  verseKeys: string[],
  reciterId: number,
): Promise<AyahAudio[]> {
  const surahNumbers = [...new Set(verseKeys.map((k) => Number(k.split(':')[0])))]
  // Fetch tiap surah yang terlibat secara paralel
  const maps = await Promise.all(
    surahNumbers.map(async (s) => [s, await fetchSurahAyahAudio(s, reciterId)] as const),
  )
  const bySurah = new Map(maps)

  const out: AyahAudio[] = []
  for (const key of verseKeys) {
    const surahNo = Number(key.split(':')[0])
    const url = bySurah.get(surahNo)?.get(key)
    if (url) out.push({ verseKey: key, url })
  }
  return out
}

/** Dipakai hanya untuk pengujian: kosongkan cache module-level. */
export function clearAudioCacheForTests(): void {
  recitersCache = null
  surahAudioCache.clear()
}