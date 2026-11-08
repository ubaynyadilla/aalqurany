/**
 * Penyimpanan lokal persisten (§5.2).
 *
 * Di perangkat Android memakai SQLite (@capacitor-community/sqlite) untuk mark
 * & reminder; preferensi ringan (tema, posisi terakhir, setelan memorize)
 * memakai Preferences. Saat dijalankan di browser (dev), SQLite otomatis
 * diganti localStorage supaya seluruh alur tetap bisa diuji tanpa emulator.
 *
 * Tidak ada tabel apa pun untuk progres hafalan — sesuai keputusan §3.2.
 */
import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import type {
  HelperVerse,
  LastRead,
  Mark,
  MarkShape,
  MemorizeSettings,
  Reminder,
  ThemeMode,
  Weekday,
} from '@/types'

const isNative = Capacitor.isNativePlatform()

const KEY_THEME = 'theme'
const KEY_LAST_READ = 'last-read'
const KEY_MEMORIZE = 'memorize-settings'
const KEY_MARKS = 'marks'
const KEY_HELPERS = 'helper-verses'
const KEY_REMINDERS = 'reminders'
const KEY_NOTES = 'page-notes'
/** Qari & tempo mode Audio — setting global aplikasi, sama kelasnya dengan tema (§ Setting Audio). */
const KEY_AUDIO_SETTINGS = 'audio-settings'

type SqliteConnection = {
  execute: (statements: string) => Promise<unknown>
  query: (statement: string, values?: unknown[]) => Promise<{ values?: Record<string, unknown>[] }>
  run: (statement: string, values?: unknown[]) => Promise<{ changes?: { lastId?: number } }>
}

let db: SqliteConnection | null = null
let initError: string | null = null
let initPromise: Promise<void> | null = null

const SCHEMA = `
-- CREATE TABLE IF NOT EXISTS berarti pengguna lama yang tabelnya sudah
-- terlanjur punya kolom note/x/y/scale/scale_y (skema mark versi lama) TIDAK
-- dimigrasi paksa di sini — kolom ekstra itu dibiarkan, tidak pernah ditulis
-- ataupun dibaca lagi oleh kode di bawah, jadi aman diabaikan begitu saja.
CREATE TABLE IF NOT EXISTS marks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page INTEGER NOT NULL,
  verse_key TEXT NOT NULL,
  -- Baris mushaf 1-15 tempat kalimat ini berada
  line INTEGER NOT NULL,
  -- Indeks kata di dalam ayat (0 = kata pertama) yang ditandai — Mark
  -- menempel per-kata, bukan per-ayat.
  word_index INTEGER NOT NULL DEFAULT 0,
  -- 'circle' | 'box' | 'highlight'
  shape TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_marks_page ON marks(page);

/*
 * Satu ayat boleh punya BANYAK potongan.
 *
 * Dulu kolom verse_key bertanda UNIQUE, dan itulah sebab kalimat yang baru
 * ditambahkan menghapus kalimat sebelumnya: baris kedua untuk ayat yang sama
 * mustahil ada, jadi penyimpanan hanya bisa menimpa. Sekarang tiap potongan
 * adalah barisnya sendiri, dikenali lewat kolom id.
 */
CREATE TABLE IF NOT EXISTS helper_verses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page INTEGER NOT NULL,
  verse_key TEXT NOT NULL,
  words_shown INTEGER,
  -- Kata ke berapa potongan ini dimulai (0 = awal ayat)
  word_offset INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_helpers_page ON helper_verses(page);
CREATE INDEX IF NOT EXISTS idx_helpers_verse ON helper_verses(verse_key);

CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  surah INTEGER NOT NULL,
  ayah_from INTEGER NOT NULL,
  ayah_to INTEGER NOT NULL,
  scheduled_at TEXT NOT NULL,
  repeat_every INTEGER,
  repeat_unit TEXT,
  -- Hari terpilih untuk pengulangan mingguan, mis. "1,3,5" (0 = Ahad).
  -- Kosong berarti reminder memakai tanggal + interval kustom.
  weekdays TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  notification_id INTEGER,
  created_at TEXT NOT NULL
);
`

