import { describe, expect, it } from 'vitest'
import { visemeAt, vowelWeights } from '../src/avatar/lipsync'

describe('visemeAt', () => {
  it('reconnaît les voyelles et digrammes français', () => {
    expect(visemeAt('bonjour', 4)).toBe('ou')
    expect(visemeAt('beau', 2)).toBe('oh')
    expect(visemeAt('maison', 1)).toBe('ee')
    expect(visemeAt('papa', 1)).toBe('aa')
    expect(visemeAt('lit', 1)).toBe('ih')
    expect(visemeAt('maman', 0)).toBe('closed')
    expect(visemeAt('a b', 1)).toBe('closed')
  })
})

describe('vowelWeights', () => {
  it('reste fermée dans le silence', () => {
    expect(Object.values(vowelWeights(1200, 0)).every((v) => v === 0)).toBe(true)
  })
  it('choisit la voyelle selon la fréquence centrale', () => {
    const low = vowelWeights(650, 1)
    const high = vowelWeights(2500, 1)
    expect(low.ou).toBeGreaterThan(low.ih)
    expect(high.ih).toBeGreaterThan(high.ou)
  })
})
