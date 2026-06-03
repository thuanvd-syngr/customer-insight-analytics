import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { Badge, BlockStack, Button, Card, Checkbox, InlineStack, Text } from "@shopify/polaris";
import { useState } from "react";

import prisma from "~/db.server";
import { getAIProvider } from "~/lib/ai";
import { ensureShop } from "~/lib/shop.server";
import { authenticate } from "~/shopify.server";
import { AppPage, SectionHeader } from "~/components";
import { getDelegate } from "~/lib/prisma-safe";

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { session } = await authenticate.admin(request);
    const shop = await ensureShop(prisma, session.shop);
    const appSetting = getDelegate(prisma, "appSetting");
    const settings = appSetting?.findMany
      ? await appSetting.findMany({ where: { shopId: shop.id } })
      : [];
    const values = Object.fromEntries(
      settings.map((s: { key: string; value: string }) => [s.key, s.value]),
    );
    const provider = getAIProvider();
    return json({
      competitorTerms: values.competitorTerms ?? "",
      autoCleanup: values.autoCleanup ?? "false",
      reportEmail: values.reportEmail ?? "",
      emailWeekly: values.emailWeekly ?? "false",
      emailMonthly: values.emailMonthly ?? "false",
      emailAlerts: values.emailAlerts ?? "false",
      aiProvider: provider.id,
      aiConfigured: provider.isConfigured(),
      loadError: null,
    });
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("Settings loader failed", error);
    const provider = getAIProvider();
    return json({
      competitorTerms: "",
      autoCleanup: "false",
      reportEmail: "",
      emailWeekly: "false",
      emailMonthly: "false",
      emailAlerts: "false",
      aiProvider: provider.id,
      aiConfigured: provider.isConfigured(),
      loadError: "Some data could not be loaded. Try refreshing.",
    });
  }
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(prisma, session.shop);
  const form = await request.formData();
  const appSetting = getDelegate(prisma, "appSetting");
  if (!appSetting?.upsert) return redirect("/app/settings");
  for (const key of ["competitorTerms", "autoCleanup", "reportEmail", "emailWeekly", "emailMonthly", "emailAlerts"]) {
    await appSetting.upsert({
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
  const [reportEmail, setReportEmail] = useState(data.reportEmail);
  const [emailWeekly, setEmailWeekly] = useState(data.emailWeekly === "true");
  const [emailMonthly, setEmailMonthly] = useState(data.emailMonthly === "true");
  const [emailAlerts, setEmailAlerts] = useState(data.emailAlerts === "true");

  return (
    <AppPage
      title="Settings"
      subtitle="Configure competitor tracking, AI, report delivery, and data retention."
    >
      <Form method="post" id="settings-form">
        <BlockStack gap="400">
          {data.loadError ? (
            <Card>
              <Text as="p" variant="bodyMd" tone="critical">{data.loadError}</Text>
            </Card>
          ) : null}

          <div className="cia-two-grid">
            <Card>
              <BlockStack gap="300">
                <SectionHeader
                  title="Data Sources"
                  description="Connect Shopify products, order notes, and imported buyer questions from the data hub."
                />
                <Button url="/app/import">Open data hub</Button>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="300">
                <SectionHeader
                  title="AI Settings"
                  description="AI enriches weekly summaries and content generation when configured."
                  trailing={
                    <Badge tone={data.aiConfigured ? "success" : "info"}>
                      {data.aiConfigured
                        ? data.aiProvider === "mock"
                          ? "Rule-based test mode"
                          : `${data.aiProvider}: configured`
                        : "AI off"}
                    </Badge>
                  }
                />
                <Text as="p" variant="bodySm" tone="subdued">
                  Set AI_PROVIDER=groq or AI_PROVIDER=gemini with the corresponding API key to enable AI content generation and summaries.
                </Text>
              </BlockStack>
            </Card>
          </div>

          <div className="cia-two-grid">
            <Card>
              <BlockStack gap="300">
                <SectionHeader
                  title="Competitor Tracking"
                  description="Add brands or alternatives customers compare against. One per line."
                />
                <div>
                  <label
                    htmlFor="competitor-terms"
                    style={{ display: "block", marginBottom: 6, fontSize: 14, fontWeight: 500 }}
                  >
                    Competitor list
                  </label>
                  <textarea
                    id="competitor-terms"
                    name="competitorTerms"
                    value={competitorTerms}
                    onChange={(e) => setCompetitorTerms(e.target.value)}
                    rows={5}
                    placeholder={"Burton\nNitro\nCapita\nLib Tech\nArbor"}
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      border: "1px solid #d0d0d0",
                      borderRadius: 8,
                      fontFamily: "inherit",
                      fontSize: 14,
                      resize: "vertical",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
                <Button url="/app/competitors">View competitor intelligence</Button>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="300">
                <SectionHeader
                  title="Report Email Delivery"
                  description="Email address that appears in exported report subjects. No automatic sending — copy HTML into your email provider."
                />
                <div>
                  <label
                    htmlFor="report-email"
                    style={{ display: "block", marginBottom: 6, fontSize: 14, fontWeight: 500 }}
                  >
                    Report email address
                  </label>
                  <input
                    id="report-email"
                    name="reportEmail"
                    type="email"
                    value={reportEmail}
                    onChange={(e) => setReportEmail(e.target.value)}
                    placeholder="owner@yourstore.com"
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      border: "1px solid #d0d0d0",
                      borderRadius: 8,
                      fontFamily: "inherit",
                      fontSize: 14,
                      boxSizing: "border-box",
                    }}
                  />
                </div>
                <Button url="/app/reports">View reports</Button>
              </BlockStack>
            </Card>
          </div>

          <Card>
            <BlockStack gap="300">
              <SectionHeader
                title="Email Report Automation"
                description="Enable automatic reports delivered to your report email address. Requires Growth or Pro plan."
              />
              <BlockStack gap="200">
                <InlineStack gap="300">
                  <Checkbox
                    label="Weekly recovery digest"
                    checked={emailWeekly}
                    onChange={(checked) => setEmailWeekly(checked)}
                  />
                  <input type="hidden" name="emailWeekly" value={String(emailWeekly)} />
                </InlineStack>
                <InlineStack gap="300">
                  <Checkbox
                    label="Monthly revenue report"
                    checked={emailMonthly}
                    onChange={(checked) => setEmailMonthly(checked)}
                  />
                  <input type="hidden" name="emailMonthly" value={String(emailMonthly)} />
                </InlineStack>
                <InlineStack gap="300">
                  <Checkbox
                    label="High-impact and competitor alerts"
                    checked={emailAlerts}
                    onChange={(checked) => setEmailAlerts(checked)}
                  />
                  <input type="hidden" name="emailAlerts" value={String(emailAlerts)} />
                </InlineStack>
              </BlockStack>
              <Button url="/app/email/send">Send test report</Button>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <SectionHeader
                title="Retention Policy"
                description="Keep analysis focused on recent buyer questions and reduce stale conversation storage."
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
            </BlockStack>
          </Card>

          <Button submit variant="primary">Save settings</Button>
        </BlockStack>
      </Form>
    </AppPage>
  );
}
