#!/usr/bin/env node
/**
 * Script rilis otomatis — satu perintah untuk seluruh alur:
 *
 *   npm run release
 *
 * Yang dilakukan otomatis:
 * 1. Baca versionCode saat ini dari android/app/build.gradle, naikkan +1.
 * 2. Naikkan versionName (format "MAJOR.MINOR.PATCH") — PATCH naik otomatis.
 * 3. Tulis balik android/app/build.gradle dengan versionCode & versionName baru.
 * 4. npm run build (web assets → dist/)
 * 5. npx cap sync android (web assets → android/.../assets/public)
 * 6. gradlew assembleRelease (build APK, sudah pakai versionCode baru dari langkah 3) —
 *    otomatis pakai gradlew.bat di Windows, ./gradlew di Mac/Linux
 * 7. Upload APK hasil build ke Firebase Storage (releases/<APP_NAME>-v<versionName>.apk),
 *    lalu jadikan publik dan ambil URL downloadnya.
 *    (APK TIDAK lagi ditaruh di public/ — Firebase Hosting Spark plan menolak
 *    file executable seperti .apk, jadi APK di-host lewat Storage, bukan Hosting.)
 * 8. Tulis public/update.json dengan versionCode/versionName/apkUrl terbaru
 *    (apkUrl sekarang menunjuk ke URL Firebase Storage, bukan domain hosting).
 * 9. npm run build LAGI (supaya public/update.json yang baru ditulis di langkah 8
 *    ikut ter-copy ke dist/)
 * 10. firebase deploy --only hosting
 *
 * SETUP SEKALI DI AWAL:
 *   1. npm install firebase-admin --save-dev
 *   2. Firebase Console → Project Settings → Service accounts →
 *      Generate new private key → simpan sebagai service-account.json di root project
 *   3. Tambahkan service-account.json ke .gitignore
 *   4. Aktifkan Firebase Storage di Console kalau belum pernah dipakai
 *   5. Isi STORAGE_BUCKET di bawah sesuai bucket kamu (lihat di halaman Storage,
 *      format gs://nama-bucket — isi tanpa "gs://")
 *
 * Pemakaian:
 *   npm run release                      → notes default "Pembaruan"
 *   npm run release -- "Perbaikan audio"  → notes custom
 */
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { platform } from 'node:os'

/** Windows pakai gradlew.bat, Mac/Linux pakai ./gradlew — dipanggil sesuai OS. */
const GRADLEW_CMD = platform() === 'win32' ? 'gradlew.bat' : './gradlew'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

/** Ganti sesuai kebutuhan kamu — dipakai untuk nama file APK & URL update.json. */
const APP_NAME = 'aalqurany'

/**
 * Nama bucket Firebase Storage kamu, TANPA "gs://" di depan.
 * Cek di Firebase Console → Storage → bagian atas halaman, biasanya
 * "nama-project.appspot.com" atau "nama-project.firebasestorage.app".
 */
const STORAGE_BUCKET = 'bacaalquran.appspot.com' // ⚠️ GANTI sesuai bucket kamu

const SERVICE_ACCOUNT_PATH = join(ROOT, 'service-account.json')

