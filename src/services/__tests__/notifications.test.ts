/** Tes label jadwal reminder (§3.3) — bagian yang murni logika, tanpa plugin. */
import { describe, expect, it } from 'vitest'
import { describeSchedule } from '../notifications'
import type { Reminder } from '@/types'

function make(patch: Partial<Reminder> = {}): Reminder {
  return {
    title: 'Baca sebelum tidur',
    surah: 2,
    ayahFrom: 14,
    ayahTo: 98,
    scheduledAt: new Date('2026-09-20T21:30:00').toISOString(),
    repeatEvery: null,
    repeatUnit: null,
    weekdays: [],
    enabled: true,
    createdAt: new Date('2026-09-13T00:00:00').toISOString(),
    ...patch,
  }
}

describe('describeSchedule', () => {
  it('menandai reminder sekali pakai dengan tanggal', () => {
    const label = describeSchedule(make())
    expect(label).toMatch(/^Sekali · /)
    expect(label).toContain('21')
  })

  it('menyebut interval tunggal tanpa angka', () => {
    expect(describeSchedule(make({ repeatEvery: 1, repeatUnit: 'day' }))).toContain('tiap hari')
    expect(describeSchedule(make({ repeatEvery: 1, repeatUnit: 'week' }))).toContain('tiap minggu')
  })

  it('menyebut interval kustom lebih dari satu', () => {
    expect(describeSchedule(make({ repeatEvery: 3, repeatUnit: 'day' }))).toContain('tiap 3 hari')
    expect(describeSchedule(make({ repeatEvery: 6, repeatUnit: 'hour' }))).toContain('tiap 6 jam')
    expect(describeSchedule(make({ repeatEvery: 2, repeatUnit: 'month' }))).toContain('tiap 2 bulan')
  })

  it('menyebut nama hari, bukan tanggal, saat berulang per hari', () => {
    const label = describeSchedule(make({ weekdays: [1, 5] }))
    expect(label).toContain('Senin')
    expect(label).toContain("Jum'at")
    // Tanggal tidak lagi berlaku, jadi tidak boleh disebut
    expect(label).not.toContain('Sekali')
    expect(label).not.toMatch(/\d{4}/)
  })

  it('menyusun hari mulai Senin sampai Minggu, bukan urutan input', () => {
    expect(describeSchedule(make({ weekdays: [0, 3, 1] }))).toContain('Senin, Rabu, Minggu')
  })

  it('menyingkat tujuh hari penuh menjadi "Tiap hari"', () => {
    expect(describeSchedule(make({ weekdays: [0, 1, 2, 3, 4, 5, 6] }))).toMatch(/^Tiap hari · /)
  })

  it('hari mengalahkan interval bila keduanya sempat tersimpan', () => {
    // Data lama bisa punya keduanya; hari yang menentukan
    const label = describeSchedule(make({ weekdays: [2], repeatEvery: 3, repeatUnit: 'day' }))
    expect(label).toContain('Selasa')
    expect(label).not.toContain('tiap 3 hari')
  })
})
