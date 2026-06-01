import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { Badge, BlockStack, Button, Card, Checkbox, InlineStack, Text, TextField } from "@shopify/polaris";
import { useState } from "react";

import prisma from "~/db.server";
import { getAIProvider } from "~/lib/ai";
import { ensureShop } from "~/lib/shop.server";
import { authenticate } from "~/shopify.server";
import { AppPage, SectionHeader } from "~/components";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(prisma, session.shop);
  const settings = await prisma.appSetting.findMany({ where: { shopId: shop.id } });
  const values = Object.fromEntries(settings.map((setting) => [setting.key, setting.value]));
  const provider = getAIProvider();
  return json({
    competitorTerms: values.competitorTerms ?? "Amazon\nTemu\nWalmart\nTarget\nTikTok Shop",
    autoCleanup: values.autoCleanup ?? "false",
    aiProvider: provider.id,
    aiConfigured: provider.isConfigured(),
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(prisma, session.shop);
  const form = await request.formData();
  for (const key of ["competitorTerms", "autoCleanup"]) {
    await prisma.appSetting.upsert({
      where: { shopId_key: { shopId: shop.id, key } },
      update: { value: String(form.get(key) ?? "") },
      create: { shopId: shop.id, key, value: String(form.get(key) ?? "") },
    });
  }
  return redirect("/app/settings");
}

export default function Settings() {
  const data = useLoaderData<typeof loader>();
  const [competitorTerms, setCompetitorTerms] = useState(data.competitorTerms);
  const [autoCleanup, setAutoCleanup] = useState(data.autoCleanup);
  const [enabled, setEnabled] = useState(data.autoCleanup === "true");
  return (
    <AppPage
      title="Settings"
      subtitle="Control competitor tracking, AI status, and data retention."
    >
      <Form method="post" id="settings-form">
        <BlockStack gap="400">
          <div className="cia-two-grid">
            <Card>
              <BlockStack gap="300">
                <SectionHeader
                  title="Data Sources"
                  description="Connect Shopify products, orders, customers, and imported buyer questions from the data hub."
                />
                <Button url="/app/import">Open data hub</Button>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="300">
                <SectionHeader
                  title="AI Settings"
                  description="AI enriches weekly summaries when configured. The recovery engine still works without AI."
                  trailing={
                    <Badge tone={data.aiConfigured ? "success" : "info"}>
                      {data.aiConfigured
                        ? data.aiProvider === "mock"
                          ? "Rule-based test summaries"
                          : `${data.aiProvider}: configured`
                        : "AI off"}
                    </Badge>
                  }
                />
              </BlockStack>
            </Card>
          </div>

          <div className="cia-two-grid">
            <Card>
              <BlockStack gap="300">
            <SectionHeader
              title="Competitor Tracking"
              description="Add marketplaces, brands, or alternatives customers compare against before buying."
            />
            <TextField
              label="Competitor list"
              name="competitorTerms"
              value={competitorTerms}
              onChange={setCompetitorTerms}
              multiline={5}
              autoComplete="off"
            />
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="300">
                <SectionHeader
                  title="Retention Policy"
                  description="Keep analysis focused on recent buyer questions and reduce stale imported conversation storage."
                />
            <InlineStack gap="300">
              <Checkbox
                label="Automatically clean up old imported conversations"
                checked={enabled}
                onChange={(checked) => {
                  setEnabled(checked);
                  setAutoCleanup(String(checked));
                }}
              />
              <input type="hidden" name="autoCleanup" value={autoCleanup} />
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">
              Cleanup keeps analysis focused on recent buyer questions and reduces stale conversation storage.
            </Text>
              </BlockStack>
            </Card>
          </div>
          <Button submit variant="primary">Save settings</Button>
        </BlockStack>
      </Form>
    </AppPage>
  );
}
