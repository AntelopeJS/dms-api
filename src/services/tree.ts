import { getRegisteredRouteHandlers } from "@antelopejs/interface-api";
import type { TreeNode } from "@antelopejs/interface-dms/base/tree";
import { getConfig } from "@/config";
import type { RouteStatistics } from "@/db/tables/routes_statistics.table";
import type { DayStatistics } from "@/types";
import { HTTP_METHOD_ICONS } from "@/types";
import { getWindowStartTimestamp } from "./statistics-utils";

/** Tree leaf is keyed by the runtime route id so the per-route endpoints
 * (`/api/monitoring/routes/route/:id/*`) can look the route back up in the
 * route registry. */
interface RouteRef {
  id: string;
  uri: string;
  method: string;
}

export interface TreeNodeStats {
  /** Request count over the window selected by the caller's `days` argument
   * to {@link buildRoutesTreeNodes} (full retention when omitted). */
  requestsCount: number;
  /** Combined client + server error rate over the same window. */
  errorRate: number;
  /** True if any stat for this route exceeded the slow threshold. */
  slow: boolean;
}

interface BuildNode {
  /** method -> {routeId, key for stats lookup} */
  methods: Map<string, { routeId: string; statsKey: string }>;
  children: Map<string, BuildNode>;
}

function createBuildNode(): BuildNode {
  return { methods: new Map(), children: new Map() };
}

function getMethodIcon(method: string): string {
  return (
    HTTP_METHOD_ICONS[method as keyof typeof HTTP_METHOD_ICONS] ?? "i-ph-file"
  );
}

function insertRoute(root: BuildNode, route: RouteRef): void {
  const segments = route.uri.split("/").filter(Boolean);
  let current = root;
  for (const segment of segments) {
    let child = current.children.get(segment);
    if (!child) {
      child = createBuildNode();
      current.children.set(segment, child);
    }
    current = child;
  }
  const method = route.method.toUpperCase();
  current.methods.set(method, {
    routeId: route.id,
    statsKey: `${method}:${route.uri}`,
  });
}

function statsForRoute(
  stats: RouteStatistics | undefined,
  sinceDay: number,
): TreeNodeStats {
  if (!stats || stats.statistics.length === 0) {
    return { requestsCount: 0, errorRate: 0, slow: false };
  }
  const threshold = getConfig().requestSlownessThreshold;
  let count = 0;
  let errors = 0;
  let slow = false;
  for (const day of stats.statistics) {
    if (day.day < sinceDay) continue;
    count += day.requestsCount;
    errors += day.clientErrorsCount + day.serverErrorsCount;
    if (day.maxResponseTime >= threshold) slow = true;
  }
  return {
    requestsCount: count,
    errorRate: count > 0 ? errors / count : 0,
    slow,
  };
}

function aggregateChildStats(stats: TreeNodeStats[]): TreeNodeStats {
  let totalCount = 0;
  let weightedErrors = 0;
  let slow = false;
  for (const s of stats) {
    totalCount += s.requestsCount;
    weightedErrors += s.errorRate * s.requestsCount;
    if (s.slow) slow = true;
  }
  return {
    requestsCount: totalCount,
    errorRate: totalCount > 0 ? weightedErrors / totalCount : 0,
    slow,
  };
}

interface TreeBuildResult {
  nodes: TreeNode[];
  aggregate: TreeNodeStats;
}

function buildFolderNode(
  segment: string,
  child: BuildNode,
  path: string,
  statsByKey: Map<string, RouteStatistics>,
  sinceDay: number,
): { node: TreeNode; contributed: TreeNodeStats[] } {
  const currentPath = path ? `${path}/${segment}` : segment;
  const contributed: TreeNodeStats[] = [];
  const methodStats: TreeNodeStats[] = [];
  const methodNodes: TreeNode[] = [];

  for (const [method, { routeId, statsKey }] of child.methods) {
    const stats = statsForRoute(statsByKey.get(statsKey), sinceDay);
    methodStats.push(stats);
    contributed.push(stats);
    methodNodes.push({
      label: method,
      value: routeId,
      icon: getMethodIcon(method),
      selectable: true,
      expandable: false,
      customData: stats,
    });
  }

  const childResult = toTreeNodes(child, currentPath, statsByKey, sinceDay);
  contributed.push(childResult.aggregate);

  const node: TreeNode = {
    label: segment,
    value: currentPath,
    icon: "i-ph-folder",
    expandable: true,
    children: [...methodNodes, ...childResult.nodes],
    customData: aggregateChildStats([...methodStats, childResult.aggregate]),
  };
  return { node, contributed };
}

function toTreeNodes(
  node: BuildNode,
  path: string,
  statsByKey: Map<string, RouteStatistics>,
  sinceDay: number,
): TreeBuildResult {
  const nodes: TreeNode[] = [];
  const collected: TreeNodeStats[] = [];

  for (const [segment, child] of node.children) {
    const { node: folderNode, contributed } = buildFolderNode(
      segment,
      child,
      path,
      statsByKey,
      sinceDay,
    );
    nodes.push(folderNode);
    collected.push(...contributed);
  }

  return { nodes, aggregate: aggregateChildStats(collected) };
}

/**
 * Build tree nodes from the route registry. When `stats` is provided
 * each node carries a `customData: TreeNodeStats` summary used by the
 * tree to color-code health. Leaf `value` is the runtime route id (the
 * key under which the route registry stores the handler), so the
 * per-route endpoints can look the route back up.
 *
 * `scopeKeys` (a Set of `METHOD:uri` keys) restricts the tree to the
 * active route scope; null/undefined includes every handler.
 *
 * `days` restricts the health stats to the last N days (day rollups, so
 * the finest window is one day); omitted = full retention window.
 */
export function buildRoutesTreeNodes(
  stats: RouteStatistics[] = [],
  scopeKeys?: Set<string> | null,
  days?: number,
): TreeNode[] {
  const root = createBuildNode();
  for (const { id, handler } of getRegisteredRouteHandlers()) {
    if (handler.mode !== "handler") continue;
    if (
      scopeKeys &&
      !scopeKeys.has(`${handler.method.toUpperCase()}:${handler.location}`)
    ) {
      continue;
    }
    insertRoute(root, {
      id,
      uri: handler.location,
      method: handler.method,
    });
  }
  const statsByKey = new Map(
    stats.map((s) => [`${s.method.toUpperCase()}:${s.uri}`, s]),
  );
  const sinceDay = days === undefined ? 0 : getWindowStartTimestamp(days);
  return toTreeNodes(root, "", statsByKey, sinceDay).nodes;
}

export type { DayStatistics };
