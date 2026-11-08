<!--
  Dialog auto-update untuk distribusi APK langsung.
  Pasang sekali di App.vue (root), di luar <router-view>, supaya muncul di
  atas halaman apa pun saat ada update tersedia:

    <UpdateDialog />

  Tidak perlu props — semua state diambil dari services/appupdate.ts.
-->
<script setup lang="ts">
import {
  updateAvailable,
  updateInfo,
  downloading,
  downloadProgress,
  updateError,
  downloadAndInstallUpdate,
  dismissUpdate,
} from '@/services/appupdate'
</script>

<template>
  <Teleport to="body">
    <div v-if="updateAvailable" class="update-overlay">
      <div class="update-card" role="dialog" aria-modal="true" aria-labelledby="update-title">
        <h2 id="update-title" class="update-title">
          Update Tersedia
          <span v-if="updateInfo?.versionName" class="update-version">v{{ updateInfo.versionName }}</span>
        </h2>

        <p v-if="updateInfo?.notes" class="update-notes">{{ updateInfo.notes }}</p>

        <div v-if="downloading" class="update-progress-wrap">
          <div class="update-progress-track">
            <div class="update-progress-fill" :style="{ width: downloadProgress + '%' }" />
          </div>
          <span class="update-progress-label">Mengunduh… {{ downloadProgress }}%</span>
        </div>

        <p v-if="updateError" class="update-error">{{ updateError }}</p>

        <div class="update-actions">
          <button
            v-if="!updateInfo?.mandatory && !downloading"
            type="button"
            class="update-btn update-btn-ghost"
            @click="dismissUpdate"
          >
            Nanti
          </button>
          <button
            type="button"
            class="update-btn update-btn-primary"
            :disabled="downloading"
            @click="downloadAndInstallUpdate"
          >
            {{ downloading ? 'Mengunduh…' : 'Update Sekarang' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.update-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.55);
}

.update-card {
  width: 100%;
  max-width: 360px;
  border-radius: 16px;
  padding: 20px;
  background: var(--update-card-bg, #ffffff);
  color: var(--update-card-fg, #1a1a1a);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
}

:global(.dark) .update-card {
  --update-card-bg: #1c1d21;
  --update-card-fg: #f1f1f1;
}

.update-title {
  margin: 0 0 8px;
  font-size: 18px;
  font-weight: 700;
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.update-version {
  font-size: 13px;
  font-weight: 500;
  opacity: 0.6;
}

.update-notes {
  margin: 0 0 16px;
  font-size: 14px;
  line-height: 1.5;
  opacity: 0.85;
  white-space: pre-line;
}

.update-progress-wrap {
  margin-bottom: 16px;
}

.update-progress-track {
  height: 8px;
  border-radius: 999px;
  background: rgba(127, 127, 127, 0.25);
  overflow: hidden;
}

.update-progress-fill {
  height: 100%;
  background: #2e7d32;
  transition: width 0.15s ease;
}

.update-progress-label {
  display: block;
  margin-top: 6px;
  font-size: 12px;
  opacity: 0.7;
}

.update-error {
  margin: 0 0 16px;
  font-size: 13px;
  color: #c0392b;
}

.update-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.update-btn {
  padding: 10px 16px;
  border-radius: 10px;
  border: none;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.update-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.update-btn-ghost {
  background: transparent;
  color: inherit;
  opacity: 0.7;
}

.update-btn-primary {
  background: #2e7d32;
  color: #ffffff;
}
</style>