// Merchant onboarding checklist — pure logic, no DB access.
// Routes provide the booleans by querying counts; this file builds the checklist.

export type OnboardingStepId =
  | "install_complete"
  | "billing_setup"
  | "first_analysis"
  | "first_opportunity"
  | "first_faq"
  | "first_publish"
  | "first_bulk_job"
  | "competitor_review";

export interface OnboardingStep {
  id: OnboardingStepId;
  title: string;
  description: string;
  actionLabel: string;
  actionUrl: string;
  completed: boolean;
  required: boolean;
  order: number;
}

export interface OnboardingChecklist {
  steps: OnboardingStep[];
  completedCount: number;
  totalCount: number;
  requiredCompleted: number;
  requiredTotal: number;
  progress: number; // 0-100 based on all steps
  isComplete: boolean; // all required steps done
  nextStep: OnboardingStep | null;
}

export interface OnboardingInput {
  hasRunInsight: boolean;
  hasOpportunity: boolean;
  hasFaq: boolean;
  hasPublished: boolean;
  hasBulkJob: boolean;
  hasBilling: boolean;
  hasCompetitor: boolean;
}

const STEP_DEFS: Array<Omit<OnboardingStep, "completed">> = [
  {
    id: "install_complete",
    title: "App Installed",
    description: "The app is installed and connected to your Shopify store.",
    actionLabel: "View Dashboard",
    actionUrl: "/app",
    required: true,
    order: 1,
  },
  {
    id: "billing_setup",
    title: "Choose a Plan",
    description: "Select a plan to unlock revenue recovery features.",
    actionLabel: "View Plans",
    actionUrl: "/app/billing",
    required: true,
    order: 2,
  },
  {
    id: "first_analysis",
    title: "Run Your First Analysis",
    description: "Analyze customer messages to uncover revenue opportunities.",
    actionLabel: "Run Analysis",
    actionUrl: "/app/insights",
    required: true,
    order: 3,
  },
  {
    id: "first_opportunity",
    title: "Review Top Opportunity",
    description: "See your biggest revenue leak and the recommended action.",
    actionLabel: "View Opportunities",
    actionUrl: "/app/insights",
    required: true,
    order: 4,
  },
  {
    id: "first_faq",
    title: "Generate Your First FAQ",
    description: "Create AI-powered FAQs to reduce customer friction.",
    actionLabel: "Generate FAQ",
    actionUrl: "/app/faq",
    required: false,
    order: 5,
  },
  {
    id: "first_publish",
    title: "Publish Content to Your Store",
    description: "Push your first FAQ or page live on Shopify.",
    actionLabel: "Publish Content",
    actionUrl: "/app/publish",
    required: false,
    order: 6,
  },
  {
    id: "first_bulk_job",
    title: "Run a Bulk Operation",
    description: "Optimize multiple products or FAQs at once.",
    actionLabel: "Bulk Optimize",
    actionUrl: "/app/bulk",
    required: false,
    order: 7,
  },
  {
    id: "competitor_review",
    title: "Review Competitor Intelligence",
    description: "See which competitors are mentioned and how to respond.",
    actionLabel: "View Competitors",
    actionUrl: "/app/competitors",
    required: false,
    order: 8,
  },
];

function resolveCompleted(id: OnboardingStepId, input: OnboardingInput): boolean {
  switch (id) {
    case "install_complete":   return true;
    case "billing_setup":      return input.hasBilling;
    case "first_analysis":     return input.hasRunInsight;
    case "first_opportunity":  return input.hasOpportunity;
    case "first_faq":          return input.hasFaq;
    case "first_publish":      return input.hasPublished;
    case "first_bulk_job":     return input.hasBulkJob;
    case "competitor_review":  return input.hasCompetitor;
  }
}

export function buildOnboardingChecklist(input: OnboardingInput): OnboardingChecklist {
  const steps: OnboardingStep[] = STEP_DEFS.map((def) => ({
    ...def,
    completed: resolveCompleted(def.id, input),
  }));

  const completedCount = steps.filter((s) => s.completed).length;
  const totalCount = steps.length;
  const requiredSteps = steps.filter((s) => s.required);
  const requiredCompleted = requiredSteps.filter((s) => s.completed).length;
  const requiredTotal = requiredSteps.length;
  const progress = Math.round((completedCount / totalCount) * 100);
  const isComplete = requiredSteps.every((s) => s.completed);
  const nextStep = steps.find((s) => !s.completed) ?? null;

  return {
    steps,
    completedCount,
    totalCount,
    requiredCompleted,
    requiredTotal,
    progress,
    isComplete,
    nextStep,
  };
}

/** True when the merchant has never run an analysis, generated a FAQ, or published. */
export function isFirstRun(input: OnboardingInput): boolean {
  return !input.hasRunInsight && !input.hasFaq && !input.hasPublished;
}

export const STEP_LABELS: Record<OnboardingStepId, string> = Object.fromEntries(
  STEP_DEFS.map((s) => [s.id, s.title]),
) as Record<OnboardingStepId, string>;
