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
  InlineGrid,
  InlineStack,
  ProgressBar,
  Select,
  Text,
} from "@shopify/polaris";
import { useState } from "react";

import prisma from "~/db.server";
import { ensureShop, getLatestRun, parseRun } from "~/lib/shop.server";
import { EMPTY_INSIGHT } from "~/lib/types";
import { authenticate } from "~/shopify.server";
import { AppPage, EmptyStateCard, ListSkeleton, SectionHeader, formatNumber } from "~/components";
import { getDelegate } from "~/lib/prisma-safe";
import { logUsage } from "~/lib/log-usage.server";
import {
  BULK_JOB_TYPE_LABELS,
  BULK_FILTER_LABELS,
  applyBulkFilter,
  processBulkJob,
  serializeJobResult,
  type BulkJobType,
  type BulkFilterType,
  type BulkItem,
} from "~/lib/bulk";
import { PLANS } from "~/lib/billing";
import type { PlanId } from "~/lib/billing";

const BATCH_SIZE = 10;

async function getCtx(request: Request) {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(prisma, session.shop);
  return { shop, session };
}

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { shop } = await getCtx(request);
    const insight = parseRun(await getLatestRun(prisma, shop.id)) ?? EMPTY_INSIGHT;
    const bulkJob = getDelegate(prisma, "bulkJob");
    const recentJobs = bulkJob?.findMany
      ? await bulkJob.findMany({
          where: { shopId: shop.id },
          orderBy: { createdAt: "desc" },
          take: 20,
        })
      : [];

    const canBulk = PLANS[shop.plan as PlanId]?.features.bulkPublishing ?? false;

    const availableItems: BulkItem[] = [
      ...insight.storewideOpportunities.map((o) => ({
        itemId: o.groupId,
        itemType: "opportunity" as const,
        label: `${o.label} (${o.severity})`,
      })),
      ...insight.questionOpportunities.map((o) => ({
        itemId: `product_${o.groupId}`,
        itemType: "opportunity" as const,
        label: `${o.label} — ${o.severity}`,
      })),
      ...insight.contentGaps.map((g) => ({
        itemId: `product_${g.productId ?? g.productTitle}`,
        itemType: "product" as const,
        label: g.productTitle,
      })),
      ...insight.competitors.map((c) => ({
        itemId: `competitor_${c.name}`,
        itemType: "opportunity" as const,
        label: `Competitor: ${c.name}`,
      })),
    ];

    return json({ recentJobs, availableItems, canBulk, loadError: null });
  } catch (error) {
    console.error("Bulk loader failed", error);
    return json({ recentJobs: [], availableItems: [], canBulk: false, loadError: "Could not load bulk jobs. Try refreshing." });
  }
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { shop } = await getCtx(request);
    const form = await request.formData();
    const intent = String(form.get("intent") ?? "");
    const jobType = String(form.get("jobType") ?? "generate") as BulkJobType;
    const filterType = (form.get("filterType") as BulkFilterType | null) ?? undefined;

    if (!PLANS[shop.plan as PlanId]?.features.bulkPublishing) {
      return json({ error: "Bulk actions require the Pro plan. Upgrade at /app/billing." }, { status: 403 });
    }

    if (intent === "start-bulk") {
      const insight = parseRun(await getLatestRun(prisma, shop.id)) ?? EMPTY_INSIGHT;
      const allItems: BulkItem[] = [
        ...insight.storewideOpportunities.map((o) => ({
          itemId: o.groupId,
          itemType: "opportunity" as const,
          label: o.label,
        })),
        ...insight.contentGaps.map((g) => ({
          itemId: `product_${g.productId ?? g.productTitle}`,
          itemType: "product" as const,
          label: g.productTitle,
        })),
        ...insight.competitors.map((c) => ({
          itemId: `competitor_${c.name}`,
          itemType: "opportunity" as const,
          label: `Competitor: ${c.name}`,
        })),
      ];

      const filtered = applyBulkFilter(allItems, filterType);

      // Create job record
      const bulkJob = getDelegate(prisma, "bulkJob");
      const bulkJobItem = getDelegate(prisma, "bulkJobItem");

      let jobId: string | null = null;
      if (bulkJob?.create) {
        const job = await bulkJob.create({
          data: {
            shopId: shop.id,
            jobType,
            filterType: filterType ?? null,
            status: "running",
            totalItems: filtered.length,
            startedAt: new Date(),
          },
        });
        jobId = (job as { id: string }).id;

        // Insert item records
        if (bulkJobItem?.create) {
          for (const item of filtered) {
            await bulkJobItem.create({
              data: {
                jobId,
                itemId: item.itemId,
                itemType: item.itemType,
                status: "queued",
              },
            });
          }
        }
      }

      // Simulate processing (in a real app this would be a background job)
      const noop = async (_item: BulkItem) => `processed:${_item.itemId}`;
      const result = await processBulkJob(
        { jobType, filterType, items: allItems, batchSize: BATCH_SIZE },
        noop,
      );

      // Update job status
      if (bulkJob?.update && jobId) {
        await bulkJob.update({
          where: { id: jobId },
          data: {
            status: result.failedItems === result.totalItems && result.totalItems > 0 ? "failed" : "completed",
            processedItems: result.processedItems,
            failedItems: result.failedItems,
            resultJson: serializeJobResult(result),
            completedAt: new Date(),
          },
        });
      }

      await logUsage(prisma, shop.id, "bulk_job_started", { jobType, totalItems: filtered.length });
      return redirect("/app/bulk");
    }

    return redirect("/app/bulk");
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("Bulk action failed", error);
    return json({ error: error instanceof Error ? error.message : "Action failed." }, { status: 500 });
  }
}

