import {
  ColumnDisplay,
  RegisterDisplay,
} from "@antelopejs/interface-dms/base/table-view";

/**
 * A timestamp as the time it happened, to the millisecond, with the date in
 * front once it is not today: the one cell of the request tables the DMS does
 * not draw (methods, statuses and paths use its status pills and mono display).
 */
@RegisterDisplay("api:time")
export class TimeDisplay extends ColumnDisplay<{ milliseconds?: boolean }> {}