const GRADLE_PATH = join(ROOT, 'android', 'app', 'build.gradle')
const APK_SOURCE = join(ROOT, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')
const PUBLIC_DIR = join(ROOT, 'public')
const UPDATE_JSON_PATH = join(PUBLIC_DIR, 'update.json')

const notes = process.argv[2] ?? 'Pembaruan'

function run(cmd, cwd = ROOT) {
  console.log(`\n→ ${cmd}`)
  execSync(cmd, { cwd, stdio: 'inherit' })
}

function bumpVersion() {
  const gradle = readFileSync(GRADLE_PATH, 'utf-8')

  const codeMatch = gradle.match(/versionCode\s+(\d+)/)
  const nameMatch = gradle.match(/versionName\s+"([^"]+)"/)
  if (!codeMatch || !nameMatch) {
    throw new Error('Tidak menemukan versionCode/versionName di build.gradle — cek format filenya.')
  }

  const currentCode = Number(codeMatch[1])
  const newCode = currentCode + 1

  // Naikkan PATCH dari "MAJOR.MINOR.PATCH" atau "MAJOR.MINOR" (dianggap PATCH=0).
  const parts = nameMatch[1].split('.').map(Number)
  while (parts.length < 3) parts.push(0)
  parts[2] += 1
  const newName = parts.join('.')

  const updatedGradle = gradle
    .replace(/versionCode\s+\d+/, `versionCode ${newCode}`)
    .replace(/versionName\s+"[^"]+"/, `versionName "${newName}"`)

  writeFileSync(GRADLE_PATH, updatedGradle)
  console.log(`Versi dinaikkan: versionCode ${currentCode} → ${newCode}, versionName "${nameMatch[1]}" → "${newName}"`)

  return { versionCode: newCode, versionName: newName }
}

/**
 * Upload APK ke Firebase Storage pakai firebase-admin SDK, jadikan publik,
 * dan kembalikan URL download langsungnya.
 */
async function uploadApkToStorage(versionName) {
  if (!existsSync(APK_SOURCE)) {
    throw new Error(`APK hasil build tidak ditemukan di ${APK_SOURCE}`)
  }
  if (!existsSync(SERVICE_ACCOUNT_PATH)) {
    throw new Error(
      `service-account.json tidak ditemukan di ${SERVICE_ACCOUNT_PATH}.\n` +
      `Lihat instruksi setup di bagian atas file ini (Firebase Console → Service accounts → Generate new private key).`
    )
  }

  const { default: admin } = await import('firebase-admin')

  if (admin.apps.length === 0) {
    admin.initializeApp({
      credential: admin.credential.cert(SERVICE_ACCOUNT_PATH),
      storageBucket: STORAGE_BUCKET,
    })
  }

  const fileName = `${APP_NAME}-v${versionName}.apk`
  const destination = `releases/${fileName}`

  console.log(`\n→ Mengunggah APK ke Firebase Storage: gs://${STORAGE_BUCKET}/${destination}`)

  const bucket = admin.storage().bucket()
  await bucket.upload(APK_SOURCE, {
    destination,
    metadata: {
      contentType: 'application/vnd.android.package-archive',
      cacheControl: 'public, max-age=0, no-cache',
    },
  })

  const file = bucket.file(destination)
  await file.makePublic()

  const apkUrl = `https://storage.googleapis.com/${STORAGE_BUCKET}/${destination}`
  console.log(`APK diunggah dan dipublikasikan: ${apkUrl}`)

  return { fileName, apkUrl }
}

function writeUpdateJson({ versionCode, versionName }, apkUrl) {
  const manifest = {
    versionCode,
    versionName,
    apkUrl,
    notes,
  }
  writeFileSync(UPDATE_JSON_PATH, JSON.stringify(manifest, null, 2) + '\n')
  console.log('public/update.json diperbarui:', manifest)
}

async function main() {
  const version = bumpVersion()

  run('npm run build')
  run('npx cap sync android')
  run(`${GRADLEW_CMD} assembleRelease`, join(ROOT, 'android'))

  const { apkUrl } = await uploadApkToStorage(version.versionName)
  writeUpdateJson(version, apkUrl)

  // Build ulang supaya public/update.json yang baru ditulis ikut masuk ke
  // dist/ sebelum di-deploy. APK TIDAK lagi ikut deploy ke Hosting — sudah
  // ada di Firebase Storage sejak langkah di atas.
  run('npm run build')
  run('firebase deploy --only hosting')

  console.log(`\n✅ Rilis v${version.versionName} (code ${version.versionCode}) selesai di-deploy.`)
  console.log(`   APK: ${apkUrl}`)
}

main().catch((err) => {
  console.error('\n❌ Rilis gagal:', err.message)
  process.exit(1)
})