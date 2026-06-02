import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  InlineGrid,
  InlineStack,
  Text,
  TextField,
} from "@shopify/polaris";
import { useState } from "react";

import prisma from "~/db.server";
import { ensureShop, getLatestRun, parseRun } from "~/lib/shop.server";
import { EMPTY_INSIGHT } from "~/lib/types";
import { authenticate } from "~/shopify.server";
import { AppPage, ListSkeleton, SectionHeader } from "~/components";
import { getDelegate } from "~/lib/prisma-safe";
import {
  buildCopilotResponse,
  detectTopic,
  TOPIC_LABELS,
  QUICK_PROMPTS,
  type CopilotResponse,
} from "~/lib/copilot";
import { canUseAIProductOptimize } from "~/lib/billing/plan-limits";
import type { PlanId } from "~/lib/billing";
import { sanitizeCopilotInput } from "~/lib/sanitize";
import { logUsage } from "~/lib/log-usage.server";

async function getCtx(request: Request) {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(prisma, session.shop);
  return { shop, session };
}

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { shop } = await getCtx(request);
    const insight = parseRun(await getLatestRun(prisma, shop.id)) ?? EMPTY_INSIGHT;
    const gate = canUseAIProductOptimize(shop.plan as PlanId);

    const copilotMessage = getDelegate(prisma, "copilotMessage");
    const recentMessages = copilotMessage?.findMany
      ? await copilotMessage.findMany({
          where: { shopId: shop.id },
          orderBy: { createdAt: "desc" },
          take: 20,
        })
      : [];

    return json({
      insight,
      recentMessages,
      canUseCopilot: gate.allowed,
      gateReason: gate.reason ?? null,
      loadError: null,
    });
  } catch (error) {
    console.error("Copilot loader failed", error);
    return json({
      insight: EMPTY_INSIGHT,
      recentMessages: [],
      canUseCopilot: false,
      gateReason: "Could not load copilot data.",
      loadError: "Could not load copilot. Try refreshing.",
    });
  }
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { shop, session } = await getCtx(request);
    const form = await request.formData();
    const question = String(form.get("question") ?? "").trim();
    const sessionRef = String(form.get("sessionRef") ?? "");

    if (!question) {
      return json({ error: "Please enter a question.", response: null });
    }

    const { clean, flagged } = sanitizeCopilotInput(question, 500);
    if (flagged) {
      return json({ error: "Your question contains content that cannot be processed. Please rephrase and try again.", response: null });
    }

    const insight = parseRun(await getLatestRun(prisma, shop.id)) ?? EMPTY_INSIGHT;
    const response = buildCopilotResponse({
      question: clean,
      insight,
      shopDomain: session.shop,
    });

    // Log the Q&A to DB
    const copilotMessage = getDelegate(prisma, "copilotMessage");
    if (copilotMessage?.create) {
      await copilotMessage.create({
        data: {
          shopId: shop.id,
          role: "user",
          content: clean,
          sessionRef: sessionRef || null,
          topic: response.topic,
          confidence: response.confidence,
        },
      });
      await copilotMessage.create({
        data: {
          shopId: shop.id,
          role: "assistant",
          content: response.body,
          sessionRef: sessionRef || null,
          topic: response.topic,
          confidence: response.confidence,
        },
      });
    }

    await logUsage(prisma, shop.id, "copilot_used", { topic: response.topic, confidence: response.confidence });

    return json({ error: null, response });
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("Copilot action failed", error);
    return json({ error: "Copilot failed. Try again.", response: null });
  }
}

const TOPIC_TONE: Record<string, "success" | "info" | "warning" | "critical"> = {
  revenue: "success",
  competitors: "warning",
  shipping: "info",
  returns: "info",
  faq: "info",
  content: "info",
  products: "info",
  analytics: "info",
  general: "info",
};

