/**
 * Verifikasi pas-otomatis: seluruh 604 halaman harus muat, dan ukuran font
 * hasilnya harus tetap nyaman dibaca.
 *
 * Diuji pada 19:9 tersempit (360x760) dan 19.5:9 (412x892).
 */
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 4324
const BASE = `http://localhost:${PORT}`

const VIEWPORTS = [
  { name: '19:9    360x760', width: 360, height: 760 },
  { name: '19.5:9  412x892', width: 412, height: 892 },
]

/** Sampel menyebar + halaman terpadat yang sebelumnya meluber */
const SAMPLE = [
  1, 2, 10, 17, 106, 131, 187, 235, 300, 355, 442, 457, 503, 562, 576, 578, 587, 589, 591, 597, 604,
]

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
    const p = await ctx.newPage()

    const overflowing = []
    let minFont = 999
    let maxFont = 0
    let minFontPage = 0
    let worstRatio = 0
    let worstPage = 0
    let vOverflow = []

    for (const n of SAMPLE) {
      await p.goto(`${BASE}/#/reader?page=${n}`)
      await p.reload()
      await p.waitForSelector('.mushaf-line', { timeout: 15000 })
      await p.waitForTimeout(560)

      const m = await p.evaluate(() => {
        const host = document.querySelector('.mushaf')
        const stage = document.querySelector('.stage')
        const lines = [...document.querySelectorAll('[data-fit-line]')]

        let ratio = 0
        for (const line of lines) {
          const kids = [...line.children]
          if (!kids.length) continue
          const sum = kids.reduce((t, k) => t + k.getBoundingClientRect().width, 0)
          const gap = parseFloat(getComputedStyle(line).columnGap || '0') || 0
          ratio = Math.max(ratio, (sum + gap * (kids.length - 1)) / line.clientWidth)
        }

        const first = lines.find((l) => l.textContent.trim())
        return {
          ratio,
          font: first ? Math.round(parseFloat(getComputedStyle(first).fontSize) * 10) / 10 : 0,
          vOver: host && stage ? Math.round(host.scrollHeight - stage.clientHeight) : 0,
        }
      })

      if (m.ratio > 1.001) overflowing.push(`${n} (${Math.round(m.ratio * 100)}%)`)
      if (m.ratio > worstRatio) {
        worstRatio = m.ratio
        worstPage = n
      }
      if (m.font && m.font < minFont) {
        minFont = m.font
        minFontPage = n
      }
      if (m.font > maxFont) maxFont = m.font
      if (m.vOver > 1) vOverflow.push(`${n} (+${m.vOver}px)`)
    }

    console.log(`\n${vp.name}`)
    console.log(`  font: ${minFont}px (hal ${minFontPage}) .. ${maxFont}px`)
    console.log(`  terpadat: hal ${worstPage} terisi ${Math.round(worstRatio * 100)}%`)
    console.log(`  luber horizontal: ${overflowing.length ? overflowing.join(', ') : 'tidak ada'}`)
    console.log(`  luber vertikal  : ${vOverflow.length ? vOverflow.join(', ') : 'tidak ada'}`)

    await ctx.close()
  }

  await browser.close()
} finally {
  server.kill()
}
