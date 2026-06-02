import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  Divider,
  InlineGrid,
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

type ContentItem = {
  id: string;
  kind: "faq" | "published" | "library";
  title: string;
  subtitle: string;
  status: "active" | "published" | "draft" | "archived";
  groupId: string | null;
  createdAt: string;
};

const STATUS_TONE: Record<string, "success" | "info" | "warning"> = {
  active: "success",
  published: "success",
  draft: "info",
  archived: "warning",
};

const KIND_LABEL: Record<string, string> = {
  faq: "FAQ",
  published: "Published Page",
  library: "Content Item",
};

const STATUS_OPTIONS = [
  { label: "All statuses", value: "" },
  { label: "Published / Active", value: "active" },
  { label: "Draft", value: "draft" },
  { label: "Archived", value: "archived" },
];

const KIND_OPTIONS = [
  { label: "All content", value: "" },
  { label: "FAQs", value: "faq" },
  { label: "Published Pages", value: "published" },
  { label: "Library Items", value: "library" },
];

async function getCtx(request: Request) {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(prisma, session.shop);
  return { shop };
}

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { shop } = await getCtx(request);

    const [faqTotal, faqPublished, faqDraft, rawFaqs] = await Promise.all([
      prisma.generatedFaq.count({ where: { shopId: shop.id } }),
      prisma.generatedFaq.count({ where: { shopId: shop.id, status: "published" } }),
      prisma.generatedFaq.count({ where: { shopId: shop.id, status: "generated" } }),
      prisma.generatedFaq.findMany({
        where: { shopId: shop.id },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: { id: true, question: true, groupId: true, status: true, createdAt: true, source: true },
      }),
    ]);

    const publishedDelegate = getDelegate(prisma, "publishedContent");
    const [rawPublished, publishedTotal] = await Promise.all([
      publishedDelegate?.findMany
        ? publishedDelegate.findMany({
            where: { shopId: shop.id },
            orderBy: { publishedAt: "desc" },
            take: 100,
          })
        : [],
      publishedDelegate?.count
        ? publishedDelegate.count({ where: { shopId: shop.id } })
        : 0,
    ]);

    const contentLibraryDelegate = getDelegate(prisma, "contentLibraryItem");
    const rawLibrary = contentLibraryDelegate?.findMany
      ? await contentLibraryDelegate.findMany({
          where: { shopId: shop.id },
          orderBy: { createdAt: "desc" },
          take: 50,
        })
      : [];

    const faqItems: ContentItem[] = rawFaqs.map((f) => ({
      id: f.id,
      kind: "faq",
      title: f.question,
      subtitle: `${f.groupId ?? "General"} · ${f.source === "ai" ? "AI generated" : "Manual"}`,
      status: (f.status === "published" ? "published" : f.status === "generated" ? "draft" : "archived") as ContentItem["status"],
      groupId: f.groupId,
      createdAt: new Date(f.createdAt).toISOString(),
    }));

    const publishedItems: ContentItem[] = (rawPublished as Array<{
      id: string;
      contentType: string;
      resourceTitle: string;
      publishedAt: Date | string;
      status: string;
    }>).map((pc) => ({
      id: pc.id,
      kind: "published",
      title: pc.resourceTitle,
      subtitle: pc.contentType.replace(/_/g, " "),
      status: (pc.status === "published" ? "published" : "archived") as ContentItem["status"],
      groupId: null,
      createdAt: new Date(pc.publishedAt).toISOString(),
    }));

    const libraryItems: ContentItem[] = (rawLibrary as Array<{
      id: string;
      title: string;
      itemType: string;
      status: string;
      createdAt: string;
    }>).map((c) => ({
      id: c.id,
      kind: "library",
      title: c.title,
      subtitle: c.itemType.replace(/_/g, " "),
      status: (c.status === "active" ? "active" : "archived") as ContentItem["status"],
      groupId: null,
      createdAt: c.createdAt,
    }));

    const allItems = [...faqItems, ...publishedItems, ...libraryItems].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    return json({
      items: allItems,
      stats: {
        faqTotal,
        faqPublished,
        faqDraft,
        publishedTotal: Number(publishedTotal),
        libraryTotal: rawLibrary.length,
      },
      loadError: null,
    });
  } catch (error) {
    console.error("Content hub loader failed", error);
    return json({
      items: [] as ContentItem[],
      stats: { faqTotal: 0, faqPublished: 0, faqDraft: 0, publishedTotal: 0, libraryTotal: 0 },
      loadError: "Content data is loading. Refresh in a moment.",
    });
  }
}

