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
  TextField,
} from "@shopify/polaris";
import { useState } from "react";

import prisma from "~/db.server";
import { ensureShop } from "~/lib/shop.server";
import { authenticate } from "~/shopify.server";
import { AppPage, EmptyStateCard, ListSkeleton, SectionHeader, formatNumber, moneyRange } from "~/components";
import { getDelegate } from "~/lib/prisma-safe";
import {
  buildRevenueTimelineSummary,
  EVENT_TYPE_LABELS,
  EVENT_TYPE_ICONS,
  type RawRevenueEvent,
  type RevenueEventType,
} from "~/lib/revenue-timeline";
import { PLANS } from "~/lib/billing";
import type { PlanId } from "~/lib/billing";

async function getCtx(request: Request) {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(prisma, session.shop);
  return { shop, session };
}

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { shop } = await getCtx(request);
    const revenueEvent = getDelegate(prisma, "revenueEvent");
    const rawEvents = revenueEvent?.findMany
      ? await revenueEvent.findMany({
          where: { shopId: shop.id },
          orderBy: { occurredAt: "desc" },
          take: 500,
        })
      : [];

    // Synthetic events from published content (safe: table may not exist yet)
    const publishedDelegate = getDelegate(prisma, "publishedContent");
    const publishedContent = publishedDelegate?.findMany
      ? await publishedDelegate.findMany({
          where: { shopId: shop.id, status: "published" },
          orderBy: { publishedAt: "desc" },
          take: 100,
        })
      : [];

    const syntheticEvents: RawRevenueEvent[] = (publishedContent as Array<{ id: string; contentType: string; resourceTitle: string; publishedAt: Date | string }>).map((pc) => ({
      id: pc.id,
      eventType: "content_published" as RevenueEventType,
      description: `Published ${pc.contentType.replace(/_/g, " ")}: ${pc.resourceTitle}`,
      refId: pc.id,
      refType: "published_content",
      lowEstimate: 50,
      highEstimate: 150,
      actualValue: null,
      occurredAt: pc.publishedAt,
    }));

    const allEvents: RawRevenueEvent[] = [
      ...(rawEvents as Array<{
        id: string;
        eventType: string;
        description: string;
        refId?: string | null;
        refType?: string | null;
        lowEstimate: number;
        highEstimate: number;
        actualValue?: number | null;
        occurredAt: Date | string;
      }>).map((e) => ({
        id: e.id,
        eventType: e.eventType as RevenueEventType,
        description: e.description,
        refId: e.refId ?? null,
        refType: e.refType ?? null,
        lowEstimate: e.lowEstimate,
        highEstimate: e.highEstimate,
        actualValue: e.actualValue ?? null,
        occurredAt: e.occurredAt,
      })),
      ...syntheticEvents,
    ].sort(
      (a, b) =>
        new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
    );

    const canRoi = PLANS[shop.plan as PlanId]?.features.revenueOpportunity ?? false;
    const summary = buildRevenueTimelineSummary(allEvents);

    return json({ events: allEvents, summary, canRoi, loadError: null });
  } catch (error) {
    console.error("ROI loader failed", error);
    return json({
      events: [],
      summary: {
        totalLow: 0, totalHigh: 0, totalActual: 0, eventCount: 0,
        topEventType: null, milestones: [], timeline: [],
      },
      canRoi: false,
      loadError: "Could not load revenue timeline. Try refreshing.",
    });
  }
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { shop } = await getCtx(request);
    const form = await request.formData();
    const intent = String(form.get("intent") ?? "");

    if (intent === "add-manual-event") {
      const description = String(form.get("description") ?? "").trim();
      const lowEstimate = Number(form.get("lowEstimate") ?? "0");
      const highEstimate = Number(form.get("highEstimate") ?? "0");

      if (!description) {
        return json({ error: "Description is required." }, { status: 400 });
      }

      const revenueEvent = getDelegate(prisma, "revenueEvent");
      if (revenueEvent?.create) {
        await revenueEvent.create({
          data: {
            shopId: shop.id,
            eventType: "manual",
            description,
            lowEstimate: Math.max(0, lowEstimate),
            highEstimate: Math.max(0, highEstimate),
          },
        });
      }
      return redirect("/app/roi");
    }

    return redirect("/app/roi");
  } catch (error) {
    if (error instanceof Response) throw error;
    return json({ error: "Action failed." }, { status: 500 });
  }
}

const EVENT_TYPE_OPTIONS = [
  { label: "All types", value: "" },
  ...Object.entries(EVENT_TYPE_LABELS).map(([value, label]) => ({ value, label })),
];

const EVENT_TONE: Record<string, "success" | "info" | "warning"> = {
  content_published: "success",
  faq_created: "success",
  insight_run: "info",
  competitor_resolved: "success",
  bulk_job: "info",
  manual: "warning",
};

