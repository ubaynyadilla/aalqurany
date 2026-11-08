/**
 * Reminder berbasis notifikasi lokal (§3.3).
 *
 * Body notifikasi hanya menyebut surah & ayat AWAL dari rentang — bukan
 * rentang penuh — dan membawa payload deep link supaya tap notifikasi
 * membuka reader tepat di ayat tersebut.
 *
 * Aplikasi tidak mencatat apakah target selesai dibaca (§3.3, tanpa tracking).
 */
import { Capacitor } from '@capacitor/core'
import { WEEKDAY_CHIPS, type Reminder, type RepeatUnit } from '@/types'

const isNative = Capacitor.isNativePlatform()

type LocalNotificationsPlugin = typeof import('@capacitor/local-notifications').LocalNotifications

/**
 * Ambil plugin notifikasi.
 *
 * Objek plugin Capacitor adalah Proxy yang menjawab SEMUA nama properti dengan
 * sebuah fungsi — termasuk `then`. Akibatnya JavaScript menganggapnya
 * "thenable": mengembalikannya langsung dari fungsi async membuat runtime
 * memanggil `then()` di atasnya, yang diteruskan ke jembatan native dan gagal
 * dengan «"LocalNotifications.then()" is not implemented on android».
 *
 * Karena itu plugin dibungkus di dalam objek biasa, bukan dikembalikan apa
 * adanya.
 */
async function plugin(): Promise<{ ln: LocalNotificationsPlugin } | null> {
  if (!isNative) return null
  const mod = await import('@capacitor/local-notifications')
  // Plugin dibungkus di dalam objek biasa; yang di-resolve promise ini bukan
  // proxy plugin, jadi runtime tidak pernah memanggil `then()` padanya.
  return { ln: mod.LocalNotifications }
}

export async function ensurePermission(): Promise<boolean> {
  const box = await plugin()
  if (!box) return false
  const ln = box.ln
  const status = await ln.checkPermissions()
  if (status.display === 'granted') return true
  const req = await ln.requestPermissions()
  return req.display === 'granted'
}

/* ---------------------------------------------------------------- id notifikasi */

/**
 * ID notifikasi harus int 32-bit; turunkan dari id reminder secara stabil.
 *
 * Tiap reminder memegang satu blok 100 id berturut-turut, supaya seluruh
 * jadwalnya bisa dibatalkan pasti hanya dengan membatalkan blok itu:
 *
 *   root          jadwal tunggal (sekali saja)
 *   root + 1..7   satu notifikasi per hari terpilih (Ahad..Sabtu)
 *   root + 10..69 kemunculan-kemunculan berikutnya untuk pengulangan interval
 */
const ID_SPAN = 100
const WEEKDAY_ID_OFFSET = 1
const OCCURRENCE_ID_OFFSET = 10

/** Berapa kemunculan ke depan yang dijadwalkan untuk pengulangan interval */
export const MAX_OCCURRENCES = 60

/** ID khusus notifikasi tes; di atas semua blok reminder (maks ±2.000.000.000). */
const TEST_NOTIFICATION_ID = 2_100_000_000

/** Kanal notifikasi Android: penting (muncul melayang & berbunyi), bukan senyap. */
const CHANNEL_ID = 'reminder'

function notificationIdFor(reminder: Reminder): number {
  const base = reminder.id ?? Date.now()
  return (Math.abs(base % 20_000_000) || 1) * ID_SPAN
}

/** Semua id yang mungkin dipakai satu reminder — dipakai saat membatalkan. */
function allNotificationIdsFor(reminder: Reminder): number[] {
  const root = notificationIdFor(reminder)
  return Array.from({ length: ID_SPAN }, (_, i) => root + i)
}

/* ------------------------------------------------------------------ kemunculan */

function addMonths(from: Date, n: number): Date {
  const d = new Date(from)
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + n)
  // 31 Jan + 1 bulan = 28/29 Feb, bukan melompat ke Maret
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(day, lastDay))
  return d
}

/** Tambahkan `n` satuan interval ke sebuah waktu; hari/pekan mengikuti kalender, bukan 24 jam tetap. */
export function addInterval(from: Date, unit: RepeatUnit, n: number): Date {
  switch (unit) {
    case 'hour':
      return new Date(from.getTime() + n * 3_600_000)
    case 'day': {
      const d = new Date(from)
      d.setDate(d.getDate() + n)
      return d
    }
    case 'week': {
      const d = new Date(from)
      d.setDate(d.getDate() + 7 * n)
      return d
    }
    case 'month':
      return addMonths(from, n)
  }
}

