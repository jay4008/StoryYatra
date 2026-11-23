import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().default(4100),
  HOST: z.string().default("127.0.0.1"),
  NODE_ENV: z.string().default("development"),
  DATABASE_URL: z.string().min(1),
  GOOGLE_CLIENT_IDS: z.string().min(1).transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean)),
  // Apple: iOS bundle id + Services ID (Android/web ke liye), comma se
  APPLE_CLIENT_IDS: z.string().default("").transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean)),
  JWT_SECRET: z.string().min(32, "JWT_SECRET kam se kam 32 akshar ka ho"),
  JWT_EXPIRES_DAYS: z.coerce.number().int().positive().default(365),
  CDN_BASE: z.string().url().default("https://cdn.technoplatsolution.online/"),
  CORS_ORIGINS: z.string().default("").transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean)),
});

export const env = schema.parse(process.env);