/**
 * Kolom yang ditambahkan setelah versi pertama. SQLite tidak punya
 * "ADD COLUMN IF NOT EXISTS", jadi kegagalan karena kolomnya sudah ada
 * memang diabaikan.
 */
const MIGRATIONS = [
  `ALTER TABLE reminders ADD COLUMN weekdays TEXT NOT NULL DEFAULT ''`,
  // Baris ini hanya relevan untuk pengguna dari versi sebelum mark punya
  // kolom `line` sama sekali — pada instalasi baru ini gagal diam-diam
  // (kolomnya sudah ada di skema) dan itu memang yang diharapkan.
  `ALTER TABLE marks ADD COLUMN line INTEGER NOT NULL DEFAULT 0`,
  // Pengguna dari versi sebelum Mark per-kata: tanda lama dianggap menandai
  // kata pertama ayat pada baris itu (word_index 0) — cukup masuk akal
  // sebagai titik awal, dan pengguna bisa menandai ulang bila mau kata lain.
  `ALTER TABLE marks ADD COLUMN word_index INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE helper_verses ADD COLUMN word_offset INTEGER NOT NULL DEFAULT 0`,
]

/**
 * Tabel `helper_verses` versi pertama menandai `verse_key` UNIQUE. Itu yang
 * membuat kalimat baru menimpa yang lama. SQLite tidak bisa melepas UNIQUE
 * lewat ALTER, jadi tabelnya dibuat ulang tanpa batasan itu.
 */
const DROP_HELPER_UNIQUE = `
CREATE TABLE IF NOT EXISTS helper_verses_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page INTEGER NOT NULL,
  verse_key TEXT NOT NULL,
  words_shown INTEGER,
  word_offset INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
INSERT INTO helper_verses_v2 (id, page, verse_key, words_shown, word_offset, created_at)
  SELECT id, page, verse_key, words_shown, word_offset, created_at FROM helper_verses;
DROP TABLE helper_verses;
ALTER TABLE helper_verses_v2 RENAME TO helper_verses;
CREATE INDEX IF NOT EXISTS idx_helpers_page ON helper_verses(page);
CREATE INDEX IF NOT EXISTS idx_helpers_verse ON helper_verses(verse_key);
`

export async function initStorage(): Promise<void> {
  if (initPromise) return initPromise
  initPromise = (async () => {
    if (!isNative) return
    try {
      await openDatabase()
    } catch (err) {
      // SQLite gagal dibuka: jangan melempar lagi pada setiap pemanggilan.
      // db tetap null sehingga semua fungsi memakai cadangan Preferences.
      db = null
      initError = err instanceof Error ? err.message : String(err)
      console.error('[storage] SQLite gagal dibuka, memakai Preferences:', err)
    }
  })()
  return initPromise
}

/** Pesan kegagalan SQLite terakhir (null bila baik-baik saja) */
export function getStorageInitError(): string | null {
  return initError
}

async function openDatabase(): Promise<void> {
  {
    const { CapacitorSQLite, SQLiteConnection } = await import('@capacitor-community/sqlite')
    const sqlite = new SQLiteConnection(CapacitorSQLite)
    const conn = await sqlite.createConnection('aalqurany', false, 'no-encryption', 1, false)
    await conn.open()
    await conn.execute(SCHEMA)

    // Basis data yang dibuat versi sebelumnya belum punya kolom baru
    for (const stmt of MIGRATIONS) {
      try {
        await conn.execute(stmt)
      } catch {
        // Kolomnya sudah ada — tidak perlu tindakan
      }
    }

    // Lepaskan batasan UNIQUE lama pada helper_verses, bila masih ada
    try {
      const info = await conn.query(
        `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'helper_verses'`,
      )
      const sql = String((info.values ?? [])[0]?.sql ?? '')
      if (/UNIQUE/i.test(sql)) await conn.execute(DROP_HELPER_UNIQUE)
    } catch {
      // Tabelnya belum ada atau sudah versi baru — biarkan
    }

    db = conn as unknown as SqliteConnection
  }
}

/* ---------------------------------------------------------- preferensi ringan */

async function readJson<T>(key: string, fallback: T): Promise<T> {
  const { value } = await Preferences.get({ key })
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  await Preferences.set({ key, value: JSON.stringify(value) })
}

