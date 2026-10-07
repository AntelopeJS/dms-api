import { h } from 'vue'
import ApiMethodBadge from '../components/internal/ApiMethodBadge.vue'
import ApiPath from '../components/internal/ApiPath.vue'
import ApiStatusBadge from '../components/internal/ApiStatusBadge.vue'
import { formatClock } from '../utils/format'

interface TimeDisplayOptions {
  milliseconds?: boolean
}

const EMPTY = '—'

// The cell displays the backend names with `@RegisterDisplay("api:…")`: the
// request tables draw methods, statuses and paths with the same badges as
// the console's own blocks.
export default defineDmsPlugin(() => {
  const { registerDataType } = useDataTypes()

  registerDataType({
    id: 'api:method',
    formatter: {
      default: (value) =>
        value
          ? h(ApiMethodBadge, { method: String(value), size: 'sm' })
          : EMPTY,
    },
  })

  registerDataType({
    id: 'api:status',
    formatter: {
      default: (value) =>
        value
          ? h(ApiStatusBadge, { status: String(value), size: 'sm' })
          : EMPTY,
    },
  })

  registerDataType({
    id: 'api:path',
    formatter: {
      default: (value) =>
        value
          ? h(ApiPath, { path: String(value), class: 'text-[12.5px]' })
          : EMPTY,
    },
  })

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
