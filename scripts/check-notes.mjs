/**
 * Verifikasi lima catatan perbaikan, memakai SENTUHAN sungguhan (bukan mouse) —
 * karena semua keluhan yang diuji di sini hanya muncul di layar sentuh.
 *
 *  1. Menu pills keluar dari ketukan nomor halaman, 4 pills, letak atas & bawah.
 *  2. Halaman berayat pendek dipusatkan, tidak direnggangkan.
 *  3. Tidak ada baris yang melebihi lebar kolom.
 *  4. Transisi halaman: teks tidak berubah ukuran di tengah animasi.
 *  5. Memorize: catatan teks bisa diketik, tanda bisa ditaruh sampai baris 15,
 *     "ketuk untuk tambah" benar-benar menambah kalimat, Reveal menampilkan
 *     halaman mushaf asli.
 *
 *   node scripts/check-notes.mjs [baseUrl]
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://127.0.0.1:5173'
const results = []

const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
]

function check(name, passed, detail = '') {
  results.push({ name, passed, detail })
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function launch() {
  let err
  for (const executablePath of CHROME_PATHS) {
    try {
      return await chromium.launch({ executablePath })
    } catch (e) {
      err = e
    }
  }
  return chromium.launch().catch(() => {
    throw err ?? new Error('Browser tidak ditemukan')
  })
}

const browser = await launch()
const context = await browser.newContext({
  viewport: { width: 412, height: 892 },
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

/** Ketukan jari sungguhan pada koordinat layar. */
async function tap(x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await page.waitForTimeout(260)
}

async function tapEl(locator) {
  const b = await locator.boundingBox()
  if (!b) throw new Error('elemen tidak terlihat')
  await tap(Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2))
}

async function pageNumber() {
  const label = await page.locator('.page-notch').first().getAttribute('aria-label')
  return Number(label?.match(/Halaman (\d+)/)?.[1] ?? 0)
}

/**
 * Pindah halaman.
 *
 * Reader tidak lagi punya tombol panah (pills transparan di atas nomor halaman
 * sudah dihapus atas permintaan pengguna), jadi di sana halaman diubah lewat
 * alamat hash. Di memorize tombol panahnya masih ada dan tetap dipakai.
 */
async function gotoPage(target) {
  const hasArrows = await page.getByRole('button', { name: 'Halaman berikutnya' }).count()

  if (!hasArrows) {
    await page.evaluate((p) => {
      location.hash = `#/reader?page=${p}`
    }, target)
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    return (await pageNumber()) === target
  }

  for (let i = 0; i < 60; i++) {
    const n = await pageNumber()
    if (n === target) return true
    await tapEl(page.getByRole('button', { name: n < target ? 'Halaman berikutnya' : 'Halaman sebelumnya' }))
    await page.waitForTimeout(180)
  }
  return false
}

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.evaluate(() => localStorage.clear())

