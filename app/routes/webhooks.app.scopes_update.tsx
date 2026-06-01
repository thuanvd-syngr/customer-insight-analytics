import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";

import prisma from "~/db.server";
import { authenticate } from "~/shopify.server";

export async function action({ request }: ActionFunctionArgs) {
  const { shop, session, payload } = await authenticate.webhook(request);
  if (session?.id && shop) {
    const scope = typeof payload === "object" && payload && "current" in payload
      ? String((payload as { current?: unknown }).current ?? "")
      : undefined;
    if (scope) {
      await prisma.session.update({
        where: { id: session.id },
        data: { scope },
      });
    }
  }
  return new Response();
}

export function loader(_args: LoaderFunctionArgs) {
  return new Response(null, { status: 200 });
}
