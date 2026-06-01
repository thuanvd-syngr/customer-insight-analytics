import { PrismaClient } from "@prisma/client";
import { verifyShopifyProductSchema } from "~/lib/schema-diagnostics.server";

// Reuse a single PrismaClient across hot reloads in development to avoid
// exhausting database connections.
declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

const prisma: PrismaClient = global.__prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.__prisma = prisma;
}

void verifyShopifyProductSchema(prisma).catch((error) => {
  console.warn("ShopifyProduct schema diagnostics failed at startup", error);
});

export default prisma;
