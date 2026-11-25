import "dotenv/config";
import { z } from "zod";

const version = z.string().regex(/^\d+(\.\d+){0,3}$/, "version 1.0 ya 1.2.3 jaisa ho");
const flag = z.enum(["true", "false"]).default("false").transform((v) => v === "true");

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
  // App update: LATEST se purane version ko FORCE_UPDATE=true par app update karna hi padega
  IOS_LATEST_VERSION: version.default("1.0"),
  IOS_FORCE_UPDATE: flag,
  IOS_STORE_URL: z.string().url().default("https://apps.apple.com/app/id6829219402"),
  ANDROID_LATEST_VERSION: version.default("1.0"),
  ANDROID_FORCE_UPDATE: flag,
  ANDROID_STORE_URL: z.string().url().default("https://play.google.com/store/apps/details?id=com.storyYatra"),
  CORS_ORIGINS: z.string().default("").transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean)),
});

export const env = schema.parse(process.env);
