import { createRouter, createWebHashHistory } from 'vue-router'
import CoverScreen from '@/views/CoverScreen.vue'
import QuranReader from '@/views/QuranReader.vue'
import MemorizeMode from '@/views/MemorizeMode.vue'
import ReminderView from '@/views/ReminderView.vue'

/**
 * Hash history dipakai karena aplikasi dijalankan dari berkas lokal di WebView
 * Android (capacitor://). History mode akan gagal memuat rute saat di-reload.
 */
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'cover', component: CoverScreen },
    { path: '/reader', name: 'reader', component: QuranReader },
    { path: '/memorize', name: 'memorize', component: MemorizeMode },
    { path: '/reminder', name: 'reminder', component: ReminderView },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

export default router
