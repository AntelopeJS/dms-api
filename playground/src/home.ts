import {
  PageController,
  pagesCategory,
  RegisterPage,
} from "@antelopejs/interface-dms/page";
import { Grid } from "@antelopejs/interface-dms/base/grid";

@RegisterPage()
export class PageHome extends PageController("home", {
  displayName: "Home",
  icon: "i-ph-house",
  category: pagesCategory,
  order: 0,
  description: "Welcome page",
}) {
  static grid = Grid({ gap: "1rem" });
}
