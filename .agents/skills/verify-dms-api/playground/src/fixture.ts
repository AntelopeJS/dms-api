import {
  Controller,
  Delete,
  Get,
  type HTTPBody,
  HTTPResult,
  JSONBody,
  Parameter,
  Post,
  Put,
} from "@antelopejs/interface-api";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The routes a journey sends traffic to, so that every status class, a slow
 * answer, a thrown error, secrets in a body and a body of any size exist on
 * demand. Only the verification playground serves them.
 */
export class FixtureController extends Controller("/fx") {
  @Get("ok")
  ok() {
    return { ok: true };
  }

  @Get("slow")
  async slow(@Parameter("ms", "query") ms?: string) {
    await wait(Number(ms ?? "1200"));
    return { slow: true };
  }

  @Get("boom")
  boom() {
    throw new Error("fixture boom: the invoice has no customer");
  }

  @Get("missing")
  missing() {
    return new HTTPResult(404, { error: "fixture not found" });
  }

  @Post("echo")
  echo(@JSONBody() body: HTTPBody) {
    return new HTTPResult(201, body);
  }

  @Post("login")
  login(@JSONBody() body: unknown) {
    void body;
    return { user: "ann", token: "issued-secret-value", note: "welcome" };
  }

  @Get("blob")
  blob(@Parameter("size", "query") size?: string) {
    return { text: "x".repeat(Number(size ?? "10")) };
  }

  @Get("items/:id")
  item(@Parameter("id", "param") id: string) {
    if (id.startsWith("x")) return new HTTPResult(404, { error: "no such item" });
    return { id };
  }

  @Put("items/:id")
  put(@Parameter("id", "param") id: string, @JSONBody() body: HTTPBody) {
    return { id, body };
  }

  @Delete("items/:id")
  remove(@Parameter("id", "param") id: string) {
    return { id, deleted: true };
  }
}
