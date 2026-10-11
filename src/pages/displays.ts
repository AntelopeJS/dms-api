import {
  ColumnDisplay,
  RegisterDisplay,
} from "@antelopejs/interface-dms/base/table-view";

/**
 * The one cell display of the request tables the DMS does not draw: methods
 * and statuses use its status pills, paths and ids its mono display,
 * durations its duration display.
 */

/**
 * A timestamp as the time it happened, to the millisecond, with the date in
 * front once it is not today.
 */
@RegisterDisplay("api:time")
export class TimeDisplay extends ColumnDisplay<{ milliseconds?: boolean }> {}
