// Short spoken version of a written CCP brief: "Today at a glance" plus the recommended first move.
const plain = (md) => String(md).replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`#>]/g, "").replace(/^\s*[-•]\s*/gm, "").replace(/\s+/g, " ").trim();
export function briefSummary(md) {
  const section = (re) => { const m = String(md).match(new RegExp(`^#+\\s*(?:\\d+\\.\\s*)?${re}[^\\n]*\\n([\\s\\S]*?)(?=^#+\\s|$(?![\\s\\S]))`, "mi")); return m ? plain(m[1]) : ""; };
  const glance = section("Today at a glance"), first = section("Recommended first move");
  const out = [glance && glance.slice(0, 420), first && "First move: " + first.slice(0, 220)].filter(Boolean).join(" ");
  return out || plain(md).slice(0, 500);
}