const VALID_THEMES: string[] = ['light', 'dark', 'forest', 'cream', 'white']

export async function getTheme(): Promise<ThemeMode | null> {
  const { value } = await Preferences.get({ key: KEY_THEME })
  return value && VALID_THEMES.includes(value) ? (value as ThemeMode) : null
}

export async function setTheme(mode: ThemeMode): Promise<void> {
  await Preferences.set({ key: KEY_THEME, value: mode })
}

export interface AudioSettings {
  qari: string | null
  tempo: number
  /** Jumlah pengulangan pemutaran (1x–4x). Data lama sebelum field ini ada → default 1. */
  repeat: number
}

export async function getAudioSettings(): Promise<AudioSettings | null> {
  const saved = await readJson<AudioSettings | null>(KEY_AUDIO_SETTINGS, null)
  if (!saved) return null
  // Data lama (sebelum field repeat ada) belum punya nilainya — anggap 1x.
  return { ...saved, repeat: saved.repeat ?? 1 }
}

export async function saveAudioSettings(value: AudioSettings): Promise<void> {
  await writeJson(KEY_AUDIO_SETTINGS, value)
}

export async function getLastRead(): Promise<LastRead | null> {
  return readJson<LastRead | null>(KEY_LAST_READ, null)
}

export async function setLastRead(value: LastRead): Promise<void> {
  await writeJson(KEY_LAST_READ, value)
}

export async function getMemorizeSettings(): Promise<MemorizeSettings | null> {
  return readJson<MemorizeSettings | null>(KEY_MEMORIZE, null)
}

export async function saveMemorizeSettings(value: MemorizeSettings): Promise<void> {
  await writeJson(KEY_MEMORIZE, value)
}

/* ------------------------------------------------------------------- marks */

export async function listMarks(): Promise<Mark[]> {
  await initStorage()
  if (!db) {
    // Data lama (sebelum Mark per-kata) belum punya wordIndex — anggap kata
    // pertama ayat pada baris itu.
    const all = await readJson<Mark[]>(KEY_MARKS, [])
    return all.map((m) => ({ ...m, wordIndex: m.wordIndex ?? 0 }))
  }

  const res = await db.query('SELECT * FROM marks ORDER BY id ASC')
  return (res.values ?? []).map((row: Record<string, unknown>) => ({
    id: Number(row.id),
    page: Number(row.page),
    verseKey: String(row.verse_key),
    line: Number(row.line),
    wordIndex: row.word_index == null ? 0 : Number(row.word_index),
    shape: String(row.shape) as MarkShape,
    createdAt: String(row.created_at),
  }))
}

