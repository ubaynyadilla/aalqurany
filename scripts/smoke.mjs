/**
 * Uji asap end-to-end di browser sungguhan, ukuran layar HP.
 * Memverifikasi jalur utama PRD: cover → reader (immersive, tap zona atas/bawah,
 * swipe halaman, lompat ayat/juz) → memorize (kalimat awal, mark, reveal) →
 * reminder (buat, tampil di daftar), plus toggle tema.
 *
 *   node scripts/smoke.mjs [baseUrl]
 */
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const BASE = process.argv[2] ?? 'http://127.0.0.1:5173'
const SHOT_DIR = 'screenshots'
const results = []
let browser

const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
]

function check(name, passed, detail = '') {
  results.push({ name, passed, detail })
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function shot(page, name) {
  await page.screenshot({ path: `${SHOT_DIR}/${name}.png` })
}

/** Ketuk titik absolut pada layar (meniru jari, bukan klik elemen). */
async function tapAt(page, x, y) {
  await page.mouse.click(x, y)
  await page.waitForTimeout(220)
}

/**
 * Titik di zona atas yang tidak tertutup baris pills saat menu terbuka
 * (pills menempati y≈51–84), sehingga aman untuk membuka maupun menutup menu.
 */
const TOP_ZONE = [206, 20]

async function toggleMenu(page) {
  await tapAt(page, TOP_ZONE[0], TOP_ZONE[1])
}

/**
 * Geser layar dengan event sentuh sungguhan. Reader mendengarkan touchstart/
 * touchend, yang tidak dibangkitkan oleh API mouse, jadi dipakai CDP.
 */
async function swipe(cdp, fromX, toX, y) {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: fromX, y }],
  })
  const steps = 10
  for (let i = 1; i <= steps; i++) {
    const x = fromX + ((toX - fromX) * i) / steps
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] })
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await new Promise((r) => setTimeout(r, 420))
}

/** Jumlah baris yang benar-benar tergambar: baris teks + baris hiasan surah. */
async function renderedLineCount(page) {
  const text = await page.locator('.mushaf-line').count()
  const headers = await page.locator('.surah-header').count()
  return { text, headers, total: text + headers }
}

