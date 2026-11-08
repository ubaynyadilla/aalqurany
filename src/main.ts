import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from '@/router'
import App from './App.vue'
import './assets/main.css'
import { isNativeApp } from '@/services/platform'

const app = createApp(App)

app.use(createPinia())
app.use(router)

app.mount('#app')

/*
 * Service worker hanya untuk versi web (PWA): di APK Capacitor aset sudah ada di
 * dalam aplikasi, dan service worker di sana malah bisa menyajikan berkas usang.
 */
if (import.meta.env.PROD && !isNativeApp && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .then(async () => {
        // Kunjungan pertama: berkas yang sudah terunduh sebelum service worker
        // aktif tidak lewat sw.js. Serahkan daftarnya supaya ikut tersimpan dan
        // aplikasi langsung bisa dibuka offline.
        const reg = await navigator.serviceWorker.ready
        const share = (): void => {
          const urls = performance
            .getEntriesByType('resource')
            .map((e) => e.name)
            .filter((u) => u.startsWith(location.origin))
          reg.active?.postMessage({ type: 'CACHE_URLS', urls: [location.href.split('#')[0], ...urls] })
        }
        share()
        // Data mushaf & font baru selesai diunduh beberapa detik kemudian
        window.setTimeout(share, 6000)
      })
      .catch(() => {
        // Service worker gagal terpasang — aplikasi tetap jalan seperti biasa
      })
  })
}