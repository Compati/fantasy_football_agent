const INJURY_ABBR: Record<string, string> = {
  Questionable: "Q",
  Doubtful: "D",
  Out: "OUT",
  IR: "IR",
  PUP: "PUP",
  Sus: "SUS",
  NA: "NA",
  DNR: "DNR",
  COV: "COV",
};

// Small colored injury-designation chip. Questionable is a caution (amber);
// everything else means likely/definitely out (red).
export function InjuryBadge({ status }: { status: string }) {
  const color = status === "Questionable" ? "var(--warn)" : "var(--bad)";
  return (
    <span
      className="ml-1 text-[10px] font-semibold uppercase px-1 py-0.5 rounded align-middle"
      style={{ color, border: `1px solid ${color}` }}
      title={status}
    >
      {INJURY_ABBR[status] ?? status}
    </span>
  );
}
