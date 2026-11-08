<script setup lang="ts">
/**
 * Reminder (§3.3): judul bebas, jadwal bebas, pengulangan interval kustom,
 * plus rentang bacaan surah & ayat dari–sampai.
 *
 * Notifikasi hanya menyebut surah & ayat AWAL, dan tap-nya membuka reader
 * tepat di ayat itu. Tidak ada status selesai/belum — aplikasi tidak melacak.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import PillButton from '@/components/PillButton.vue'
import SheetModal from '@/components/SheetModal.vue'
import { iconBack, iconClose, iconLock, iconPlus, iconReminder } from '@/components/icons'
import { remindersAvailable } from '@/services/platform'
import { useQuranStore } from '@/stores/quranStore'
import { useReminderStore } from '@/stores/reminderStore'
import { describeSchedule } from '@/services/notifications'
import { WEEKDAY_CHIPS, type Reminder, type RepeatUnit, type Weekday } from '@/types'

const router = useRouter()
const quran = useQuranStore()
const store = useReminderStore()

const formOpen = ref(false)
const editing = ref<Reminder | null>(null)

const title = ref('')
const surah = ref(1)
const ayahFrom = ref(1)
const ayahTo = ref(1)
const dateValue = ref('')
const timeValue = ref('')
/** Dua pilihan saja: sekali, atau diulangi (§3.3) */
const repeatMode = ref<'once' | 'repeat'>('once')
const repeatEvery = ref(1)
const repeatUnit = ref<RepeatUnit>('week')
const weekdays = ref<Weekday[]>([])
const intervalOpen = ref(false)
const formError = ref<string | null>(null)

/**
 * Memilih hari membuat tanggal tidak berlaku — hari-hari itulah yang menentukan
 * kapan reminder tayang, jadi kolom tanggal disembunyikan.
 */
const usesDate = computed(() => !weekdays.value.length)

/** Label pill interval di samping chip hari */
const intervalLabel = computed(() => {
  if (weekdays.value.length) return 'Mingguan'
  const n = repeatEvery.value
  if (repeatUnit.value === 'week') return n === 1 ? 'Mingguan' : `Tiap ${n} minggu`
  if (repeatUnit.value === 'month') return n === 1 ? 'Bulanan' : `Tiap ${n} bulan`
  if (repeatUnit.value === 'hour') return n === 1 ? 'Tiap jam' : `Tiap ${n} jam`
  return n === 1 ? 'Harian' : `Tiap ${n} hari`
})

const selectedSurah = computed(() => quran.surahByNumber(surah.value))
const maxAyah = computed(() => selectedSurah.value?.versesCount ?? 286)

/**
 * Apa yang perlu diperbaiki pengguna agar reminder benar-benar berbunyi.
 * Sebelumnya reminder yang tak bisa dijadwalkan (izin ditolak, dsb.) gagal
 * DIAM-DIAM — tersimpan tapi tak pernah muncul. Sekarang alasannya ditampilkan
 * beserta tombol perbaikannya.
 */
const attention = computed<{ title: string; text: string; button: string; run: () => void } | null>(() => {
  const h = store.health
  if (h && (h.permission === 'denied' || h.permission === 'prompt')) {
    return {
      title: 'Notifikasi belum diizinkan',
      text: 'Reminder tidak akan muncul sebelum Aalqurany boleh mengirim notifikasi. Bila dialog izin tidak muncul, buka Pengaturan HP → Aplikasi → Aalqurany → Notifikasi.',
      button: 'Izinkan notifikasi',
      run: () => void store.requestPermission(),
    }
  }
  if (h && (h.exactAlarm === 'denied' || h.exactAlarm === 'prompt')) {
    return {
      title: 'Alarm tepat waktu belum aktif',
      text: 'Aktifkan "Alarm & pengingat" untuk Aalqurany supaya reminder tayang tepat pada jamnya, tidak terlambat.',
      button: 'Buka pengaturan',
      run: () => void store.openAlarmSettings(),
    }
  }
  const prob = store.problem
  if (prob?.kind === 'failed') {
    return {
      title: 'Reminder gagal dijadwalkan',
      text: prob.message,
      button: 'Coba lagi',
      run: () => void store.syncAll(),
    }
  }
  return null
})

