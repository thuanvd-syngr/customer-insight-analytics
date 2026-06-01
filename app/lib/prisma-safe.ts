import type { PrismaClient } from "@prisma/client";

export type PrismaDelegate = {
  findMany?: (...args: any[]) => Promise<any>;
  findFirst?: (...args: any[]) => Promise<any>;
  findUnique?: (...args: any[]) => Promise<any>;
  count?: (...args: any[]) => Promise<number>;
  create?: (...args: any[]) => Promise<any>;
  createMany?: (...args: any[]) => Promise<any>;
  update?: (...args: any[]) => Promise<any>;
  updateMany?: (...args: any[]) => Promise<any>;
  upsert?: (...args: any[]) => Promise<any>;
};

export function getDelegate(db: PrismaClient, modelName: string): PrismaDelegate | null {
  const delegate = (db as unknown as Record<string, unknown>)[modelName];
  if (!delegate || typeof delegate !== "object") {
    console.warn(`Prisma delegate "${modelName}" is unavailable. Falling back safely.`);
    return null;
  }
  return delegate as PrismaDelegate;
}

export async function safeCount(
  db: PrismaClient,
  modelName: string,
  args?: Record<string, unknown>,
): Promise<number> {
  const delegate = getDelegate(db, modelName);
  if (!delegate?.count) return 0;
  return delegate.count(args);
}