async function main() {
  await mkdir(SHOT_DIR, { recursive: true })

  let launchError
  for (const executablePath of CHROME_PATHS) {
    try {
      browser = await chromium.launch({ executablePath })
      break
    } catch (err) {
      launchError = err
    }
  }
  if (!browser) throw launchError ?? new Error('Browser tidak ditemukan')

  const context = await browser.newContext({
    viewport: { width: 412, height: 892 }, // ukuran layar HP Android umum
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  })
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)

  const errors = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(String(e)))

  /* ------------------------------------------------------------ cover screen */
  // Mulai dari keadaan bersih supaya hasil tes tidak bergantung pada sisa data
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.clear())
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)

  check(
    'Shortcut terakhir dibaca belum tampil pada pemakaian pertama',
    (await page.locator('.last-read').count()) === 0,
  )

  check('Cover screen tampil', await page.locator('.cover').isVisible())
  check(
    'Cover punya pills Reminder & Memorize',
    (await page.getByRole('button', { name: 'Memorize' }).count()) > 0 &&
      (await page.getByRole('button', { name: 'Reminder' }).count()) > 0,
  )
  await shot(page, '01-cover-light')

  // Toggle tema harus cepat dijangkau dari cover
  await page.getByRole('button', { name: /Mode gelap|Mode terang/ }).click()
  await page.waitForTimeout(320)
  const darkOn = await page.evaluate(() => document.documentElement.classList.contains('dark'))
  check('Toggle tema mengaktifkan dark mode', darkOn)
  await shot(page, '02-cover-dark')

  // Tema harus bertahan setelah reload (persist antar sesi)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  const darkPersist = await page.evaluate(() =>
    document.documentElement.classList.contains('dark'),
  )
  check('Preferensi tema bertahan setelah reload', darkPersist)

  // Kembali ke light supaya tangkapan layar berikutnya mudah dibaca
  await page.getByRole('button', { name: /Mode terang/ }).click()
  await page.waitForTimeout(300)

  /* ----------------------------------------------------------------- reader */
  await page.getByRole('button', { name: 'Buka Mushaf' }).click()
  await page.waitForTimeout(900)

  check('Reader terbuka', await page.locator('.reader').isVisible())

  const lines = await renderedLineCount(page)
  check(
    'Halaman dirender tepat 15 baris mushaf',
    lines.total === 15,
    `${lines.text} baris teks + ${lines.headers} baris hiasan surah`,
  )

  const arabicShown = await page.locator('.mushaf-line .word').first().innerText()
  check('Teks Arab tampil', /[\u0600-\u06FF]/.test(arabicShown), arabicShown.slice(0, 12))

  const headerShown = await page.locator('.surah-name').count()
  check('Header nama surah tampil di halaman 1', headerShown > 0)

  // Menu harus TERSEMBUNYI saat pertama membaca (immersive)
  check('Menu tersembunyi saat membaca', (await page.locator('.menu-layer').count()) === 0)
  await shot(page, '03-reader-immersive')

  // Ketuk TENGAH layar: tidak boleh memunculkan menu
  await tapAt(page, 206, 446)
  check(
    'Ketuk tengah layar tidak memunculkan menu',
    (await page.locator('.menu-layer').count()) === 0,
  )

  // Ketuk zona ATAS: menu muncul
  await toggleMenu(page)
  check('Ketuk area atas memunculkan pills menu', await page.locator('.menu-layer').isVisible())
  await shot(page, '04-reader-menu')

  await toggleMenu(page)
  await page.waitForTimeout(240)
  check('Ketuk lagi menutup menu', (await page.locator('.menu-layer').count()) === 0)

  // Zona BAWAH juga memanggil menu. Dipakai sisi kiri agar tidak mengenai
  // pager yang mengambang di tengah bawah.
  await tapAt(page, 60, 840)
  check('Ketuk area bawah memunculkan menu', await page.locator('.menu-layer').isVisible())

  await toggleMenu(page)
  await page.waitForTimeout(240)
  check('Menu tertutup kembali', (await page.locator('.menu-layer').count()) === 0)

  // Swipe ganti halaman
  const pageBefore = await currentPageNumber(page)
  await swipe(cdp, 90, 330, 446) // ke arah kanan → halaman berikutnya (RTL)
  const pageAfterNext = await currentPageNumber(page)
  check(
    'Swipe berpindah halaman',
    pageAfterNext === pageBefore + 1,
    `${pageBefore} → ${pageAfterNext}`,
  )

  await swipe(cdp, 330, 90, 446) // balik
  const pageBack = await currentPageNumber(page)
  check('Swipe arah sebaliknya kembali', pageBack === pageBefore, `→ ${pageBack}`)

  // Lompat ke ayat: Al-Baqarah 255 (Ayat Kursi) ada di halaman 42
  await page.getByRole('button', { name: 'Lompat ke ayat' }).click()
  await page.waitForTimeout(320)
  await page.getByPlaceholder('Cari surah...').fill('Baqarah')
  await page.waitForTimeout(220)
  await page.getByRole('option', { name: /Al-Baqarah/ }).first().click()
  await page.locator('input[type=number]').first().fill('255')
  await page.getByRole('button', { name: /^Buka Al-Baqarah/ }).click()
  await page.waitForTimeout(700)

  const pageAfterJump = await currentPageNumber(page)
  check('Lompat ke Al-Baqarah 255 mendarat di halaman 42', pageAfterJump === 42, `hal. ${pageAfterJump}`)
  check('Ayat tujuan ditandai', (await page.locator('.highlight').count()) > 0)
  await shot(page, '05-reader-ayat-kursi')

  // Lompat ke juz 30 → halaman 582
  await page.getByRole('button', { name: 'Lompat ke juz' }).click()
  await page.waitForTimeout(320)
  await page.getByRole('button', { name: /Juz 30/ }).click()
  await page.waitForTimeout(700)
  const pageJuz30 = await currentPageNumber(page)
  check('Lompat ke juz 30 mendarat di halaman 582', pageJuz30 === 582, `hal. ${pageJuz30}`)

  /* --------------------------------------------------------------- memorize */
  await toggleMenu(page)
  await page.getByRole('button', { name: 'Memorize' }).click()
  await page.waitForTimeout(800)

  check('Memorize mode terbuka', await page.locator('.memorize').isVisible())

  // Sisi kiri wajib memuat Mark & Reveal; sisi kanan memuat daftar ayat
  const railBox = await page.locator('.left-rail').boundingBox()
  const panelBox = await page.locator('.right-panel').boundingBox()
  check(
    'Mark & Reveal berada di sisi kiri, ayat di sisi kanan',
    railBox.x < panelBox.x,
    `rail x=${Math.round(railBox.x)} vs panel x=${Math.round(panelBox.x)}`,
  )

  const verseCount = await page.locator('.verse').count()
  check('Beberapa ayat tampil sekaligus', verseCount > 1, `${verseCount} ayat`)

  // Hanya kalimat awal yang tampil (ada elipsis penanda sisanya disembunyikan)
  const firstVerseText = await page.locator('.verse-text').first().innerText()
  const wordsShown = firstVerseText.replace('…', '').trim().split(/\s+/).length
  check('Hanya kata awal ditampilkan', wordsShown <= 3 && firstVerseText.includes('…'), `${wordsShown} kata`)
  await shot(page, '06-memorize')

  // Reveal: tahan → teks penuh, lepas → tersembunyi lagi.
  // Diukur pada ayat terpanjang di halaman: ayat pendek yang jumlah katanya
  // sama dengan setelan "kata awal" memang tidak berubah saat di-reveal.
  const hiddenTexts = await page.locator('.verse-text').allInnerTexts()
  const longestIdx = hiddenTexts.reduce(
    (best, t, i) => (t.length > hiddenTexts[best].length ? i : best),
    0,
  )
  const hiddenLongest = hiddenTexts[longestIdx]

  const revealBtn = page.getByRole('button', { name: /Tampilkan teks penuh/ })
  await revealBtn.hover()
  await page.mouse.down()
  await page.waitForTimeout(380)
  const revealedText = await page.locator('.verse-text').nth(longestIdx).innerText()
  const allRevealed = await page.locator('.verse-text.revealed').count()
  await shot(page, '07-memorize-reveal')
  await page.mouse.up()
  await page.waitForTimeout(340)
  const hiddenAgain = await page.locator('.verse-text').nth(longestIdx).innerText()

  check(
    'Reveal menampilkan teks penuh saat ditahan',
    revealedText.length > hiddenLongest.length && !revealedText.includes('…'),
    `${hiddenLongest.length} → ${revealedText.length} karakter`,
  )
  check('Teks kembali tersembunyi setelah dilepas', hiddenAgain.includes('…'))

  // Satu ikon me-reveal SELURUH ayat di halaman, bukan satu per satu
  check(
    'Reveal berlaku untuk seluruh ayat di halaman',
    allRevealed === verseCount,
    `${allRevealed}/${verseCount} ayat`,
  )

  // Mark: buka tray, seret bentuk ke ayat
  await page.getByRole('button', { name: 'Menu tanda' }).click()
  await page.waitForTimeout(360)
  check('Tray bentuk muncul', await page.locator('.tray').isVisible())

  const trayBox = await page.locator('.tray').boundingBox()
  const viewportW = 412
  check(
    'Tray meluncur dari sisi kanan layar',
    trayBox.x + trayBox.width >= viewportW - 4,
    `tepi kanan tray = ${Math.round(trayBox.x + trayBox.width)} dari ${viewportW}`,
  )
  await shot(page, '08-memorize-tray')

  const circleBtn = page.getByRole('button', { name: 'Tanda Bulatan' })
  const cBox = await circleBtn.boundingBox()
  const targetVerse = page.locator('.verse').nth(1)
  const targetKey = await targetVerse.getAttribute('data-verse-key')
  const vBox = await targetVerse.boundingBox()

  await page.mouse.move(cBox.x + cBox.width / 2, cBox.y + cBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(vBox.x + vBox.width / 2, vBox.y + vBox.height / 2, { steps: 14 })
  await page.waitForTimeout(220)
  const hoveredWhileDragging = await page.locator('.verse.hover').count()
  await shot(page, '09-memorize-dragging')
  await page.mouse.up()
  await page.waitForTimeout(560)

  check('Ayat tujuan tersorot saat bentuk diseret', hoveredWhileDragging === 1)

  const markCount = await page.locator('.mark-chip').count()
  check('Drag-and-drop menambahkan mark', markCount === 1, `${markCount} mark`)

  // Mark harus menempel pada ayat yang dituju, bukan ayat lain
  const markedOnTarget = await targetVerse.locator('.mark-chip').count()
  check('Mark menempel pada ayat yang dituju', markedOnTarget === 1, `ayat ${targetKey}`)
  await shot(page, '10-memorize-marked')

  // Mark harus persisten setelah reload
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1100)
  const markAfterReload = await page.locator('.mark-chip').count()
  check('Mark tersimpan setelah reload', markAfterReload === 1, `${markAfterReload} mark`)

  // Hapus: long-press → target hapus muncul → seret ke sana
  const chip = page.locator('.mark-chip').first()
  const chipBox = await chip.boundingBox()
  await page.mouse.move(chipBox.x + chipBox.width / 2, chipBox.y + chipBox.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(650) // lewati ambang long-press
  const trashVisible = await page.locator('[data-trash]').isVisible()
  check('Long-press memunculkan ikon hapus', trashVisible)
  await shot(page, '11-memorize-trash')

  const trashBox = await page.locator('[data-trash]').boundingBox()
  await page.mouse.move(trashBox.x + trashBox.width / 2, trashBox.y + trashBox.height / 2, {
    steps: 14,
  })
  await page.waitForTimeout(220)
  await page.mouse.up()
  await page.waitForTimeout(520)

  const marksAfterDelete = await page.locator('.mark-chip').count()
  check('Seret ke ikon hapus menghapus mark', marksAfterDelete === 0, `${marksAfterDelete} mark`)

  // Setelan memorize: ubah jumlah kata awal
  await page.getByRole('button', { name: 'Setelan memorize' }).click()
  await page.waitForTimeout(360)
  await page.locator('input[type=range]').first().fill('4')
  await page.waitForTimeout(300)
  await shot(page, '12-memorize-settings')
  await page.locator('button[aria-label="Tutup"]').click()
  await page.waitForTimeout(320)

  const widerText = await page.locator('.verse-text').first().innerText()
  const widerWords = widerText.replace('…', '').trim().split(/\s+/).length
  check('Setelan jumlah kata awal berpengaruh', widerWords === 4, `${widerWords} kata`)

  /* --------------------------------------------------------------- reminder */
  await page.goto(`${BASE}/#/reminder`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)

  check('Halaman reminder terbuka', (await page.locator('.reminder-view').count()) > 0)
  await shot(page, '13-reminder-empty')

  await page.getByRole('button', { name: 'Buat reminder' }).first().click()
  await page.waitForTimeout(400)

  await page.getByPlaceholder('mis. Baca sebelum tidur').fill('Baca sebelum tidur')
  await page.locator('.field[type=date]').fill('2026-09-20')
  await page.locator('.field[type=time]').fill('21:30')
  await page.getByRole('button', { name: 'Berulang' }).click()
  await page.waitForTimeout(200)
  await page.locator('.field.num').fill('2')

  // Pilih Al-Baqarah, ayat 14–98 (contoh persis dari PRD)
  await page.locator('select').first().selectOption('2')
  await page.waitForTimeout(250)
  const ayahInputs = page.locator('.grid-2 input[type=number]')
  await ayahInputs.nth(0).fill('14')
  await ayahInputs.nth(1).fill('98')
  await page.waitForTimeout(200)

  const previewText = await page.locator('.preview').innerText()
  check(
    'Pratinjau notifikasi hanya menyebut ayat awal',
    previewText.includes('14') && !previewText.includes('98'),
    previewText.replace(/\s+/g, ' ').trim(),
  )
  await shot(page, '14-reminder-form')

  await page.getByRole('button', { name: 'Simpan reminder' }).click()
  await page.waitForTimeout(700)

  const cardCount = await page.locator('.card').count()
  check('Reminder tersimpan dan tampil di daftar', cardCount === 1, `${cardCount} kartu`)

  const cardTitle = await page.locator('.card-title').innerText()
  const cardRange = await page.locator('.card-range').innerText()
  const cardSched = await page.locator('.card-sched').innerText()
  check('Judul bebas tersimpan apa adanya', cardTitle === 'Baca sebelum tidur', cardTitle)
  check('Rentang bacaan tersimpan', /14.*98/.test(cardRange), cardRange)
  check('Interval kustom terbaca', /tiap 2 hari/.test(cardSched), cardSched)
  await shot(page, '15-reminder-list')

  // Reminder bertahan setelah reload
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  check('Reminder bertahan setelah reload', (await page.locator('.card').count()) === 1)

  // Deep link: tap "Buka" harus membuka reader di ayat awal (hal. 3 untuk 2:14)
  await page.getByRole('button', { name: 'Buka' }).click()
  await page.waitForTimeout(800)
  const deepLinkPage = await currentPageNumber(page)
  check('Tombol Buka membawa ke halaman ayat awal', deepLinkPage === 3, `hal. ${deepLinkPage}`)

  /* ------------------------------------------------- shortcut terakhir dibaca */
  await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  const lastReadVisible = await page.locator('.last-read').isVisible()
  check('Shortcut "terakhir dibaca" muncul di cover', lastReadVisible)

  const lastReadLabel = await page.locator('.lr-page').innerText()
  check('Shortcut menunjuk halaman terakhir', lastReadLabel === '3', `hal. ${lastReadLabel}`)
  await shot(page, '16-cover-last-read')

  await page.locator('.last-read').click()
  await page.waitForTimeout(800)
  check(
    'Shortcut membuka reader di halaman terakhir',
    (await currentPageNumber(page)) === 3 && (await page.locator('.reader').isVisible()),
  )

  // Shortcut tidak boleh tampil di reader
  check(
    'Shortcut tidak muncul di reader',
    (await page.locator('.last-read').count()) === 0,
  )

  /* -------------------------------------------------------------- dark mode */
  await toggleMenu(page)
  await page.getByRole('button', { name: 'Gelap' }).click()
  await page.waitForTimeout(400)
  await toggleMenu(page)
  await page.waitForTimeout(300)
  await shot(page, '17-reader-dark')
  const readerDark = await page.evaluate(() =>
    document.documentElement.classList.contains('dark'),
  )
  check('Dark mode aktif di reader', readerDark)

  await page.goto(`${BASE}/#/memorize`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await shot(page, '18-memorize-dark')

  /* ------------------------------------------------------------------ error */
  const realErrors = errors.filter((e) => !/favicon|404/i.test(e))
  check('Tidak ada error di console', realErrors.length === 0, realErrors.slice(0, 2).join(' | '))

  await context.close()
  await browser.close()

  const failed = results.filter((r) => !r.passed)
  console.log(`\n${results.length - failed.length}/${results.length} lulus`)
  if (failed.length) {
    console.log('\nGagal:')
    for (const f of failed) console.log(` - ${f.name}${f.detail ? ` (${f.detail})` : ''}`)
    process.exitCode = 1
  }
}

/**
 * Nomor halaman aktif. Di memorize mode selalu terlihat; di reader hanya
 * tampil bersama menu, jadi menu dibuka sebentar lalu ditutup lagi supaya
 * pemeriksaan tidak mengubah keadaan yang sedang diuji.
 */
async function currentPageNumber(page) {
  if (await page.locator('.page-label').count()) {
    return parseNumber(await page.locator('.page-label').first().innerText())
  }

  const alreadyOpen = await page.locator('.pager').isVisible().catch(() => false)
  if (!alreadyOpen) await toggleMenu(page)

  await page.locator('.pager-label').waitFor({ state: 'visible', timeout: 6000 })
  const text = await page.locator('.pager-label').innerText()

  if (!alreadyOpen) {
    await toggleMenu(page)
    await page.locator('.pager').waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {})
  }
  return parseNumber(text)
}

function parseNumber(text) {
  const m = text.match(/hal\.?\s*(\d+)|Halaman\s*(\d+)/i)
  return Number(m?.[1] ?? m?.[2])
}

main().catch(async (err) => {
  console.error('\nSmoke test error:', err.message)
  if (browser) await browser.close()
  process.exitCode = 1
})