/** Kembali dari layar pengaturan HP → periksa lagi izinnya */
function onVisible(): void {
  if (document.visibilityState === 'visible' && remindersAvailable) void store.refreshHealth()
}

onMounted(async () => {
  // Di web/PWA fitur terkunci: tidak ada yang dimuat atau dijadwalkan
  if (!remindersAvailable) return
  document.addEventListener('visibilitychange', onVisible)
  await store.load()
  await store.refreshHealth()
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisible)
})

function resetForm(): void {
  const now = new Date(Date.now() + 60 * 60 * 1000)
  title.value = ''
  surah.value = 1
  ayahFrom.value = 1
  ayahTo.value = 7
  dateValue.value = toDateInput(now)
  timeValue.value = toTimeInput(now)
  repeatMode.value = 'once'
  repeatEvery.value = 1
  repeatUnit.value = 'week'
  weekdays.value = []
  intervalOpen.value = false
  formError.value = null
  editing.value = null
}

function toDateInput(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function toTimeInput(d: Date): string {
  const h = `${d.getHours()}`.padStart(2, '0')
  const mi = `${d.getMinutes()}`.padStart(2, '0')
  return `${h}:${mi}`
}

function openCreate(): void {
  resetForm()
  formOpen.value = true
}

function openEdit(r: Reminder): void {
  const at = new Date(r.scheduledAt)
  editing.value = r
  title.value = r.title
  surah.value = r.surah
  ayahFrom.value = r.ayahFrom
  ayahTo.value = r.ayahTo
  dateValue.value = toDateInput(at)
  timeValue.value = toTimeInput(at)
  weekdays.value = [...(r.weekdays ?? [])]
  repeatMode.value =
    weekdays.value.length || (r.repeatEvery && r.repeatUnit) ? 'repeat' : 'once'
  repeatEvery.value = r.repeatEvery ?? 1
  repeatUnit.value = r.repeatUnit ?? 'week'
  intervalOpen.value = false
  formError.value = null
  formOpen.value = true
}

function setMode(mode: 'once' | 'repeat'): void {
  repeatMode.value = mode
  if (mode === 'once') {
    // Sekali pakai: tidak ada hari maupun interval
    weekdays.value = []
    intervalOpen.value = false
  }
}

/**
 * Hari dan interval saling menggantikan: memilih hari berarti pengulangan
 * mingguan pada hari-hari itu, sehingga interval kustom dikosongkan — dan
 * tanggal jadi tidak berlaku.
 */
function toggleWeekday(day: Weekday): void {
  repeatMode.value = 'repeat'
  weekdays.value = weekdays.value.includes(day)
    ? weekdays.value.filter((d) => d !== day)
    : [...weekdays.value, day]
}

function isWeekdayOn(day: Weekday): boolean {
  return weekdays.value.includes(day)
}

/** Pilihan siap pakai pada menu pill interval */
function pickInterval(unit: RepeatUnit, every: number): void {
  repeatMode.value = 'repeat'
  repeatUnit.value = unit
  repeatEvery.value = every
  // Interval berbasis tanggal, jadi pilihan hari dilepas
  weekdays.value = []
  intervalOpen.value = false
}

/** "Tiap berapa hari" — nilainya diketik sendiri pengguna */
function useCustomDays(): void {
  repeatMode.value = 'repeat'
  repeatUnit.value = 'day'
  weekdays.value = []
  if (repeatEvery.value < 1) repeatEvery.value = 2
}

async function submit(): Promise<void> {
  formError.value = null

  const name = title.value.trim()
  if (!name) {
    formError.value = 'Judul reminder belum diisi'
    return
  }
  if (!timeValue.value) {
    formError.value = 'Jam belum diisi'
    return
  }
  if (usesDate.value && !dateValue.value) {
    formError.value = 'Tanggal belum diisi'
    return
  }

  const from = clamp(ayahFrom.value, 1, maxAyah.value)
  const to = clamp(ayahTo.value, from, maxAyah.value)

  /*
   * Bila hari dipilih, tanggal tidak dipakai — hanya jamnya yang disimpan,
   * dengan tanggal hari ini sebagai pembawa jam saja.
   */
  const dateForSchedule = usesDate.value ? dateValue.value : toDateInput(new Date())
  const scheduledAt = new Date(`${dateForSchedule}T${timeValue.value}`)
  if (Number.isNaN(scheduledAt.getTime())) {
    formError.value = usesDate.value ? 'Tanggal atau jam tidak valid' : 'Jam tidak valid'
    return
  }

  const repeats = repeatMode.value === 'repeat'
  const byWeekday = repeats && weekdays.value.length > 0

  const payload: Reminder = {
    ...(editing.value ?? {}),
    title: name,
    surah: surah.value,
    ayahFrom: from,
    ayahTo: to,
    scheduledAt: scheduledAt.toISOString(),
    // Interval hanya berlaku bila pengulangan tidak berbasis hari
    repeatEvery: repeats && !byWeekday ? Math.max(1, repeatEvery.value) : null,
    repeatUnit: repeats && !byWeekday ? repeatUnit.value : null,
    weekdays: byWeekday ? sortWeekdays(weekdays.value) : [],
    enabled: editing.value?.enabled ?? true,
    createdAt: editing.value?.createdAt ?? new Date().toISOString(),
  }

  await store.save(payload)
  formOpen.value = false
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number(n) || min))
}

