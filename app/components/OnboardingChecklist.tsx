import { Link } from "@remix-run/react";
import {
  BlockStack,
  Box,
  Card,
  InlineStack,
  ProgressBar,
  Text,
} from "@shopify/polaris";
import type { ReactNode } from "react";

export interface OnboardingStep {
  title: string;
  description: string;
  completed: boolean;
  /** Optional inline action node (e.g. a <Form> with a submit Button). */
  action?: ReactNode;
  actionLabel?: string;
  actionUrl?: string;
}

export interface OnboardingChecklistProps {
  title?: string;
  steps: OnboardingStep[];
}

/** A 3-step "get started" checklist with progress, like top App Store apps. */
export function OnboardingChecklist({
  title = "Get started in 3 steps",
  steps,
}: OnboardingChecklistProps) {
  const done = steps.filter((s) => s.completed).length;
  const progress = steps.length ? Math.round((done / steps.length) * 100) : 0;

  return (
    <Card>
      <BlockStack gap="400">
        <BlockStack gap="200">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingMd">
              {title}
            </Text>
            <Text as="span" variant="bodySm" tone="subdued">
              {`${done} of ${steps.length} complete`}
            </Text>
          </InlineStack>
          <ProgressBar progress={progress} tone="primary" size="small" />
        </BlockStack>

        <BlockStack gap="300">
          {steps.map((step, index) => (
            <Box
              key={step.title}
              padding="300"
              borderRadius="200"
              borderColor="border"
              borderWidth="025"
              background={step.completed ? "bg-surface-success" : "bg-surface"}
            >
              <InlineStack align="space-between" blockAlign="center" wrap={false} gap="300">
                <InlineStack gap="300" blockAlign="center" wrap={false}>
                  <Box
                    background={step.completed ? "bg-fill-success" : "bg-fill-secondary"}
                    borderRadius="full"
                    minHeight="28px"
                    minWidth="28px"
                  >
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Text
                        as="span"
                        variant="headingSm"
                        tone={step.completed ? "text-inverse" : "subdued"}
                      >
                        {step.completed ? "✓" : String(index + 1)}
                      </Text>
                    </div>
                  </Box>
                  <BlockStack gap="050">
                    <Text as="h3" variant="headingSm">
                      {step.title}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {step.description}
                    </Text>
                  </BlockStack>
                </InlineStack>
                <Box>
                  {step.action
                    ? step.action
                    : step.actionLabel && step.actionUrl
                      ? <Link to={step.actionUrl}>{step.actionLabel}</Link>
                      : null}
                </Box>
              </InlineStack>
            </Box>
          ))}
        </BlockStack>
      </BlockStack>
    </Card>
  );
}