export default function ContentHub() {
  const { items, stats, loadError } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get("q") ?? "");
  const kindFilter = searchParams.get("kind") ?? "";
  const statusFilter = searchParams.get("status") ?? "";

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

  const filtered = items.filter((item) => {
    if (kindFilter && item.kind !== kindFilter) return false;
    if (statusFilter && item.status !== statusFilter && !(statusFilter === "active" && item.status === "published")) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!item.title.toLowerCase().includes(q) && !item.subtitle.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const totalItems = stats.faqTotal + stats.publishedTotal + stats.libraryTotal;

  return (
    <AppPage
      title="Content Center"
      subtitle="All your recovery content — FAQs, published pages, and blog posts — in one place."
      primaryAction={<Button url="/app/faq" variant="primary">Generate FAQ</Button>}
      secondaryAction={<Button url="/app/publish">Publish Content</Button>}
    >
      <BlockStack gap="500">
        {loadError ? (
          <Banner tone="info" title="Content loading"><p>{loadError}</p></Banner>
        ) : null}

        <div className="cia-metric-strip">
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">Total Content</div>
            <Text as="p" variant="headingLg">{formatNumber(totalItems)}</Text>
          </div>
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">FAQs Generated</div>
            <Text as="p" variant="headingLg">{formatNumber(stats.faqTotal)}</Text>
          </div>
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">FAQs Published</div>
            <Text as="p" variant="headingLg">{formatNumber(stats.faqPublished)}</Text>
          </div>
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">Pages Live on Store</div>
            <Text as="p" variant="headingLg">{formatNumber(stats.publishedTotal)}</Text>
          </div>
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">Drafts Ready</div>
            <Text as="p" variant="headingLg">{formatNumber(stats.faqDraft)}</Text>
          </div>
        </div>

        {totalItems === 0 ? null : (
          <InlineGrid columns={{ xs: 1, sm: 2, md: 3 }} gap="300">
            <Card>
              <BlockStack gap="150">
                <Text as="h3" variant="headingSm">Generate FAQ Answers</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Create answers for your highest-value buying objections from the Opportunities page.
                </Text>
                <Button url="/app/faq" variant="primary" size="slim">Open FAQ Builder</Button>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="150">
                <Text as="h3" variant="headingSm">Publish to Shopify</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Push FAQ pages, policy pages, and blog articles live to your Shopify store.
                </Text>
                <Button url="/app/publish" size="slim">Go to Publish</Button>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="150">
                <Text as="h3" variant="headingSm">Full Content Library</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Browse, filter, and manage all content with advanced search and status filters.
                </Text>
                <Button url="/app/library" size="slim">Open Library</Button>
              </BlockStack>
            </Card>
          </InlineGrid>
        )}

        <Card>
          <BlockStack gap="300">
            <SectionHeader title="Filter Content" description="Search and filter across all content types." />
            <InlineStack gap="300" wrap={false}>
              <div style={{ flex: 1 }}>
                <TextField
                  label="Search"
                  value={search}
                  onChange={handleSearch}
                  placeholder="Search by title or type…"
                  autoComplete="off"
                />
              </div>
              <div style={{ minWidth: "170px" }}>
                <Select label="Type" options={KIND_OPTIONS} value={kindFilter} onChange={(v) => updateFilter("kind", v)} />
              </div>
              <div style={{ minWidth: "170px" }}>
                <Select label="Status" options={STATUS_OPTIONS} value={statusFilter} onChange={(v) => updateFilter("status", v)} />
              </div>
            </InlineStack>
          </BlockStack>
        </Card>

        {filtered.length === 0 ? (
          <EmptyStateCard
            title="No content yet"
            body="Generate FAQs from your Opportunities page or publish pages to Shopify to start building your content library."
            actionLabel="Generate FAQ"
            actionUrl="/app/faq"
          />
        ) : (
          <Card>
            <BlockStack gap="200">
              {filtered.slice(0, 50).map((item, idx) => (
                <BlockStack key={item.id} gap="150">
                  {idx > 0 ? <Divider /> : null}
                  <InlineStack align="space-between" blockAlign="center" wrap={false} gap="300">
                    <BlockStack gap="050">
                      <InlineStack gap="200" blockAlign="center" wrap>
                        <Text as="p" variant="bodyMd" fontWeight="semibold">{item.title}</Text>
                        <Badge tone={STATUS_TONE[item.status] ?? "info"}>{item.status}</Badge>
                        <Badge tone="info">{KIND_LABEL[item.kind]}</Badge>
                      </InlineStack>
                      <Text as="p" variant="bodySm" tone="subdued">{item.subtitle}</Text>
                    </BlockStack>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {new Date(item.createdAt).toLocaleDateString()}
                    </Text>
                  </InlineStack>
                </BlockStack>
              ))}
              {filtered.length > 50 ? (
                <Text as="p" variant="bodySm" tone="subdued">
                  {`Showing 50 of ${filtered.length} items. Use the Full Content Library for bulk management.`}
                </Text>
              ) : null}
            </BlockStack>
          </Card>
        )}
      </BlockStack>
    </AppPage>
  );
}
