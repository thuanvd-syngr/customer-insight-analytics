import { PrismaClient } from "@prisma/client";

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

export default prisma;
