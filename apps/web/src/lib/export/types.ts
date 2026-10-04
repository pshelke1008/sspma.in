export type ExportCellType = 'text' | 'number' | 'currency' | 'date';

/** A plain value a spreadsheet cell can hold. Dates travel as ISO strings. */
export type ExportValue = string | number | boolean | null | undefined;

/**
 * One exported column. `value` returns the raw value (a number for money, an
 * ISO date string for dates) — never formatted display text — so the CSV and
 * the workbook can both type the cell properly.
 */
export interface ExportColumn<T> {
  header: string;
  type?: ExportCellType;
  value: (row: T) => ExportValue;
}

export interface ExportResult<T> {
  rows: T[];
  /** Number of rows that matched the filters on the server. */
  total: number;
  /** True when `total` exceeded the export ceiling and only the first rows were taken. */
  capped: boolean;
}
