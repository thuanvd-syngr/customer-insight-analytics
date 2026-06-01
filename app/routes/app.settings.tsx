import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { BlockStack, Button, Card, Page, Text, TextField } from "@shopify/polaris";
import { useState } from "react";

import prisma from "~/db.server";
import { getAIProvider } from "~/lib/ai";
import { ensureShop } from "~/lib/shop.server";
import { authenticate } from "~/shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(prisma, session.shop);
  const settings = await prisma.appSetting.findMany({ where: { shopId: shop.id } });
  const values = Object.fromEntries(settings.map((setting) => [setting.key, setting.value]));
  const provider = getAIProvider();
  return json({
    competitorTerms: values.competitorTerms ?? "",
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
  return (
    <Page title="Settings">
      <Card>
        <Form method="post">
          <BlockStack gap="300">
            <Text as="p" variant="bodyMd">
              AI provider: {data.aiProvider} ({data.aiConfigured ? "configured" : "not configured"})
            </Text>
            <TextField
              label="Competitor terms"
              name="competitorTerms"
              value={competitorTerms}
              onChange={setCompetitorTerms}
              multiline={5}
              autoComplete="off"
            />
            <TextField
              label="Auto cleanup"
              name="autoCleanup"
              value={autoCleanup}
              onChange={setAutoCleanup}
              autoComplete="off"
            />
            <Button submit variant="primary">Save</Button>
          </BlockStack>
        </Form>
      </Card>
    </Page>
  );
}
