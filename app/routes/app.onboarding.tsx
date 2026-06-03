import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  Divider,
  InlineStack,
  ProgressBar,
  Text,
} from "@shopify/polaris";

import prisma from "~/db.server";
import { ensureShop, getLatestRun, parseRun } from "~/lib/shop.server";
import { authenticate } from "~/shopify.server";
import { AppPage, DashboardSkeleton, SectionHeader } from "~/components";
import { getDelegate, safeCount } from "~/lib/prisma-safe";
import {
  buildOnboardingChecklist,
  isFirstRun,
  type OnboardingInput,
} from "~/lib/onboarding";
import { PLANS } from "~/lib/billing";
import type { PlanId } from "~/lib/billing";

async function getCtx(request: Request) {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(prisma, session.shop);
  return { shop, session };
}

async function buildInput(shopId: string, plan: string): Promise<OnboardingInput> {
  const [insightCount, faqCount, publishedCount, competitorCount] = await Promise.all([
    prisma.insightRun.count({ where: { shopId, status: "completed" } }),
    prisma.generatedFaq.count({ where: { shopId } }),
    safeCount(prisma, "publishedContent", { where: { shopId, status: "published" } }),
    prisma.competitor.count({ where: { shopId } }),
  ]);

  const bulkJob = getDelegate(prisma, "bulkJob");
  const bulkCount = bulkJob?.count
    ? await bulkJob.count({ where: { shopId, status: "completed" } })
    : 0;

  const latestRun = await getLatestRun(prisma, shopId);
  const insight = parseRun(latestRun);

  return {
    hasRunInsight: insightCount > 0,
    hasOpportunity: (insight?.storewideOpportunities.length ?? 0) > 0,
    hasFaq: faqCount > 0,
    hasPublished: publishedCount > 0,
    hasBulkJob: bulkCount > 0,
    hasBilling: plan !== "free",
    hasCompetitor: competitorCount > 0,
  };
}

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { shop } = await getCtx(request);
    const input = await buildInput(shop.id, shop.plan);
    const checklist = buildOnboardingChecklist(input);
    const firstRun = isFirstRun(input);

    return json({ checklist, firstRun, loadError: null });
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("Onboarding loader failed", error);
    return json({
      checklist: null,
      firstRun: true,
      loadError: null,
    });
  }
}

export async function action({ request }: ActionFunctionArgs) {
  await getCtx(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  if (intent === "complete") return redirect("/app");
  return redirect("/app/onboarding");
}

export default function OnboardingPage() {
  const { checklist, firstRun, loadError } = useLoaderData<typeof loader>();
  const navigation = useNavigation();

  if (navigation.state === "loading") return <DashboardSkeleton />;

  if (!checklist) {
    return (
      <AppPage
        title="Getting Started"
        subtitle="Let's connect your store data to begin finding revenue opportunities."
        primaryAction={<Button url="/app/import" variant="primary">Import Store Data</Button>}
      >
        <BlockStack gap="400">
          <Card>
            <BlockStack gap="300">
              <SectionHeader
                title="4 steps to your first recovered sale"
                description="Follow these steps to start recovering revenue from unanswered customer questions."
              />
              {[
                { step: "1", title: "Import Your Data", desc: "Bring in customer questions, products, and orders.", url: "/app/import", label: "Import data" },
                { step: "2", title: "Analyze Buying Questions", desc: "Run the engine to find what's blocking purchases.", url: "/app/import", label: "Run analysis" },
                { step: "3", title: "Generate Recovery Content", desc: "Create FAQ answers for your highest-value objections.", url: "/app/faq", label: "Generate FAQs" },
                { step: "4", title: "Publish to Your Store", desc: "Push FAQ pages and blog articles live on Shopify.", url: "/app/publish", label: "Publish content" },
              ].map((item, idx) => (
                <BlockStack key={item.step} gap="100">
                  {idx > 0 ? <Divider /> : null}
                  <InlineStack align="space-between" blockAlign="center" gap="300" wrap={false}>
                    <BlockStack gap="050">
                      <Text as="p" variant="bodyMd" fontWeight="semibold">{`Step ${item.step} — ${item.title}`}</Text>
                      <Text as="p" variant="bodySm" tone="subdued">{item.desc}</Text>
                    </BlockStack>
                    <Button url={item.url} size="slim">{item.label}</Button>
                  </InlineStack>
                </BlockStack>
              ))}
            </BlockStack>
          </Card>
        </BlockStack>
      </AppPage>
    );
  }

  return (
    <AppPage
      title={firstRun ? "Let's Recover Your First Sale" : "Setup Progress"}
      subtitle={
        firstRun
          ? "Let's connect your store data to begin finding the questions costing you revenue."
          : `You've completed ${checklist.completedCount} of ${checklist.totalCount} setup steps.`
      }
      primaryAction={
        checklist.isComplete ? (
          <Form method="post">
            <input type="hidden" name="intent" value="complete" />
            <Button submit variant="primary">Go to Dashboard</Button>
          </Form>
        ) : checklist.nextStep ? (
          <Button url={checklist.nextStep.actionUrl} variant="primary">
            {checklist.nextStep.actionLabel}
          </Button>
        ) : undefined
      }
    >
      <BlockStack gap="500">
        {loadError ? <Banner tone="critical" title="Error"><p>{loadError}</p></Banner> : null}

        {checklist.isComplete ? (
          <Banner tone="success" title="You're set up — start recovering revenue">
            <p>All required steps are complete. Head to Opportunities to see what to fix first.</p>
          </Banner>
        ) : firstRun ? (
          <Banner tone="info" title="Start here — takes about 10 minutes">
            <p>Complete these steps to find the customer questions costing you sales and generate answers that recover revenue.</p>
          </Banner>
        ) : null}

        {/* Progress */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <SectionHeader
                title="Setup Progress"
                description={`${checklist.requiredCompleted} of ${checklist.requiredTotal} required steps complete`}
              />
              <Text as="p" variant="headingLg">{checklist.progress}%</Text>
            </InlineStack>
            <ProgressBar
              progress={checklist.progress}
              size="large"
              tone={checklist.progress >= 100 ? "success" : "primary"}
            />
          </BlockStack>
        </Card>

        {/* Step list */}
        <Card>
          <BlockStack gap="200">
            <SectionHeader title="Recovery Setup Steps" description="Complete each step to start recovering revenue from unanswered customer questions." />
            {checklist.steps.map((step, idx) => (
              <BlockStack key={step.id} gap="100">
                {idx > 0 ? <Divider /> : null}
                <InlineStack align="space-between" blockAlign="center" gap="300" wrap={false}>
                  <BlockStack gap="050">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="p" variant="bodyMd" fontWeight="semibold">{step.title}</Text>
                      {step.required ? (
                        <Badge tone="info">Required</Badge>
                      ) : (
                        <Badge>Optional</Badge>
                      )}
                      {step.completed ? (
                        <Badge tone="success">Done</Badge>
                      ) : null}
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">{step.description}</Text>
                  </BlockStack>
                  {!step.completed ? (
                    <Button url={step.actionUrl} size="slim">
                      {step.actionLabel}
                    </Button>
                  ) : (
                    <Text as="span" variant="bodyMd">✓</Text>
                  )}
                </InlineStack>
              </BlockStack>
            ))}
          </BlockStack>
        </Card>

        {!firstRun && !checklist.isComplete ? (
          <InlineStack>
            <Form method="post">
              <input type="hidden" name="intent" value="complete" />
              <Button submit variant="plain">Skip onboarding</Button>
            </Form>
          </InlineStack>
        ) : null}
      </BlockStack>
    </AppPage>
  );
}
