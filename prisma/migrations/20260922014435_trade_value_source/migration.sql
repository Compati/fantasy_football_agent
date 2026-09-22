-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TradeValue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sleeperId" TEXT NOT NULL,
    "isDynasty" BOOLEAN NOT NULL,
    "ppr" REAL NOT NULL,
    "numQbs" INTEGER NOT NULL,
    "numTeams" INTEGER NOT NULL,
    "value" INTEGER NOT NULL,
    "redraftValue" INTEGER NOT NULL,
    "overallRank" INTEGER NOT NULL,
    "positionRank" INTEGER NOT NULL,
    "trend30" INTEGER NOT NULL,
    "tier" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'fantasycalc',
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TradeValue_sleeperId_fkey" FOREIGN KEY ("sleeperId") REFERENCES "Player" ("sleeperId") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_TradeValue" ("id", "isDynasty", "numQbs", "numTeams", "overallRank", "positionRank", "ppr", "redraftValue", "sleeperId", "tier", "trend30", "updatedAt", "value") SELECT "id", "isDynasty", "numQbs", "numTeams", "overallRank", "positionRank", "ppr", "redraftValue", "sleeperId", "tier", "trend30", "updatedAt", "value" FROM "TradeValue";
DROP TABLE "TradeValue";
ALTER TABLE "new_TradeValue" RENAME TO "TradeValue";
CREATE UNIQUE INDEX "TradeValue_sleeperId_isDynasty_ppr_numQbs_numTeams_key" ON "TradeValue"("sleeperId", "isDynasty", "ppr", "numQbs", "numTeams");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
