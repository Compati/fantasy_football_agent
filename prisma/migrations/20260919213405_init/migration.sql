-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Connection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "sleeperUsername" TEXT,
    "sleeperUserId" TEXT,
    "yahooGuid" TEXT,
    "yahooAccessToken" TEXT,
    "yahooRefreshToken" TEXT,
    "yahooExpiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Connection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "League" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "connectionId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "ppr" REAL NOT NULL DEFAULT 1,
    "numTeams" INTEGER NOT NULL DEFAULT 12,
    "numQbs" INTEGER NOT NULL DEFAULT 1,
    "faabBudget" INTEGER,
    "rosterPositions" JSONB NOT NULL,
    "scoringSettings" JSONB NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "League_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerName" TEXT,
    "isMine" BOOLEAN NOT NULL DEFAULT false,
    "faabBudgetUsed" INTEGER,
    "wins" INTEGER,
    "losses" INTEGER,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Team_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RosterSpot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamId" TEXT NOT NULL,
    "sleeperId" TEXT,
    "name" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "nflTeam" TEXT,
    "slot" TEXT NOT NULL,
    "starter" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "RosterSpot_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Player" (
    "sleeperId" TEXT NOT NULL PRIMARY KEY,
    "espnId" TEXT,
    "yahooId" TEXT,
    "name" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "nflTeam" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Projection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sleeperId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "week" INTEGER NOT NULL,
    "points" REAL NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Projection_sleeperId_fkey" FOREIGN KEY ("sleeperId") REFERENCES "Player" ("sleeperId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TradeValue" (
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
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TradeValue_sleeperId_fkey" FOREIGN KEY ("sleeperId") REFERENCES "Player" ("sleeperId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NewsItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "publishedAt" DATETIME NOT NULL,
    "playerIds" JSONB NOT NULL,
    "sentiment" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Connection_userId_platform_key" ON "Connection"("userId", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "League_platform_externalId_key" ON "League"("platform", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Team_leagueId_externalId_key" ON "Team"("leagueId", "externalId");

-- CreateIndex
CREATE INDEX "Player_espnId_idx" ON "Player"("espnId");

-- CreateIndex
CREATE INDEX "Player_yahooId_idx" ON "Player"("yahooId");

-- CreateIndex
CREATE INDEX "Projection_season_week_idx" ON "Projection"("season", "week");

-- CreateIndex
CREATE UNIQUE INDEX "Projection_sleeperId_source_season_week_key" ON "Projection"("sleeperId", "source", "season", "week");

-- CreateIndex
CREATE UNIQUE INDEX "TradeValue_sleeperId_isDynasty_ppr_numQbs_numTeams_key" ON "TradeValue"("sleeperId", "isDynasty", "ppr", "numQbs", "numTeams");

-- CreateIndex
CREATE UNIQUE INDEX "NewsItem_url_key" ON "NewsItem"("url");

-- CreateIndex
CREATE INDEX "NewsItem_publishedAt_idx" ON "NewsItem"("publishedAt");
