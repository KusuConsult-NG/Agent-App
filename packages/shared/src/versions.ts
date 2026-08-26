/**
 * Semantic version comparison.
 *
 * Lived in the API's `middleware/auth` beside its first caller, which meant the
 * version gate's own arithmetic could only be reached by importing Express
 * middleware. Three places need the same answer now: the gate that refuses a
 * handset, the publishing path that counts how many handsets a new minimum
 * would stop, and the portal screen that shows an administrator that count
 * before they publish. A second implementation anywhere among them would make
 * the preview disagree with the consequence, so there is one.
 *
 * Compared numerically part by part rather than lexicographically, because
 * '1.10.0' is above '1.9.0' and string comparison says the opposite. Missing
 * parts are treated as 0, so '1.2' and '1.2.0' are the same version.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}
