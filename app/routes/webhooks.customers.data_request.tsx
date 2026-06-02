import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";

import { authenticate } from "~/shopify.server";

// Mandatory Shopify GDPR webhook: customers/data_request
// Sent when a merchant or customer requests an export of all data stored for a customer.
// This app stores customer data only as:
//   - customerRef (hashed email or Shopify customer ID, never raw email)
//   - order notes (content of order.note field, anonymized at import)
// No raw PII (email address, full name, phone) is stored.
export async function action({ request }: ActionFunctionArgs) {
  const { topic, shop, payload } = await authenticate.webhook(request);
  console.info("GDPR customers/data_request received", {
    topic,
    shop,
    customerId: ((payload as Record<string, unknown>)?.customer as Record<string, unknown> | undefined)?.id ?? null,
  });
  // This app does not store raw customer PII. All customer references are hashed
  // customer IDs or anonymized order content. No data export is required.
  return new Response(null, { status: 200 });
}

export function loader(_args: LoaderFunctionArgs) {
  return new Response(null, { status: 200 });
}
