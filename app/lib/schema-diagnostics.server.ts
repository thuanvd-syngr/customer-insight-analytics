import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";

export type ShopifyProductSchemaDiagnostics = {
  delegateAvailable: boolean;
  dbColumns: string[];
  clientFields: string[];
  hasTags: boolean;
  hasProductType: boolean;
  hasCollections: boolean;
  clientHasTags: boolean;
  clientHasProductType: boolean;
  clientHasCollections: boolean;
  compatibilityMode: boolean;
  migrationVersion: string | null;
  error?: string;
};

const OPTIONAL_COLUMNS = ["tags", "productType", "collections"] as const;

function clientFieldsForShopifyProduct(): string[] {
  const model = Prisma.dmmf.datamodel.models.find((item) => item.name === "ShopifyProduct");
  return model?.fields.map((field) => field.name) ?? [];
}

export async function getShopifyProductSchemaDiagnostics(
  db: PrismaClient,
): Promise<ShopifyProductSchemaDiagnostics> {
  const delegateAvailable = Boolean((db as unknown as Record<string, unknown>).shopifyProduct);
  const clientFields = clientFieldsForShopifyProduct();
  try {
    const rows = await db.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'ShopifyProduct'
    `;
    const migrations = await db.$queryRaw<Array<{ migration_name: string; finished_at: Date | null }>>`
      SELECT migration_name, finished_at
      FROM "_prisma_migrations"
      WHERE migration_name = '20260601090000_real_shopify_data_engine'
      ORDER BY started_at DESC
      LIMIT 1
    `.catch(() => []);
    const dbColumns = rows.map((row) => row.column_name);
    const hasTags = dbColumns.includes("tags");
    const hasProductType = dbColumns.includes("productType");
    const hasCollections = dbColumns.includes("collections");
    const clientHasTags = clientFields.includes("tags");
    const clientHasProductType = clientFields.includes("productType");
    const clientHasCollections = clientFields.includes("collections");
    const compatibilityMode =
      !delegateAvailable ||
      OPTIONAL_COLUMNS.some((column) => !dbColumns.includes(column) || !clientFields.includes(column));

    return {
      delegateAvailable,
      dbColumns,
      clientFields,
      hasTags,
      hasProductType,
      hasCollections,
      clientHasTags,
      clientHasProductType,
      clientHasCollections,
      compatibilityMode,
      migrationVersion: migrations[0]?.finished_at ? migrations[0].migration_name : null,
    };
  } catch (error) {
    return {
      delegateAvailable,
      dbColumns: [],
      clientFields,
      hasTags: false,
      hasProductType: false,
      hasCollections: false,
      clientHasTags: clientFields.includes("tags"),
      clientHasProductType: clientFields.includes("productType"),
      clientHasCollections: clientFields.includes("collections"),
      compatibilityMode: true,
      migrationVersion: null,
      error: error instanceof Error ? error.message : "Schema diagnostics failed",
    };
  }
}

export async function verifyShopifyProductSchema(db: PrismaClient): Promise<ShopifyProductSchemaDiagnostics> {
  const diagnostics = await getShopifyProductSchemaDiagnostics(db);
  console.info("ShopifyProduct columns", {
    tags: diagnostics.hasTags,
    productType: diagnostics.hasProductType,
    collections: diagnostics.hasCollections,
  });
  if (diagnostics.compatibilityMode) {
    console.warn("Schema mismatch detected. Running compatibility mode.", {
      delegateAvailable: diagnostics.delegateAvailable,
      migrationVersion: diagnostics.migrationVersion,
      clientHasTags: diagnostics.clientHasTags,
      clientHasProductType: diagnostics.clientHasProductType,
      clientHasCollections: diagnostics.clientHasCollections,
      error: diagnostics.error,
    });
  }
  return diagnostics;
}
