import { computed } from 'vue'
import { formatLocale } from '../utils/format'

/**
 * The locale numbers and dates are written in: the interface language, a
 * bare `en` read as British English (`formatLocale`).
 */
export function useFormatLocale() {
  const { locale } = useI18n()
  return computed(() => formatLocale(locale.value))
}
