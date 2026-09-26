-- CreateTable
CREATE TABLE "WaiverClaim" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "week" INTEGER NOT NULL,
    "sleeperId" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "bid" INTEGER NOT NULL,
    "won" BOOLEAN NOT NULL,
    "projAtClaim" REAL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WaiverClaim_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "WaiverClaim_transactionId_key" ON "WaiverClaim"("transactionId");

-- CreateIndex
CREATE INDEX "WaiverClaim_leagueId_idx" ON "WaiverClaim"("leagueId");
