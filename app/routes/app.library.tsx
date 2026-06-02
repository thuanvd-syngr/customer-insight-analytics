import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";
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
import { AppPage, EmptyStateCard, ListSkeleton, SectionHeader, formatNumber } from "~/components";
import { getDelegate } from "~/lib/prisma-safe";
import {
  filterLibraryItems,
  getLibraryStats,
  sortLibraryItems,
  truncateContent,
  parseTags,
  ITEM_TYPE_LABELS,
  SOURCE_LABELS,
  type LibraryItem,
  type ContentLibraryItemType,
} from "~/lib/content-library";
import type { PlanId } from "~/lib/billing";

async function getCtx(request: Request) {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(prisma, session.shop);
  return { shop, session };
}

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { shop } = await getCtx(request);
    const url = new URL(request.url);
    const filterType = (url.searchParams.get("type") as ContentLibraryItemType | null) ?? undefined;
    const filterStatus = (url.searchParams.get("status") as "active" | "archived" | null) ?? undefined;
    const search = url.searchParams.get("q") ?? undefined;

    // Load GeneratedFaqs as library items
    const rawFaqs = await prisma.generatedFaq.findMany({
      where: { shopId: shop.id },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    // Load PublishedContent as library items (safe: table may not exist yet)
    const publishedDelegate = getDelegate(prisma, "publishedContent");
    const rawPublished = publishedDelegate?.findMany
      ? await publishedDelegate.findMany({
          where: { shopId: shop.id },
          orderBy: { publishedAt: "desc" },
          take: 200,
        })
      : [];

    // Load ContentLibraryItems (new model)
    const contentLibraryItem = getDelegate(prisma, "contentLibraryItem");
    const rawCustom = contentLibraryItem?.findMany
      ? await contentLibraryItem.findMany({
          where: { shopId: shop.id },
          orderBy: { createdAt: "desc" },
          take: 200,
        })
      : [];

    // Merge into unified LibraryItem list
    const items: LibraryItem[] = [
      ...rawFaqs.map((faq) => ({
        id: faq.id,
        itemType: "faq" as ContentLibraryItemType,
        title: faq.question,
        content: faq.answerText,
        tags: parseTags(null),
        groupId: faq.groupId,
        productId: faq.productId,
        source: (faq.source === "ai" ? "generated" : "manual") as "generated" | "manual",
        status: (faq.status === "published" ? "active" : "active") as "active" | "archived",
        usageCount: 0,
        createdAt: faq.createdAt.toISOString(),
      })),
      ...(rawPublished as Array<{ id: string; contentType: string; resourceTitle: string; publishedAt: Date | string; status: string }>).map((pc) => ({
        id: pc.id,
        itemType: ("faq_page" === pc.contentType ? "faq" : "page_template") as ContentLibraryItemType,
        title: pc.resourceTitle,
        content: `Published ${pc.contentType.replace(/_/g, " ")} on ${new Date(pc.publishedAt).toLocaleDateString()}`,
        tags: [pc.contentType],
        groupId: null,
        productId: null,
        source: "generated" as const,
        status: (pc.status === "published" ? "active" : "archived") as "active" | "archived",
        usageCount: 0,
        createdAt: new Date(pc.publishedAt).toISOString(),
      })),
      ...(rawCustom as Array<{
        id: string;
        itemType: string;
        title: string;
        content: string;
        tags?: string | null;
        groupId?: string | null;
        productId?: string | null;
        source: string;
        status: string;
        usageCount: number;
        createdAt: string;
      }>).map((c) => ({
        id: c.id,
        itemType: c.itemType as ContentLibraryItemType,
        title: c.title,
        content: c.content,
        tags: parseTags(c.tags),
        groupId: c.groupId,
        productId: c.productId,
        source: c.source as "generated" | "manual" | "imported",
        status: c.status as "active" | "archived",
        usageCount: c.usageCount,
        createdAt: c.createdAt,
      })),
    ];

    const filtered = filterLibraryItems(items, { itemType: filterType, status: filterStatus, search });
    const sorted = sortLibraryItems(filtered, "createdAt", "desc");
    const stats = getLibraryStats(items);

    return json({ items: sorted, stats, loadError: null });
  } catch (error) {
    console.error("Library loader failed", error);
    return json({
      items: [],
      stats: { total: 0, active: 0, archived: 0, byType: { faq: 0, blog_tip: 0, page_template: 0, email_snippet: 0, social_post: 0 }, totalUsage: 0, mostUsedType: null },
      loadError: "Could not load content library. Try refreshing.",
    });
  }
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { shop } = await getCtx(request);
    const form = await request.formData();
    const intent = String(form.get("intent") ?? "");

    if (intent === "archive") {
      const itemId = String(form.get("itemId") ?? "");
      const itemSource = String(form.get("itemSource") ?? "");
      if (itemSource === "faq") {
        await prisma.generatedFaq.update({
          where: { id: itemId },
          data: { status: "rolled_back" },
        });
      }
      // ContentLibraryItem archive
      const contentLibraryItem = getDelegate(prisma, "contentLibraryItem");
      if (contentLibraryItem?.update && itemSource === "custom") {
        await contentLibraryItem.update({
          where: { id: itemId },
          data: { status: "archived" },
        });
      }
    }

    return redirect("/app/library");
  } catch (error) {
    if (error instanceof Response) throw error;
    return json({ error: "Action failed." }, { status: 500 });
  }
}

