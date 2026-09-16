import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";

/**
 * Routes page — the central introspection surface.
 *
 * Composition is left to a single custom component (`DmsApiRoutesView`)
 * so the heavy interactivity (tree selection, tab switching, drawer
 * details) lives in one place. The component is mostly hand-rolled
 * (custom tree, custom tabs, Nuxt UI inputs); DmsCard is the only Dms*
 * primitive it uses.
 */
@RegisterPage()
export class RoutesPage extends PageController(
  "routes",
  {
    displayName: "$page.api.routes.title",
    description: "$page.api.routes.description",
    icon: "i-ph-tree-structure",
    module: "api",
    order: 1,
  },
  DefaultLayout({ hideHeader: true, fullWidth: true }),
) {
  static content = CustomComponent("DmsApiRoutesView").meta({
    name: "$page.api.routes.title",
    icon: "i-ph-tree-structure",
  });
}
