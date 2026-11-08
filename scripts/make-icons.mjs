/**
 * Bangun seluruh ikon Android dari design/logo.svg.
 *
 * Dipakai Playwright (Chromium) sebagai perender: ia sudah ada sebagai
 * devDependency, jadi tidak perlu menambah sharp/imagemagick hanya untuk ini.
 *
 * Yang dihasilkan, per kepadatan layar:
 *  - ic_launcher.png dan ic_launcher_round.png  (ikon penuh)
 *  - ic_launcher_foreground.png                 (lapis depan adaptive icon)
 *  - splash.png                                 (layar pembuka, tegak & datar)
 *  - ic_stat_reminder.png                       (ikon status notifikasi, putih
 *    transparan — Android 5+ hanya memakai bentuk siluetnya)
 *  - public/favicon.svg                         (ikon web)
 */
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const RES = resolve(root, 'android/app/src/main/res')

const source = await readFile(resolve(root, 'design/logo.svg'), 'utf8')

// Lebar/tinggi tetap 512px pada berkas sumber membuat gambar tidak ikut mengecil
// di dalam wadahnya — hanya sudut kirinya yang terpotret. Untuk perenderan,
// ukurannya diganti 100% supaya menyesuaikan kotak yang tersedia.
const svg = source.replace(
  /<svg([^>]*)>/,
  (_m, attrs) =>
    `<svg${attrs.replace(/\s(width|height)="[^"]*"/g, '')} width="100%" height="100%" preserveAspectRatio="xMidYMid meet">`,
)

/** Kepadatan Android: nama folder → faktor terhadap mdpi (48dp) */
const DPI = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }

const browser = await chromium.launch()
const page = await browser.newPage()

/**
 * Render sebuah potongan HTML ke PNG dengan latar transparan.
 * `pad` menyisakan ruang di sekeliling gambar (untuk foreground adaptive icon
 * yang wajib punya bantalan supaya tidak terpotong saat dipangkas bulat).
 */
async function render(size, { pad = 0, bg = null, content = svg, grayscale = false } = {}) {
  const inner = 100 - pad * 2
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(
    `<!doctype html><html><body style="margin:0;width:${size}px;height:${size}px;
       ${bg ? `background:${bg};` : ''}
       display:flex;align-items:center;justify-content:center;overflow:hidden">
       <div style="width:${inner}%;height:${inner}%;display:flex;
         ${grayscale ? 'filter:grayscale(1) brightness(0) invert(1);' : ''}">
         ${content}
       </div>
     </body></html>`,
  )
  await page.waitForTimeout(60)
  return page.screenshot({ omitBackground: !bg })
}

async function save(relPath, buffer) {
  const out = resolve(RES, relPath)
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, buffer)
  return relPath
}

const written = []

/* ------------------------------------------------------- ikon launcher */
for (const [dpi, factor] of Object.entries(DPI)) {
  const size = Math.round(48 * factor)
  // Ikon penuh: latar kertas supaya buku tetap terbaca di launcher lama
  written.push(await save(`mipmap-${dpi}/ic_launcher.png`, await render(size, { pad: 4, bg: '#f6f1e4' })))
  written.push(
    await save(`mipmap-${dpi}/ic_launcher_round.png`, await render(size, { pad: 4, bg: '#f6f1e4' })),
  )

  // Lapis depan adaptive icon: 108dp, isi penting di 66% bagian tengah
  const fgSize = Math.round(108 * factor)
  written.push(await save(`mipmap-${dpi}/ic_launcher_foreground.png`, await render(fgSize, { pad: 22 })))
}

/* --------------------------------------------- ikon status notifikasi */
// Android memakai alfa saja: gambar dijadikan putih pekat pada latar transparan
for (const [dpi, factor] of Object.entries(DPI)) {
  const size = Math.round(24 * factor)
  written.push(
    await save(`drawable-${dpi}/ic_stat_reminder.png`, await render(size, { pad: 2, grayscale: true })),
  )
}

/* --------------------------------------------------------- splash screen */
// Satu gambar per orientasi; logo di tengah latar kertas
const SPLASH = {
  'drawable-port-mdpi': [320, 480],
  'drawable-port-hdpi': [480, 800],
  'drawable-port-xhdpi': [720, 1280],
  'drawable-port-xxhdpi': [960, 1600],
  'drawable-port-xxxhdpi': [1280, 1920],
  'drawable-land-mdpi': [480, 320],
  'drawable-land-hdpi': [800, 480],
  'drawable-land-xhdpi': [1280, 720],
  'drawable-land-xxhdpi': [1600, 960],
  'drawable-land-xxxhdpi': [1920, 1280],
}

for (const [dir, [w, h]] of Object.entries(SPLASH)) {
  const side = Math.round(Math.min(w, h) * 0.42)
  await page.setViewportSize({ width: w, height: h })
  await page.setContent(
    `<!doctype html><html><body style="margin:0;width:${w}px;height:${h}px;background:#f6f1e4;
       display:flex;align-items:center;justify-content:center">
       <div style="width:${side}px;height:${side}px;display:flex">${svg}</div>
     </body></html>`,
  )
  await page.waitForTimeout(60)
  written.push(await save(`${dir}/splash.png`, await page.screenshot()))
}
// splash.png dasar (dipakai bila kepadatan tidak cocok)
await page.setViewportSize({ width: 720, height: 1280 })
await page.setContent(
  `<!doctype html><html><body style="margin:0;width:720px;height:1280px;background:#f6f1e4;
     display:flex;align-items:center;justify-content:center">
     <div style="width:302px;height:302px;display:flex">${svg}</div>
   </body></html>`,
)
written.push(await save('drawable/splash.png', await page.screenshot()))

await browser.close()

/* ------------------------------------------------------------- favicon web */
await writeFile(resolve(root, 'public/favicon.svg'), svg, 'utf8')

console.log(`${written.length} berkas ikon ditulis:`)
for (const w of written) console.log('  ' + w)
console.log('  public/favicon.svg')
