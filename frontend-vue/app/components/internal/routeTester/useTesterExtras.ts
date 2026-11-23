import { useTesterActions } from './useTesterActions'
import { useTesterAnswer } from './useTesterAnswer'
import { useTesterFocus } from './useTesterFocus'
import type { useTesterFlow } from './useTesterFlow'
import type { TesterState } from './useTesterState'

/**
 * The rest of the tester, as `RouteTester` sets it up last: history, cURL,
 * the keyboard, the live hold and the answer.
 */
export function useTesterExtras(
  tester: TesterState & ReturnType<typeof useTesterFlow>,
) {
  return {
    ...useTesterActions(tester),
    ...useTesterFocus(tester),
    ...useTesterAnswer(tester),
  }
}