/** Urutkan sesuai tampilan chip (Senin lebih dulu, Ahad terakhir). */
function sortWeekdays(days: Weekday[]): Weekday[] {
  const order = WEEKDAY_CHIPS.map((c) => c.day)
  return [...days].sort((a, b) => order.indexOf(a) - order.indexOf(b))
}

function rangeLabel(r: Reminder): string {
  return `${quran.surahName(r.surah)} ${r.ayahFrom}–${r.ayahTo}`
}

async function openReader(r: Reminder): Promise<void> {
  // Sesi reminder: membuka bacaan ini tidak mengubah "terakhir dibaca" di cover
  await quran.openFromReminder(r.surah, r.ayahFrom)
  router.push('/reader')
}
</script>

<template>
  <!-- Terkunci di web/PWA: notifikasi terjadwal hanya andal di aplikasi Android -->
  <main v-if="!remindersAvailable" class="reminder-view">
    <header class="head safe-top">
      <button type="button" class="icon-btn" aria-label="Kembali" @click="router.back()">
        <span aria-hidden="true" v-html="iconBack" />
      </button>
      <h1>Reminder</h1>
      <span class="icon-btn placeholder" aria-hidden="true" />
    </header>

    <section class="list safe-bottom">
      <div class="empty">
        <span class="empty-icon" aria-hidden="true" v-html="iconLock" />
        <p class="empty-title">Reminder terkunci di versi web</p>
        <p class="empty-text">
          Pengingat terjadwal hanya berjalan di aplikasi Android. Peramban di iPhone tidak
          mengizinkan alarm berbunyi saat aplikasi tertutup, jadi fitur ini dimatikan di sini
          daripada berjalan tidak andal.
        </p>
      </div>
    </section>
  </main>

  <main v-else class="reminder-view">
    <header class="head safe-top">
      <button type="button" class="icon-btn" aria-label="Kembali" @click="router.back()">
        <span aria-hidden="true" v-html="iconBack" />
      </button>
      <h1>Reminder</h1>
      <button type="button" class="icon-btn" aria-label="Buat reminder" @click="openCreate">
        <span aria-hidden="true" v-html="iconPlus" />
      </button>
    </header>

    <section class="list safe-bottom">
      <div v-if="attention" class="attention" role="alert">
        <p class="attention-title">{{ attention.title }}</p>
        <p class="attention-text">{{ attention.text }}</p>
        <button type="button" class="attention-btn" @click="attention.run">{{ attention.button }}</button>
      </div>

      <p v-if="store.loading" class="state">Memuat...</p>

      <div v-else-if="!store.reminders.length" class="empty">
        <span class="empty-icon" aria-hidden="true" v-html="iconReminder" />
        <p class="empty-title">Belum ada reminder</p>
        <p class="empty-text">
          Buat pengingat dengan judul bebas, jadwal sendiri, dan rentang bacaan surah & ayat.
        </p>
        <PillButton :icon="iconPlus" label="Buat reminder" @click="openCreate" />
      </div>

      <article v-for="r in store.reminders" :key="r.id" class="card" :class="{ off: !r.enabled }">
        <div class="card-main" @click="openEdit(r)">
          <h2 class="card-title">{{ r.title }}</h2>
          <p class="card-range">{{ rangeLabel(r) }}</p>
          <p class="card-sched">{{ describeSchedule(r) }}</p>
        </div>

        <div class="card-side">
          <label class="switch">
            <input type="checkbox" :checked="r.enabled" @change="store.toggle(r)" />
            <span class="track" aria-hidden="true" />
            <span class="sr">Aktifkan reminder</span>
          </label>
          <button type="button" class="mini" @click="openReader(r)">Buka</button>
          <button type="button" class="mini danger" aria-label="Hapus" @click="store.remove(r)">
            <span aria-hidden="true" v-html="iconClose" />
          </button>
        </div>
      </article>

      <p v-if="store.reminders.length" class="foot-note">
        Reminder hanya mengingatkan. Aplikasi tidak melacak apakah bacaan sudah selesai.
      </p>

      <!-- Bukti bahwa notifikasi bisa muncul di HP ini, tanpa menunggu jadwal -->
      <div class="test-zone">
        <button type="button" class="test-btn" :disabled="store.testing" @click="store.sendTest()">
          Tes notifikasi
        </button>
        <p v-if="store.testMessage" class="test-note" role="status">{{ store.testMessage }}</p>
        <p class="test-note">
          Bila reminder tidak muncul di HP tertentu (Xiaomi, Oppo, Vivo, dsb.), izinkan Aalqurany
          berjalan di latar belakang dan matikan penghemat baterai untuknya.
        </p>
      </div>
    </section>

    <SheetModal
      v-if="formOpen"
      :title="editing ? 'Ubah reminder' : 'Reminder baru'"
      @close="formOpen = false"
    >
      <label class="field-row">
        <span class="label">Judul</span>
        <input v-model="title" class="field" type="text" placeholder="mis. Baca sebelum tidur" />
      </label>

      <!-- Tanggal disembunyikan pada mode mingguan: hari yang dipilih sudah
           menentukan kapan reminder tayang, jadi tanggal tidak lagi berarti -->
      <div class="grid-2">
        <label v-if="usesDate" class="field-row">
          <span class="label">Tanggal</span>
          <input v-model="dateValue" class="field" type="date" />
        </label>
        <label class="field-row" :class="{ wide: !usesDate }">
          <span class="label">Jam</span>
          <input v-model="timeValue" class="field" type="time" />
        </label>
      </div>

      <div class="field-row">
        <span class="label">Pengulangan</span>
        <div class="seg">
          <button type="button" :class="{ on: repeatMode === 'once' }" @click="setMode('once')">
            Sekali
          </button>
          <button type="button" :class="{ on: repeatMode === 'repeat' }" @click="setMode('repeat')">
            Diulangi
          </button>
        </div>
      </div>

      <!--
        Hanya muncul saat "Diulangi": tujuh chip hari S S R K J S M, lalu pill
        interval di samping chip M. Memilih hari berarti pengulangan mingguan
        pada hari itu, sehingga tanggal tidak lagi dipakai.
      -->
      <div v-if="repeatMode === 'repeat'" class="field-row">
        <div class="days-row" role="group" aria-label="Hari pengulangan">
          <button
            v-for="c in WEEKDAY_CHIPS"
            :key="c.day"
            type="button"
            class="day"
            :class="{ on: isWeekdayOn(c.day) }"
            :aria-pressed="isWeekdayOn(c.day)"
            :aria-label="c.name"
            :title="c.name"
            @click="toggleWeekday(c.day)"
          >
            {{ c.short }}
          </button>

          <!-- Pill interval, tepat di samping chip M -->
          <div class="interval-wrap">
            <button
              type="button"
              class="interval-pill"
              :class="{ on: intervalOpen }"
              :aria-expanded="intervalOpen"
              @click="intervalOpen = !intervalOpen"
            >
              {{ intervalLabel }}
            </button>

            <div v-if="intervalOpen" class="interval-menu">
              <button type="button" @click="pickInterval('week', 1)">Mingguan</button>
              <button type="button" @click="pickInterval('month', 1)">Bulanan</button>

              <div class="interval-custom">
                <span>Tiap</span>
                <input
                  v-model.number="repeatEvery"
                  class="field num"
                  type="number"
                  min="1"
                  inputmode="numeric"
                  aria-label="Jumlah hari"
                  @focus="useCustomDays"
                />
                <span>hari</span>
                <button type="button" class="apply" @click="pickInterval('day', repeatEvery)">
                  Pakai
                </button>
              </div>
            </div>
          </div>
        </div>

        <span class="days-hint">
          {{
            weekdays.length
              ? 'Berulang tiap pekan pada hari terpilih — tanggal tidak dipakai.'
              : `Berulang ${intervalLabel.toLowerCase()} mulai tanggal & jam di atas.`
          }}
        </span>
      </div>

      <label class="field-row">
        <span class="label">Surah</span>
        <select v-model.number="surah" class="field">
          <option v-for="s in quran.surahs" :key="s.number" :value="s.number">
            {{ s.number }}. {{ s.nameLatin }} ({{ s.versesCount }} ayat)
          </option>
        </select>
      </label>

      <div class="grid-2">
        <label class="field-row">
          <span class="label">Ayat dari</span>
          <input v-model.number="ayahFrom" class="field" type="number" min="1" :max="maxAyah" inputmode="numeric" />
        </label>
        <label class="field-row">
          <span class="label">Sampai</span>
          <input v-model.number="ayahTo" class="field" type="number" :min="ayahFrom" :max="maxAyah" inputmode="numeric" />
        </label>
      </div>

      <p class="preview">
        Notifikasi menampilkan titik mulai:
        <strong>{{ selectedSurah?.nameLatin }} : {{ ayahFrom }}</strong>
      </p>

      <p v-if="formError" class="error">{{ formError }}</p>

      <button type="button" class="submit" @click="submit">
        {{ editing ? 'Simpan perubahan' : 'Simpan reminder' }}
      </button>
    </SheetModal>
  </main>