/**
 * Kemunculan reminder yang masih akan datang, urut dari yang terdekat.
 *
 * Pengulangan interval TIDAK diserahkan ke `every` milik plugin: di Android
 * `every` bersama `at` tidak mengulang (hanya `at` yang dipakai), dan `count`
 * hanya membatasi jumlah tayang — bukan pengali interval seperti dulu diduga.
 * Akibatnya reminder "tiap 3 hari" hanya berbunyi sekali. Karena itu setiap
 * kemunculan dijadwalkan sebagai notifikasi tunggal biasa, dan jadwalnya
 * diperbarui tiap aplikasi dibuka (lihat `syncReminders`).
 */
export function upcomingOccurrences(
  reminder: Pick<Reminder, 'scheduledAt' | 'repeatEvery' | 'repeatUnit'>,
  now: number = Date.now(),
  limit: number = MAX_OCCURRENCES,
): Date[] {
  const start = new Date(reminder.scheduledAt)
  if (Number.isNaN(start.getTime())) return []

  const unit = reminder.repeatUnit
  const every = reminder.repeatEvery
  // Plugin menolak waktu yang sudah lewat, beri jarak aman beberapa detik
  const threshold = now + 3_000

  if (!unit || !every) return start.getTime() > threshold ? [start] : []

  const out: Date[] = []
  for (let k = 0; out.length < limit && k < 20_000; k++) {
    const at = addInterval(start, unit, every * k)
    if (at.getTime() > threshold) out.push(at)
  }
  return out
}

/* ---------------------------------------------------------- penjadwalan aman */

/**
 * Semua operasi jadwal dijalankan BERURUTAN. Tanpa ini, sinkronisasi saat
 * aplikasi dibuka dan penyimpanan reminder yang bersamaan bisa saling
 * membatalkan notifikasi satu sama lain.
 */
let queue: Promise<unknown> = Promise.resolve()

function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task)
  queue = run.catch(() => undefined)
  return run
}

export type PermissionState = 'granted' | 'denied' | 'prompt' | 'unavailable'

function normalizeState(value: string | undefined): PermissionState {
  if (value === 'granted' || value === 'denied') return value
  if (value === 'prompt' || value === 'prompt-with-rationale') return 'prompt'
  return 'unavailable'
}

/** Apa yang menghalangi reminder berbunyi. */
export type ReminderProblem = 'permission' | 'exact-alarm' | 'failed'

export interface ScheduleResult {
  /** Id dasar yang disimpan pada reminder */
  notificationId?: number
  /** Semua id notifikasi yang berhasil dijadwalkan */
  ids: number[]
  problem?: ReminderProblem
  message?: string
}

export interface ReminderHealth {
  permission: PermissionState
  exactAlarm: PermissionState
}

/** Buat kanal notifikasi sekali; aman dipanggil berulang. */
async function ensureChannel(ln: LocalNotificationsPlugin): Promise<void> {
  try {
    await ln.createChannel({
      id: CHANNEL_ID,
      name: 'Pengingat bacaan',
      description: 'Pengingat jadwal membaca Al-Qur’an',
      importance: 4,
      visibility: 1,
      vibration: true,
    })
  } catch {
    // Bukan Android, atau kanal sudah ada — notifikasi tetap bisa dijadwalkan
  }
}

async function exactAlarmState(ln: LocalNotificationsPlugin): Promise<PermissionState> {
  try {
    const res = await ln.checkExactNotificationSetting()
    return normalizeState(res.exact_alarm)
  } catch {
    return 'unavailable'
  }
}

/** Keadaan izin saat ini — ditampilkan di layar Reminder bila ada yang kurang. */
export async function checkReminderHealth(): Promise<ReminderHealth> {
  const box = await plugin()
  if (!box) return { permission: 'unavailable', exactAlarm: 'unavailable' }
  const perm = await box.ln.checkPermissions().catch(() => null)
  return {
    permission: normalizeState(perm?.display),
    exactAlarm: await exactAlarmState(box.ln),
  }
}

/** Minta izin notifikasi; true bila sudah diizinkan. */
export function requestReminderPermission(): Promise<boolean> {
  return ensurePermission()
}

/** Buka layar pengaturan "Alarm & pengingat" milik Android. */
export async function openExactAlarmSettings(): Promise<void> {
  const box = await plugin()
  if (!box) return
  try {
    await box.ln.changeExactNotificationSetting()
  } catch {
    // Pengaturan tidak bisa dibuka — pengguna tetap bisa membukanya sendiri
  }
}

