/** Selects the newest plugin release whose declared minimum app version is supported. */
export function selectCompatibleRelease(
  versions: unknown,
  supportsAppVersion: (minimum: string) => boolean
): string | undefined {
  if (!versions || typeof versions !== "object" || Array.isArray(versions)) return undefined;
  return Object.entries(versions as Record<string, unknown>)
    .filter(([, minimum]) => typeof minimum === "string" && supportsAppVersion(minimum))
    .map(([version]) => version)
    .sort((a, b) => compareVersions(b, a))[0];
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
  const parse = (value: string) => /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value);
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return a.localeCompare(b);
  for (let i = 1; i <= 3; i++) {
    const difference = Number(left[i]) - Number(right[i]);
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
      const difference = Number(x) - Number(y);
      if (difference) return difference;
    } else if (xNumeric !== yNumeric) {
      return xNumeric ? -1 : 1;
    } else {
      const difference = x.localeCompare(y);
      if (difference) return difference;
    }
  }
  return leftIdentifiers.length - rightIdentifiers.length;
}
