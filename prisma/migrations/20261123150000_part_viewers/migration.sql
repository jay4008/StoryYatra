-- One row per viewer per part, so a replay inside the window is not counted again.
CREATE TABLE "part_viewers" (
    "bookSlug" TEXT NOT NULL,
    "part" INTEGER NOT NULL,
    "viewerKey" TEXT NOT NULL,
    "lastCountedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "part_viewers_pkey" PRIMARY KEY ("bookSlug","part","viewerKey")
);

CREATE INDEX "part_viewers_lastCountedAt_idx" ON "part_viewers"("lastCountedAt");
