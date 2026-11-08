/** Ikon inline (SVG) — dipakai lewat v-html pada PillButton & tombol lain. */

const s = (body: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`

/** Lompat ke ayat: penanda sisipan pada baris teks */
export const iconGoVerse = s(
  '<path d="M4 6h16M4 12h9M4 18h16"/><path d="M17 9.5v5l3-2.5z" fill="currentColor" stroke="none"/>',
)

/** Lompat ke juz: tumpukan bagian */
export const iconGoJuz = s('<path d="M4 7h16M4 12h16M4 17h16"/><circle cx="8" cy="7" r="1.6"/><circle cx="14" cy="17" r="1.6"/>')

export const iconMemorize = s(
  '<path d="M6 4h9a3 3 0 0 1 3 3v13H8a2 2 0 0 1-2-2z"/><path d="M6 17h12"/><path d="M10 8h5"/>',
)

/** Stabilo (spidol penanda): dipakai memberi warna pada kata di reader */
export const iconHighlighter = s(
  '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
)

export const iconLock = s('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>')

export const iconReminder = s('<circle cx="12" cy="13" r="7"/><path d="M12 10v3.5l2 1.5"/><path d="M9 3h6"/>')

export const iconMark = s('<path d="M5 18l6-6 3 3 5-7"/><circle cx="7" cy="8" r="2"/>')

/** Reveal: lipatan sudut kertas (curled corner paper) */
export const iconReveal = s(
  '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 16c2.5-2.5 5-2.5 7 0"/>',
)

export const iconSun = s(
  '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4"/>',
)

export const iconMoon = s('<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5z"/>')

export const iconBack = s('<path d="M15 5l-7 7 7 7"/>')

export const iconClose = s('<path d="M6 6l12 12M18 6L6 18"/>')

export const iconPlus = s('<path d="M12 5v14M5 12h14"/>')

export const iconBook = s(
  '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v16H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 5.5v16"/>',
)

export const iconSettings = s(
  '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"/>',
)

export const iconShapeCircle = s('<circle cx="12" cy="12" r="7"/>')
export const iconShapeBox = s('<rect x="5" y="6" width="14" height="12" rx="1.5"/>')
/** Stabilo: balok miring transparan menimpa sebuah garis teks */
export const iconShapeHighlight = s(
  '<path d="M4 15h16" opacity="0.4"/><rect x="5" y="11" width="14" height="7" rx="1.5" transform="skewX(-12)" fill="currentColor" stroke="none" opacity="0.85"/>',
)

export const iconChevronLeft = s('<path d="M14 6l-6 6 6 6"/>')
export const iconChevronRight = s('<path d="M10 6l6 6-6 6"/>')

/** Tema coklat mushaf (kertas kuning hangat) */
export const iconThemeLight = s('<rect x="3" y="4" width="18" height="16" rx="2" fill="currentColor" opacity="0.18"/><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 9h8M8 13h5"/>')
/** Tema dark (malam) */
export const iconThemeDark = s('<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5z"/>')
/** Tema forest (hijau hutan) */
export const iconThemeForest = s('<path d="M12 3l4 7H8z"/><path d="M8 10l3 6H5z"/><path d="M16 10l3 6h-6z"/><path d="M8 16h8v3H8z"/>')
/** Tema cream (krem lembut) */
export const iconThemeCream = s('<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4"/>')
/** Tema white (putih bersih) */
export const iconThemeWhite = s('<circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18" opacity="0.3"/>')

/** Audio: speaker dengan gelombang suara — ikon menu Audio di bottom bar */
export const iconAudio = s(
  '<path d="M4 10v4h4l5 4V6L8 10z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/>',
)

/** Setting Audio: slider/equalizer — ikon menu Setting Audio di bottom bar */
export const iconAudioSettings = s(
  '<path d="M4 7h7M15 7h5M4 17h11M19 17h1"/><circle cx="13" cy="7" r="2.2"/><circle cx="17" cy="17" r="2.2"/>',
)

/** Play: dipakai nomor halaman saat rentang audio sudah lengkap & belum diputar */
export const iconPlay = s('<path d="M7 5l12 7-12 7z" fill="currentColor" stroke="none"/>')

/** Pause: dipakai nomor halaman saat audio sedang diputar */
export const iconPause = s('<path d="M7 5h3v14H7zM14 5h3v14h-3z" fill="currentColor" stroke="none"/>')

/** Centang: menandai qari yang sedang terpilih di QariPickerSheet */
export const iconCheck = s('<path d="M5 12.5l4.5 4.5L19 7"/>')