/**
 * Jadwalkan satu reminder.
 *
 * `mode`:
 *  - 'save' : pengguna baru menyimpan/mengaktifkan. Bila waktunya sekali-saja
 *             dan sudah lewat, tayang semenit lagi supaya tidak hilang diam-diam.
 *  - 'sync' : penjadwalan ulang otomatis saat aplikasi dibuka. Jadwal sekali-saja
 *             yang sudah lewat DILEWATI — kalau tidak, ia akan tayang lagi tiap
 *             aplikasi dibuka.
 */
export function scheduleReminder(
  reminder: Reminder,
  surahName: string,
  mode: 'save' | 'sync' = 'save',
): Promise<ScheduleResult> {
  return serial(() => scheduleNow(reminder, surahName, mode))
}

async function scheduleNow(
  reminder: Reminder,
  surahName: string,
  mode: 'save' | 'sync',
): Promise<ScheduleResult> {
  const box = await plugin()
  if (!box || !reminder.enabled) return { notificationId: reminder.notificationId, ids: [] }
  const ln = box.ln

  if (!(await ensurePermission())) {
    return {
      notificationId: reminder.notificationId,
      ids: [],
      problem: 'permission',
      message: 'Notifikasi belum diizinkan untuk Aalqurany',
    }
  }
  await ensureChannel(ln)

  const root = notificationIdFor(reminder)
  // Bersihkan seluruh blok lebih dulu: reminder mungkin sebelumnya memakai
  // jadwal lain, dan sisa notifikasinya tidak boleh tertinggal.
  await ln.cancel({ notifications: allNotificationIdsFor(reminder).map((id) => ({ id })) })

  const shared = {
    // Judul persis seperti yang diketik pengguna, tanpa label tambahan
    title: reminder.title,
    // Hanya titik mulai bacaan
    body: `${surahName} : ${reminder.ayahFrom}`,
    channelId: CHANNEL_ID,
    extra: {
      // Deep link ke ayat awal
      route: '/reader',
      surah: reminder.surah,
      ayah: reminder.ayahFrom,
      reminderId: reminder.id,
    },
  }

  const notifications: Parameters<LocalNotificationsPlugin['schedule']>[0]['notifications'] = []

  if (reminder.weekdays?.length) {
    /*
     * Jadwal per hari: tanggal diabaikan, hanya jam & menit yang dipakai, lalu
     * satu notifikasi berulang dibuat untuk setiap hari terpilih. Ini yang
     * membuat memilih hari otomatis menghapus makna tanggal.
     */
    const at = new Date(reminder.scheduledAt)
    for (const day of reminder.weekdays) {
      notifications.push({
        ...shared,
        id: root + WEEKDAY_ID_OFFSET + day,
        schedule: {
          allowWhileIdle: true,
          // Capacitor memakai 1 = Ahad … 7 = Sabtu, sedangkan Weekday kita
          // mengikuti Date.getDay() (0 = Ahad), jadi digeser satu.
          on: { weekday: day + 1, hour: at.getHours(), minute: at.getMinutes() },
          repeats: true,
        },
      })
    }
  } else {
    let times = upcomingOccurrences(reminder)

    // Sekali saja & sudah lewat: pada 'save' tayangkan semenit lagi
    if (!times.length && mode === 'save' && !(reminder.repeatEvery && reminder.repeatUnit)) {
      times = [new Date(Date.now() + 60_000)]
    }

    times.forEach((at, i) => {
      notifications.push({
        ...shared,
        id: i === 0 && times.length === 1 ? root : root + OCCURRENCE_ID_OFFSET + i,
        schedule: { at, allowWhileIdle: true },
      })
    })
  }

  if (!notifications.length) return { notificationId: root, ids: [] }

  try {
    await ln.schedule({ notifications })
  } catch (err) {
    return {
      notificationId: root,
      ids: [],
      problem: 'failed',
      message: err instanceof Error ? err.message : String(err),
    }
  }

  const ids = notifications.map((n) => n.id)
  // Tanpa izin alarm tepat, Android tetap menayangkan — hanya boleh terlambat.
  const exact = await exactAlarmState(ln)
  return {
    notificationId: root,
    ids,
    ...(exact !== 'granted' && exact !== 'unavailable'
      ? {
          problem: 'exact-alarm' as const,
          message: 'Izin "Alarm & pengingat" belum aktif, reminder bisa terlambat',
        }
      : {}),
  }
}

export function cancelReminder(reminder: Reminder): Promise<void> {
  return serial(async () => {
    const box = await plugin()
    if (!box) return
    await box.ln.cancel({ notifications: allNotificationIdsFor(reminder).map((id) => ({ id })) })
  })
}