/* ==================================================== 1. menu dari nomor halaman */
await page.goto(`${BASE}/#/reader`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

check('Menu tersembunyi saat pertama membaca', (await page.locator('.menu-layer').count()) === 0)

// Ketukan di tengah & zona atas TIDAK lagi memunculkan menu
await tap(206, 446)
await tap(206, 30)
check(
  'Ketuk badan halaman tidak memunculkan menu (bug lama)',
  (await page.locator('.menu-layer').count()) === 0,
)

// Nomor halaman yang memunculkannya
await tapEl(page.locator('.page-notch'))
const menuVisible = await page.locator('.menu-layer').isVisible().catch(() => false)
check('Ketuk nomor halaman memunculkan menu', menuVisible)

const pillNames = await page.locator('.pill').allInnerTexts()
check('Empat pills muncul', pillNames.length === 4, pillNames.map((t) => t.trim()).join(', '))

// Pills transparan di atas nomor halaman (pager) sudah dihapus
check('Tidak ada lagi pills transparan di atas nomor halaman', (await page.locator('.pager').count()) === 0)

if (menuVisible) {
  const coverBox = await page.getByRole('button', { name: 'Cover' }).boundingBox()
  const themeBox = await page.getByRole('button', { name: /Gelap|Terang/ }).boundingBox()
  const surahBox = await page.locator('.top-bar .quick-pill').first().boundingBox()
  const juzBox = await page.locator('.top-bar .quick-pill').last().boundingBox()
  const notchBox = await page.locator('.page-notch').boundingBox()
  const botBox = await page.locator('.menu.bottom').boundingBox()

  // "Bersanding" = pusat vertikalnya sama, jadi keempatnya satu baris
  const mid = (b) => b.y + b.height / 2
  const spread = Math.max(
    Math.abs(mid(coverBox) - mid(surahBox)),
    Math.abs(mid(themeBox) - mid(juzBox)),
  )
  check(
    'Cover & tema sebaris dengan pills surah dan juz',
    spread < 6,
    `selisih pusat vertikal ${spread.toFixed(1)}px`,
  )

  // Urutan kiri→kanan: surah, cover, tema, juz — tanpa saling menimpa
  const order = [surahBox, coverBox, themeBox, juzBox]
  let ordered = true
  for (let i = 1; i < order.length; i++) {
    if (order[i].x < order[i - 1].x + order[i - 1].width - 1) ordered = false
  }
  check(
    'Keempat pills atas berjajar tanpa bertumpuk',
    ordered,
    order.map((b) => `${Math.round(b.x)}..${Math.round(b.x + b.width)}`).join(' | '),
  )

  check('Pills Memorize & Reminder ada di sisi bawah', botBox.y > 892 * 0.8, `y=${Math.round(botBox.y)}`)

  // Kanan-kiri nomor halaman: satu pill di kiri notch, satu di kanan
  const memoBox = await page.getByRole('button', { name: 'Memorize' }).boundingBox()
  const remBox = await page.getByRole('button', { name: 'Reminder' }).boundingBox()
  const notchMid = notchBox.x + notchBox.width / 2
  const flanking =
    (memoBox.x + memoBox.width < notchMid && remBox.x > notchMid) ||
    (remBox.x + remBox.width < notchMid && memoBox.x > notchMid)
  check(
    'Dua pills bawah mengapit nomor halaman kanan-kiri',
    flanking,
    `memorize ${Math.round(memoBox.x)}, notch ${Math.round(notchMid)}, reminder ${Math.round(remBox.x)}`,
  )
}

await tapEl(page.locator('.page-notch'))
await page.waitForTimeout(300)
check('Ketuk nomor halaman lagi menutup menu', (await page.locator('.menu-layer').count()) === 0)

/* ============================================ 2 & 3. tata letak baris mushaf */
async function lineStats() {
  return page.evaluate(() => {
    const host = document.querySelector('.mushaf')
    if (!host) return null
    const loose = host.classList.contains('loose')
    const rows = []
    for (const line of host.querySelectorAll('[data-fit-line]')) {
      const words = [...line.children]
      if (!words.length) continue
      let sum = 0
      for (const w of words) sum += w.getBoundingClientRect().width
      const avail = line.clientWidth
      const gaps = Math.max(1, words.length - 1)
      const cs = getComputedStyle(line)

      /*
       * Celah yang BENAR-BENAR terlihat: jarak antar tepi kata yang berdekatan.
       * Menghitungnya dari (lebar kolom - jumlah lebar kata) hanya sah ketika
       * baris direnggangkan sampai tepi; pada baris yang dipusatkan, sisa ruang
       * itu jatuh di pinggir kolom, bukan di antara kata.
       */
      let widest = 0
      for (let i = 1; i < words.length; i++) {
        const prev = words[i - 1].getBoundingClientRect()
        const cur = words[i].getBoundingClientRect()
        // dir=rtl: kata berikutnya berada di sebelah KIRI kata sebelumnya
        widest = Math.max(widest, Math.abs(prev.left - cur.right))
      }

      rows.push({
        words: words.length,
        fill: sum / avail,
        gap: widest,
        squeezed: line.hasAttribute('data-squeezed'),
        justify: cs.justifyContent,
        // Lebar sesudah transform: inilah yang benar-benar terlihat
        rendered: line.getBoundingClientRect().width,
        avail,
      })
    }
    return { loose, rows }
  })
}

// Halaman 1 (Al-Fatihah) — dulu celahnya sampai 127px
await gotoPage(1)
await page.waitForTimeout(700)
const p1 = await lineStats()
check('Halaman ayat pendek ditandai "loose"', p1.loose, 'hal. 1')
check(
  'Baris halaman pendek dipusatkan, tidak direnggangkan',
  p1.rows.every((r) => r.justify === 'center'),
  p1.rows[0]?.justify,
)
const maxGap1 = Math.max(...p1.rows.map((r) => r.gap))
check(
  'Celah antar kata halaman pendek jadi wajar',
  maxGap1 < 20,
  `celah maks ${maxGap1.toFixed(1)}px (sebelumnya 127.6px)`,
)

// Halaman padat harus TETAP rata kanan-kiri, tidak ikut dipusatkan
await gotoPage(3)
await page.waitForTimeout(700)
const p3 = await lineStats()
check('Halaman padat tetap rata kanan-kiri', !p3.loose && p3.rows[0].justify === 'space-between')

/* --------------------- baris kepanjangan: tidak boleh melebihi lebar kolom */
let overflowFound = 0
let squeezedFound = 0
for (const target of [1, 2, 3, 42, 177, 293, 402, 576, 604]) {
  await gotoPage(target)
  await page.waitForTimeout(620)
  const st = await lineStats()
  if (!st) continue
  for (const r of st.rows) {
    // Lebar tergambar tidak boleh melewati lebar kolom (toleransi 1px pembulatan)
    if (r.rendered > r.avail + 1) overflowFound++
    if (r.squeezed) squeezedFound++
  }
}
check(
  'Tidak ada baris yang melebihi batas kanan-kiri kolom',
  overflowFound === 0,
  `${overflowFound} baris meluber; ${squeezedFound} baris dipadatkan otomatis`,
)

/* ================================================= 4. transisi pindah halaman */
await gotoPage(50)
await page.waitForTimeout(700)

/*
 * Rekam ukuran font sepanjang animasi. Kalau ukurannya berubah SAAT animasi
 * berjalan, itulah yang terlihat sebagai gerakan patah-patah: teks melompat
 * ukuran di tengah geseran. Perekam dipasang lebih dulu, lalu halaman dibalik
 * dengan swipe jari sungguhan.
 */
await page.evaluate(() => {
  const w = window
  w.__probe = { sizes: [], animFrames: 0, settleFrames: 0 }
  w.__probeTimer = setInterval(() => {
    const stage = document.querySelector('.stage')
    const host = document.querySelector('.mushaf')
    if (!stage || !host) return
    if (stage.className.includes('turn-')) {
      w.__probe.animFrames++
      w.__probe.sizes.push(getComputedStyle(host).getPropertyValue('--fit-size').trim())
    }
    if (stage.classList.contains('settling')) w.__probe.settleFrames++
  }, 8)
})

const beforeTurn = await pageNumber()
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 90, y: 446 }] })
for (let i = 1; i <= 10; i++) {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: 90 + 24 * i, y: 446 }],
  })
}
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
await page.waitForTimeout(1100)

