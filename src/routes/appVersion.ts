import { Router } from "express";
import { z } from "zod";
import { env } from "../env";

export const appVersionRouter = Router();

const VERSION = /^\d+(\.\d+){0,3}$/;

/** Numeric, part by part, so 1.10 is newer than 1.9 and 1.0 equals 1.0.0. */
export function compareVersions(a: string, b: string) {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

const releases = {
  ios: { latestVersion: env.IOS_LATEST_VERSION, forceUpdate: env.IOS_FORCE_UPDATE, storeUrl: env.IOS_STORE_URL },
  android: { latestVersion: env.ANDROID_LATEST_VERSION, forceUpdate: env.ANDROID_FORCE_UPDATE, storeUrl: env.ANDROID_STORE_URL },
};

/** GET /app/version?platform=ios&version=1.0 — public, and never cached so a change applies at once. */
appVersionRouter.get("/app/version", (req, res) => {
  const query = z.object({
    platform: z.enum(["ios", "android"]),
    version: z.string().regex(VERSION),
  }).safeParse(req.query);
  if (!query.success) return res.status(400).json({ error: "invalid_query" });

  const { platform, version } = query.data;
  const release = releases[platform];
  const updateAvailable = compareVersions(version, release.latestVersion) < 0;
  res.set("Cache-Control", "no-store").json({
    platform,
    currentVersion: version,
    latestVersion: release.latestVersion,
    forceUpdate: release.forceUpdate,
    updateAvailable,
    mustUpdate: release.forceUpdate && updateAvailable,
    storeUrl: release.storeUrl,
  });
});