</template>

<style scoped>
.reminder-view {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background: var(--color-paper);
  color: var(--color-ink);
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  padding: 0.85rem 0.9rem;
  border-bottom: 1px solid var(--color-paper-edge);
}

.head h1 {
  margin: 0;
  font-size: 1.02rem;
  font-weight: 600;
}

.icon-btn {
  width: 2.3rem;
  height: 2.3rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-ink) 7%, transparent);
  color: inherit;
}

.attention {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-bottom: 0.9rem;
  padding: 0.8rem 0.9rem;
  border: 1px solid color-mix(in srgb, #c77800 55%, transparent);
  border-radius: 0.9rem;
  background: color-mix(in srgb, #ff9d00 13%, transparent);
}

.attention-title {
  margin: 0;
  font-size: 0.86rem;
  font-weight: 600;
}

.attention-text {
  margin: 0;
  font-size: 0.76rem;
  line-height: 1.5;
  opacity: 0.85;
}

.attention-btn {
  align-self: flex-start;
  margin-top: 0.2rem;
  padding: 0.42rem 0.9rem;
  border: 1px solid var(--color-accent);
  border-radius: 999px;
  background: var(--color-accent);
  color: #fff;
  font-size: 0.76rem;
}

.test-zone {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  margin-top: 1.2rem;
  padding-top: 1rem;
  border-top: 1px solid var(--color-paper-edge);
}

.test-btn {
  padding: 0.5rem 1.1rem;
  border: 1px solid color-mix(in srgb, var(--color-accent) 60%, transparent);
  border-radius: 999px;
  background: transparent;
  color: var(--color-accent);
  font-size: 0.8rem;
}

.test-btn:disabled {
  opacity: 0.5;
}

.test-note {
  margin: 0;
  max-width: 24rem;
  font-size: 0.72rem;
  line-height: 1.5;
  text-align: center;
  opacity: 0.65;
}

.dark .attention {
  border-color: color-mix(in srgb, #ffb648 55%, transparent);
  background: color-mix(in srgb, #ffb648 14%, transparent);
}

.dark .attention-btn {
  border-color: var(--color-accent-soft);
  background: var(--color-accent-soft);
  color: #06120f;
}

.dark .test-btn {
  border-color: color-mix(in srgb, var(--color-accent-soft) 60%, transparent);
  color: var(--color-accent-soft);
}

.dark .test-zone {
  border-color: var(--color-night-edge);
}

.icon-btn.placeholder {
  visibility: hidden;
}

.icon-btn :deep(svg) {
  width: 1.15rem;
  height: 1.15rem;
}

.list {
  flex: 1;
  overflow-y: auto;
  padding: 0.9rem;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.state {
  margin: auto;
  opacity: 0.6;
  font-size: 0.88rem;
}

.empty {
  margin: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 2rem 1rem;
  text-align: center;
}

.empty-icon :deep(svg) {
  width: 2.6rem;
  height: 2.6rem;
  opacity: 0.4;
}

.empty-title {
  margin: 0;
  font-size: 0.98rem;
  font-weight: 600;
}

.empty-text {
  margin: 0 0 0.5rem;
  max-width: 17rem;
  font-size: 0.8rem;
  opacity: 0.65;
}

.card {
  display: flex;
  align-items: stretch;
  gap: 0.7rem;
  padding: 0.8rem 0.9rem;
  border: 1px solid var(--color-paper-edge);
  border-radius: 0.9rem;
  background: rgb(255 255 255 / 0.6);
}

.card.off {
  opacity: 0.55;
}

.card-main {
  flex: 1;
  min-width: 0;
}

.card-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-range {
  margin: 0.2rem 0 0;
  font-size: 0.8rem;
  opacity: 0.8;
}

.card-sched {
  margin: 0.15rem 0 0;
  font-size: 0.72rem;
  opacity: 0.6;
}

.card-side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  justify-content: space-between;
  gap: 0.4rem;
}

.switch {
  position: relative;
  display: inline-flex;
  cursor: pointer;
}

.switch input {
  position: absolute;
  opacity: 0;
  width: 100%;
  height: 100%;
  margin: 0;
}

.track {
  width: 2.4rem;
  height: 1.35rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-ink) 18%, transparent);
  transition: background-color 0.18s ease;
  position: relative;
}

.track::after {
  content: '';
  position: absolute;
  top: 0.18rem;
  left: 0.2rem;
  width: 1rem;
  height: 1rem;
  border-radius: 999px;
  background: #fff;
  transition: transform 0.18s ease;
}

.switch input:checked + .track {
  background: var(--color-accent);
}

.switch input:checked + .track::after {
  transform: translateX(0.98rem);
}

.sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}

.mini {
  padding: 0.28rem 0.6rem;
  border: 1px solid var(--color-paper-edge);
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font-size: 0.72rem;
}

.mini.danger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.8rem;
  height: 1.8rem;
  padding: 0;
  border-color: color-mix(in srgb, #b3261e 40%, transparent);
  color: #b3261e;
}

.mini.danger :deep(svg) {
  width: 0.9rem;
  height: 0.9rem;
}

.foot-note {
  margin: 0.4rem 0 0;
  font-size: 0.7rem;
  opacity: 0.55;
  text-align: center;
}

.field-row {
  display: flex;
  flex-direction: column;
  gap: 0.28rem;
  padding: 0.4rem 0;
}

.label {
  font-size: 0.78rem;
  opacity: 0.7;
}

.field {
  width: 100%;
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--color-paper-edge);
  border-radius: 0.7rem;
  background: rgb(255 255 255 / 0.75);
  color: inherit;
  font-size: 0.88rem;
}