const probe = await page.evaluate(() => {
  clearInterval(window.__probeTimer)
  return window.__probe
})
const afterTurn = await pageNumber()

check('Swipe berpindah halaman', afterTurn === beforeTurn + 1, `${beforeTurn} → ${afterTurn}`)
check(
  'Halaman baru ditata dulu sebelum animasi (jeda "settling" terpantau)',
  probe.settleFrames > 0,
  `${probe.settleFrames} frame`,
)
const uniqueSizes = [...new Set(probe.sizes.filter(Boolean))]
check(
  'Ukuran teks tidak berubah di tengah animasi',
  uniqueSizes.length <= 1,
  `${probe.animFrames} frame animasi, ukuran: ${uniqueSizes.join(', ') || 'tidak terpantau'}`,
)

/* ============================================================== 5. memorize */
await page.goto(`${BASE}/#/memorize`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
await gotoPage(3)
await page.waitForTimeout(600)

/* ---- 5a. catatan teks bisa diketik */
await tapEl(page.getByRole('button', { name: 'Menu tanda' }))
await page.waitForTimeout(320)
await tapEl(page.getByRole('button', { name: 'Tanda Catatan' }))
await page.waitForTimeout(300)
check('Bentuk Catatan disiagakan setelah diketuk', await page.locator('.arming-bar').isVisible())

// Ketuk baris 13 — jauh di bawah, wilayah yang dulu tidak bisa dijangkau
const row13 = await page.locator('.sheet [data-line="13"]').boundingBox()
await tap(Math.round(row13.x + row13.width / 2), Math.round(row13.y + row13.height / 2))
await page.waitForTimeout(420)

const noteBoxOpen = await page.locator('.note-input').isVisible().catch(() => false)
check('Kotak isian catatan terbuka', noteBoxOpen)

if (noteBoxOpen) {
  const focused = await page.evaluate(
    () => document.activeElement?.classList.contains('note-input') ?? false,
  )
  check('Kotak catatan langsung terfokus (papan tik HP terbuka)', focused)

  await page.keyboard.type('waqaf lazim')
  const typed = await page.locator('.note-input').inputValue()
  check('Teks bisa diketik ke catatan', typed === 'waqaf lazim', typed)

  await tapEl(page.getByRole('button', { name: 'Simpan' }))
  await page.waitForTimeout(520)

  const noteText = await page.locator('.mark .note').first().innerText().catch(() => '')
  check('Catatan tersimpan dan tampil di lembar', noteText === 'waqaf lazim', noteText)

  const noteLine = await page
    .locator('.line:has(.mark .note)')
    .first()
    .getAttribute('data-line')
    .catch(() => null)
  check('Catatan mendarat di baris yang diketuk (baris 13)', noteLine === '13', `baris ${noteLine}`)
}

/* ---- 5b. tanda bisa ditaruh sampai baris paling bawah, lewat ketukan */
const placed = []
for (const lineNo of [3, 8, 15]) {
  await tapEl(page.getByRole('button', { name: 'Menu tanda' }))
  await page.waitForTimeout(280)
  await tapEl(page.getByRole('button', { name: 'Tanda Bulatan' }))
  await page.waitForTimeout(240)

  const before = await page.locator('.mark').count()
  const box = await page.locator(`.sheet [data-line="${lineNo}"]`).boundingBox()
  await tap(Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2))
  await page.waitForTimeout(460)
  const after = await page.locator('.mark').count()

  const onLine = await page.locator(`.line[data-line="${lineNo}"] .mark`).count()
  placed.push(`baris ${lineNo}: ${after > before ? `OK (${onLine} tanda)` : 'GAGAL'}`)
}
check(
  'Tanda bisa ditaruh di baris 3, 8, dan 15 dengan ketukan',
  placed.every((p) => p.includes('OK')),
  placed.join('; '),
)

