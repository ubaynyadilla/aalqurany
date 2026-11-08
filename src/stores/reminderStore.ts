/**
 * State reminder (§3.3). Menyimpan daftar reminder dan menyinkronkannya
 * dengan notifikasi lokal terjadwal. Tanpa status "sudah dibaca".
 *
 * Reminder yang gagal dijadwalkan (izin belum diberikan, dsb.) TIDAK boleh
 * gagal diam-diam: penyebabnya disimpan di `problem` dan ditampilkan di layar
 * Reminder, supaya pengguna tahu kenapa notifikasinya tidak muncul.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import * as storage from '@/services/storage'
import {
  cancelReminder,
  checkReminderHealth,
  openExactAlarmSettings,
  requestReminderPermission,
  scheduleReminder,
  sendTestNotification,
  syncReminders,
  type ReminderHealth,
  type ReminderProblem,
  type ScheduleResult,
} from '@/services/notifications'
import type { Reminder } from '@/types'
import { useQuranStore } from './quranStore'

export interface ReminderIssue {
  kind: ReminderProblem
  message: string
}

export const useReminderStore = defineStore('reminder', () => {
  const reminders = ref<Reminder[]>([])
  const loading = ref(false)

  /** Masalah terakhir saat menjadwalkan; null bila semuanya lancar */
  const problem = ref<ReminderIssue | null>(null)
  /** Keadaan izin notifikasi & alarm tepat, untuk banner di layar Reminder */
  const health = ref<ReminderHealth | null>(null)
  /** Hasil tombol "Tes notifikasi" */
  const testMessage = ref<string | null>(null)
  const testing = ref(false)

  let syncing = false

  function noteResult(res: Pick<ScheduleResult, 'problem' | 'message'>): void {
    problem.value = res.problem
      ? { kind: res.problem, message: res.message ?? 'Reminder belum bisa dijadwalkan' }
      : null
  }

  async function load(): Promise<void> {
    loading.value = true
    try {
      reminders.value = await storage.listReminders()
    } finally {
      loading.value = false
    }
  }

  async function save(input: Reminder): Promise<Reminder> {
    const quran = useQuranStore()
    const saved = await storage.saveReminder(input)

    const res = await scheduleReminder(saved, quran.surahName(saved.surah), 'save')
    noteResult(res)

    const withNotification = { ...saved, notificationId: res.notificationId }
    if (res.notificationId !== saved.notificationId) {
      await storage.saveReminder(withNotification)
    }

    const idx = reminders.value.findIndex((r) => r.id === withNotification.id)
    if (idx >= 0) reminders.value[idx] = withNotification
    else reminders.value = [...reminders.value, withNotification]

    return withNotification
  }

  async function toggle(reminder: Reminder): Promise<void> {
    const next = { ...reminder, enabled: !reminder.enabled }
    if (next.enabled) {
      await save(next)
    } else {
      await cancelReminder(reminder)
      await storage.saveReminder(next)
      const idx = reminders.value.findIndex((r) => r.id === next.id)
      if (idx >= 0) reminders.value[idx] = next
    }
  }

  async function remove(reminder: Reminder): Promise<void> {
    await cancelReminder(reminder)
    if (reminder.id != null) await storage.deleteReminder(reminder.id)
    reminders.value = reminders.value.filter((r) => r.id !== reminder.id)
  }

  /**
   * Jadwalkan ulang semua reminder aktif. Dipanggil saat aplikasi dibuka dan
   * saat kembali ke depan: jadwal interval selalu terisi ke depan, sisa versi
   * lama dibersihkan, dan reminder tidak mati diam-diam setelah pembaruan
   * aplikasi atau perubahan izin.
   */
  async function syncAll(): Promise<void> {
    if (syncing) return
    syncing = true
    try {
      const quran = useQuranStore()
      if (!reminders.value.length) reminders.value = await storage.listReminders()

      const res = await syncReminders(reminders.value, (n) => quran.surahName(n))
      noteResult(res)

      for (const r of reminders.value) {
        const id = r.id != null ? res.ids.get(r.id) : undefined
        if (id != null && id !== r.notificationId) {
          r.notificationId = id
          await storage.saveReminder(r)
        }
      }
    } catch {
      // Sinkronisasi gagal tidak boleh mengganggu aplikasi; coba lagi saat dibuka berikutnya
    } finally {
      syncing = false
    }
  }

  async function refreshHealth(): Promise<void> {
    health.value = await checkReminderHealth()
  }

  /** Minta izin notifikasi; bila diberikan, langsung jadwalkan ulang semuanya. */
  async function requestPermission(): Promise<void> {
    const granted = await requestReminderPermission()
    await refreshHealth()
    if (granted) await syncAll()
  }

  async function openAlarmSettings(): Promise<void> {
    await openExactAlarmSettings()
  }

  /** Notifikasi tes beberapa detik dari sekarang — bukti bahwa reminder bisa berbunyi. */
  async function sendTest(): Promise<void> {
    testing.value = true
    testMessage.value = null
    try {
      const res = await sendTestNotification(5)
      testMessage.value = res.problem
        ? (res.message ?? 'Notifikasi tes gagal dikirim')
        : 'Notifikasi tes akan muncul 5 detik lagi'
      await refreshHealth()
    } finally {
      testing.value = false
    }
  }

  return {
    reminders,
    loading,
    problem,
    health,
    testMessage,
    testing,
    load,
    save,
    toggle,
    remove,
    syncAll,
    refreshHealth,
    requestPermission,
    openAlarmSettings,
    sendTest,
  }
})
