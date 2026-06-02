import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  Divider,
  InlineStack,
  Select,
  Text,
} from "@shopify/polaris";
import { useState } from "react";

import prisma from "~/db.server";
import { ensureShop, getLatestRun, parseRun } from "~/lib/shop.server";
import { EMPTY_INSIGHT } from "~/lib/types";
import { authenticate } from "~/shopify.server";
import { AppPage, ListSkeleton, SectionHeader } from "~/components";
import { getDelegate } from "~/lib/prisma-safe";
import { logUsage } from "~/lib/log-usage.server";
import {
  sendAndLog,
  getEmailProvider,
  buildWeeklyReportEmail,
  buildMonthlyReportEmail,
  buildAlertEmail,
  getEmailSubject,
  type EmailReportType,
} from "~/lib/email";
import { canUseEmailReports } from "~/lib/billing/plan-limits";
import type { PlanId } from "~/lib/billing";

async function getCtx(request: Request) {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(prisma, session.shop);
  return { shop, session };
}

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { shop } = await getCtx(request);
    const appSetting = getDelegate(prisma, "appSetting");
    const settings = appSetting?.findMany
      ? await appSetting.findMany({ where: { shopId: shop.id } })
      : [];
    const values = Object.fromEntries(
      (settings as Array<{ key: string; value: string }>).map((s) => [s.key, s.value]),
    );
    const reportEmail = values.reportEmail ?? "";

    const emailReportLog = getDelegate(prisma, "emailReportLog");
    const recentLogs = emailReportLog?.findMany
      ? await emailReportLog.findMany({
          where: { shopId: shop.id },
          orderBy: { createdAt: "desc" },
          take: 20,
        })
      : [];

    const provider = getEmailProvider();
    const gate = canUseEmailReports(shop.plan as PlanId);

    return json({
      reportEmail,
      recentLogs,
      providerId: provider.id,
      providerConfigured: provider.isConfigured(),
      canEmail: gate.allowed,
      gateReason: gate.reason ?? null,
      loadError: null,
    });
  } catch (error) {
    console.error("Email send loader failed", error);
    return json({
      reportEmail: "",
      recentLogs: [],
      providerId: "mock",
      providerConfigured: true,
      canEmail: false,
      gateReason: "Could not load email settings.",
      loadError: "Could not load email data. Try refreshing.",
    });
  }
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { shop, session } = await getCtx(request);
    const form = await request.formData();
    const intent = String(form.get("intent") ?? "");
    const reportType = String(form.get("reportType") ?? "test") as EmailReportType;
    const recipientEmail = String(form.get("recipientEmail") ?? "");

    if (!recipientEmail || !recipientEmail.includes("@")) {
      return json({ error: "Enter a valid email address in Settings before sending." }, { status: 400 });
    }

    const gate = canUseEmailReports(shop.plan as PlanId);
    if (!gate.allowed && reportType !== "test") {
      return json({ error: gate.reason ?? "Upgrade required." }, { status: 403 });
    }

    if (intent === "send-test") {
      const insight = parseRun(await getLatestRun(prisma, shop.id)) ?? EMPTY_INSIGHT;
      const storeName = session.shop.replace(".myshopify.com", "");
      const subject = getEmailSubject(reportType, storeName);

      const buildInput = {
        shopDomain: session.shop,
        storeName,
        insight,
        reportType,
        recipientEmail,
      };

      let html = "";
      if (reportType === "weekly") html = buildWeeklyReportEmail(buildInput);
      else if (reportType === "monthly") html = buildMonthlyReportEmail(buildInput);
      else html = buildAlertEmail(buildInput);

      const result = await sendAndLog(
        prisma,
        { shopId: shop.id, reportType, subject, recipientEmail, status: "pending", provider: "mock" },
        { to: recipientEmail, subject, html },
      );

      if (!result.ok) {
        return json({ error: result.error ?? "Send failed." }, { status: 500 });
      }
      await logUsage(prisma, shop.id, "marketing_generated", { reportType });
      return redirect("/app/email/send");
    }

    return redirect("/app/email/send");
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("Email send action failed", error);
    return json({ error: error instanceof Error ? error.message : "Action failed." }, { status: 500 });
  }
}

const REPORT_OPTIONS: Array<{ label: string; value: EmailReportType }> = [
  { label: "Weekly Recovery Report", value: "weekly" },
  { label: "Monthly Revenue Report", value: "monthly" },
  { label: "Competitor Alert", value: "alert_competitor" },
  { label: "High-Impact Opportunity Alert", value: "alert_high_impact" },
  { label: "Test (echo only)", value: "test" },
];

