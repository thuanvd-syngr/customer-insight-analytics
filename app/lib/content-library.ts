// Recovery Content Library — pure helper functions (no DB imports).
// DB access happens in route loaders/actions via getDelegate().

export type ContentLibraryItemType =
  | "faq"
  | "blog_tip"
  | "page_template"
  | "email_snippet"
  | "social_post";

export type ContentLibraryStatus = "active" | "archived";

export interface LibraryItem {
  id: string;
  itemType: ContentLibraryItemType;
  title: string;
  content: string;
  tags: string[];
  groupId?: string | null;
  productId?: string | null;
  source: "generated" | "manual" | "imported";
  status: ContentLibraryStatus;
  usageCount: number;
  createdAt: string;
}

export interface LibraryFilter {
  itemType?: ContentLibraryItemType;
  status?: ContentLibraryStatus;
  groupId?: string;
  search?: string;
}

export interface LibraryStats {
  total: number;
  active: number;
  archived: number;
  byType: Record<ContentLibraryItemType, number>;
  totalUsage: number;
  mostUsedType: ContentLibraryItemType | null;
}

export const ITEM_TYPE_LABELS: Record<ContentLibraryItemType, string> = {
  faq: "FAQ",
  blog_tip: "Blog Tip",
  page_template: "Page Template",
  email_snippet: "Email Snippet",
  social_post: "Social Post",
};

export const SOURCE_LABELS: Record<string, string> = {
  generated: "AI Generated",
  manual: "Manual",
  imported: "Imported",
};

export function parseTags(tagsJson: string | null | undefined): string[] {
  if (!tagsJson) return [];
  try {
    const parsed = JSON.parse(tagsJson);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function serializeTags(tags: string[]): string {
  return JSON.stringify(tags.filter(Boolean));
}

export function filterLibraryItems(items: LibraryItem[], filter: LibraryFilter): LibraryItem[] {
  let result = [...items];
  if (filter.itemType) {
    result = result.filter((i) => i.itemType === filter.itemType);
  }
  if (filter.status) {
    result = result.filter((i) => i.status === filter.status);
  }
  if (filter.groupId) {
    result = result.filter((i) => i.groupId === filter.groupId);
  }
  if (filter.search) {
    const q = filter.search.toLowerCase();
    result = result.filter(
      (i) =>
        i.title.toLowerCase().includes(q) ||
        i.content.toLowerCase().includes(q) ||
        i.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }
  return result;
}

export function getLibraryStats(items: LibraryItem[]): LibraryStats {
  const byType: Record<ContentLibraryItemType, number> = {
    faq: 0,
    blog_tip: 0,
    page_template: 0,
    email_snippet: 0,
    social_post: 0,
  };
  let totalUsage = 0;
  for (const item of items) {
    byType[item.itemType] = (byType[item.itemType] ?? 0) + 1;
    totalUsage += item.usageCount;
  }
  const active = items.filter((i) => i.status === "active").length;
  let mostUsedType: ContentLibraryItemType | null = null;
  let maxUsage = 0;
  for (const [type, count] of Object.entries(byType) as Array<[ContentLibraryItemType, number]>) {
    if (count > maxUsage) {
      maxUsage = count;
      mostUsedType = type;
    }
  }
  return {
    total: items.length,
    active,
    archived: items.length - active,
    byType,
    totalUsage,
    mostUsedType,
  };
}

export function buildLibraryItemFromFaq(faq: {
  id: string;
  question: string;
  answerText: string;
  groupId?: string | null;
  productId?: string | null;
  productTitle?: string | null;
  source: string;
  createdAt: Date | string;
}): Omit<LibraryItem, "status" | "usageCount"> {
  return {
    id: faq.id,
    itemType: "faq",
    title: faq.question,
    content: faq.answerText,
    tags: [faq.groupId ?? "general"].filter(Boolean),
    groupId: faq.groupId,
    productId: faq.productId,
    source: faq.source === "ai" ? "generated" : "manual",
    createdAt: typeof faq.createdAt === "string" ? faq.createdAt : faq.createdAt.toISOString(),
  };
}

export function buildLibraryItemFromPublished(pc: {
  id: string;
  contentType: string;
  resourceTitle: string;
  publishedAt: Date | string;
}): Omit<LibraryItem, "status" | "usageCount"> {
  const typeMap: Record<string, ContentLibraryItemType> = {
    faq_page: "faq",
    blog_article: "blog_tip",
    shipping_page: "page_template",
    return_page: "page_template",
    warranty_page: "page_template",
    payment_page: "page_template",
    discount_page: "page_template",
  };
  return {
    id: pc.id,
    itemType: typeMap[pc.contentType] ?? "page_template",
    title: pc.resourceTitle,
    content: `Published ${pc.contentType.replace(/_/g, " ")}`,
    tags: [pc.contentType],
    groupId: null,
    productId: null,
    source: "generated",
    createdAt:
      typeof pc.publishedAt === "string" ? pc.publishedAt : pc.publishedAt.toISOString(),
  };
}

export function truncateContent(content: string, maxLen = 200): string {
  if (content.length <= maxLen) return content;
  return content.slice(0, maxLen - 3) + "...";
}

export function sortLibraryItems(
  items: LibraryItem[],
  by: "createdAt" | "usageCount" | "title",
  dir: "asc" | "desc" = "desc",
): LibraryItem[] {
  return [...items].sort((a, b) => {
    let cmp: number;
    if (by === "createdAt") {
      cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    } else if (by === "usageCount") {
      cmp = a.usageCount - b.usageCount;
    } else {
      cmp = a.title.localeCompare(b.title);
    }
    return dir === "asc" ? cmp : -cmp;
  });
}
