import type { PlayoffPicture } from "@/lib/features/playoffs";

// Never show a sim result as a certainty: 99.6% reads ">99%", 0.3% reads "<1%".
const pct = (n: number) => (n > 0.995 && n < 1 ? ">99%" : n > 0 && n < 0.005 ? "<1%" : `${(n * 100).toFixed(n > 0 && n < 0.1 ? 1 : 0)}%`);
const tone = (p: number) => (p >= 0.75 ? "text-good" : p >= 0.3 ? "text-warn" : "text-bad");

const STATUS_LABEL: Record<PlayoffPicture["status"], string> = {
  locked_in: "Locked in",
  in_the_hunt: "In the hunt",
  long_shot: "Long shot",
  out: "Out",
  made_playoffs: "In the playoffs",
  missed_playoffs: "Missed the playoffs",
};

// Playoff picture for a head-to-head league: seed vs the cut line, the odds of
// making it, and how much this week's result moves them.
export function PlayoffPanel({ p }: { p: PlayoffPicture }) {
  const regular = p.makePlayoffsProb != null;
  // The cut line plus the teams just outside it; always include my row.
  const rows = p.standings.filter((s) => s.seed <= p.playoffTeams + 3 || s.isMine);
  const ahead = p.winsAboveCut;

  return (
    <section className="rounded-xl border border-border bg-surface p-4 mb-5">
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="font-medium">
          {p.phase === "playoffs" ? "Playoffs" : "Playoff picture"} — Week {p.week}
        </h2>
        {regular ? (
          <span className={`text-sm font-semibold ${tone(p.makePlayoffsProb!)}`}>
            {pct(p.makePlayoffsProb!)} to make it
          </span>
        ) : (
          <span className="text-sm font-semibold">{STATUS_LABEL[p.status]}</span>
        )}
      </div>
      <p className="text-xs text-muted mb-3">
        Seed {p.me.seed} of {p.standings.length} · {p.me.record} · top {p.playoffTeams} make it
        {regular ? ` · ${p.weeksLeftInRegularSeason} regular-season week${p.weeksLeftInRegularSeason === 1 ? "" : "s"} left` : ""}
        {ahead != null && regular ? ` · ${ahead === 0 ? "level with" : ahead > 0 ? `${ahead} game${ahead === 1 ? "" : "s"} ahead of` : `${-ahead} game${ahead === -1 ? "" : "s"} behind`} the first team out` : ""}
        {regular ? ` · ${STATUS_LABEL[p.status].toLowerCase()}` : ""}
      </p>

      {regular && p.ifWinThisWeek != null && p.ifLoseThisWeek != null && (
        <div className="grid grid-cols-2 gap-3 mb-3 text-sm">
          <div className="rounded-lg border border-border p-2.5">
            <div className={`text-lg font-semibold ${tone(p.ifWinThisWeek)}`}>{pct(p.ifWinThisWeek)}</div>
            <div className="text-[10px] text-muted uppercase">if you win this week</div>
          </div>
          <div className="rounded-lg border border-border p-2.5">
            <div className={`text-lg font-semibold ${tone(p.ifLoseThisWeek)}`}>{pct(p.ifLoseThisWeek)}</div>
            <div className="text-[10px] text-muted uppercase">if you lose</div>
          </div>
          {p.thisWeekSwing != null && (
            <div className="col-span-2 text-xs text-muted -mt-1">
              This game moves your odds by {Math.round(p.thisWeekSwing * 100)} points
              {p.thisWeekSwing >= 0.25 ? " — a must-win." : "."}
            </div>
          )}
        </div>
      )}

      {p.bracket && (
        <p className="text-sm mb-3">
          {p.bracket.status === "alive" &&
            `Still alive — round ${p.bracket.round} of ${p.bracket.rounds}${p.bracket.opponent ? ` vs ${p.bracket.opponent}` : ""}${p.bracket.winProbThisWeek != null ? ` (${pct(p.bracket.winProbThisWeek)} to win)` : ""}.`}
          {p.bracket.status === "champion" && "Champion."}
          {p.bracket.status === "eliminated" && `Eliminated in round ${p.bracket.round}.`}
          {p.bracket.status === "not_in_bracket" && "Not in the playoff bracket."}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase text-muted">
              <th className="py-1 pr-2 font-normal">#</th>
              <th className="py-1 pr-2 font-normal">Team</th>
              <th className="py-1 pr-2 font-normal">Record</th>
              <th className="py-1 pr-2 font-normal text-right">PF</th>
              {regular && <th className="py-1 font-normal text-right">Odds</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr
                key={s.seed}
                className={`${s.isMine ? "font-semibold" : ""} ${s.seed === p.playoffTeams ? "border-b-2 border-dashed border-border" : ""}`}
              >
                <td className="py-1 pr-2 text-muted">{s.seed}</td>
                <td className="py-1 pr-2">{s.team}</td>
                <td className="py-1 pr-2">{s.record}</td>
                <td className="py-1 pr-2 text-right text-muted">{s.pointsFor}</td>
                {regular && (
                  <td className={`py-1 text-right ${s.makePlayoffsProb != null ? tone(s.makePlayoffsProb) : ""}`}>
                    {s.makePlayoffsProb != null ? pct(s.makePlayoffsProb) : "—"}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {regular && (
        <p className="mt-2 text-[11px] text-muted">
          Odds simulate the rest of the schedule from each team&apos;s scoring so far (seeding: wins, then points for).
          First-round byes aren&apos;t modeled.
        </p>
      )}
    </section>
  );
}