const STATUS_TONE: Record<string, "success" | "critical" | "warning" | "info"> = {
  sent: "success",
  failed: "critical",
  skipped: "warning",
  pending: "info",
};

export default function EmailSendPage() {
  const { reportEmail, recentLogs, providerId, providerConfigured, canEmail, gateReason, loadError } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [reportType, setReportType] = useState<string>("weekly");

  if (navigation.state === "loading") return <ListSkeleton />;
  const isSending = navigation.state === "submitting";

  return (
    <AppPage
      title="Email Reports"
      subtitle="Send recovery reports and alerts to your report email address."
      primaryAction={<Button url="/app/reports">View reports</Button>}
      secondaryAction={<Button url="/app/settings">Configure email</Button>}
    >
      <BlockStack gap="500">
        {loadError ? <Banner tone="critical" title="Load error"><p>{loadError}</p></Banner> : null}
        {actionData && "error" in actionData ? (
          <Banner tone="critical" title="Send failed"><p>{actionData.error}</p></Banner>
        ) : null}

        {!canEmail ? (
          <Banner tone="warning" title="Growth or Pro plan required">
            <p>{gateReason} <a href="/app/billing">Upgrade →</a></p>
          </Banner>
        ) : null}

        <div className="cia-metric-strip">
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">Email Provider</div>
            <Text as="p" variant="headingMd">{providerId}</Text>
          </div>
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">Provider Status</div>
            <Badge tone={providerConfigured ? "success" : "critical"}>
              {providerConfigured ? "Ready" : "Not configured"}
            </Badge>
          </div>
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">Report Email</div>
            <Text as="p" variant="bodyMd" tone={reportEmail ? undefined : "subdued"}>
              {reportEmail || "Not set — configure in Settings"}
            </Text>
          </div>
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">Emails Sent</div>
            <Text as="p" variant="headingMd">{recentLogs.length}</Text>
          </div>
        </div>

        <Card>
          <BlockStack gap="300">
            <SectionHeader
              title="Send Test Report"
              description="Preview any report type by sending it to your configured report email address."
            />
            {!reportEmail ? (
              <Banner tone="info">
                <p>Set a report email address in <a href="/app/settings">Settings</a> first.</p>
              </Banner>
            ) : (
              <Form method="post">
                <input type="hidden" name="intent" value="send-test" />
                <input type="hidden" name="recipientEmail" value={reportEmail} />
                <BlockStack gap="300">
                  <Select
                    label="Report type"
                    options={REPORT_OPTIONS}
                    value={reportType}
                    onChange={setReportType}
                  />
                  <input type="hidden" name="reportType" value={reportType} />
                  <Text as="p" variant="bodySm" tone="subdued">{`Sending to: ${reportEmail}`}</Text>
                  <Button submit variant="primary" loading={isSending} disabled={!providerConfigured}>
                    {isSending ? "Sending…" : "Send Test Report"}
                  </Button>
                </BlockStack>
              </Form>
            )}
          </BlockStack>
        </Card>

        {recentLogs.length > 0 ? (
          <BlockStack gap="300">
            <SectionHeader title="Email Log" description="Last 20 send attempts for this store." />
            <Card>
              <BlockStack gap="200">
                {(recentLogs as Array<{
                  id: string;
                  reportType: string;
                  subject: string;
                  recipientEmail: string;
                  status: string;
                  provider: string;
                  error?: string | null;
                  createdAt: string;
                  sentAt?: string | null;
                }>).map((log, idx) => (
                  <BlockStack key={log.id} gap="100">
                    {idx > 0 ? <Divider /> : null}
                    <InlineStack align="space-between" blockAlign="center" wrap={false} gap="200">
                      <BlockStack gap="050">
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="p" variant="bodyMd" fontWeight="semibold">{log.subject}</Text>
                          <Badge tone={STATUS_TONE[log.status] ?? "info"}>{log.status}</Badge>
                          <Badge tone="info">{log.provider}</Badge>
                        </InlineStack>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {`To: ${log.recipientEmail} · ${new Date(log.createdAt).toLocaleDateString()}`}
                        </Text>
                        {log.error ? (
                          <Text as="p" variant="bodySm" tone="critical">{log.error}</Text>
                        ) : null}
                      </BlockStack>
                    </InlineStack>
                  </BlockStack>
                ))}
              </BlockStack>
            </Card>
          </BlockStack>
        ) : null}
      </BlockStack>
    </AppPage>
  );
}
