import { z } from "zod";
import { env } from "../env";

const TTL_MS = 5 * 60 * 1000;
const catalogSchema = z.object({ books: z.array(z.object({ id: z.string(), parts: z.number() })) });

let parts = new Map<string, number>();
let fetchedAt = 0;

/**
 * Story ids live in the CDN catalog, not in Postgres. Checking against it stops
 * views and reviews being written for made-up stories or parts. A stale list is kept if the CDN is down.
 */
export async function partCountOf(slug: string): Promise<number | undefined> {
  if (Date.now() - fetchedAt > TTL_MS) {
    try {
      const res = await fetch(new URL("catalog.json", env.CDN_BASE));
      if (!res.ok) throw new Error(`cdn ${res.status}`);
      const catalog = catalogSchema.parse(await res.json());
      parts = new Map(catalog.books.map((b) => [b.id, b.parts]));
      fetchedAt = Date.now();
    } catch (err) {
      if (!parts.size) throw err;
      console.error("catalog refresh failed", err);
    }
  }
  return parts.get(slug);
}
