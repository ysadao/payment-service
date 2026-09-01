import path from "node:path";
import { Store } from "./store.js";
import { emptyDb, type DbShape, type IdempotencyRecord } from "./types.js";
import { config } from "./config.js";

export interface AppContext {
  store: Store<DbShape>;
  idempotency: Map<string, IdempotencyRecord>;
}

export function createContext(dataDir = config.dataDir): AppContext {
  return {
    store: new Store<DbShape>(path.join(dataDir, "payments.json"), emptyDb()),
    idempotency: new Map(),
  };
}
