/**
 * Cari kombinasi --mushaf-gutter dan --mushaf-text yang membuat baris terpadat
 * di SELURUH 604 halaman tetap muat, sekaligus menjaga teks sebesar mungkin.
 *
 * Diukur pada rasio 19:9 tersempit (360x760) karena itu kasus paling sulit;
 * bila muat di sana, rasio yang lebih lebar otomatis aman.
 */
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 4323
const BASE = `http://localhost:${PORT}`

// Cari halaman yang barisnya paling banyak kata — kandidat terberat
const pagesFile = JSON.parse(
  gunzipSync(readFileSync('public/data/quran-pages.json.gz')).toString('utf8'),
)
const byDensity = pagesFile.pages
  .map((p) => ({ page: p.page, max: Math.max(...p.lines.map((l) => l.words.length)) }))
  .sort((a, b) => b.max - a.max)

const HARDEST = byDensity.slice(0, 12).map((x) => x.page)
console.log(`halaman terpadat: ${HARDEST.map((p) => p).join(', ')}`)
console.log(`kata terbanyak dalam satu baris: ${byDensity[0].max}\n`)

const CANDIDATES = [
  { gutter: '7vw', text: 'clamp(0.92rem, 4.3vw, 1.55rem)' },
  { gutter: '5vw', text: 'clamp(0.92rem, 4.3vw, 1.55rem)' },
  { gutter: '5vw', text: 'clamp(0.86rem, 4vw, 1.45rem)' },
  { gutter: '4vw', text: 'clamp(0.86rem, 4vw, 1.45rem)' },
  { gutter: '4vw', text: 'clamp(0.84rem, 3.85vw, 1.4rem)' },
  { gutter: '3.5vw', text: 'clamp(0.84rem, 3.85vw, 1.4rem)' },
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
  const ctx = await browser.newContext({
    viewport: { width: 360, height: 760 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  })
  const page = await ctx.newPage()

  for (const cand of CANDIDATES) {
    let worst = { ratio: 0 }
    let fontPx = 0

    for (const n of HARDEST) {
      await page.goto(`${BASE}/#/reader?page=${n}`)
      await page.reload()
      await page.waitForSelector('.mushaf-line', { timeout: 15000 })

      // Terapkan kandidat lalu biarkan layout menetap
      await page.evaluate((c) => {
        document.documentElement.style.setProperty('--mushaf-gutter', c.gutter)
        document.documentElement.style.setProperty('--mushaf-text', c.text)
      }, cand)
      await page.waitForTimeout(320)

      const m = await page.evaluate(() => {
        const lines = [...document.querySelectorAll('.mushaf-line')]
        let out = { ratio: 0, words: 0, font: 0 }
        for (const line of lines) {
          const kids = [...line.children]
          if (!kids.length) continue
          const sum = kids.reduce((t, k) => t + k.getBoundingClientRect().width, 0)
          const gaps = (kids.length - 1) * parseFloat(getComputedStyle(line).columnGap || '0')
          const ratio = (sum + gaps) / line.clientWidth
          if (ratio > out.ratio) {
            out = {
              ratio,
              words: kids.length,
              font: Math.round(parseFloat(getComputedStyle(line).fontSize) * 10) / 10,
            }
          }
        }
        return out
      })

      fontPx = m.font || fontPx
      if (m.ratio > worst.ratio) worst = { ...m, page: n }
    }

    const pct = Math.round(worst.ratio * 100)
    const verdict = worst.ratio > 1 ? `LUBER ${pct}%` : pct > 97 ? `mepet ${pct}%` : `muat ${pct}%`
    console.log(
      `gutter ${cand.gutter.padEnd(6)} font ${String(fontPx).padStart(4)}px  ` +
        `terberat hal ${String(worst.page).padStart(3)} (${worst.words} kata)  →  ${verdict}`,
    )
  }

  await browser.close()
} finally {
  server.kill()
}
