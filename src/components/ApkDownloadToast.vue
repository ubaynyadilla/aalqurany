<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { APK_VERSION, APK_DOWNLOAD_URL } from '@/config/apkRelease'

const STORAGE_KEY = 'apk-toast-dismissed-version'
const visible = ref(false)

onMounted(() => {
  const dismissed = localStorage.getItem(STORAGE_KEY)
  if (dismissed !== APK_VERSION) {
    requestAnimationFrame(() => {
      visible.value = true
    })
  }
})

function dismiss(): void {
  localStorage.setItem(STORAGE_KEY, APK_VERSION)
  visible.value = false
}
</script>

<template>
  <Transition name="apk-toast-anim">
    <div v-if="visible" class="apk-toast">
      <div class="apk-toast__icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      </div>
      <div class="apk-toast__body">
        <span class="apk-toast__title">Install aplikasinya</span>
        <span class="apk-toast__subtitle">Lebih ringan &amp; nyaman diakses lewat APK.</span>
      </div>
      <a
        :href="APK_DOWNLOAD_URL"
        target="_blank"
        rel="noopener noreferrer"
        class="apk-toast__link"
        @click="dismiss"
      >
        Install
      </a>
      <button class="apk-toast__close" aria-label="Tutup" @click="dismiss">✕</button>
    </div>
  </Transition>
</template>

<style scoped>
.apk-toast {
  position: fixed;
  bottom: calc(16px + env(safe-area-inset-bottom, 0px));
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 14px;
  background: #f5efe0;
  color: #1a1a1a;
  padding: 14px 16px;
  border-radius: 20px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
  z-index: 1000;
  width: calc(100vw - 32px);
  max-width: 440px;
}

.apk-toast__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  background: #1a1410;
  color: #f5efe0;
  border-radius: 14px;
}

.apk-toast__body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  line-height: 1.3;
}

.apk-toast__title {
  font-weight: 700;
  font-size: 15px;
}

.apk-toast__subtitle {
  font-size: 12.5px;
  color: #7a7265;
  margin-top: 2px;
}

.apk-toast__link {
  background: #1a1410;
  color: #f5efe0;
  font-weight: 700;
  font-size: 14px;
  text-decoration: none;
  padding: 10px 18px;
  border-radius: 12px;
  white-space: nowrap;
  flex-shrink: 0;
  transition: background 0.15s ease;
}

.apk-toast__link:hover {
  background: #332a20;
}

.apk-toast__close {
  background: none;
  border: none;
  color: #a39a8c;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  padding: 4px;
  flex-shrink: 0;
}

.apk-toast-anim-enter-active {
  transition: transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.3s ease;
}
.apk-toast-anim-leave-active {
  transition: transform 0.2s ease, opacity 0.2s ease;
}
.apk-toast-anim-enter-from {
  transform: translate(-50%, 40px);
  opacity: 0;
}
.apk-toast-anim-leave-to {
  transform: translate(-50%, 20px);
  opacity: 0;
}
</style>