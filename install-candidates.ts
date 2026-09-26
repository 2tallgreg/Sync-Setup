/** Selects the newest plugin release whose declared minimum app version is supported. */
export function selectCompatibleRelease(
  versions: unknown,
  supportsAppVersion: (minimum: string) => boolean
): string | undefined {
  if (!versions || typeof versions !== "object" || Array.isArray(versions)) return undefined;
  return Object.entries(versions as Record<string, unknown>)
    .filter(([version, minimum]) => validVersion(version) &&
      typeof minimum === "string" && !!minimum && supportsAppVersion(minimum))
    .map(([version]) => version)
    .sort((a, b) => compareVersions(b, a))[0];
}

const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
function validVersion(version: string): boolean {
  const parsed = versionPattern.exec(version);
  return !!parsed && !(parsed[4]?.split(".").some(part => /^0\d+$/.test(part)));
}

function compareNumeric(a: string, b: string): number {
  return a.length - b.length || (a === b ? 0 : a < b ? -1 : 1);
}

/** Run async work with a fixed upper bound while retaining input-order results. */
export async function mapConcurrent<T, R>(
  items: readonly T[], limit: number, work: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await work(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  return results;
}

function compareVersions(a: string, b: string): number {
  const left = versionPattern.exec(a)!;
  const right = versionPattern.exec(b)!;
  for (let i = 1; i <= 3; i++) {
    const difference = compareNumeric(left[i], right[i]);
    if (difference) return difference;
  }
  if (!left[4] && !right[4]) return 0;
  if (!left[4]) return 1;
  if (!right[4]) return -1;

  const leftIdentifiers = left[4].split(".");
  const rightIdentifiers = right[4].split(".");
  for (let i = 0; i < Math.min(leftIdentifiers.length, rightIdentifiers.length); i++) {
    const x = leftIdentifiers[i];
    const y = rightIdentifiers[i];
    const xNumeric = /^\d+$/.test(x);
    const yNumeric = /^\d+$/.test(y);
    if (xNumeric && yNumeric) {
      const difference = compareNumeric(x, y);
      if (difference) return difference;
    } else if (xNumeric !== yNumeric) {
      return xNumeric ? -1 : 1;
    } else {
      const difference = x === y ? 0 : x < y ? -1 : 1;
      if (difference) return difference;
    }
  }
  return leftIdentifiers.length - rightIdentifiers.length;
}