export async function addMark(
  page: number,
  verseKey: string,
  line: number,
  wordIndex: number,
  shape: MarkShape,
): Promise<Mark> {
  await initStorage()
  const createdAt = new Date().toISOString()

  if (!db) {
    const all = await readJson<Mark[]>(KEY_MARKS, [])
    const mark: Mark = { id: Date.now(), page, verseKey, line, wordIndex, shape, createdAt }
    all.push(mark)
    await writeJson(KEY_MARKS, all)
    return mark
  }

  const res = await db.run(
    `INSERT INTO marks (page, verse_key, line, word_index, shape, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [page, verseKey, line, wordIndex, shape, createdAt],
  )
  return { id: res.changes?.lastId, page, verseKey, line, wordIndex, shape, createdAt }
}

export async function deleteMark(id: number): Promise<void> {
  await initStorage()
  if (!db) {
    const all = await readJson<Mark[]>(KEY_MARKS, [])
    await writeJson(
      KEY_MARKS,
      all.filter((m) => m.id !== id),
    )
    return
  }
  await db.run('DELETE FROM marks WHERE id = ?', [id])
}

/* ----------------------------------------------------- catatan per halaman */

/**
 * Catatan bebas di layar Memorize, satu catatan per halaman mushaf
 * (kunci = nomor halaman). Ringan dan hanya teks, jadi disimpan lewat
 * Preferences — tidak perlu tabel SQLite sendiri.
 */
export async function getPageNotes(): Promise<Record<string, string>> {
  return readJson<Record<string, string>>(KEY_NOTES, {})
}

export async function savePageNotes(notes: Record<string, string>): Promise<void> {
  await writeJson(KEY_NOTES, notes)
}

/* ---------------------------------------------------------- ayat bantuan */

export async function listHelperVerses(): Promise<HelperVerse[]> {
  await initStorage()
  if (!db) {
    // Data lama belum punya wordOffset — anggap mulai dari awal ayat
    const all = await readJson<HelperVerse[]>(KEY_HELPERS, [])
    return all.map((h) => ({ ...h, wordOffset: h.wordOffset ?? 0 }))
  }

  const res = await db.query('SELECT * FROM helper_verses ORDER BY id ASC')
  return (res.values ?? []).map((row: Record<string, unknown>) => ({
    id: Number(row.id),
    page: Number(row.page),
    verseKey: String(row.verse_key),
    wordsShown: row.words_shown == null ? null : Number(row.words_shown),
    wordOffset: row.word_offset == null ? 0 : Number(row.word_offset),
    createdAt: String(row.created_at),
  }))
}

/**
 * Tambah SATU potongan baru.
 *
 * Selalu menambah, tidak pernah menimpa: satu ayat boleh punya sebanyak apa pun
 * potongan, dan menambah kalimat kedua tidak menghilangkan yang pertama. Hanya
 * potongan yang benar-benar kembar (ayat, awal kata, dan panjang sama) yang
 * dipakai ulang supaya tidak menumpuk ganda di tempat yang sama.
 */
export async function addHelperVerse(
  page: number,
  verseKey: string,
  wordsShown: number | null = null,
  wordOffset = 0,
): Promise<HelperVerse> {
  await initStorage()
  const createdAt = new Date().toISOString()

  if (!db) {
    const all = await readJson<HelperVerse[]>(KEY_HELPERS, [])
    const twin = all.find(
      (h) =>
        h.verseKey === verseKey &&
        (h.wordOffset ?? 0) === wordOffset &&
        h.wordsShown === wordsShown,
    )
    if (twin) return twin

    const helper: HelperVerse = {
      id: nextLocalId(all),
      page,
      verseKey,
      wordsShown,
      wordOffset,
      createdAt,
    }
    all.push(helper)
    await writeJson(KEY_HELPERS, all)
    return helper
  }

  const dup = await db.query(
    `SELECT id FROM helper_verses
     WHERE verse_key = ? AND word_offset = ?
       AND ((words_shown IS NULL AND ? IS NULL) OR words_shown = ?)
     LIMIT 1`,
    [verseKey, wordOffset, wordsShown, wordsShown],
  )
  const existingId = (dup.values ?? [])[0]?.id
  if (existingId != null) {
    return { id: Number(existingId), page, verseKey, wordsShown, wordOffset, createdAt }
  }

  const res = await db.run(
    `INSERT INTO helper_verses (page, verse_key, words_shown, word_offset, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [page, verseKey, wordsShown, wordOffset, createdAt],
  )
  return { id: res.changes?.lastId, page, verseKey, wordsShown, wordOffset, createdAt }
}

/**
 * id lokal yang belum terpakai. `Date.now()` saja tidak cukup: dua potongan yang
 * ditambahkan dalam milidetik yang sama akan bertabrakan id-nya, dan itu membuat
 * penghapusan satu potongan ikut membuang potongan lain.
 */
function nextLocalId(all: HelperVerse[]): number {
  const max = all.reduce((n, h) => Math.max(n, h.id ?? 0), 0)
  return Math.max(Date.now(), max + 1)
}

/** Buang satu potongan saja, dikenali lewat id barisnya. */
export async function deleteHelperVerseById(id: number): Promise<void> {
  await initStorage()
  if (!db) {
    const all = await readJson<HelperVerse[]>(KEY_HELPERS, [])
    await writeJson(
      KEY_HELPERS,
      all.filter((h) => h.id !== id),
    )
    return
  }
  await db.run('DELETE FROM helper_verses WHERE id = ?', [id])
}

/** Buang SEMUA potongan sebuah ayat — dipakai tombol "bawaan". */
export async function deleteHelperVerse(verseKey: string): Promise<void> {
  await initStorage()
  if (!db) {
    const all = await readJson<HelperVerse[]>(KEY_HELPERS, [])
    await writeJson(
      KEY_HELPERS,
      all.filter((h) => h.verseKey !== verseKey),
    )
    return
  }
  await db.run('DELETE FROM helper_verses WHERE verse_key = ?', [verseKey])
}

/* --------------------------------------------------------------- reminders */

export async function listReminders(): Promise<Reminder[]> {
  await initStorage()
  if (!db) {
    // Data yang tersimpan sebelum fitur hari ada belum punya `weekdays`
    const all = await readJson<Reminder[]>(KEY_REMINDERS, [])
    return all.map((r) => ({ ...r, weekdays: r.weekdays ?? [] }))
  }

  const res = await db.query('SELECT * FROM reminders ORDER BY scheduled_at ASC')
  return (res.values ?? []).map((row: Record<string, unknown>) => ({
    id: Number(row.id),
    title: String(row.title),
    surah: Number(row.surah),
    ayahFrom: Number(row.ayah_from),
    ayahTo: Number(row.ayah_to),
    scheduledAt: String(row.scheduled_at),
    repeatEvery: row.repeat_every == null ? null : Number(row.repeat_every),
    repeatUnit: row.repeat_unit == null ? null : (String(row.repeat_unit) as Reminder['repeatUnit']),
    weekdays: parseWeekdays(row.weekdays),
    enabled: Number(row.enabled) === 1,
    notificationId: row.notification_id == null ? undefined : Number(row.notification_id),
    createdAt: String(row.created_at),
  }))
}

/** "1,3,5" → [1,3,5]. Nilai tak dikenal dibuang agar data lama tetap aman. */
function parseWeekdays(raw: unknown): Weekday[] {
  if (raw == null) return []
  return String(raw)
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n): n is Weekday => Number.isInteger(n) && n >= 0 && n <= 6)
}

