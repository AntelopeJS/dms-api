import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";

/**
 * Summary page — landing page for the API module.
 *
 * Same composition pattern as the Routes page: a single custom Vue
 * component renders the whole surface (KPIs, health, request history,
 * watch-list, activity). `hideHeader: true` because the component renders
 * its own header markup; `fullWidth: true` so the multi-column charts get
 * the room they need.
 */
@RegisterPage()
export class SummaryPage extends PageController(
  "summary",
  {
    displayName: "$page.api.summary.title",
    description: "$page.api.summary.description",
    icon: "i-ph-chart-line",
    module: "api",
    order: 0,
  },
  DefaultLayout({ hideHeader: true, fullWidth: true }),
) {
  static content = CustomComponent("DmsApiSummaryView").meta({
    name: "$page.api.summary.title",
    icon: "i-ph-chart-line",
  });
}