.field.num {
  width: 5rem;
}

.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.6rem;
}

.seg {
  display: inline-flex;
  gap: 0.3rem;
}

.seg button {
  flex: 1;
  padding: 0.55rem 0.7rem;
  border: 1px solid var(--color-paper-edge);
  border-radius: 0.7rem;
  background: transparent;
  color: inherit;
  font-size: 0.82rem;
}

.seg button.on {
  border-color: var(--color-accent);
  background: color-mix(in srgb, var(--color-accent) 15%, transparent);
}

/* Kolom jam melebar penuh ketika tanggal disembunyikan */
.field-row.wide {
  grid-column: 1 / -1;
}

/* Tujuh chip hari dalam satu baris, dengan pill interval di ujungnya */
.days-row {
  display: flex;
  align-items: center;
  gap: 0.28rem;
}

.day {
  flex: 1 1 0;
  min-width: 0;
  aspect-ratio: 1;
  max-height: 2.4rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid var(--color-paper-edge);
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font-size: 0.82rem;
  font-weight: 600;
  transition: background-color 0.15s ease, border-color 0.15s ease;
}

.day.on {
  border-color: var(--color-accent);
  background: var(--color-accent);
  color: #fff;
}

.interval-wrap {
  position: relative;
  flex: 0 0 auto;
  margin-inline-start: 0.15rem;
}

