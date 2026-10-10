import { h } from 'vue'
import { formatClock } from '../utils/format'

interface TimeDisplayOptions {
  milliseconds?: boolean
}

const EMPTY = '—'

// The cell display the backend names with `@RegisterDisplay("api:time")`:
// the time of a request, to the millisecond.
export default defineDmsPlugin(() => {
  const { registerDataType } = useDataTypes()

  registerDataType({
    id: 'api:time',
    formatter: {
      default: (value, locale, options) =>
        h(
          'span',
          { class: 'text-muted font-mono text-[12px] tabular-nums' },
          formatClock(
            value as string,
            locale,
            (options as TimeDisplayOptions | undefined)?.milliseconds ?? false,
          ) || EMPTY,
        ),
    },
  })
})
