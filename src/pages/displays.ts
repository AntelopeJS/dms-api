import {
  ColumnDisplay,
  RegisterDisplay,
} from "@antelopejs/interface-dms/base/table-view";

/**
 * The cell displays of the request tables the DMS does not draw: methods and
 * statuses use its status pills, ids its mono display, durations its
 * duration display.
 */

/**
 * A timestamp as the time it happened, to the millisecond, with the date in
 * front once it is not today.
 */
@RegisterDisplay("api:time")
export class TimeDisplay extends ColumnDisplay<{ milliseconds?: boolean }> {}

/**
 * A requested path in the mono font, marked "Tester" when the console's
 * Tester sent the request (the row's `source`): it is kept in the logs, out
 * of the statistics and the health.
 */
@RegisterDisplay("api:path")
export class PathDisplay extends ColumnDisplay<Record<string, never>> {}
