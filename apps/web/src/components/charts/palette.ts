/** Chart colours drawn from the product palette so charts read as one system. */
export const CHART_COLORS = [
  '#0866FF',
  '#F59E0B',
  '#22A06B',
  '#9B6BD6',
  '#0E7490',
  '#D64545',
  '#DB2777',
  '#64748B',
];

export const AXIS_STYLE = {
  fontSize: 11,
  fill: '#626F84',
};

export const GRID_COLOR = '#DCE0E6';

export function seriesColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length];
}

/** Axis tick formatter: 1.2L / 45K — keeps long rupee values readable. */
export function shortAmount(value: number): string {
  const amount = Math.abs(value);
  if (amount >= 10_000_000) return `${(value / 10_000_000).toFixed(1)}Cr`;
  if (amount >= 100_000) return `${(value / 100_000).toFixed(1)}L`;
  if (amount >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return String(value);
}