/**
 * Jadwalkan ulang semua reminder aktif lalu buang notifikasi terjadwal yang
 * tidak lagi dimiliki reminder mana pun (sisa versi lama, reminder terhapus).
 * Dipanggil saat aplikasi dibuka dan saat kembali ke depan — supaya jadwal
 * interval selalu terisi dan tak ada reminder yang mati diam-diam.
 */
export async function syncReminders(
  reminders: Reminder[],
  nameOf: (surah: number) => string,
): Promise<{ problem?: ReminderProblem; message?: string; ids: Map<number, number> }> {
  const box = await plugin()
  const idsByReminder = new Map<number, number>()
  if (!box) return { ids: idsByReminder }

  const keep = new Set<number>()
  let problem: ReminderProblem | undefined
  let message: string | undefined

  for (const r of reminders) {
    if (!r.enabled) continue
    const res = await scheduleReminder(r, nameOf(r.surah), 'sync')
    res.ids.forEach((id) => keep.add(id))
    if (r.id != null && res.notificationId != null) idsByReminder.set(r.id, res.notificationId)
    if (res.problem && (!problem || res.problem === 'permission')) {
      problem = res.problem
      message = res.message
    }
  }

  await serial(async () => {
    try {
      const { notifications } = await box.ln.getPending()
      const stale = notifications.filter((n) => n.id !== TEST_NOTIFICATION_ID && !keep.has(n.id))
      if (stale.length) await box.ln.cancel({ notifications: stale.map((n) => ({ id: n.id })) })
    } catch {
      // Gagal membersihkan sisa lama tidak boleh menggagalkan sinkronisasi
    }
  })

  return { problem, message, ids: idsByReminder }
}

/** Kirim satu notifikasi tes beberapa detik dari sekarang, untuk memastikan reminder bisa berbunyi. */
export function sendTestNotification(seconds = 5): Promise<ScheduleResult> {
  return serial(async () => {
    const box = await plugin()
    if (!box) {
      return { ids: [], problem: 'failed' as const, message: 'Notifikasi hanya tersedia di aplikasi Android' }
    }
    if (!(await ensurePermission())) {
      return { ids: [], problem: 'permission' as const, message: 'Notifikasi belum diizinkan untuk Aalqurany' }
    }
    await ensureChannel(box.ln)
    try {
      await box.ln.schedule({
        notifications: [
          {
            id: TEST_NOTIFICATION_ID,
            title: 'Tes reminder',
            body: 'Notifikasi berfungsi. Reminder akan tampil seperti ini.',
            channelId: CHANNEL_ID,
            schedule: { at: new Date(Date.now() + seconds * 1000), allowWhileIdle: true },
          },
        ],
      })
    } catch (err) {
      return {
        ids: [],
        problem: 'failed' as const,
        message: err instanceof Error ? err.message : String(err),
      }
    }
    return { ids: [TEST_NOTIFICATION_ID] }
  })
}

export type ReminderTapHandler = (payload: { surah: number; ayah: number }) => void

/** Daftarkan handler tap notifikasi → reader membuka ayat awal. */
export async function onReminderTap(handler: ReminderTapHandler): Promise<void> {
  const box = await plugin()
  if (!box) return
  await box.ln.addListener('localNotificationActionPerformed', (action) => {
    const extra = action.notification.extra as
      | { surah?: number; ayah?: number }
      | undefined
    if (extra?.surah && extra?.ayah) {
      handler({ surah: Number(extra.surah), ayah: Number(extra.ayah) })
    }
  })
}

export function describeSchedule(reminder: Reminder): string {
  const at = new Date(reminder.scheduledAt)
  const time = at.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
  const date = at.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })

  // Jadwal per hari mengabaikan tanggal, jadi yang disebut hanya hari & jam
  if (reminder.weekdays?.length) {
    const order = WEEKDAY_CHIPS.map((c) => c.day)
    const names = [...reminder.weekdays]
      .sort((a, b) => order.indexOf(a) - order.indexOf(b))
      .map((d) => WEEKDAY_CHIPS.find((c) => c.day === d)?.name ?? '')
      .filter(Boolean)

    if (names.length === 7) return `Tiap hari · ${time}`
    return `${names.join(', ')} · ${time}`
  }

  if (!reminder.repeatEvery || !reminder.repeatUnit) {
    return `Sekali · ${date} ${time}`
  }

  const unitLabel: Record<RepeatUnit, string> = {
    hour: 'jam',
    day: 'hari',
    week: 'minggu',
    month: 'bulan',
  }
  const n = reminder.repeatEvery
  const every = n === 1 ? `tiap ${unitLabel[reminder.repeatUnit]}` : `tiap ${n} ${unitLabel[reminder.repeatUnit]}`
  return `${every} · mulai ${time}`
}
