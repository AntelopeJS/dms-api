/**
 * Reader's view of RouteStatistics.tla for /statechart: one region for the
 * stored row, one per request and one per prune.
 */

/**
 * The variables of RouteStatistics.tla this view reads, as /statechart
 * passes them: a function is an object keyed by its domain, a model value
 * is its name.
 * @typedef {object} Vars
 * @property {boolean} exists
 * @property {number} rev
 * @property {Record<string, Record<string, number>>} row
 * @property {Record<string, string>} fate
 * @property {Record<string, string>} wpc
 * @property {Record<string, string>} ppc
 */

/**
 * The row as the console reads it: missing, or stored with or without the
 * request counted before the run, on the oldest day.
 * @param {Vars} v
 */
function storedRow(v) {
  if (!v.exists) return "No row";
  return Object.values(v.row).some((counts) => (counts.Seed ?? 0) > 0) ? "Row with the oldest day" : "Row";
}

/** @type {Record<string, string>} */
const FATES = {
  none: "not arrived",
  pending: "being written",
  resolved: "resolved",
  unknown: "answered unknown",
  failed: "failed",
};

/**
 * @param {Vars} v
 * @param {string} r
 */
function request(v, r) {
  const times = Object.values(v.row).reduce((sum, counts) => sum + (counts[r] ?? 0), 0);
  const counted = times === 0 ? "not counted" : times === 1 ? "counted once" : `counted ${times} times`;
  if (v.fate[r] === "none" || (v.fate[r] === "pending" && times < 2)) return FATES[v.fate[r]];
  return `${FATES[v.fate[r]] ?? v.fate[r]}, ${counted}`;
}

/** @type {Record<string, string>} */
const PRUNES = { idle: "not started", read: "reading", await: "writing", done: "done" };

/**
 * One region for the row, one per request, one per prune.
 * @param {Vars} v
 * @returns {Record<string, string>}
 */
export function state(v) {
  /** @type {Record<string, string>} */
  const regions = { Row: storedRow(v) };
  for (const r of Object.keys(v.fate)) regions[`Request ${r}`] = request(v, r);
  for (const [q, at] of Object.entries(v.ppc)) regions[`Prune ${q}`] = PRUNES[at] ?? at;
  return regions;
}

/** @type {Record<string, string>} */
const STEPS = {
  Arrive: "a request arrives",
  WriteStart: "its batch's write starts",
  WriteRead: "the write reads the row and sends it back",
  WriteLost: "the write's answer is lost",
  PruneStart: "the hourly prune starts",
  PruneAnswer: "the prune hears the answer",
  PruneLost: "the prune's answer is lost",
  Tick: "midnight passes",
};

/**
 * The arrow label of one TLC step; `Settled` changes nothing and is hidden.
 * @param {string} action
 * @param {Vars} from
 * @param {Vars} to
 * @returns {string | null}
 */
export function step(action, from, to) {
  const landed = to.rev !== from.rev;
  if (action === "DbApply") return landed ? "the database applies a write" : "the database refuses a write";
  if (action === "OrphanApply") return landed ? "the lost write applies late" : "the lost write is refused late";
  if (action === "WriteAnswer") {
    const retried = Object.keys(to.wpc).some((p) => to.wpc[p] === "read");
    return retried ? "the write retries from a fresh read" : "the write hears its answer";
  }
  if (action === "PruneRead") {
    const writes = Object.keys(to.ppc).some((q) => to.ppc[q] === "await" && from.ppc[q] === "read");
    return writes ? "the prune reads the row and sends it without the old days" : "the prune finds nothing to drop";
  }
  return STEPS[action] ?? null;
}

export const title = "Per-route statistics of dms-api: two replicas' writes and the hourly prune";
