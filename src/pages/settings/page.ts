import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { apiSettingsForm } from "./form";

/**
 * Settings page — runtime configuration of the API console.
 *
 * Unlike the other API pages (single custom component), this one uses the
 * DMS declarative Form: fields are defined backend-side in `./form` and
 * rendered by DmsForm, which handles fetch/submit/validation/toasts against
 * /api/monitoring/settings. Values apply without restart.
 */
@RegisterPage()
export class ApiSettingsPage extends PageController(
  "settings",
  {
    displayName: "$page.api.settings.title",
    description: "$page.api.settings.description",
    icon: "i-ph-gear",
    module: "api",
    order: 3,
  },
  DefaultLayout(),
) {
  static content = apiSettingsForm;
}
