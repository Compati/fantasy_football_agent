-- CreateTable
CREATE TABLE "PlayerProp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sleeperId" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "week" INTEGER NOT NULL,
    "market" TEXT NOT NULL,
    "line" REAL,
    "overPrice" INTEGER,
    "underPrice" INTEGER,
    "yesPrice" INTEGER,
    "bookmaker" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlayerProp_sleeperId_fkey" FOREIGN KEY ("sleeperId") REFERENCES "Player" ("sleeperId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PlayerProp_season_week_idx" ON "PlayerProp"("season", "week");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerProp_sleeperId_season_week_market_key" ON "PlayerProp"("sleeperId", "season", "week", "market");