/* ---- 5b2. ukuran tanda: lebar & tinggi bisa diatur sendiri-sendiri */
{
  // Pilih satu tanda bentuk supaya pegangan ukurannya muncul
  const shapeMark = page.locator('.mark.shape-circle').first()
  const mb = await shapeMark.boundingBox()
  if (mb) {
    await tap(Math.round(mb.x + mb.width / 2), Math.round(mb.y + mb.height / 2))
    await page.waitForTimeout(320)

    const handles = await page.locator('.mark.shape-circle .handle').count()
    check(
      'Tanda punya tiga pegangan ukuran (sudut, lebar, tinggi)',
      handles === 3,
      `${handles} pegangan`,
    )

    /** Ukuran tanda bulatan yang sedang tampil */
    const boxOf = () =>
      page.locator('.mark.shape-circle').first().evaluate((el) => {
        const b = el.getBoundingClientRect()
        return { w: Math.round(b.width), h: Math.round(b.height) }
      })

    /** Seret sebuah pegangan sejauh (dx, dy) dengan jari */
    const dragHandle = async (cls, dx, dy) => {
      const hb = await page.locator(`.mark.shape-circle .handle.${cls}`).boundingBox()
      if (!hb) return false
      const x = Math.round(hb.x + hb.width / 2)
      const y = Math.round(hb.y + hb.height / 2)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
      for (let i = 1; i <= 8; i++) {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: x + Math.round((dx * i) / 8), y: y + Math.round((dy * i) / 8) }],
        })
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await page.waitForTimeout(420)
      return true
    }

    // Pegangan sisi kanan: hanya melebar → oval rebah
    const start = await boxOf()
    await dragHandle('side-x', 46, 0)
    const wider = await boxOf()
    check(
      'Pegangan lebar hanya melebarkan tanda (oval rebah)',
      wider.w > start.w + 4 && Math.abs(wider.h - start.h) <= 3,
      `${start.w}×${start.h} → ${wider.w}×${wider.h}`,
    )

    // Pegangan sisi bawah: hanya meninggi → oval tegak
    await dragHandle('side-y', 0, 40)
    const taller = await boxOf()
    check(
      'Pegangan tinggi hanya meninggikan tanda (oval tegak)',
      taller.h > wider.h + 4 && Math.abs(taller.w - wider.w) <= 3,
      `${wider.w}×${wider.h} → ${taller.w}×${taller.h}`,
    )

    // Bertahan sesudah reload: ukuran dua arah ikut tersimpan
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    const saved = await boxOf().catch(() => null)
    check(
      'Ukuran dua arah tersimpan di HP',
      saved != null && Math.abs(saved.w - taller.w) <= 3 && Math.abs(saved.h - taller.h) <= 3,
      saved ? `${saved.w}×${saved.h}` : 'tanda tidak ditemukan',
    )
  } else {
    check('Tanda bentuk ditemukan untuk uji ukuran', false, 'tidak ada .mark.shape-circle')
  }
}

