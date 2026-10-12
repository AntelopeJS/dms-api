// Sends the storefront demo (src/shop.ts) a burst of realistic traffic, so
// the API console has something to show: healthy calls, a slow route, client
// errors and a failing webhook. Usage: node scripts/traffic.mjs [count]
const BASE_URL = process.env.API_URL ?? "http://127.0.0.1:5010";
const COUNT = Number(process.argv[2] ?? 200);
const CONCURRENCY = 8;

const order = () => ({
  customerId: `C-00${400 + Math.floor(Math.random() * 99)}`,
  currency: "EUR",
  items: [
    { sku: "DESK-OAK-160", quantity: 1 + Math.floor(Math.random() * 3) },
    { sku: "CHAIR-ERGO-GR", quantity: Math.random() < 0.1 ? 40 : 2 },
  ],
  notes: null,
});

const CALLS = [
  [30, () => ["GET", "/api/orders"]],
  [20, () => ["POST", "/api/orders", order()]],
  [3, () => ["POST", "/api/orders", { customerId: "C-00481", items: [] }]],
  [15, () => ["GET", `/api/orders/${10400 + Math.floor(Math.random() * 90)}`]],
  [2, () => ["GET", "/api/orders/x404"]],
  [4, () => ["PATCH", "/api/orders/10477"]],
  [1, () => ["DELETE", "/api/orders/10311"]],
  [
    5,
    () => [
      "POST",
      "/api/orders/10477/refund",
      { amount: Math.random() < 0.4 ? 900 : 120 },
    ],
  ],
  [12, () => ["GET", "/api/customers/C-00481"]],
  [4, () => ["PUT", "/api/customers/C-00977", { name: "Initech" }]],
  [6, () => ["GET", "/api/invoices/INV-2291/pdf"]],
  [2, () => ["POST", "/api/invoices/INV-2291/send"]],
  [
    4,
    () => [
      "POST",
      "/webhooks/stripe",
      {
        type: "invoice.paid",
        data: {
          object: {
            customer: Math.random() < 0.6 ? null : { email: "A@B.C" },
            metadata: { portal_token: "secret" },
          },
        },
      },
    ],
  ],
  [3, () => ["POST", "/webhooks/shippo", { event: "track_updated" }]],
];
const TOTAL_WEIGHT = CALLS.reduce((sum, [weight]) => sum + weight, 0);

function pick() {
  let roll = Math.random() * TOTAL_WEIGHT;
  for (const [weight, make] of CALLS) {
    roll -= weight;
    if (roll <= 0) return make();
  }
  return CALLS[0][1]();
}

async function send() {
  const [method, path, body] = pick();
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: body
      ? { "content-type": "application/json", "user-agent": "acme-traffic/1.0" }
      : { "user-agent": "acme-traffic/1.0" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return response.status;
}

const statuses = {};
let sent = 0;
async function worker() {
  while (sent < COUNT) {
    sent += 1;
    const status = await send().catch(() => "ERR");
    statuses[status] = (statuses[status] ?? 0) + 1;
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`Sent ${COUNT} requests`, statuses);
