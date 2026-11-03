import {
  Controller,
  Get,
  HTTPResult,
  JSONBody,
  Parameter,
  Post,
  Prefix,
} from "@antelopejs/interface-api";

interface OrderBody {
  sku: string;
  quantity: number;
  gift?: boolean;
}

/** Routes behind a middleware whose name matches the default auth pattern `^auth_`. */
export class GuardedController extends Controller("/fx/guarded") {
  @Prefix("get", "*")
  auth_check(@Parameter("authorization", "header") authorization?: string) {
    if (authorization !== "Bearer letmein") {
      return new HTTPResult(401, { error: "sign in first" });
    }
    return undefined;
  }

  @Get("secret")
  secret() {
    return { secret: true };
  }
}

/** Routes behind a middleware the default patterns do not match: `authMiddlewareCallbacks` names it. */
export class NamedController extends Controller("/fx/named") {
  @Prefix("get", "*")
  checkTicket(@Parameter("x-ticket", "header") ticket?: string) {
    if (ticket !== "t-1") return new HTTPResult(403, { error: "ticket needed" });
    return undefined;
  }

  @Get("page")
  page() {
    return { page: 1 };
  }
}

/** A route whose handler checks the caller itself: no guard shows before it. */
export class InlineController extends Controller("/fx/inline") {
  @Get("private")
  private(@Parameter("x-user", "header") user?: string) {
    if (!user) return new HTTPResult(401, { error: "who are you" });
    return { user };
  }
}

/** A route with path, query, header and body parameters, for the Documentation tab. */
export class OrdersController extends Controller("/fx/orders") {
  @Post(":shop/lines")
  add(
    @Parameter("shop", "param") shop: string,
    @Parameter("limit", "query") limit: string | undefined,
    @Parameter("x-tenant", "header") tenant: string | undefined,
    @JSONBody() body: OrderBody,
  ) {
    return new HTTPResult(201, { shop, limit, tenant, line: body });
  }
}
