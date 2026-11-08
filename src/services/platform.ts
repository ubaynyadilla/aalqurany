/**
 * Kemampuan yang bergantung pada tempat aplikasi berjalan.
 *
 * Reminder memakai notifikasi lokal terjadwal milik Capacitor. Di web (PWA,
 * terutama Safari iOS) jadwal seperti itu tidak bisa berjalan andal — peramban
 * tidak boleh membunyikan alarm saat aplikasi tertutup — jadi fiturnya hanya
 * dibuka di aplikasi native (APK). Satu-satunya tempat yang menentukan itu
 * adalah berkas ini.
 */
import { Capacitor } from '@capacitor/core'

/** True bila berjalan sebagai aplikasi Capacitor (APK), false di peramban/PWA. */
export const isNativeApp = Capacitor.isNativePlatform()

/** Reminder hanya tersedia di aplikasi native. */
export const remindersAvailable = isNativeApp