const TYPE_OPTIONS = [
  { label: "All types", value: "" },
  ...Object.entries(ITEM_TYPE_LABELS).map(([value, label]) => ({ value, label })),
];

const STATUS_TONE: Record<string, "success" | "warning" | "info"> = {
  active: "success",
  archived: "warning",
  published: "success",
  draft: "info",
};

const SOURCE_TONE: Record<string, "info" | "success" | "warning"> = {
  generated: "info",
  manual: "success",
  imported: "warning",
};

export default function LibraryPage() {
  const { items, stats, loadError } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get("q") ?? "");
  const typeFilter = searchParams.get("type") ?? "";

  if (navigation.state === "loading") return <ListSkeleton />;

  function updateFilter(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next);
  }

  function handleSearch(v: string) {
    setSearch(v);
    const next = new URLSearchParams(searchParams);
    if (v) next.set("q", v);
    else next.delete("q");
    setSearchParams(next);
  }

  return (
    <AppPage
      title="Recovery Content Library"
      subtitle="Browse, search, and manage all generated FAQs, published pages, and content assets."
      primaryAction={<Button url="/app/faq" variant="primary">Generate FAQ</Button>}
      secondaryAction={<Button url="/app/publish">Publish Content</Button>}
    >
      <BlockStack gap="500">
        {loadError ? <Banner tone="critical" title="Load error"><p>{loadError}</p></Banner> : null}
        {actionData && "error" in actionData ? (
          <Banner tone="critical" title="Action failed"><p>{actionData.error}</p></Banner>
        ) : null}

        <div className="cia-metric-strip">
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">Total Items</div>
            <Text as="p" variant="headingLg">{formatNumber(stats.total)}</Text>
          </div>
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">Active</div>
            <Text as="p" variant="headingLg">{formatNumber(stats.active)}</Text>
          </div>
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">FAQs</div>
            <Text as="p" variant="headingLg">{formatNumber(stats.byType.faq)}</Text>
          </div>
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">Pages / Articles</div>
            <Text as="p" variant="headingLg">{formatNumber(stats.byType.page_template + stats.byType.blog_tip)}</Text>
          </div>
        </div>

        <Card>
          <BlockStack gap="300">
            <SectionHeader title="Filter & Search" description="Narrow down your content library." />
            <InlineStack gap="300" wrap={false}>
              <div style={{ flex: 1 }}>
                <TextField
                  label="Search"
                  value={search}
                  onChange={handleSearch}
                  placeholder="Search title or content…"
                  autoComplete="off"
                />
              </div>
              <div style={{ minWidth: "180px" }}>
                <Select
                  label="Type"
                  options={TYPE_OPTIONS}
                  value={typeFilter}
                  onChange={(v) => updateFilter("type", v)}
                />
              </div>
            </InlineStack>
          </BlockStack>
        </Card>

        {items.length === 0 ? (
          <EmptyStateCard
            title="No content yet"
            body="Generate FAQs or publish pages to build your content library."
            actionLabel="Generate FAQ"
            actionUrl="/app/faq"
          />
        ) : (
          <Card>
            <BlockStack gap="200">
              {(items as LibraryItem[]).map((item, idx) => (
                <BlockStack key={item.id} gap="150">
                  {idx > 0 ? <Divider /> : null}
                  <InlineStack align="space-between" blockAlign="start" wrap={false} gap="300">
                    <BlockStack gap="100">
                      <InlineStack gap="200" blockAlign="center" wrap>
                        <Text as="p" variant="bodyMd" fontWeight="semibold">{item.title}</Text>
                        <Badge tone={STATUS_TONE[item.status] ?? "info"}>{item.status}</Badge>
                        <Badge tone="info">{ITEM_TYPE_LABELS[item.itemType]}</Badge>
                        <Badge tone={SOURCE_TONE[item.source] ?? "info"}>
                          {SOURCE_LABELS[item.source] ?? item.source}
                        </Badge>
                      </InlineStack>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {truncateContent(item.content)}
                      </Text>
                      {item.groupId ? (
                        <Text as="p" variant="bodySm" tone="subdued">
                          Group: {item.groupId}
                        </Text>
                      ) : null}
                    </BlockStack>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {new Date(item.createdAt).toLocaleDateString()}
                    </Text>
                  </InlineStack>
                </BlockStack>
              ))}
            </BlockStack>
          </Card>
        )}
      </BlockStack>
    </AppPage>
  );
}