const STATUS_TONE: Record<string, "success" | "critical" | "warning" | "info"> = {
  completed: "success",
  failed: "critical",
  running: "warning",
  queued: "info",
};

export default function BulkPage() {
  const { recentJobs, availableItems, canBulk, loadError } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [jobType, setJobType] = useState<string>("generate");
  const [filterType, setFilterType] = useState<string>("");

  if (navigation.state === "loading") return <ListSkeleton />;

  const isSubmitting = navigation.state === "submitting";
  const filteredCount = applyBulkFilter(
    availableItems as BulkItem[],
    (filterType as BulkFilterType) || undefined,
  ).length;

  const jobTypeOptions = Object.entries(BULK_JOB_TYPE_LABELS).map(([value, label]) => ({ value, label }));
  const filterOptions = [
    { value: "", label: "All opportunities" },
    ...Object.entries(BULK_FILTER_LABELS).map(([value, label]) => ({ value, label })),
  ];

  return (
    <AppPage
      title="Bulk Actions"
      subtitle="Process multiple opportunities at once — generate content, publish pages, or mark resolved."
      primaryAction={
        !canBulk ? <Button url="/app/billing" variant="primary">Upgrade to Pro</Button> : undefined
      }
    >
      <BlockStack gap="500">
        {loadError ? <Banner tone="critical" title="Load error"><p>{loadError}</p></Banner> : null}
        {actionData && "error" in actionData ? (
          <Banner tone="critical" title="Action failed"><p>{actionData.error}</p></Banner>
        ) : null}

        {!canBulk ? (
          <Banner tone="warning" title="Pro plan required">
            <p>Bulk actions are available on the Pro plan ($79/mo). Upgrade to process multiple opportunities at once.</p>
          </Banner>
        ) : null}

        <div className="cia-metric-strip">
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">Available Items</div>
            <Text as="p" variant="headingLg">{formatNumber(availableItems.length)}</Text>
          </div>
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">Will Process</div>
            <Text as="p" variant="headingLg">{formatNumber(filteredCount)}</Text>
          </div>
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">Batch Size</div>
            <Text as="p" variant="headingLg">{formatNumber(BATCH_SIZE)}</Text>
          </div>
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">Recent Jobs</div>
            <Text as="p" variant="headingLg">{formatNumber(recentJobs.length)}</Text>
          </div>
        </div>

        <Card>
          <BlockStack gap="400">
            <SectionHeader
              title="Start Bulk Job"
              description="Select a job type and filter, then start processing. Items run in batches of 10 with up to 2 retries."
            />
            <Form method="post">
              <input type="hidden" name="intent" value="start-bulk" />
              <BlockStack gap="300">
                <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                  <BlockStack gap="150">
                    <Select
                      label="Job type"
                      options={jobTypeOptions}
                      value={jobType}
                      onChange={setJobType}
                      disabled={!canBulk}
                    />
                    <input type="hidden" name="jobType" value={jobType} />
                  </BlockStack>
                  <BlockStack gap="150">
                    <Select
                      label="Filter"
                      options={filterOptions}
                      value={filterType}
                      onChange={setFilterType}
                      disabled={!canBulk}
                    />
                    <input type="hidden" name="filterType" value={filterType} />
                  </BlockStack>
                </InlineGrid>
                <Text as="p" variant="bodySm" tone="subdued">
                  {`${formatNumber(filteredCount)} item${filteredCount === 1 ? "" : "s"} will be processed by this job.`}
                </Text>
                <Button
                  submit
                  variant="primary"
                  loading={isSubmitting}
                  disabled={!canBulk || filteredCount === 0}
                >
                  {isSubmitting ? "Starting job…" : `Start Bulk Job (${formatNumber(filteredCount)} items)`}
                </Button>
              </BlockStack>
            </Form>
          </BlockStack>
        </Card>

        {recentJobs.length === 0 ? (
          <EmptyStateCard
            title="No bulk jobs yet"
            body="Start a bulk job above to generate content or publish pages for multiple opportunities at once."
            actionLabel="Start first job"
            actionUrl="/app/bulk"
          />
        ) : (
          <BlockStack gap="300">
            <SectionHeader title="Recent Jobs" description="Last 20 bulk jobs for this store." />
            <Card>
              <BlockStack gap="200">
                {(recentJobs as Array<{
                  id: string;
                  jobType: string;
                  status: string;
                  filterType?: string | null;
                  totalItems: number;
                  processedItems: number;
                  failedItems: number;
                  createdAt: string;
                  completedAt?: string | null;
                }>).map((job, idx) => (
                  <BlockStack key={job.id} gap="150">
                    {idx > 0 ? <Divider /> : null}
                    <InlineStack align="space-between" blockAlign="center" wrap={false} gap="200">
                      <BlockStack gap="050">
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="p" variant="bodyMd" fontWeight="semibold">
                            {BULK_JOB_TYPE_LABELS[job.jobType as BulkJobType] ?? job.jobType}
                          </Text>
                          <Badge tone={STATUS_TONE[job.status] ?? "info"}>{job.status}</Badge>
                          {job.filterType ? (
                            <Badge tone="info">
                              {BULK_FILTER_LABELS[job.filterType as BulkFilterType] ?? job.filterType}
                            </Badge>
                          ) : null}
                        </InlineStack>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {`${formatNumber(job.processedItems)}/${formatNumber(job.totalItems)} completed · ${formatNumber(job.failedItems)} failed`}
                        </Text>
                      </BlockStack>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {new Date(job.createdAt).toLocaleDateString()}
                      </Text>
                    </InlineStack>
                    {job.status === "running" ? (
                      <ProgressBar
                        progress={job.totalItems > 0 ? Math.round((job.processedItems / job.totalItems) * 100) : 0}
                        size="small"
                        tone="primary"
                      />
                    ) : null}
                  </BlockStack>
                ))}
              </BlockStack>
            </Card>
          </BlockStack>
        )}
      </BlockStack>
    </AppPage>
  );
}
