/**
 * Run async tasks with a concurrency cap.
 * Tasks run as a pool; result order matches input order.
 */
export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  onItemSettled?: (index: number, result: R | undefined, error: unknown) => void,
): Promise<Array<{ ok: true; value: R } | { ok: false; error: unknown }>> {
  const results: Array<{ ok: true; value: R } | { ok: false; error: unknown }> =
    new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        const value = await fn(items[i], i);
        results[i] = { ok: true, value };
        onItemSettled?.(i, value, undefined);
      } catch (error) {
        results[i] = { ok: false, error };
        onItemSettled?.(i, undefined, error);
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}
