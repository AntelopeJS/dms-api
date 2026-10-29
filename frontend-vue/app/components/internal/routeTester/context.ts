import type { useTesterExtras } from './useTesterExtras'
import type { useTesterFlow } from './useTesterFlow'
import type { useTesterState } from './useTesterState'

/** Everything `RouteTester` sets up, as its private child components read it. */
export type TesterContext = ReturnType<typeof useTesterState> &
  ReturnType<typeof useTesterFlow> &
  ReturnType<typeof useTesterExtras>
