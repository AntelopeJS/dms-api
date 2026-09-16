import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";

/**
 * Logs page — live request log explorer.
 *
 * Same composition pattern as the other API pages: a single custom Vue
 * component (`DmsApiLogsView`) renders the whole surface (live toggle,
 * filter bar, detail drawer). `hideHeader: true`
 * because the component renders its own header; `fullWidth: true` so the
 * log table and drawer get the room they need.
 */
@RegisterPage()
export class LogsPage extends PageController(
  "logs",
  {
    displayName: "$page.api.logs.title",
    description: "$page.api.logs.description",
    icon: "i-ph-list-magnifying-glass",
    module: "api",
    order: 2,
  },
  DefaultLayout({ hideHeader: true, fullWidth: true }),
) {
  static content = CustomComponent("DmsApiLogsView").meta({
    name: "$page.api.logs.title",
    icon: "i-ph-list-magnifying-glass",
  });
}
