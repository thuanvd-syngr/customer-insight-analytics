import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { BlockStack, Card, DataTable, Page, Text } from "@shopify/polaris";

import prisma from "~/db.server";
import { ensureShop, getLatestRun, parseRun } from "~/lib/shop.server";
import { EMPTY_INSIGHT } from "~/lib/types";
import { authenticate } from "~/shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(prisma, session.shop);
  return json({ insight: parseRun(await getLatestRun(prisma, shop.id)) ?? EMPTY_INSIGHT });
}

export default function Insights() {
  const { insight } = useLoaderData<typeof loader>();
  return (
    <Page title="Insights">
      <BlockStack gap="400">
        <Card>
          <DataTable
            columnContentTypes={["text", "numeric", "numeric", "numeric", "text"]}
            headings={["Group", "Count", "Trend 7d", "Trend 30d", "Example"]}
            rows={insight.keywordGroups.map((group) => [
              group.label,
              group.count,
              `${Math.round(group.trend7 * 100)}%`,
              `${Math.round(group.trend30 * 100)}%`,
              group.exampleQuote ?? "",
            ])}
          />
        </Card>
        <Card>
          <Text as="h2" variant="headingMd">Competitor mentions</Text>
          <DataTable
            columnContentTypes={["text", "numeric", "text"]}
            headings={["Name", "Count", "Example"]}
            rows={insight.competitors.map((item) => [item.name, item.count, item.exampleQuote ?? ""])}
          />
        </Card>
      </BlockStack>
    </Page>
  );
}
