import { randomUUID } from "node:crypto";
import { Controller, JSONBody, Post } from "@antelopejs/interface-api";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { DEFAULT_TENANT_ID } from "@antelopejs/interface-dms/constants";
import { RoleModel } from "@antelopejs/interface-dms/db";
import { createUserInviteToken } from "@antelopejs/interface-dms";
import { z } from "zod";

const memberSchema = z.object({
  name: z.string(),
  permissions: z.array(z.string()),
  language: z.string().default("en"),
});

/** The ids a grant sits under, as the roles editor of the DMS stores them: `a.b.c` also grants `a` and `a.b`. */
function withAncestors(permissions: string[]): string[] {
  return [
    ...new Set(
      permissions.flatMap((id) => {
        const segments = id.split(".");
        return segments.map((_, index) => segments.slice(0, index + 1).join("."));
      }),
    ),
  ];
}

/**
 * A role holding exactly the permission ids given, and an invitation to it a
 * journey signs up with: the roles editor of the DMS grants the same ids.
 * Only the e2e playground serves it.
 */
export class FixtureMembersController extends Controller("/fixture-api") {
  @Post("/member")
  async member(@JSONBody() body: unknown) {
    const { name, permissions, language } = memberSchema.parse(body);
    const [roleId] = await GetModel(RoleModel, DEFAULT_TENANT_ID).insert({
      name: `${name} ${randomUUID()}`,
      permissions: withAncestors(permissions),
    });
    const email = `${name.toLowerCase()}-${randomUUID()}@verify.local`;
    const { token } = await createUserInviteToken({
      tenantId: DEFAULT_TENANT_ID,
      email,
      language,
      roleIds: roleId === undefined ? [] : [roleId],
      asTenantOwner: false,
    });
    return { email, token, roleId };
  }
}