function serializeWeekdays(days: Weekday[] | undefined): string {
  return (days ?? []).join(',')
}

export async function saveReminder(reminder: Reminder): Promise<Reminder> {
  await initStorage()

  if (!db) {
    const all = await readJson<Reminder[]>(KEY_REMINDERS, [])
    if (reminder.id) {
      const idx = all.findIndex((r) => r.id === reminder.id)
      if (idx >= 0) all[idx] = reminder
      else all.push(reminder)
    } else {
      reminder = { ...reminder, id: Date.now() }
      all.push(reminder)
    }
    await writeJson(KEY_REMINDERS, all)
    return reminder
  }

  if (reminder.id) {
    await db.run(
      `UPDATE reminders SET title=?, surah=?, ayah_from=?, ayah_to=?, scheduled_at=?,
       repeat_every=?, repeat_unit=?, weekdays=?, enabled=?, notification_id=? WHERE id=?`,
      [
        reminder.title,
        reminder.surah,
        reminder.ayahFrom,
        reminder.ayahTo,
        reminder.scheduledAt,
        reminder.repeatEvery,
        reminder.repeatUnit,
        serializeWeekdays(reminder.weekdays),
        reminder.enabled ? 1 : 0,
        reminder.notificationId ?? null,
        reminder.id,
      ],
    )
    return reminder
  }

  const res = await db.run(
    `INSERT INTO reminders (title, surah, ayah_from, ayah_to, scheduled_at,
     repeat_every, repeat_unit, weekdays, enabled, notification_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      reminder.title,
      reminder.surah,
      reminder.ayahFrom,
      reminder.ayahTo,
      reminder.scheduledAt,
      reminder.repeatEvery,
      reminder.repeatUnit,
      serializeWeekdays(reminder.weekdays),
      reminder.enabled ? 1 : 0,
      reminder.notificationId ?? null,
      reminder.createdAt,
    ],
  )
  return { ...reminder, id: res.changes?.lastId }
}

export async function deleteReminder(id: number): Promise<void> {
  await initStorage()
  if (!db) {
    const all = await readJson<Reminder[]>(KEY_REMINDERS, [])
    await writeJson(
      KEY_REMINDERS,
      all.filter((r) => r.id !== id),
    )
    return
  }
  await db.run('DELETE FROM reminders WHERE id = ?', [id])
}