import type { PrismaClient } from "@prisma/client";
import { prisma } from "./db.js";

export interface AppContext {
  prisma: PrismaClient;
}

export function createContext(client: PrismaClient = prisma): AppContext {
  return { prisma: client };
}
