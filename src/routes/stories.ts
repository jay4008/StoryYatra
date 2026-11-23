import { createHmac } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { env } from "../env";
import { partCountOf } from "../lib/catalog";
import { prisma } from "../lib/db";
import { verifyUserToken } from "../lib/jwt";
import { requireAuth, type AuthedRequest } from "../lib/requireAuth";

export const storiesRouter = Router();

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const VIEW_WINDOW_HOURS = 24;

/** Anonymous and stable: the app's device id, or the IP for a client that sends none. */
function viewerKeyOf(req: Request) {
  const device = req.get("x-device-id");
  const raw = device && /^[A-Za-z0-9-]{16,64}$/.test(device) ? `device:${device}` : `ip:${req.ip}`;
  return createHmac("sha256", env.JWT_SECRET).update(raw).digest("hex");
}

// Rows older than the window no longer affect counting.
setInterval(() => {
  const before = new Date(Date.now() - VIEW_WINDOW_HOURS * 3600_000);
  prisma.partViewer.deleteMany({ where: { lastCountedAt: { lt: before } } }).catch((err) => console.error("viewer cleanup failed", err));
}, 3600_000).unref();

const viewLimit = rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: "draft-7", legacyHeaders: false });
const reviewWriteLimit = rateLimit({ windowMs: 60 * 60 * 1000, limit: 60, standardHeaders: "draft-7", legacyHeaders: false });

async function requireStory(req: Request, res: Response, next: NextFunction) {
  try {
    if ((await partCountOf(req.params.id)) !== undefined) return next();
    res.status(404).json({ error: "story_not_found" });
  } catch (err) {
    next(err);
  }
}

type ReviewCursor = { updatedAt: Date; id: string };

const encodeCursor = (r: ReviewCursor) =>
  Buffer.from(JSON.stringify({ u: r.updatedAt.toISOString(), i: r.id })).toString("base64url");

/** Points at a position, not a row, so a deleted or edited review can't break the next page. */
function decodeCursor(value: string): ReviewCursor | null {
  try {
    const parsed = z.object({ u: z.string().datetime(), i: z.string().uuid() })
      .parse(JSON.parse(Buffer.from(value, "base64url").toString()));
    return { updatedAt: new Date(parsed.u), id: parsed.i };
  } catch {
    return null;
  }
}

const roundRating = (avg: number | null) => (avg === null ? 0 : Math.round(avg * 10) / 10);

type ReviewRow = { id: string; rating: number; text: string | null; updatedAt: Date; userId: string; user: { name: string | null } };

const publicReview = (r: ReviewRow) => ({
  id: r.id,
  userName: r.user.name || "Story Yatra user",
  rating: r.rating,
  text: r.text,
  updatedAt: r.updatedAt,
});

async function summaryOf(bookSlug: string) {
  const groups = await prisma.review.groupBy({ by: ["rating"], where: { bookSlug }, _count: { _all: true } });
  const breakdown: Record<string, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let count = 0;
  let sum = 0;
  for (const g of groups) {
    breakdown[g.rating] = g._count._all;
    count += g._count._all;
    sum += g.rating * g._count._all;
  }
  return { rating: count ? roundRating(sum / count) : 0, ratingCount: count, breakdown };
}

/** Views and rating for every story, for the home screen. */
storiesRouter.get("/stories/stats", async (_req, res) => {
  const [views, ratings] = await Promise.all([
    prisma.storyView.findMany(),
    prisma.review.groupBy({ by: ["bookSlug"], _avg: { rating: true }, _count: { _all: true } }),
  ]);
  const stats: Record<string, { views: number; rating: number; ratingCount: number }> = {};
  const entry = (slug: string) => (stats[slug] ??= { views: 0, rating: 0, ratingCount: 0 });
  for (const v of views) entry(v.bookSlug).views = v.count;
  for (const r of ratings) {
    entry(r.bookSlug).rating = roundRating(r._avg.rating);
    entry(r.bookSlug).ratingCount = r._count._all;
  }
  res.json({ stats });
});

/** Views and rating of one story, with the view count of each part. */
storiesRouter.get("/stories/:id/stats", requireStory, async (req, res) => {
  const bookSlug = req.params.id;
  const [story, partRows, summary] = await Promise.all([
    prisma.storyView.findUnique({ where: { bookSlug } }),
    prisma.partView.findMany({ where: { bookSlug } }),
    summaryOf(bookSlug),
  ]);
  res.json({
    views: story?.count ?? 0,
    rating: summary.rating,
    ratingCount: summary.ratingCount,
    parts: Object.fromEntries(partRows.map((p) => [p.part, p.count])),
  });
});

