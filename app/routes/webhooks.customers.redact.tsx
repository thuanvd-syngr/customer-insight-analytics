import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";

import prisma from "~/db.server";
import { authenticate } from "~/shopify.server";

// Mandatory Shopify GDPR webhook: customers/redact
// Sent 10 days after a customer requests deletion of their data.
// This app stores customer data only as hashed customerRef values (never raw email/name).
// We anonymize any ImportedMessage rows linked to the customer's hashed ID.
export async function action({ request }: ActionFunctionArgs) {
  const { topic, shop, payload } = await authenticate.webhook(request);
  const body = payload as {
    customer?: { id?: string | number };
    orders_to_redact?: Array<{ id?: string | number }>;
  };
  const customerId = body?.customer?.id ? String(body.customer.id) : null;

  console.info("GDPR customers/redact received", { topic, shop, customerId });

  if (customerId) {
    // Nullify customerRef for any messages linked to this customer.
    // Content is kept for aggregate analytics but the customer linkage is removed.
    await prisma.importedMessage.updateMany({
      where: { customerRef: customerId },
      data: { customerRef: null },
    });
  }

  return new Response(null, { status: 200 });
}

export function loader(_args: LoaderFunctionArgs) {
  return new Response(null, { status: 200 });
}
