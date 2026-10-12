import {
  Controller,
  Delete,
  Get,
  HTTPResult,
  JSONBody,
  Parameter,
  Post,
  Put,
  Route,
} from "@antelopejs/interface-api";

/**
 * A small storefront API for the console to watch: healthy routes, a slow
 * one, one answering client errors and a webhook that fails. Run
 * `pnpm --dir playground traffic` to send it a few hundred requests.
 */

interface OrderLine {
  sku: string;
  quantity: number;
}

interface OrderBody {
  customerId?: string;
  currency?: string;
  items?: OrderLine[];
  notes?: string | null;
}

interface StripeEvent {
  type?: string;
  data?: { object?: { customer?: { email?: string } | null } };
}

const STOCK_LIMIT = 10;
const SLOW_PDF_MS = 1_400;
const NOT_FOUND = 404;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const jitter = (base: number, spread: number) =>
  wait(base + Math.round(Math.random() * spread));

let nextOrder = 10_480;

export class OrdersController extends Controller("/api/orders") {
  @Get("")
  async list() {
    await jitter(30, 120);
    return [{ id: String(nextOrder), status: "pending_payment" }];
  }

  @Post("")
  async create(@JSONBody() body: OrderBody) {
    await jitter(80, 180);
    if (!body?.items?.length) {
      return new HTTPResult(400, { error: "Cart is empty" });
    }
    const short = body.items.find((line) => line.quantity > STOCK_LIMIT);
    if (short) {
      throw new HTTPResult(422, {
        error: `Insufficient stock for SKU ${short.sku}`,
      });
    }
    nextOrder += 1;
    return new HTTPResult(201, {
      id: String(nextOrder),
      status: "pending_payment",
      customerId: body.customerId,
      currency: body.currency ?? "EUR",
    });
  }

  @Get(":id")
  async get(@Parameter("id", "param") id: string) {
    await jitter(20, 80);
    if (id.startsWith("x")) {
      return new HTTPResult(NOT_FOUND, { error: "Order not found" });
    }
    return { id, status: "paid" };
  }

  @Route("handler", "patch", ":id")
  async update(@Parameter("id", "param") id: string) {
    await jitter(40, 100);
    return { id, status: "paid" };
  }

  @Delete(":id")
  async remove(@Parameter("id", "param") id: string) {
    await jitter(10, 30);
    return new HTTPResult(NOT_FOUND, { error: `Order ${id} not found` });
  }

  @Post(":id/refund")
  async refund(
    @Parameter("id", "param") id: string,
    @JSONBody() body: { amount?: number },
  ) {
    await jitter(40, 90);
    if ((body?.amount ?? 0) > 500) {
      throw new HTTPResult(422, { error: "Refund exceeds captured amount" });
    }
    return { id, refunded: body?.amount ?? 0 };
  }
}

export class CustomersController extends Controller("/api/customers") {
  @Get("")
  async list() {
    await jitter(20, 60);
    return [{ id: "C-00481", name: "Northwind Traders" }];
  }

  @Get(":id")
  async get(@Parameter("id", "param") id: string) {
    await jitter(40, 90);
    return { id, name: "Northwind Traders" };
  }

  @Put(":id")
  async update(
    @Parameter("id", "param") id: string,
    @JSONBody() body: { name?: string },
  ) {
    await jitter(80, 150);
    return { id, name: body?.name ?? "Northwind Traders" };
  }
}

export class InvoicesController extends Controller("/api/invoices") {
  @Get(":id/pdf")
  async pdf(@Parameter("id", "param") id: string) {
    await jitter(SLOW_PDF_MS, 900);
    return { id, url: `https://files.acme.test/${id}.pdf` };
  }

  @Post(":id/send")
  async send(@Parameter("id", "param") id: string) {
    await jitter(100, 200);
    return { id, sent: true };
  }
}

export class WebhooksController extends Controller("/webhooks") {
  @Post("stripe")
  async stripe(@JSONBody() event: StripeEvent) {
    await jitter(15, 40);
    // Reads the customer's email without checking it: an invoice paid by a
    // deleted customer makes the handler throw, which is the point.
    const customer = event?.data?.object?.customer as { email: string };
    return { received: true, email: customer.email.toLowerCase() };
  }

  @Post("shippo")
  async shippo() {
    await jitter(15, 40);
    return { received: true };
  }
}
