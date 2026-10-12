import { Controller, Get } from "@antelopejs/interface-api";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { AuthUserWithPermission } from "@antelopejs/interface-dms/guards";
import { RoutesPage } from "@/pages/routes";
import { issueTesterSourceToken } from "@/services/tester-source";

/** The Tester tab of the Routes page: what its permission opens. */
export const testerBlock = RoutesPage.explorer.targetChild("tabs", "tester");

export class TesterController extends Controller("/api/monitoring/tester") {
  /**
   * `{ header, value, expiresAt }`: the header the Tester sends its next
   * calls with, so the capture logs them as the Tester's and leaves them out
   * of the statistics and the health. Valid 15 minutes; ask before each call.
   */
  @Get("source")
  getSourceToken(@AuthUserWithPermission(testerBlock) _user: User) {
    return issueTesterSourceToken();
  }
}