/* ---- 5c. Reveal menampilkan halaman mushaf asli */
const revealBtn = page.getByRole('button', { name: /Tampilkan teks penuh/ })
const rb = await revealBtn.boundingBox()
await cdp.send('Input.dispatchTouchEvent', {
  type: 'touchStart',
  touchPoints: [{ x: Math.round(rb.x + rb.width / 2), y: Math.round(rb.y + rb.height / 2) }],
})
await page.waitForTimeout(420)
const revealShowsMushaf = await page.locator('.reveal-page .mushaf').isVisible().catch(() => false)
const sheetHidden = !(await page.locator('.sheet').isVisible().catch(() => true))
const revealLines = await page.locator('.reveal-page .mushaf-line').count()
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
await page.waitForTimeout(360)

check('Reveal menampilkan halaman mushaf utama', revealShowsMushaf, `${revealLines} baris mushaf`)
check('Lembar per-baris disembunyikan saat Reveal', sheetHidden)
check('Lembar memorize kembali setelah Reveal dilepas', await page.locator('.sheet').isVisible())

/* ---- 5d. Bantu: "ketuk untuk tambah" benar-benar menambah kalimat */
await tapEl(page.getByRole('button', { name: 'Pilih ayat bantuan' }))
await page.waitForTimeout(520)

const pills = await page.locator('[role="dialog"] .chip').allInnerTexts()
check('Panel Bantu punya dua pills saja', pills.length === 2, pills.join(' | '))

// Ketuk kata di ayat kedua panel: harus langsung membuka pilihan kalimat
const words = page.locator('[role="dialog"] .verse').nth(1).locator('.word')
await tapEl(words.nth(3))
await page.waitForTimeout(360)
const pickedVisible = await page.locator('.picked').isVisible().catch(() => false)
check('Ketuk kata membuka pilihan kalimat (bug "masih null")', pickedVisible)