export default function CopilotPage() {
  const { insight, recentMessages, canUseCopilot, gateReason, loadError } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [question, setQuestion] = useState("");
  const [sessionRef] = useState(() => `s_${Math.random().toString(36).slice(2, 10)}`);

  if (navigation.state === "loading") return <ListSkeleton />;
  const isAsking = navigation.state === "submitting";
  const response = actionData?.response as CopilotResponse | null | undefined;

  return (
    <AppPage
      title="AI Revenue Copilot"
      subtitle="Ask questions about your store's revenue recovery opportunities. Get instant, data-driven recommendations."
      primaryAction={<Button url="/app/insights">View Insights</Button>}
    >
      <BlockStack gap="500">
        {loadError ? (
          <Banner tone="critical" title="Load error"><p>{loadError}</p></Banner>
        ) : null}

        {!canUseCopilot ? (
          <Banner tone="warning" title="Growth or Pro plan required">
            <p>{gateReason} <a href="/app/billing">Upgrade →</a></p>
          </Banner>
        ) : null}

        <div className="cia-metric-strip">
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">Insight Score</div>
            <Text as="p" variant="headingLg">{insight.insightScore}/100</Text>
          </div>
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">Messages Analyzed</div>
            <Text as="p" variant="headingLg">{insight.messageCount}</Text>
          </div>
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">Opportunities</div>
            <Text as="p" variant="headingLg">{insight.storewideOpportunities.length}</Text>
          </div>
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">Sessions Logged</div>
            <Text as="p" variant="headingLg">{recentMessages.length}</Text>
          </div>
        </div>

        {/* Quick prompts */}
        <Card>
          <BlockStack gap="300">
            <SectionHeader
              title="Quick Prompts"
              description="Tap a prompt to get instant revenue recovery advice based on your store data."
            />
            <InlineGrid columns={{ xs: 2, sm: 3 }} gap="200">
              {QUICK_PROMPTS.map((p) => (
                <Form key={p.topic} method="post">
                  <input type="hidden" name="question" value={p.question} />
                  <input type="hidden" name="sessionRef" value={sessionRef} />
                  <Button submit disabled={!canUseCopilot || isAsking} fullWidth>
                    {p.label}
                  </Button>
                </Form>
              ))}
            </InlineGrid>
          </BlockStack>
        </Card>

        {/* Ask anything */}
        <Card>
          <BlockStack gap="300">
            <SectionHeader
              title="Ask the Copilot"
              description="Ask anything about your store's revenue recovery, content gaps, or competitor threats."
            />
            <Form method="post">
              <input type="hidden" name="sessionRef" value={sessionRef} />
              <BlockStack gap="300">
                <TextField
                  label="Your question"
                  name="question"
                  value={question}
                  onChange={setQuestion}
                  placeholder="e.g. What is my biggest revenue leak right now?"
                  multiline={2}
                  autoComplete="off"
                  disabled={!canUseCopilot}
                />
                <Button
                  submit
                  variant="primary"
                  loading={isAsking}
                  disabled={!canUseCopilot || !question.trim()}
                >
                  {isAsking ? "Thinking…" : "Ask Copilot"}
                </Button>
              </BlockStack>
            </Form>
          </BlockStack>
        </Card>

        {/* Response */}
        {actionData?.error ? (
          <Banner tone="critical" title="Error">
            <p>{actionData.error}</p>
          </Banner>
        ) : null}

        {response ? (
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center" wrap={false} gap="200">
                <Text as="h2" variant="headingMd">{response.headline}</Text>
                <InlineStack gap="200">
                  <Badge tone={TOPIC_TONE[response.topic] ?? "info"}>
                    {TOPIC_LABELS[response.topic]}
                  </Badge>
                  <Badge tone={response.confidence >= 80 ? "success" : "info"}>
                    {`${response.confidence}% confidence`}
                  </Badge>
                </InlineStack>
              </InlineStack>

              <Text as="p" variant="bodyMd">{response.body}</Text>

              {response.bulletPoints.length > 0 ? (
                <BlockStack gap="150">
                  <Text as="p" variant="bodySm" fontWeight="semibold">Key actions:</Text>
                  <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
                    {response.bulletPoints.map((bp, i) => (
                      <li key={i}><Text as="p" variant="bodyMd">{bp}</Text></li>
                    ))}
                  </ul>
                </BlockStack>
              ) : null}

              {response.dataPoints.length > 0 ? (
                <div className="cia-metric-strip">
                  {response.dataPoints.map((dp) => (
                    <div key={dp.label} className="cia-muted-panel">
                      <div className="cia-eyebrow">{dp.label}</div>
                      <Text as="p" variant="bodyMd" fontWeight="semibold">{dp.value}</Text>
                    </div>
                  ))}
                </div>
              ) : null}

              {response.actions.length > 0 ? (
                <InlineStack gap="200">
                  {response.actions.map((a) => (
                    <Button
                      key={a.url}
                      url={a.url}
                      variant={a.priority === "high" ? "primary" : "secondary"}
                    >
                      {a.label}
                    </Button>
                  ))}
                </InlineStack>
              ) : null}
            </BlockStack>
          </Card>
        ) : null}
      </BlockStack>
    </AppPage>
  );
}
