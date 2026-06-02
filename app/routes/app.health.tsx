import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigation } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  Divider,
  InlineStack,
  Text,
} from "@shopify/polaris";

import prisma from "~/db.server";
import { ensureShop } from "~/lib/shop.server";
import { authenticate } from "~/shopify.server";
import { AppPage, DashboardSkeleton, SectionHeader } from "~/components";
import { getHealth, getConfigHealth } from "~/lib/health.server";

async function getCtx(request: Request) {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(prisma, session.shop);
  return { shop, session };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { shop } = await getCtx(request);

  // DB connectivity check
  let dbOk = false;
  let dbLatencyMs = 0;
  try {
    const start = performance.now();
    await prisma.$queryRaw`SELECT 1`;
    dbLatencyMs = Math.round(performance.now() - start);
    dbOk = true;
  } catch {}

  // Count key records to confirm table access
  let insightRunCount = 0;
  let messageCount = 0;
  try {
    insightRunCount = await prisma.insightRun.count({ where: { shopId: shop.id } });
    messageCount = await prisma.importedMessage.count({ where: { shopId: shop.id } });
  } catch {}

  const health = getHealth(new Date());
  const configHealth = getConfigHealth(process.env as NodeJS.ProcessEnv);

  return json({
    health,
    configHealth,
    dbOk,
    dbLatencyMs,
    insightRunCount,
    messageCount,
    shopDomain: shop.shopDomain,
    plan: shop.plan,
    checkedAt: new Date().toISOString(),
  });
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <Badge tone={ok ? "success" : "critical"}>
      {ok ? "OK" : "FAIL"}
    </Badge>
  );
}

export default function HealthPage() {
  const {
    health,
    configHealth,
    dbOk,
    dbLatencyMs,
    insightRunCount,
    messageCount,
    shopDomain,
    plan,
    checkedAt,
  } = useLoaderData<typeof loader>();
  const navigation = useNavigation();

  if (navigation.state === "loading") return <DashboardSkeleton />;

  const allOk = dbOk && configHealth.status === "ok";

  return (
    <AppPage
      title="App Health"
      subtitle="System diagnostics for your Customer Insight Analytics installation."
      primaryAction={<Button url="/app/status">Status Dashboard</Button>}
    >
      <BlockStack gap="500">
        {!allOk ? (
          <Banner tone="warning" title="Configuration issues detected">
            <p>Some checks failed. See details below.</p>
          </Banner>
        ) : (
          <Banner tone="success" title="All systems operational">
            <p>App is connected and running correctly.</p>
          </Banner>
        )}

        {/* Summary */}
        <div className="cia-metric-strip">
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">Service</div>
            <Text as="p" variant="bodyMd" fontWeight="semibold">{health.service}</Text>
          </div>
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">Status</div>
            <Text as="p" variant="bodyMd" fontWeight="semibold">{health.status.toUpperCase()}</Text>
          </div>
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">DB Latency</div>
            <Text as="p" variant="bodyMd" fontWeight="semibold">{dbOk ? `${dbLatencyMs}ms` : "—"}</Text>
          </div>
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">Plan</div>
            <Text as="p" variant="bodyMd" fontWeight="semibold">{plan}</Text>
          </div>
        </div>

        {/* Connectivity checks */}
        <Card>
          <BlockStack gap="300">
            <SectionHeader title="Connectivity" description="Core infrastructure status." />
            <BlockStack gap="150">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="p" variant="bodyMd">Database</Text>
                <InlineStack gap="200" blockAlign="center">
                  {dbOk ? <Text as="span" variant="bodySm" tone="subdued">{dbLatencyMs}ms</Text> : null}
                  <StatusDot ok={dbOk} />
                </InlineStack>
              </InlineStack>
              <Divider />
              <InlineStack align="space-between" blockAlign="center">
                <Text as="p" variant="bodyMd">Shopify Session</Text>
                <StatusDot ok={true} />
              </InlineStack>
              <Divider />
              <InlineStack align="space-between" blockAlign="center">
                <Text as="p" variant="bodyMd">Config Health</Text>
                <StatusDot ok={configHealth.status === "ok"} />
              </InlineStack>
            </BlockStack>
          </BlockStack>
        </Card>

        {/* Config checks */}
        {configHealth.missing.length > 0 ? (
          <Card>
            <BlockStack gap="300">
              <SectionHeader title="Missing Configuration" description="These environment variables are required but not set." />
              <BlockStack gap="100">
                {configHealth.missing.map((key) => (
                  <InlineStack key={key} gap="200" blockAlign="center">
                    <Badge tone="critical">Missing</Badge>
                    <Text as="p" variant="bodyMd">{key}</Text>
                  </InlineStack>
                ))}
              </BlockStack>
            </BlockStack>
          </Card>
        ) : null}

        {/* Data summary */}
        <Card>
          <BlockStack gap="300">
            <SectionHeader title="Store Data" description="Records in your shop database." />
            <BlockStack gap="150">
              <InlineStack align="space-between">
                <Text as="p" variant="bodyMd">Shop Domain</Text>
                <Text as="p" variant="bodyMd" tone="subdued">{shopDomain}</Text>
              </InlineStack>
              <Divider />
              <InlineStack align="space-between">
                <Text as="p" variant="bodyMd">Analysis Runs</Text>
                <Text as="p" variant="bodyMd" fontWeight="semibold">{insightRunCount}</Text>
              </InlineStack>
              <Divider />
              <InlineStack align="space-between">
                <Text as="p" variant="bodyMd">Messages Imported</Text>
                <Text as="p" variant="bodyMd" fontWeight="semibold">{messageCount}</Text>
              </InlineStack>
            </BlockStack>
          </BlockStack>
        </Card>

        <Text as="p" variant="bodySm" tone="subdued">
          Last checked: {new Date(checkedAt).toLocaleString()}
        </Text>
      </BlockStack>
    </AppPage>
  );
}
