/**
 * Auto-update untuk distribusi APK langsung (bukan Play Store).
 *
 * Alur: cek file JSON versi di server → kalau versionCode di JSON lebih besar
 * dari versionCode app yang terpasang, tawarkan download APK baru → setelah
 * selesai download, buka file-nya lewat FileProvider supaya Android
 * menampilkan installer APK bawaan (user tinggal tap "Install").
 *
 * Catatan:
 * - Android TETAP akan minta konfirmasi install (tidak bisa silent kecuali
 *   app jadi device-owner lewat MDM) — ini batas OS, bukan batas kode ini.
 * - Butuh <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />
 *   di AndroidManifest.xml.
 * - Pastikan versionCode di android/app/build.gradle dinaikkan tiap rilis,
 *   dan update.json di server disinkronkan bareng upload APK baru.
 */
import { ref } from 'vue'
import { Filesystem, Directory } from '@capacitor/filesystem'
import { App } from '@capacitor/app'
import { FileOpener } from '@capawesome-team/capacitor-file-opener'

const UPDATE_JSON_URL = 'https://bacaalquran.web.app/update.json'

interface UpdateManifest {
  versionCode: number
  versionName: string
  apkUrl: string
  notes?: string
  /** Kalau true, update ini wajib (misal breaking change) — dialog tidak punya tombol "Nanti". */
  mandatory?: boolean
}

/** State reaktif, bisa dipakai langsung di komponen (mis. progress bar / dialog). */
export const updateAvailable = ref(false)
export const updateInfo = ref<UpdateManifest | null>(null)
export const downloading = ref(false)
export const downloadProgress = ref(0) // 0-100
export const updateError = ref<string | null>(null)

/**
 * Cek ke server apakah ada versi lebih baru dari yang terpasang.
 * Panggil ini sekali saat app start (mis. di App.vue onMounted), atau manual
 * lewat tombol "Cek Update" di halaman Setting.
 */
export async function checkForUpdate(): Promise<void> {
  updateError.value = null
  try {
    const info = await App.getInfo()
    const currentVersionCode = Number(info.build)

    const res = await fetch(UPDATE_JSON_URL, { cache: 'no-store' })
    if (!res.ok) throw new Error(`Gagal cek update (HTTP ${res.status})`)
    const manifest: UpdateManifest = await res.json()

    if (manifest.versionCode > currentVersionCode) {
      updateInfo.value = manifest
      updateAvailable.value = true
    } else {
      updateAvailable.value = false
      updateInfo.value = null
    }
  } catch (err) {
    updateError.value = err instanceof Error ? err.message : String(err)
  }
}

/**
 * Download APK dari `updateInfo.value.apkUrl` dengan progress, lalu buka
 * installer-nya. Panggil ini dari tombol "Update Sekarang" di dialog.
 */
export async function downloadAndInstallUpdate(): Promise<void> {
  const manifest = updateInfo.value
  if (!manifest) return

  downloading.value = true
  downloadProgress.value = 0
  updateError.value = null

  try {
    const base64Data = await downloadWithProgress(manifest.apkUrl, (pct) => {
      downloadProgress.value = pct
    })

    const fileName = `app-${manifest.versionName}.apk`

    await Filesystem.writeFile({
      path: fileName,
      data: base64Data,
      directory: Directory.Cache,
    })

    const { uri } = await Filesystem.getUri({
      path: fileName,
      directory: Directory.Cache,
    })

    await FileOpener.openFile({
      path: uri,
      mimeType: 'application/vnd.android.package-archive',
    })
  } catch (err) {
    updateError.value = err instanceof Error ? err.message : 'Gagal mengunduh/membuka APK'
  } finally {
    downloading.value = false
  }
}

/** Download file lewat XHR (bukan fetch) supaya bisa pantau progress via event `progress`. */
function downloadWithProgress(url: string, onProgress: (pct: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('GET', url, true)
    xhr.responseType = 'blob'

    xhr.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100))
      }
    }

    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`Gagal mengunduh APK (HTTP ${xhr.status})`))
        return
      }
      const reader = new FileReader()
      reader.onloadend = () => {
        const result = reader.result as string
        // Buang prefix "data:...;base64," — Filesystem.writeFile cuma butuh base64-nya saja.
        resolve(result.split(',')[1])
      }
      reader.onerror = () => reject(new Error('Gagal membaca berkas APK yang diunduh'))
      reader.readAsDataURL(xhr.response)
    }

    xhr.onerror = () => reject(new Error('Koneksi gagal saat mengunduh APK'))
    xhr.send()
  })
}

/** Tutup dialog update tanpa update (kalau updatenya tidak mandatory). */
export function dismissUpdate(): void {
  updateAvailable.value = false
}