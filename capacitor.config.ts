import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Konfigurasi Capacitor.
 *
 * Tidak ada `server.url` di sini: aplikasi ini offline-first (§5), jadi WebView
 * harus memuat aset dari dalam APK, bukan dari dev server. Menyetel server.url
 * membuat aplikasi mati begitu PC tidak terjangkau.
 *
 * Untuk live-reload saat mengembangkan, pakai `npx cap run android --livereload`
 * yang menyuntikkan alamat itu sementara, tanpa mengubah berkas ini.
 */
const config: CapacitorConfig = {
  appId: 'com.aalqurany.quran',
  appName: "Aalqurany",
  webDir: 'dist',

  android: {
    // Data mushaf dibaca sebagai berkas lokal; tanpa lalu lintas HTTP biasa
    allowMixedContent: false,
    // Warna navigation bar (gesture bar bawah) — gelap agar tidak ada garis putih
    backgroundColor: '#26282c',
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 800,
      backgroundColor: '#f6f1e4',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      androidSpinnerStyle: 'small',
    },
    LocalNotifications: {
      // Ikon status monokrom hasil scripts/make-icons.mjs. Android 5+ memakai
      // siluetnya saja, jadi ikon berwarna akan tampil sebagai kotak putih.
      smallIcon: 'ic_stat_reminder',
      iconColor: '#1f6f5c',
    },
  },
}

export default config
