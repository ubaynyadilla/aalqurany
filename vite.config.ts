import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Path relatif: satu build yang sama jalan di APK Capacitor, di root domain,
  // maupun di subfolder (mis. GitHub Pages /nama-repo/).
  base: './',
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // Aset data mushaf (.json.gz) disalin apa adanya dari public/
    assetsInlineLimit: 0,
  },
})
