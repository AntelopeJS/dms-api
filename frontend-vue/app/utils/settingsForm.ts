// What the console's own inputs of the Settings form decide: how a number
// field changed what was typed, which field the page was opened on, and when
// a save waits for the user to confirm a lowered retention. Pure but for
// `revealLinkedField`, so it is tested without a form.

/**
 * A number as typed in a field written in `locale` ("1,020", "1 020"):
 * `null` when the field is empty, `NaN` when it does not read as a number.
 */
export function parseTypedNumber(text: string, locale: string): number | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const parts = new Intl.NumberFormat(locale).formatToParts(11111.1)
  const group = parts.find((part) => part.type === 'group')?.value
  const decimal = parts.find((part) => part.type === 'decimal')?.value ?? '.'
  let digits = trimmed.replace(/[\s  ]/g, '')
  if (group) digits = digits.split(group).join('')
  return Number(digits.split(decimal).join('.'))
}

/** Why a number field holds another value than the one typed. */
export type NumberAdjustment = 'max' | 'min' | 'step'

/**
 * How the field changed what was typed (`typed`) into the value it holds
 * (`value`): kept within its bounds, or put on its steps. `null` when it
 * holds what was typed, or nothing.
 */
export function numberAdjustment(
  typed: number | null,
  value: number | null | undefined,
  bounds: { min?: number; max?: number },
): NumberAdjustment | null {
  if (typed === null || Number.isNaN(typed) || typeof value !== 'number')
    return null
  if (value === typed) return null
  if (bounds.max !== undefined && typed > bounds.max) return 'max'
  if (bounds.min !== undefined && typed < bounds.min) return 'min'
  return 'step'
}

/** Whether the page was opened on the anchor of field `id`. */
export function isLinkedField(hash: string, id: string | undefined): boolean {
  if (!id || !hash) return false
  try {
    return decodeURIComponent(hash.replace(/^#/, '')) === id
  } catch {
    return false
  }
}

/**
 * Brings the field into view and focuses its input when the page was opened
 * on its anchor (`/modules/api/settings#requestLogMaxBodyKb`). Called as the
 * field mounts, on the field's own element: a link followed inside the app
 * renders the page without the browser's own jump to the anchor, the field
 * drawn only once the form loads.
 */
export function revealLinkedField(
  id: string | undefined,
  root: HTMLElement | null | undefined,
): void {
  if (!root || !isLinkedField(window.location.hash, id)) return
  requestAnimationFrame(() => {
    root.scrollIntoView({ block: 'center' })
    root.querySelector<HTMLElement>('input')?.focus({ preventScroll: true })
  })
}

/** What the next hourly prune deletes (`GET …/settings/retention-impact`). */
export interface RetentionImpact {
  days: number
  requests: number
}

/** A retention field holding a value below the one saved. */
export interface RetentionChange {
  field: string
  /** How the confirmation names it ("Statistics: 90 → 30 days"). */
  label: string
  from: number
  to: number
}

/** Whether `value` shortens the retention saved as `saved`. */
export function isLowered(
  value: number | null | undefined,
  saved: number | null | undefined,
): value is number {
  return typeof value === 'number' && typeof saved === 'number' && value < saved
}

export interface RetentionGuard {
  /** The field's lowered value, or `null` once it is not lowered. */
  set(field: string, change: RetentionChange | null): void
  /**
   * The form's validator: `true` when nothing lowered waits, or when these
   * very changes were confirmed. Otherwise it asks once for all the lowered
   * fields of the form and answers `false`; a confirmation submits again.
   */
  allowSubmit(): boolean
}

/**
 * The confirmation a form's lowered retentions share: one dialog for both
 * fields, asked on save, before anything is sent. A confirmation holds only
 * while the form keeps exactly the changes it was given (the resubmit, or a
 * save refused for another field and sent again): any other change, a saved
 * value among them, clears it, so the next lowering asks again.
 */
export function createRetentionGuard(
  ask: (changes: RetentionChange[]) => Promise<boolean>,
  resubmit: () => void,
): RetentionGuard {
  const changes = new Map<string, RetentionChange>()
  let confirmed: string | null = null
  let asking = false

  const pending = () =>
    [...changes.values()].sort((left, right) =>
      left.field.localeCompare(right.field),
    )
  const keyOf = (list: RetentionChange[]) =>
    list
      .map((change) => `${change.field}:${change.from}:${change.to}`)
      .join(',')

  return {
    set(field, change) {
      if (change) changes.set(field, change)
      else changes.delete(field)
      if (keyOf(pending()) !== confirmed) confirmed = null
    },
    allowSubmit() {
      const list = pending()
      if (list.length === 0) return true
      const key = keyOf(list)
      if (key === confirmed) return true
      if (asking) return false
      asking = true
      void ask(list)
        .then((accepted) => {
          if (!accepted) return
          confirmed = key
          resubmit()
        })
        .finally(() => {
          asking = false
        })
      return false
    },
  }
}

const guards = new WeakMap<object, RetentionGuard>()

/** The guard of one form, shared by its retention fields. */
export function retentionGuardOf(
  form: object,
  create: () => RetentionGuard,
): RetentionGuard {
  let guard = guards.get(form)
  if (!guard) {
    guard = create()
    guards.set(form, guard)
  }
  return guard
}
