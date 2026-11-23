import { TESTER_CONSTANTS } from './testerConstants'
import type { RouteTesterProps } from './testerTypes'
import { useTesterChecks } from './useTesterChecks'
import { useTesterFields } from './useTesterFields'
import { useTesterHints } from './useTesterHints'
import { useTesterOutgoing } from './useTesterOutgoing'
import { useTesterServices } from './useTesterServices'
import { useTesterView } from './useTesterView'

export type {
  CapturedRow,
  CapturedState,
  ReadJson,
  RouteTesterProps,
  Row,
} from './testerTypes'

/**
 * The tester's state, as `RouteTester` sets it up: its constants, its
 * fields and what they compute.
 */
export function useTesterState(props: RouteTesterProps) {
  const services = useTesterServices(props)
  const fields = useTesterFields()
  const outgoing = useTesterOutgoing(services, fields)
  const checks = useTesterChecks(services, fields, outgoing)
  const view = useTesterView(services, fields, outgoing)
  const hints = useTesterHints(services, fields, outgoing, checks)
  return {
    ...TESTER_CONSTANTS,
    ...services,
    ...fields,
    ...outgoing,
    ...checks,
    ...view,
    ...hints,
  }
}

/** What `useTesterState` returns, which the tester's flows and extras read. */
export type TesterState = ReturnType<typeof useTesterState>
