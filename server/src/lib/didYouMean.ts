// Small Levenshtein-distance "did you mean" helper (PLAN.md's MCP tools
// example: "no project with slug X, did you mean: ..." — errors should let
// the calling agent self-correct rather than fail silently).

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

/** Up to `max` candidates within a small edit distance of `input`, closest
 * first. Returns `[]` (not "everything") when nothing is actually close. */
export function didYouMean(input: string, candidates: string[], max = 3): string[] {
  const threshold = Math.max(2, Math.floor(input.length / 3));
  return candidates
    .map((c) => ({ c, d: levenshtein(input, c) }))
    .filter((x) => x.d <= threshold)
    .sort((a, b) => a.d - b.d)
    .slice(0, max)
    .map((x) => x.c);
}
