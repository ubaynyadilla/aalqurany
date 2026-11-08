/**
 * Ambil tangkapan layar tiap layar untuk pemeriksaan visual cepat.
 * Jalankan setelah `npm run build`: node scripts/shots.mjs
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { spawn } from 'node:child_process'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const OUT = 'tmp-shots'
const PORT = 4319
const BASE = `http://localhost:${PORT}`

mkdirSync(OUT, { recursive: true })

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  shell: true,
  stdio: 'ignore',
})

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(BASE)
      if (res.ok) return
    } catch {
      /* server belum siap */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('preview server tidak siap')
}

const shots = []

try {
  await waitForServer()

  const browser = await chromium.launch({ executablePath: CHROME })
  const ctx = await browser.newContext({
    viewport: { width: 412, height: 892 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  })
  const page = await ctx.newPage()

  const errors = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })

  async function shot(name, hash, prep) {
    await page.goto(`${BASE}/#${hash}`)
    await page.waitForTimeout(1200)
    if (prep) await prep()
    await page.screenshot({ path: `${OUT}/${name}.png` })
    shots.push(name)
  }

  // Cover: shortcut lanjut baca dengan halo & tulisan Arab
  await shot('01-cover', '/')

  // Reader: pills surah/juz, notch nomor halaman, bingkai Kufi
  await shot('02-reader-p1', '/reader?page=1')
  await shot('03-reader-p2', '/reader?page=2')
  // Halaman 587 memuat beberapa kepala surah sekaligus
  await shot('04-reader-p587', '/reader?page=587')
  await shot('05-reader-menu', '/reader?page=2', async () => {
    await page.touchscreen.tap(206, 20)
    await page.waitForTimeout(400)
  })

  // Memorize: baris sejajar mushaf, rail kiri, tray bentuk
  await shot('06-memorize', '/memorize')
  await shot('07-memorize-tray', '/memorize', async () => {
    await page.getByRole('button', { name: 'Menu tanda' }).click()
    await page.waitForTimeout(350)
  })
  await shot('08-memorize-helper', '/memorize', async () => {
    await page.getByRole('button', { name: 'Pilih ayat bantuan' }).click()
    await page.waitForTimeout(500)
  })

  // Dark mode
  await shot('09-dark-reader', '/reader?page=2', async () => {
    await page.evaluate(() => document.documentElement.classList.add('dark'))
    await page.waitForTimeout(250)
  })

  console.log(`OK ${shots.length} tangkapan: ${shots.join(', ')}`)
  if (errors.length) {
    console.log('\nERROR konsol:')
    for (const e of [...new Set(errors)]) console.log('  ' + e)
  } else {
    console.log('Tanpa error konsol.')
  }

  await browser.close()
} finally {
  server.kill()
}
