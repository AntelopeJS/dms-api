import { RegisterModule } from "@antelopejs/interface-dms/page";

export const apiModule = RegisterModule({
  id: "api",
  title: "$page.api.category_name",
  description: "$page.api.summary.description",
  icon: "i-ph-brackets-curly",
  landingPage: "summary",
});
