import {
  ColumnDisplay,
  RegisterDisplay,
} from "@antelopejs/interface-dms/base/table-view";

/**
 * Cell displays of the request tables. The frontend draws them with the same
 * method and status badges as the console's own blocks, so a GET or a 500
 * looks the same in a table cell, the request drawer and the route tree.
 */

/** A method as its coloured badge: GET, POST, PUT, PATCH, DELETE. */
@RegisterDisplay("api:method")
export class MethodDisplay extends ColumnDisplay<Record<string, never>> {}

/** A status code as a chip tinted by its class (2xx, 3xx, 4xx, 5xx). */
@RegisterDisplay("api:status")
export class StatusDisplay extends ColumnDisplay<Record<string, never>> {}

/**
 * A timestamp as the time it happened, to the millisecond, with the date in
 * front once it is not today.
 */
@RegisterDisplay("api:time")
export class TimeDisplay extends ColumnDisplay<{ milliseconds?: boolean }> {}

/** A path with its `:params` highlighted, in the mono font. */
@RegisterDisplay("api:path")
export class PathDisplay extends ColumnDisplay<Record<string, never>> {}
