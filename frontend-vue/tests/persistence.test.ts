import { afterEach, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useSelectedPeriod } from '../app/composables/useSelectedPeriod'

afterEach(() => vi.unstubAllGlobals())

it('restores and persists the period in a Vite browser without import.meta.client', () => {
  vi.stubGlobal('useDmsState', () => ref(null))
  const getItem = vi.fn(() => '30d')
  const setItem = vi.fn()
  vi.stubGlobal('window', { localStorage: { getItem, setItem } })
  const selection = useSelectedPeriod()
  const options = [
    { value: '7d', label: '7d' },
    { value: '30d', label: '30d' },
  ]
  expect(selection.resolve(undefined, options, '7d')).toBe('30d')
  expect(getItem).toHaveBeenCalledWith('dms-api:period')
  selection.set('7d')
  expect(setItem).toHaveBeenCalledWith('dms-api:period', '7d')
})

it('keeps in-memory selection when browser storage denies access', () => {
  vi.stubGlobal('useDmsState', () => ref(null))
  const deny = () => {
    throw new Error('Storage denied')
  }
  vi.stubGlobal('window', { localStorage: { getItem: deny, setItem: deny } })
  const selection = useSelectedPeriod()
  const options = [
    { value: '7d', label: '7d' },
    { value: '30d', label: '30d' },
  ]
  expect(selection.resolve(undefined, options, '7d')).toBe('7d')
  selection.set('30d')
  expect(selection.resolve(undefined, options, '7d')).toBe('30d')
})

it('does not access browser storage during server rendering', () => {
  vi.stubGlobal('useDmsState', () => ref(null))
  vi.stubGlobal('window', undefined)
  const selection = useSelectedPeriod()
  expect(selection.resolve(undefined, [], '7d')).toBe('7d')
  expect(() => selection.set('30d')).not.toThrow()
})