.interval-pill {
  padding: 0.4rem 0.7rem;
  border: 1px solid var(--color-paper-edge);
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font-size: 0.72rem;
  white-space: nowrap;
}

.interval-pill.on {
  border-color: var(--color-accent);
  background: color-mix(in srgb, var(--color-accent) 14%, transparent);
}

/* Menu pilihan: mingguan, bulanan, atau ketik sendiri berapa hari */
.interval-menu {
  position: absolute;
  z-index: 20;
  top: calc(100% + 0.35rem);
  right: 0;
  min-width: 11rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.4rem;
  border: 1px solid var(--color-paper-edge);
  border-radius: 0.7rem;
  background: var(--color-paper);
  box-shadow: 0 10px 26px rgb(0 0 0 / 0.18);
}

.interval-menu > button {
  padding: 0.5rem 0.6rem;
  border: 0;
  border-radius: 0.5rem;
  background: transparent;
  color: inherit;
  font-size: 0.82rem;
  text-align: start;
}

.interval-custom {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.35rem 0.6rem 0.2rem;
  border-top: 1px solid var(--color-paper-edge);
  font-size: 0.78rem;
}

.interval-custom .num {
  width: 3.4rem;
  padding: 0.35rem 0.45rem;
  font-size: 0.8rem;
}

