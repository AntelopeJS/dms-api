import {
  ColumnDisplay,
  RegisterDisplay,
} from "@antelopejs/interface-dms/base/table-view";

/**
 * Cell displays of the request tables the DMS does not draw. Methods and
 * statuses use its status pills (`StatusPillDisplay`); the module keeps the
 * time to the millisecond, the decoded path with the tester's badge, the
 * duration that may never have been measured, the request id and the error.
 */

/**
 * A timestamp as the time it happened, to the millisecond, with the date in
 * front once it is not today.
 */
@RegisterDisplay("api:time")
export class TimeDisplay extends ColumnDisplay<{ milliseconds?: boolean }> {}

/**
 * A path decoded as people read it, with its `:params` highlighted in the
 * mono font and the tester's badge on the requests it sent: the DMS mono
 * display shows neither.
 */
@RegisterDisplay("api:path")
export class PathDisplay extends ColumnDisplay<Record<string, never>> {}

/**
 * A duration in ms, tinted when the row is `slow`; a dash with its reason
 * when it was never measured (`null`: rejected before any handler).
 */
@RegisterDisplay("api:duration")
export class RequestDurationDisplay extends ColumnDisplay<
  Record<string, never>
> {}

/** A request id by its first characters, copied whole. */
@RegisterDisplay("api:request-id")
export class RequestIdDisplay extends ColumnDisplay<Record<string, never>> {}

/** An error message on one line, whole on hover. */
@RegisterDisplay("api:error")
export class ErrorDisplay extends ColumnDisplay<Record<string, never>> {}
