import { computed } from 'vue'
import { useUserRegionalPreferences } from '#dms-core/app/composables/user/useUserRegionalPreferences'
import { regionalDateTimeFormat } from '#dms-core/app/utils/regional'
import { cachedDateFormat, type DateFormat } from '../utils/format'

/**
 * How the console writes its dates and times: through the DMS's regional
 * formatter, in the console's locale (`useFormatLocale`) and with the user's
 * Language & region preferences (time zone, clock, date format). The formats
 * are made once each, and again when the language or the preferences change.
 */
export function useDateFormat() {
  const locale = useFormatLocale()
  const { preferences } = useUserRegionalPreferences()
  return computed<DateFormat>(() => {
    const current = locale.value
    // Read so that a change of preferences makes the formats again.
    void preferences.value
    return cachedDateFormat((options) =>
      regionalDateTimeFormat(current, options),
    )
  })
}