/** One view per device per part per window, added to the part and its story. No login needed. */
storiesRouter.post("/stories/:id/parts/:part/view", viewLimit, requireStory, async (req, res) => {
  const bookSlug = req.params.id;
  const part = Number(req.params.part);
  const total = await partCountOf(bookSlug);
  if (!Number.isInteger(part) || part < 1 || part > total!) return res.status(404).json({ error: "part_not_found" });

  const viewerKey = viewerKeyOf(req);
  const result = await prisma.$transaction(async (tx) => {
    // Inserts a new viewer or renews an expired one; affects 0 rows inside the window.
    const counted = await tx.$executeRaw`
      INSERT INTO part_viewers ("bookSlug", "part", "viewerKey", "lastCountedAt")
      VALUES (${bookSlug}, ${part}, ${viewerKey}, NOW() AT TIME ZONE 'UTC')
      ON CONFLICT ("bookSlug", "part", "viewerKey") DO UPDATE SET "lastCountedAt" = NOW() AT TIME ZONE 'UTC'
      WHERE part_viewers."lastCountedAt" < (NOW() AT TIME ZONE 'UTC') - make_interval(hours => ${VIEW_WINDOW_HOURS}::int)`;
    if (!counted) {
      const [partRow, storyRow] = await Promise.all([
        tx.partView.findUnique({ where: { bookSlug_part: { bookSlug, part } } }),
        tx.storyView.findUnique({ where: { bookSlug } }),
      ]);
      return { views: storyRow?.count ?? 0, partViews: partRow?.count ?? 0, counted: false };
    }
    const partRow = await tx.partView.upsert({
      where: { bookSlug_part: { bookSlug, part } },
      create: { bookSlug, part, count: 1 },
      update: { count: { increment: 1 } },
    });
    const storyRow = await tx.storyView.upsert({
      where: { bookSlug },
      create: { bookSlug, count: 1 },
      update: { count: { increment: 1 } },
    });
    return { views: storyRow.count, partViews: partRow.count, counted: true };
  });
  res.json(result);
});

/**
 * Newest first, `?limit=` (1-50, default 20) and `?cursor=` from the last page's nextCursor.
 * The viewer's own review comes back in `mine` and is left out of the list.
 */
storiesRouter.get("/stories/:id/reviews", requireStory, async (req, res) => {
  const bookSlug = req.params.id;
  const query = z.object({
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
    cursor: z.string().max(300).optional(),
  }).safeParse(req.query);
  if (!query.success) return res.status(400).json({ error: "invalid_query" });
  const { limit, cursor: rawCursor } = query.data;
  const cursor = rawCursor ? decodeCursor(rawCursor) : null;
  if (rawCursor && !cursor) return res.status(400).json({ error: "invalid_cursor" });

  // Reading is public; a valid token additionally returns the person's own review.
  const header = req.headers.authorization ?? "";
  const userId = header.startsWith("Bearer ") ? await verifyUserToken(header.slice(7)).catch(() => null) : null;
  const others = { bookSlug, ...(userId ? { userId: { not: userId } } : {}) };

  const [rows, total, mine, summary] = await Promise.all([
    prisma.review.findMany({
      where: {
        ...others,
        ...(cursor ? { OR: [{ updatedAt: { lt: cursor.updatedAt } }, { updatedAt: cursor.updatedAt, id: { lt: cursor.id } }] } : {}),
      },
      include: { user: { select: { name: true } } },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    }),
    prisma.review.count({ where: others }),
    userId
      ? prisma.review.findUnique({
          where: { userId_bookSlug: { userId, bookSlug } },
          include: { user: { select: { name: true } } },
        })
      : null,
    summaryOf(bookSlug),
  ]);
  const page = rows.slice(0, limit);
  const hasMore = rows.length > limit;

  res.json({
    summary,
    reviews: page.map(publicReview),
    mine: mine ? publicReview(mine) : null,
    total,
    hasMore,
    nextCursor: hasMore ? encodeCursor(page[page.length - 1]) : null,
  });
});

const reviewBody = z.object({
  rating: z.number().int().min(1).max(5),
  text: z.string().trim().max(500).optional(),
});

/** One review per person per story; sending again replaces it. */
storiesRouter.put("/stories/:id/review", reviewWriteLimit, requireAuth, requireStory, async (req: AuthedRequest, res) => {
  const body = reviewBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "invalid_body" });
  const bookSlug = req.params.id;
  const data = { rating: body.data.rating, text: body.data.text || null };
  const review = await prisma.review.upsert({
    where: { userId_bookSlug: { userId: req.userId!, bookSlug } },
    create: { ...data, userId: req.userId!, bookSlug },
    update: data,
    include: { user: { select: { name: true } } },
  });
  res.json({ review: publicReview(review), summary: await summaryOf(bookSlug) });
});

storiesRouter.delete("/stories/:id/review", requireAuth, requireStory, async (req: AuthedRequest, res) => {
  await prisma.review.deleteMany({ where: { userId: req.userId!, bookSlug: req.params.id } });
  res.json({ summary: await summaryOf(req.params.id) });
});
