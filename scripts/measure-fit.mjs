/**
 * Ukur apakah halaman mushaf benar-benar muat pada beberapa rasio layar.
 *
 * Dua hal yang diperiksa:
 *  - luber horizontal: baris memakai white-space:nowrap, jadi baris terpanjang
 *    bisa keluar kolom bila gutter terlalu lebar;
 *  - luber vertikal: 15 baris harus muat dalam tinggi panggung.
 *
 * Jalankan setelah `npm run build`: node scripts/measure-fit.mjs
 */
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 4321
const BASE = `http://localhost:${PORT}`

/** Ukuran CSS px yang lazim; 19:9 adalah target utama pertanyaan ini */
const VIEWPORTS = [
  { name: '19.5:9  412x892', width: 412, height: 892 },
  { name: '19:9    390x823', width: 390, height: 823 },
  { name: '19:9    360x760', width: 360, height: 760 },
  { name: '20:9    412x915', width: 412, height: 915 },
  { name: '16:9    360x640 (sempit)', width: 360, height: 640 },
]

/** Halaman uji: padat kata, banyak kepala surah, dan awal/akhir mushaf */
const PAGES = [1, 2, 106, 187, 300, 442, 587, 604]

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  shell: true,
  stdio: 'ignore',
})

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(BASE)).ok) return
    } catch {
      /* belum siap */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('preview server tidak siap')
}

try {
  await waitForServer()
  const browser = await chromium.launch({ executablePath: CHROME })

  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
      hasTouch: true,
      isMobile: true,
    })
    const page = await ctx.newPage()

    let worstOverflow = 0
    let worstPage = 0
    let vertical = null
    let fontPx = 0

    for (const n of PAGES) {
      await page.goto(`${BASE}/#/reader?page=${n}`)
      await page.waitForSelector('.mushaf-line', { timeout: 15000 })
      await page.waitForTimeout
      await page.waitForTimeout(450)

      const m = await page.evaluate(() => {
        const stage = document.querySelector('.stage')
        const mushaf = document.querySelector('.mushaf')
        const lines = [...document.querySelectorAll('.mushaf-line')]

        // Luber horizontal: selisih lebar isi baris terhadap lebar kolom
        let over = 0
        for (const l of lines) {
          over = Math.max(over, l.scrollWidth - l.clientWidth)
        }

        const first = lines.find((l) => l.textContent.trim())
        return {
          colWidth: mushaf ? Math.round(mushaf.clientWidth) : 0,
          stageH: stage ? Math.round(stage.clientHeight) : 0,
          contentH: mushaf ? Math.round(mushaf.scrollHeight) : 0,
          over: Math.round(over),
          fontPx: first ? Math.round(parseFloat(getComputedStyle(first).fontSize) * 10) / 10 : 0,
          rows: lines.length + document.querySelectorAll('.surah-header').length +
            document.querySelectorAll('.bismillah-line').length,
        }
      })

      fontPx = m.fontPx || fontPx
      if (m.over > worstOverflow) {
        worstOverflow = m.over
        worstPage = n
      }
      if (!vertical) vertical = m
      vertical = { ...vertical, ...m, worstV: Math.max(vertical.worstV ?? 0, m.contentH - m.stageH) }
    }

    const vOver = Math.max(0, vertical.worstV ?? 0)
    const hVerdict = worstOverflow > 1 ? `LUBER ${worstOverflow}px (hal ${worstPage})` : 'muat'
    const vVerdict = vOver > 1 ? `LUBER ${vOver}px` : 'muat'

    console.log(
      `${vp.name.padEnd(24)} kolom ${String(vertical.colWidth).padStart(3)}px  ` +
        `font ${String(fontPx).padStart(4)}px  horizontal: ${hVerdict.padEnd(22)} vertikal: ${vVerdict}`,
    )

    await ctx.close()
  }

  await browser.close()
} finally {
  server.kill()
}
