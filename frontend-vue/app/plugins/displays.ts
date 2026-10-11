import { h } from 'vue'
import { fullDateTime, requestClock } from '../utils/requestDrawer'

interface TimeDisplayOptions {
  milliseconds?: boolean
}

const EMPTY = '—'

// The one cell display the backend names with `@RegisterDisplay("api:…")`:
// methods and statuses are the DMS status pills, paths and ids its mono
// display, durations its duration display.
export default defineDmsPlugin(() => {
  const { registerDataType } = useDataTypes()

  // "Yesterday, 23:42:10.120" rather than a bare time once the day changed;
  // the whole date and its time zone on hover, written when hovered: every
  // cell is drawn again on each "Load more", and formatting a full date costs
  // more than the cell itself (about 0.1 ms, 200 ms over 2,000 rows).
  registerDataType({
    id: 'api:time',
    formatter: {
      default: (value, locale, options) =>
        h(
          'span',
          {
            class: 'text-muted font-mono text-[12px] tabular-nums',
            onMouseenter: (event: MouseEvent) => {
              const cell = event.currentTarget as HTMLElement
              if (!cell.title)
                cell.title = fullDateTime(value as string, locale)
            },
          },
          requestClock(
            value as string,
            locale,
            (options as TimeDisplayOptions | undefined)?.milliseconds ?? false,
          ) || EMPTY,
        ),
    },
  })
})
