import { LiveToggle } from "@antelopejs/interface-dms/base/live-toggle";
import { HStack, Spacer } from "@antelopejs/interface-dms/base/stack";
import type {
  Component,
  ComponentBuilder,
} from "@antelopejs/interface-dms/component";

/** The parts of a monitoring page's toolbar, the same on every page. */
export interface PageToolbarParts {
  /** The route scope chip (`scopeChip()`). */
  scope: Component;
  /** A pill right of the scope: the Overview's Beta. */
  badge?: Component;
  /** The page's period. */
  period: Component;
}

/**
 * The toolbar of the monitoring pages, a DMS `HStack`: `[scope] [badge] ···
 * [live] [period]` on one line, wrapping on a narrow window. `live` is the
 * DMS `LiveToggle`: Direct / Pause over the page's realtime (its `live`
 * option), "Updated 12 s ago" and the L key. The children keep their ids
 * (`scope`, `beta`, `live`, `period`): permissions and blocks name them so.
 */
export function pageToolbar(parts: PageToolbarParts): ComponentBuilder {
  const toolbar = HStack({
    alignment: "center",
    spacing: "0.75rem",
    wrap: true,
  }).child("scope", parts.scope);
  if (parts.badge) toolbar.child("beta", parts.badge);
  return toolbar
    .child("spacer", Spacer())
    .child("live", LiveToggle({ align: "right" }))
    .child("period", parts.period);
}
