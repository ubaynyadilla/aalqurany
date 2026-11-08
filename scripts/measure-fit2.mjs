/**
 * Pemeriksaan kedua, lebih ketat: `justify-content: space-between` membuat
 * scrollWidth tidak selalu memperlihatkan luber, karena flex item masih boleh
 * mengempis. Jadi lebar kata dijumlah sendiri dan dibandingkan dengan kolom.
 *
 * Yang dilaporkan: rasio isi/kolom baris terpadat, dan sisa kelegaan (headroom).
 */
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 4322
const BASE = `http://localhost:${PORT}`

const VIEWPORTS = [
  { name: '19.5:9  412x892', width: 412, height: 892 },
  { name: '19:9    390x823', width: 390, height: 823 },
  { name: '19:9    360x760', width: 360, height: 760 },
  { name: '16:9    360x640', width: 360, height: 640 },
]

/** Halaman yang barisnya paling padat kata di seluruh mushaf */
const PAGES = [1, 2, 106, 187, 235, 300, 442, 587, 604]

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

    let tightest = { ratio: 0 }

    for (const n of PAGES) {
      // Router memakai hash history: berpindah hash saja tidak memuat ulang
      // komponen, sehingga onMounted (pembaca query ?page=) tidak jalan lagi.
      // Karena itu dipaksa reload penuh untuk setiap halaman uji.
      await page.goto(`${BASE}/#/reader?page=${n}`)
      await page.reload()
      await page.waitForSelector('.mushaf-line', { timeout: 15000 })
      await page.waitForFunction(
        (want) => document.querySelector('.page-notch')?.textContent?.trim().length > 0 || want > 0,
        n,
        { timeout: 15000 },
      )
      await page.waitForTimeout(500)

      const worst = await page.evaluate(() => {
        const lines = [...document.querySelectorAll('.mushaf-line')]
        let out = { ratio: 0, words: 0, sum: 0, col: 0 }

        for (const line of lines) {
          const kids = [...line.children]
          if (!kids.length) continue
          // Lebar sebenarnya tiap kata, di luar pengaruh space-between
          const sum = kids.reduce((t, k) => t + k.getBoundingClientRect().width, 0)
          const gaps = (kids.length - 1) * parseFloat(getComputedStyle(line).columnGap || '0')
          const need = sum + gaps
          const col = line.clientWidth
          const ratio = need / col
          if (ratio > out.ratio) out = { ratio, words: kids.length, sum: Math.round(need), col: Math.round(col) }
        }
        return out
      })

      if (worst.ratio > tightest.ratio) tightest = { ...worst, page: n }
    }

    const pct = Math.round(tightest.ratio * 100)
    const verdict =
      tightest.ratio > 1 ? `LUBER ${pct}%` : pct > 96 ? `mepet ${pct}%` : `lega, terisi ${pct}%`

    console.log(
      `${vp.name.padEnd(18)} baris terpadat hal ${String(tightest.page).padStart(3)} ` +
        `(${tightest.words} kata): ${tightest.sum}px dari ${tightest.col}px  →  ${verdict}`,
    )

    await ctx.close()
  }

  await browser.close()
} finally {
  server.kill()
}
