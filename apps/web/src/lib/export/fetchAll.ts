import type { ExportResult } from './types';

/** Upper bound on rows in one export; beyond this the user is told to narrow the filters. */
export const EXPORT_MAX_ROWS = 10_000;

interface PageResponse<T> {
  data: T[];
  meta: { total: number; totalPages: number };
}

/**
 * Walks a paginated list endpoint page by page until every row matching the
 * current filters is collected (or the ceiling is reached).
 */
export async function fetchAllPages<T>(
  fetchPage: (page: number, pageSize: number) => Promise<PageResponse<T>>,
  options: { pageSize?: number; maxRows?: number; signal?: AbortSignal } = {},
): Promise<ExportResult<T>> {
  const pageSize = options.pageSize ?? 100;
  const maxRows = options.maxRows ?? EXPORT_MAX_ROWS;
  const rows: T[] = [];
  let total = 0;
  let page = 1;

  for (;;) {
    if (options.signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
    const response = await fetchPage(page, pageSize);
    total = response.meta.total;
    rows.push(...response.data);
    if (rows.length >= maxRows || page >= response.meta.totalPages || response.data.length === 0) break;
    page += 1;
  }

  return { rows: rows.slice(0, maxRows), total, capped: total > maxRows };
}
