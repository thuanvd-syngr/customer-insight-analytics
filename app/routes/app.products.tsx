import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Card, DataTable, Page } from "@shopify/polaris";

import prisma from "~/db.server";
import { ensureShop, getLatestRun, parseRun } from "~/lib/shop.server";
import { EMPTY_INSIGHT } from "~/lib/types";
import { authenticate } from "~/shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(prisma, session.shop);
  return json({ insight: parseRun(await getLatestRun(prisma, shop.id)) ?? EMPTY_INSIGHT });
}

export default function Products() {
  const { insight } = useLoaderData<typeof loader>();
  return (
    <Page title="Products with confusion">
      <Card>
        <DataTable
          columnContentTypes={["text", "numeric", "numeric", "text"]}
          headings={["Product", "Mentions", "Score", "Top groups"]}
          rows={insight.productConfusion.map((product) => [
            product.productTitle,
            product.mentionCount,
            product.confusionScore,
            product.topGroups.join(", "),
          ])}
        />
      </Card>
    </Page>
  );
}
