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
import { getDelegate } from "~/lib/prisma-safe";
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
    prisma.publishedContent.count({ where: { shopId, status: "published" } }),
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
    console.error("Onboarding loader failed", error);
    return json({
      checklist: null,
      firstRun: false,
      loadError: "Could not load onboarding data. Try refreshing.",
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
      <AppPage title="Getting Started" subtitle="Set up your Revenue Recovery Platform.">
        {loadError ? <Banner tone="critical" title="Error"><p>{loadError}</p></Banner> : null}
      </AppPage>
    );
  }

  return (
    <AppPage
      title={firstRun ? "Welcome to Revenue Recovery" : "Setup Checklist"}
      subtitle={
        firstRun
          ? "Let's set up your store for maximum revenue recovery. Follow the steps below."
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
          <Banner tone="success" title="Setup complete!">
            <p>All required steps are done. Your store is ready for revenue recovery.</p>
          </Banner>
        ) : firstRun ? (
          <Banner tone="info" title="Start here">
            <p>Follow these steps to unlock the full power of Customer Insight Analytics.</p>
          </Banner>
        ) : null}

        {/* Progress */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <SectionHeader
                title="Overall Progress"
                description={`${checklist.requiredCompleted} / ${checklist.requiredTotal} required steps complete`}
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
            <SectionHeader title="Setup Steps" description="Complete each step to unlock the full platform." />
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
