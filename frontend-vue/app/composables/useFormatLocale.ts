import { computed } from 'vue'

/** The locale numbers and dates are written in: the interface language. */
export function useFormatLocale() {
  const { locale } = useI18n()
  return computed(() => locale.value)
}
