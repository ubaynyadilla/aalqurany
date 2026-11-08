<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { Capacitor } from '@capacitor/core'
import { useQuranStore } from '@/stores/quranStore'
import { useReminderStore } from '@/stores/reminderStore'
import { onReminderTap } from '@/services/notifications'
import { remindersAvailable, isNativeApp } from '@/services/platform'
import { ensureMushafFont } from '@/services/fonts'
import { checkForUpdate } from '@/services/appupdate'
import ApkDownloadToast from '@/components/ApkDownloadToast.vue'
import UpdateDialog from '@/components/UpdateDialog.vue'

/**
 * Wake Lock — cegah layar mati selagi membaca.
 *
 * Strategi: minta wake lock saat aplikasi berjalan, lepas setelah 10 menit
 * tanpa aktivitas (sentuhan/klik), dan minta ulang setiap kali ada aktivitas.
 * Jika perangkat tidak mendukung Wake Lock API (Android WebView lama), gagal
 * diam-diam tanpa mempengaruhi fungsi lain.
 */
const WAKE_TIMEOUT_MS = 10 * 60 * 1000 // 10 menit

let wakeLock: WakeLockSentinel | null = null
let wakeTimer: number | undefined

async function requestWakeLock(): Promise<void> {
  if (!('wakeLock' in navigator)) return
  try {
    if (wakeLock && !wakeLock.released) return // sudah aktif
    wakeLock = await navigator.wakeLock.request('screen')
  } catch {
    // Izin ditolak atau API tidak tersedia — abaikan
  }
}

function releaseWakeLock(): void {
  wakeLock?.release().catch(() => {})
  wakeLock = null
}

function resetWakeTimer(): void {
  window.clearTimeout(wakeTimer)
  void requestWakeLock()
  wakeTimer = window.setTimeout(releaseWakeLock, WAKE_TIMEOUT_MS)
}

// Minta ulang wake lock saat tab kembali aktif (resume dari background)
function onVisibilityChange(): void {
  if (document.visibilityState === 'visible') resetWakeTimer()
}

const quran = useQuranStore()
const reminders = useReminderStore()
const router = useRouter()

/*
 * Aplikasi Android: WebView Capacitor sudah berhenti di dalam area aman —
 * di ATAS bar notifikasi (status bar) maupun di ATAS navigasi/gesture bar
 * bawah — jadi tidak "digambar tertutup" oleh keduanya. Tapi WebView tetap
 * melaporkan tinggi kedua bar itu lewat env(safe-area-inset-top/bottom),
 * seolah-olah kontennya masih perlu menyisakan ruang lagi. Dipakai apa
 * adanya, ruang itu terhitung DUA KALI: sekali oleh sistem (WebView memang
 * sudah lebih pendek), sekali lagi oleh padding kita — nomor halaman dan
 * pills jadi mengambang jauh dari tepi, dan celah kosong muncul di atas
 * pills surah/juz. Disetel 0 di sini, sebelum tampilan pertama, supaya
 * tidak ada lompatan tata letak.
 */
if (Capacitor.isNativePlatform()) {
  document.documentElement.style.setProperty('--safe-top', '0px')
  document.documentElement.style.setProperty('--safe-bottom', '0px')
}

// Font mushaf mulai dimuat sekarang, paralel dengan pemuatan data, supaya sudah
// siap saat halaman pertama digambar (ukuran teks dihitung untuk font ini).
void ensureMushafFont()

/**
 * Warna bar notifikasi HP: abu-abu gelap, tetap pada kedua tema. Style.Dark
 * di Capacitor berarti "latar gelap, isi terang", jadi jam dan ikon sistem
 * tampil putih di atasnya.
 */
const STATUS_BAR_COLOR = '#26282c'

onUnmounted(() => {
  window.clearTimeout(wakeTimer)
  releaseWakeLock()
  document.removeEventListener('visibilitychange', onVisibilityChange)
  document.removeEventListener('touchstart', resetWakeTimer)
  document.removeEventListener('click', resetWakeTimer)
})

onMounted(async () => {
  // Mulai wake lock dan timer sejak aplikasi dibuka
  resetWakeTimer()
  document.addEventListener('visibilitychange', onVisibilityChange)
  // Setiap sentuhan/klik memperbarui timer — mundur 10 menit dari aktivitas terakhir
  document.addEventListener('touchstart', resetWakeTimer, { passive: true })
  document.addEventListener('click', resetWakeTimer)

  await quran.init()

  /*
   * Bar notifikasi HP tetap kelihatan: WebView berhenti di bawahnya, tidak
   * menimpanya. Warnanya abu-abu gelap tetap — tidak ikut berubah saat tema
   * berganti — jadi ikon dan jam di bar itu selalu putih dan terbaca.
   */
  if (Capacitor.isNativePlatform()) {
    try {
      const { StatusBar, Style } = await import('@capacitor/status-bar')
      await StatusBar.setOverlaysWebView({ overlay: false })
      await StatusBar.setBackgroundColor({ color: STATUS_BAR_COLOR })
      await StatusBar.setStyle({ style: Style.Dark })
    } catch {
      // Plugin tidak tersedia — abaikan, tampilan tetap jalan
    }

    try {
      const { SplashScreen } = await import('@capacitor/splash-screen')
      await SplashScreen.hide()
    } catch {
      // Abaikan bila splash screen tidak dipasang
    }
  }

  if (remindersAvailable) {
    /*
     * Jadwalkan ulang semua reminder saat aplikasi dibuka DAN tiap kembali ke
     * depan. Jadwal interval diisi beberapa kemunculan ke depan, jadi tanpa ini
     * ia akan habis; dan reminder yang gagal dijadwalkan (izin, pembaruan
     * aplikasi) ikut terpulihkan alih-alih mati diam-diam.
     */
    void reminders.syncAll()
    try {
      const { App: CapApp } = await import('@capacitor/app')
      await CapApp.addListener('resume', () => {
        void reminders.syncAll()
      })
    } catch {
      // Tanpa plugin App, jadwal tetap disinkronkan saat aplikasi dibuka
    }
  }

  // Tap notifikasi reminder → reader terbuka tepat di ayat awal (§3.3).
  // Dibuka sebagai sesi reminder: "terakhir dibaca" di cover tidak ikut berubah.
  await onReminderTap(async ({ surah, ayah }) => {
    await quran.openFromReminder(surah, ayah)
    router.push({ path: '/reader', query: { surah, ayah } })
  })

  /*
   * §auto-update: hanya relevan untuk APK terpasang (bukan versi web) —
   * versi web selalu dapat kode terbaru dari server tanpa perlu unduh APK.
   * Dijalankan di akhir onMounted supaya tidak menunda alur inti (init data,
   * status bar, reminder) di atas.
   */
  if (isNativeApp) {
    void checkForUpdate()
  }
})
</script>

<template>
  <RouterView />
  <ApkDownloadToast v-if="!isNativeApp" />
  <UpdateDialog v-if="isNativeApp" />
</template>