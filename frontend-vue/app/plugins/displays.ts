import { h } from 'vue'
import ApiTesterBadge from '../components/internal/ApiTesterBadge.vue'
import { fullDateTime, requestClock } from '../utils/requestDrawer'

interface TimeDisplayOptions {
  milliseconds?: boolean
}

const EMPTY = '—'

/** `source` of a request the console's Tester sent. */
const TESTER_SOURCE = 'tester'

// The cell displays the backend names with `@RegisterDisplay("api:…")`:
// methods and statuses are the DMS status pills, ids its mono display,
// durations its duration display.
export default defineDmsPlugin(() => {
  const { registerDataType } = useDataTypes()
  // The console's dates, with the user's Language & region preferences.
  const dateFormat = useDateFormat()

  // "Yesterday, 23:42:10.120" rather than a bare time once the day changed;
  // the whole date and its time zone on hover, written when hovered: every
  // cell is drawn again on each "Load more", and formatting a full date costs
  // more than the cell itself (about 0.1 ms, 200 ms over 2,000 rows).
  registerDataType({
    id: 'api:time',
    formatter: {
      default: (value, _locale, options) =>
        h(
          'span',
          {
            class: 'text-muted font-mono text-[12px] tabular-nums',
            onMouseenter: (event: MouseEvent) => {
              const cell = event.currentTarget as HTMLElement
              if (!cell.title)
                cell.title = fullDateTime(value as string, dateFormat.value)
            },
          },
          requestClock(
            value as string,
            dateFormat.value,
            (options as TimeDisplayOptions | undefined)?.milliseconds ?? false,
          ) || EMPTY,
        ),
    },
  })

  // The path in the mono font, as the DMS mono cell draws it, and "Tester"
  // beside it when the console's Tester sent the request.
  registerDataType({
    id: 'api:path',
    formatter: {
      default: (value, _locale, _options, row) => {
        const path = value === null || value === undefined ? '' : String(value)
        return h(
          'span',
          { class: 'flex min-w-0 max-w-full items-center gap-1.5' },
          [
            h(
              'span',
              {
                class: 'text-toned truncate font-mono text-[12.5px]',
                title: path,
              },
              path || EMPTY,
            ),
            row?.source === TESTER_SOURCE ? h(ApiTesterBadge) : null,
          ],
        )
      },
    },
  })
})
