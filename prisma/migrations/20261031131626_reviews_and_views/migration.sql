-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bookSlug" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "text" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "part_views" (
    "bookSlug" TEXT NOT NULL,
    "part" INTEGER NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "part_views_pkey" PRIMARY KEY ("bookSlug","part")
);

-- CreateTable
CREATE TABLE "story_views" (
    "bookSlug" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "story_views_pkey" PRIMARY KEY ("bookSlug")
);

-- CreateIndex
CREATE INDEX "reviews_bookSlug_updatedAt_idx" ON "reviews"("bookSlug", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_userId_bookSlug_key" ON "reviews"("userId", "bookSlug");

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
