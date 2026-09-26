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
  const parse = (value: string): number[] => value.split(/[.+-]/).map(part => {
    const digits = part.match(/^\d+/)?.[0];
    return digits ? Number(digits) : 0;
  });
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference) return difference;
  }
  return a.localeCompare(b);
}
