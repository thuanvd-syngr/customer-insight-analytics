import type { GeneratedFaq, PrismaClient } from "@prisma/client";

import type { AdminLike } from "~/lib/shopify-data.server";

type PublishTarget = "metafield" | "append_description" | "faq_block";

async function graph<T>(
  admin: AdminLike,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const response = await admin.graphql(query, { variables });
  return (await response.json()) as T;
}

async function productDescription(admin: AdminLike, productId: string): Promise<string> {
  const body = await graph<{
    data?: { product?: { descriptionHtml?: string | null } };
  }>(
    admin,
    `query ProductDescription($id: ID!) {
      product(id: $id) { descriptionHtml }
    }`,
    { id: productId },
  );
  return body.data?.product?.descriptionHtml ?? "";
}

async function updateProductDescription(
  admin: AdminLike,
  productId: string,
  descriptionHtml: string,
) {
  return graph<{
    data?: { productUpdate?: { userErrors?: Array<{ message: string }> } };
    errors?: Array<{ message: string }>;
  }>(
    admin,
    `mutation ProductDescriptionUpdate($input: ProductInput!) {
      productUpdate(input: $input) {
        userErrors { message }
      }
    }`,
    { input: { id: productId, descriptionHtml } },
  );
}

async function publishMetafield(admin: AdminLike, faq: GeneratedFaq) {
  return graph<{
    data?: { metafieldsSet?: { metafields?: Array<{ id: string }>; userErrors?: Array<{ message: string }> } };
    errors?: Array<{ message: string }>;
  }>(
    admin,
    `mutation PublishFaqMetafield($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id }
        userErrors { message }
      }
    }`,
    {
      metafields: [{
        ownerId: faq.productId,
        namespace: "customer_insight",
        key: `faq_${faq.groupId ?? "recovery"}`,
        type: "multi_line_text_field",
        value: faq.answerHtml,
      }],
    },
  );
}

async function deleteMetafield(admin: AdminLike, id: string) {
  return graph<{
    data?: { metafieldDelete?: { deletedId?: string | null; userErrors?: Array<{ message: string }> } };
    errors?: Array<{ message: string }>;
  }>(
    admin,
    `mutation DeleteFaqMetafield($input: MetafieldDeleteInput!) {
      metafieldDelete(input: $input) {
        deletedId
        userErrors { message }
      }
    }`,
    { input: { id } },
  );
}

function bodyErrors(body: {
  errors?: Array<{ message: string }>;
  data?: {
    productUpdate?: { userErrors?: Array<{ message: string }> };
    metafieldsSet?: { userErrors?: Array<{ message: string }> };
    metafieldDelete?: { userErrors?: Array<{ message: string }> };
  };
}): string[] {
  return [
    ...(body.errors ?? []).map((error) => error.message),
    ...(body.data?.productUpdate?.userErrors ?? []).map((error) => error.message),
    ...(body.data?.metafieldsSet?.userErrors ?? []).map((error) => error.message),
    ...(body.data?.metafieldDelete?.userErrors ?? []).map((error) => error.message),
  ].filter(Boolean);
}

export async function publishGeneratedFaq(input: {
  db: PrismaClient;
  admin: AdminLike;
  shopId: string;
  faqId: string;
  target: PublishTarget;
}): Promise<GeneratedFaq> {
  const faq = await input.db.generatedFaq.findFirst({
    where: { id: input.faqId, shopId: input.shopId },
  });
  if (!faq) throw new Error("FAQ draft not found.");
  if (!faq.productId) {
    return input.db.generatedFaq.update({
      where: { id: faq.id },
      data: { status: "failed", error: "Select a product before publishing.", publishTarget: input.target },
    });
  }

  try {
    if (input.target === "metafield" || input.target === "faq_block") {
      const body = await publishMetafield(input.admin, faq);
      const errors = bodyErrors(body);
      if (errors.length > 0) throw new Error(errors.join("; "));
      return input.db.generatedFaq.update({
        where: { id: faq.id },
        data: {
          status: "published",
          publishTarget: input.target,
          publishRef: body.data?.metafieldsSet?.metafields?.[0]?.id ?? null,
          error: null,
          publishedAt: new Date(),
        },
      });
    }

    const previousHtml = await productDescription(input.admin, faq.productId);
    const body = await updateProductDescription(
      input.admin,
      faq.productId,
      `${previousHtml}\n${faq.answerHtml}`,
    );
    const errors = bodyErrors(body);
    if (errors.length > 0) throw new Error(errors.join("; "));
    return input.db.generatedFaq.update({
      where: { id: faq.id },
      data: {
        status: "published",
        publishTarget: input.target,
        publishRef: faq.productId,
        previousHtml,
        error: null,
        publishedAt: new Date(),
      },
    });
  } catch (error) {
    return input.db.generatedFaq.update({
      where: { id: faq.id },
      data: {
        status: "failed",
        publishTarget: input.target,
        error: error instanceof Error ? error.message : "Shopify publish failed.",
      },
    });
  }
}

export async function rollbackGeneratedFaq(input: {
  db: PrismaClient;
  admin: AdminLike;
  shopId: string;
  faqId: string;
}): Promise<GeneratedFaq> {
  const faq = await input.db.generatedFaq.findFirst({
    where: { id: input.faqId, shopId: input.shopId },
  });
  if (!faq) throw new Error("FAQ draft not found.");
  if ((faq.publishTarget === "metafield" || faq.publishTarget === "faq_block") && faq.publishRef) {
    const body = await deleteMetafield(input.admin, faq.publishRef);
    const errors = bodyErrors(body);
    if (errors.length > 0) {
      return input.db.generatedFaq.update({
        where: { id: faq.id },
        data: { status: "failed", error: errors.join("; ") },
      });
    }
    return input.db.generatedFaq.update({
      where: { id: faq.id },
      data: { status: "rolled_back", rolledBackAt: new Date(), error: null },
    });
  }

  if (faq.publishTarget !== "append_description" || !faq.productId || faq.previousHtml === null) {
    return input.db.generatedFaq.update({
      where: { id: faq.id },
      data: { status: "failed", error: "Rollback is only available after a successful Shopify publish." },
    });
  }
  const body = await updateProductDescription(input.admin, faq.productId, faq.previousHtml);
  const errors = bodyErrors(body);
  if (errors.length > 0) {
    return input.db.generatedFaq.update({
      where: { id: faq.id },
      data: { status: "failed", error: errors.join("; ") },
    });
  }
  return input.db.generatedFaq.update({
    where: { id: faq.id },
    data: { status: "rolled_back", rolledBackAt: new Date(), error: null },
  });
}
