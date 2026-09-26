/*
  Warnings:

  - Added the required column `budget` to the `WaiverClaim` table without a default value. This is not possible if the table is not empty.
  - Added the required column `season` to the `WaiverClaim` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_WaiverClaim" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "week" INTEGER NOT NULL,
    "budget" INTEGER NOT NULL,
    "sleeperId" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "bid" INTEGER NOT NULL,
    "won" BOOLEAN NOT NULL,
    "projAtClaim" REAL,
    "projAhead" REAL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WaiverClaim_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_WaiverClaim" ("bid", "id", "leagueId", "position", "projAtClaim", "sleeperId", "transactionId", "updatedAt", "week", "won") SELECT "bid", "id", "leagueId", "position", "projAtClaim", "sleeperId", "transactionId", "updatedAt", "week", "won" FROM "WaiverClaim";
DROP TABLE "WaiverClaim";
ALTER TABLE "new_WaiverClaim" RENAME TO "WaiverClaim";
CREATE UNIQUE INDEX "WaiverClaim_transactionId_key" ON "WaiverClaim"("transactionId");
CREATE INDEX "WaiverClaim_leagueId_season_idx" ON "WaiverClaim"("leagueId", "season");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