export default function RoiPage() {
  const { events, summary, canRoi, loadError } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [filterType, setFilterType] = useState("");
  const [description, setDescription] = useState("");
  const [lowEst, setLowEst] = useState("");
  const [highEst, setHighEst] = useState("");

  if (navigation.state === "loading") return <ListSkeleton />;
  const isSubmitting = navigation.state === "submitting";

  const filteredEvents = filterType
    ? (events as RawRevenueEvent[]).filter((e) => e.eventType === filterType)
    : (events as RawRevenueEvent[]);

  return (
    <AppPage
      title="Revenue Timeline"
      subtitle="Track every content action and its estimated revenue recovery over time."
      primaryAction={<Button url="/app/insights">View Opportunities</Button>}
    >
      <BlockStack gap="500">
        {loadError ? <Banner tone="critical" title="Load error"><p>{loadError}</p></Banner> : null}
        {actionData && "error" in actionData ? (
          <Banner tone="critical" title="Error"><p>{actionData.error}</p></Banner>
        ) : null}

        {!canRoi ? (
          <Banner tone="warning" title="Starter plan required">
            <p>Revenue timeline requires Starter plan or higher. <a href="/app/billing">Upgrade →</a></p>
          </Banner>
        ) : null}

        <div className="cia-metric-strip">
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">Est. Recovered (Low)</div>
            <Text as="p" variant="headingLg">${formatNumber(summary.totalLow)}</Text>
          </div>
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">Est. Recovered (High)</div>
            <Text as="p" variant="headingLg">${formatNumber(summary.totalHigh)}</Text>
          </div>
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">Confirmed Actual</div>
            <Text as="p" variant="headingLg">${formatNumber(summary.totalActual)}</Text>
          </div>
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">Total Events</div>
            <Text as="p" variant="headingLg">{formatNumber(summary.eventCount)}</Text>
          </div>
        </div>

        {/* Milestones */}
        {summary.milestones.length > 0 ? (
          <Card>
            <BlockStack gap="300">
              <SectionHeader title="Milestones" description="Key achievements in your revenue recovery journey." />
              <InlineStack gap="200" wrap>
                {(summary.milestones as Array<{ label: string; date: string; value: number }>).filter(Boolean).map((m, i) => (
                  <Badge key={i} tone="success">{m.label}</Badge>
                ))}
              </InlineStack>
            </BlockStack>
          </Card>
        ) : null}

        {/* Add manual event */}
        <Card>
          <BlockStack gap="300">
            <SectionHeader
              title="Add Manual Recovery Event"
              description="Record a confirmed revenue recovery or offline action."
            />
            <Form method="post">
              <input type="hidden" name="intent" value="add-manual-event" />
              <BlockStack gap="300">
                <TextField
                  label="Description"
                  name="description"
                  value={description}
                  onChange={setDescription}
                  placeholder="e.g. Fixed shipping FAQ — 3 new orders confirmed"
                  autoComplete="off"
                />
                <InlineStack gap="300" wrap={false}>
                  <TextField
                    label="Est. Revenue (Low)"
                    name="lowEstimate"
                    type="number"
                    value={lowEst}
                    onChange={setLowEst}
                    prefix="$"
                    autoComplete="off"
                  />
                  <TextField
                    label="Est. Revenue (High)"
                    name="highEstimate"
                    type="number"
                    value={highEst}
                    onChange={setHighEst}
                    prefix="$"
                    autoComplete="off"
                  />
                </InlineStack>
                <Button submit loading={isSubmitting} disabled={!description.trim()}>
                  Add Recovery Event
                </Button>
              </BlockStack>
            </Form>
          </BlockStack>
        </Card>

        {/* Timeline events list */}
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center" wrap={false} gap="200">
            <SectionHeader title="Recovery Events" description={`${filteredEvents.length} event${filteredEvents.length === 1 ? "" : "s"}`} />
            <div style={{ minWidth: "200px" }}>
              <Select
                label="Filter by type"
                options={EVENT_TYPE_OPTIONS}
                value={filterType}
                onChange={setFilterType}
                labelInline
              />
            </div>
          </InlineStack>

          {filteredEvents.length === 0 ? (
            <EmptyStateCard
              title="No events yet"
              body="Publish content, create FAQs, or run analyses to track your recovery events."
              actionLabel="Publish Content"
              actionUrl="/app/publish"
            />
          ) : (
            <Card>
              <BlockStack gap="200">
                {filteredEvents.slice(0, 50).map((event, idx) => (
                  <BlockStack key={event.id} gap="100">
                    {idx > 0 ? <Divider /> : null}
                    <InlineStack align="space-between" blockAlign="center" wrap={false} gap="200">
                      <BlockStack gap="050">
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="span" variant="bodyMd">
                            {EVENT_TYPE_ICONS[event.eventType as RevenueEventType] ?? "•"}
                          </Text>
                          <Text as="p" variant="bodyMd" fontWeight="semibold">{event.description}</Text>
                          <Badge tone={EVENT_TONE[event.eventType] ?? "info"}>
                            {EVENT_TYPE_LABELS[event.eventType as RevenueEventType] ?? event.eventType}
                          </Badge>
                        </InlineStack>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {`Est. $${event.lowEstimate}–$${event.highEstimate}`}
                          {event.actualValue != null ? ` · Actual: $${event.actualValue}` : ""}
                        </Text>
                      </BlockStack>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {new Date(event.occurredAt).toLocaleDateString()}
                      </Text>
                    </InlineStack>
                  </BlockStack>
                ))}
              </BlockStack>
            </Card>
          )}
        </BlockStack>
      </BlockStack>
    </AppPage>
  );
}
