import { describe, expect, it } from "vitest";
import { WebhooksController } from "../playground/src/shop";

describe("the playground Stripe webhook", () => {
  it("answers the lower-cased email of the invoice's customer", async () => {
    const answer = await new WebhooksController().stripe({
      type: "invoice.paid",
      data: { object: { customer: { email: "A@B.C" } } },
    });
    expect(answer).toEqual({ received: true, email: "a@b.c" });
  });

  it("fails with a message naming the deleted customer", async () => {
    await expect(
      new WebhooksController().stripe({
        type: "invoice.paid",
        data: { object: { customer: null } },
      }),
    ).rejects.toThrow(/customer was deleted/);
  });
});
