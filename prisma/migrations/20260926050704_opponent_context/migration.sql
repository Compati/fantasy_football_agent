-- CreateTable
CREATE TABLE "DefenseVsPosition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "season" INTEGER NOT NULL,
    "throughWeek" INTEGER NOT NULL,
    "team" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "games" INTEGER NOT NULL,
    "perGame" REAL NOT NULL,
    "adjusted" REAL NOT NULL,
    "rank" INTEGER NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "GameLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "season" INTEGER NOT NULL,
    "week" INTEGER NOT NULL,
    "team" TEXT NOT NULL,
    "opponent" TEXT NOT NULL,
    "isHome" BOOLEAN NOT NULL,
    "spread" REAL,
    "total" REAL,
    "impliedTotal" REAL,
    "commenceTime" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "DefenseVsPosition_season_team_position_key" ON "DefenseVsPosition"("season", "team", "position");

-- CreateIndex
CREATE UNIQUE INDEX "GameLine_season_week_team_key" ON "GameLine"("season", "week", "team");