if (pickedVisible) {
  const label1 = await page.locator('.picked-label').innerText()
  // Ketukan kedua memperpanjang kalimat
  await tapEl(words.nth(6))
  await page.waitForTimeout(300)
  const label2 = await page.locator('.picked-label').innerText()
  check(
    'Ketukan kedua memperpanjang kalimat terpilih',
    label1 !== label2,
    `${label1.replace(/\s+/g, ' ')} → ${label2.replace(/\s+/g, ' ')}`,
  )

  const before = await page.locator('.seg-text.helper').count()
  await tapEl(page.getByRole('button', { name: 'Pakai di sini' }))
  await page.waitForTimeout(560)

  // Tutup panel supaya lembar terlihat
  await tapEl(page.locator('[role="dialog"] .close'))
  await page.waitForTimeout(420)

  const after = await page.locator('.seg-text.helper').count()
  check(
    'Kalimat pilihan masuk ke lembar memorize',
    after > before,
    `bagian bantuan ${before} → ${after}`,
  )

  /* ------- kalimat KEDUA di ayat yang sama tidak menghapus yang pertama ------- */
  await tapEl(page.getByRole('button', { name: 'Pilih ayat bantuan' }))
  await page.waitForTimeout(520)

  const words2 = page.locator('[role="dialog"] .verse').nth(1).locator('.word')
  const wordCount = await words2.count()
  // Kata TERAKHIR ayat — kasus "muttaqin": sesudahnya hanya nomor ayat
  await tapEl(words2.nth(wordCount - 1))
  await page.waitForTimeout(320)
  await tapEl(page.getByRole('button', { name: 'Pakai di sini' }))
  await page.waitForTimeout(560)

  const chipCount = await page.locator('[role="dialog"] .pick-chip').count()
  await tapEl(page.locator('[role="dialog"] .close'))
  await page.waitForTimeout(420)

  const afterSecond = await page.locator('.seg-text.helper').count()
  check(
    'Kalimat kedua di ayat yang sama TIDAK menghapus kalimat pertama',
    afterSecond > after,
    `bagian bantuan ${after} → ${afterSecond}; ${chipCount} kalimat tercatat di panel`,
  )

  /*
   * Satu ayat = satu deret. Kalimat pembantu menyatu ke dalam ayatnya, jadi
   * jumlah segmen ayat tidak boleh ikut bertambah saat kalimat ditambahkan.
   */
  const layout = await page.evaluate(() => {
    const seg = document.querySelector('.segment.helper')
    if (!seg) return null
    const parts = [...seg.querySelectorAll('.seg-text')].map((el) => el.textContent?.trim() ?? '')
    const dots = seg.querySelectorAll('.seg-ellipsis').length
    // Nomor ayat harus jadi yang terakhir di dalam deret
    const kids = [...seg.children]
    return { parts: parts.length, dots, lastIsNumber: kids[kids.length - 1]?.className.includes('seg-num') }
  })
  check(
    'Satu ayat tampil sebagai satu deret berbagian (bukan segmen terpisah)',
    layout != null && layout.parts >= 2 && layout.lastIsNumber === true,
    layout ? `${layout.parts} bagian, ${layout.dots} titik-titik, nomor ayat di ujung` : 'segmen tidak ditemukan',
  )

  /*
   * Kalimat yang berakhir tepat di kata terakhir ayat langsung bersambung ke
   * nomor ayatnya: titik-titik selalu lebih sedikit daripada jumlah bagian.
   */
  check(
    'Tidak ada titik-titik sesudah kalimat penutup ayat',
    layout != null && layout.dots < layout.parts,
    layout ? `${layout.dots} titik-titik untuk ${layout.parts} bagian` : '',
  )

  // Harus bertahan setelah reload (tersimpan lokal)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  const afterReload = await page.locator('.seg-text.helper').count()
  check(
    'Kalimat pilihan tersimpan di HP (tetap ada sesudah reload)',
    afterReload >= afterSecond,
    `${afterReload} bagian`,
  )

  /*
   * Setelan memorize tidak boleh mengunci kalimat pembantu: mengubah "kata awal
   * ditampilkan" hanya mengubah potongan bawaan, kalimat pilihan tetap utuh.
   */
  /*
   * Bagian pembantu TERAKHIR, bukan yang pertama: bagian pertama bisa menempel
   * pada potongan bawaan dan tergabung dengannya, jadi ia memang ikut berubah
   * bersama setelan. Yang harus kebal setelan adalah kalimat pembantu yang
   * berdiri sendiri.
   */
  const helperTextBefore = await page.locator('.seg-text.helper').last().innerText()
  await tapEl(page.getByRole('button', { name: 'Setelan memorize' }))
  await page.waitForTimeout(420)
  await page.locator('.setting input[type="range"]').evaluate((el) => {
    el.value = '6'
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.waitForTimeout(520)
  await tapEl(page.locator('[role="dialog"] .close'))
  await page.waitForTimeout(420)
  const helperTextAfter = await page.locator('.seg-text.helper').last().innerText()
  check(
    'Setelan memorize tidak mengubah kalimat pembantu',
    helperTextBefore === helperTextAfter,
    `"${helperTextBefore}" → "${helperTextAfter}"`,
  )
}

const realErrors = errors.filter((e) => !/favicon|404|Download the Vue/i.test(e))
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