.apply {
  margin-inline-start: auto;
  padding: 0.3rem 0.55rem;
  border: 0;
  border-radius: 999px;
  background: var(--color-accent);
  color: #fff;
  font-size: 0.7rem;
}

.days-hint {
  font-size: 0.68rem;
  opacity: 0.6;
}

.repeat {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0;
}

.repeat .label {
  flex: 0 0 auto;
}

.repeat select {
  flex: 1;
}

.preview {
  margin: 0.7rem 0 0;
  padding: 0.6rem 0.75rem;
  border-radius: 0.7rem;
  background: color-mix(in srgb, var(--color-accent) 10%, transparent);
  font-size: 0.78rem;
}

.error {
  margin: 0.6rem 0 0;
  color: #b3261e;
  font-size: 0.78rem;
}

.submit {
  margin-top: 0.9rem;
  width: 100%;
  padding: 0.85rem 1rem;
  border: 0;
  border-radius: 0.8rem;
  background: var(--color-accent);
  color: #fff;
  font-size: 0.92rem;
  font-weight: 600;
}

.dark .reminder-view {
  background: var(--color-night);
  color: var(--color-night-ink);
}

.dark .head,
.dark .card,
.dark .field,
.dark .seg button,
.dark .day,
.dark .interval-pill,
.dark .interval-menu,
.dark .interval-custom,
.dark .mini {
  border-color: var(--color-night-edge);
}

.dark .day.on {
  border-color: var(--color-accent-soft);
  background: var(--color-accent-soft);
  color: #06120f;
}

.dark .interval-menu {
  background: var(--color-night);
}

.dark .interval-pill.on {
  border-color: var(--color-accent-soft);
  background: color-mix(in srgb, var(--color-accent-soft) 16%, transparent);
}

.dark .apply {
  background: var(--color-accent-soft);
  color: #06120f;
}

.dark .card {
  background: rgb(255 255 255 / 0.04);
}

.dark .field {
  background: rgb(255 255 255 / 0.06);
}

.dark .icon-btn {
  background: color-mix(in srgb, var(--color-night-ink) 10%, transparent);
}

.dark .switch input:checked + .track {
  background: var(--color-accent-soft);
}

.dark .submit {
  background: var(--color-accent-soft);
  color: #06120f;
}
</style>
