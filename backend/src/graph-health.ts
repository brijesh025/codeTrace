import { Redis } from "ioredis";

export interface GraphHealthClient {
  ping(): Promise<string>;
  quit(): Promise<unknown>;
}

export function createGraphHealthClient(connectionUrl: string): GraphHealthClient {
  return new Redis(connectionUrl, {
    lazyConnect: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 2_000,
  });
}
