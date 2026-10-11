import { h } from 'vue'
import ApiDuration from '../components/internal/ApiDuration.vue'
import ApiPath from '../components/internal/ApiPath.vue'
import ApiRequestId from '../components/internal/ApiRequestId.vue'
import ApiTesterBadge from '../components/internal/ApiTesterBadge.vue'
import {
  decodePath,
  fullDateTime,
  localDay,
  requestClock,
} from '../utils/requestDrawer'
import { TIME_ATTRIBUTE } from '../utils/liveTable'

interface TimeDisplayOptions {
  milliseconds?: boolean
}

const EMPTY = '—'
/** A request the console's tester sent (`source` of a row). */
const TESTER_SOURCE = 'tester'
/**
 * A time cell's day, for the line `RequestDrawerHost` draws between the days
 * of a table sorted on time.
 */
const DAY_ATTRIBUTE = 'data-dms-api-day'

function dash() {
  return h('span', { class: 'text-dimmed' }, EMPTY)
}

function duration(value: unknown, row?: Record<string, unknown>) {
  return h(ApiDuration, {
    ms: typeof value === 'number' ? value : null,
    slow: row?.slow === true,
  })
}

// The cell displays the backend names with `@RegisterDisplay("api:…")`, for
// what the DMS displays do not draw: methods and statuses are its status
// pills, the rest is the module's.
export default defineDmsPlugin(() => {
  const { registerDataType } = useDataTypes()

  // Decoded as people read it ("commande-é", not "commande-%C3%A9"), with
  // the tester's badge on the requests it sent.
  registerDataType({
    id: 'api:path',
    formatter: {
      default: (value, _locale, _options, row) =>
        value
          ? h('span', { class: 'inline-flex min-w-0 items-center gap-1.5' }, [
              h('bdi', { class: 'min-w-0 truncate' }, [
                h(ApiPath, {
                  path: decodePath(String(value)),
                  class: 'text-[12.5px]',
                }),
              ]),
              row?.source === TESTER_SOURCE ? h(ApiTesterBadge) : null,
            ])
          : EMPTY,
    },
  })

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
            [DAY_ATTRIBUTE]: localDay(value as string),
            // The live mode counts what arrived after the newest row.
            [TIME_ATTRIBUTE]: String(value),
          },
          requestClock(
            value as string,
            locale,
            (options as TimeDisplayOptions | undefined)?.milliseconds ?? false,
          ) || EMPTY,
        ),
    },
  })

  // A duration never measured (the request was turned away before any
  // handler) reads as a dash, not as "0 ms".
  registerDataType({
    id: 'api:duration',
    formatter: {
      default: (value, _locale, _options, row) => duration(value, row),
      empty: (value, _locale, _options, row) => duration(value, row),
    },
  })

  registerDataType({
    id: 'api:request-id',
    formatter: {
      default: (value) =>
        value ? h(ApiRequestId, { id: String(value) }) : dash(),
    },
  })

  registerDataType({
    id: 'api:error',
    formatter: {
      default: (value) =>
        value
          ? h(
              'bdi',
              {
                class: 'text-error/90 block truncate text-[12.5px]',
                title: String(value),
              },
              String(value),
            )
          : dash(),
      empty: () => dash(),
    },
  })
})
