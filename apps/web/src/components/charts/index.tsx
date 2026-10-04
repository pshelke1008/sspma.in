import {
  Bar,
  BarChart as ReBarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart as ReLineChart,
  Pie,
  PieChart as RePieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatCurrency } from '@/lib/utils/format';
import { ChartTooltip } from './ChartTooltip';
import { AXIS_STYLE, GRID_COLOR, seriesColor, shortAmount } from './palette';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import { EmptyState } from '../common/states';

export interface SeriesSpec {
  key: string;
  label: string;
  color?: string;
}

/**
 * Every chart here is wrapped in ResponsiveContainer and paired with an
 * accessible data table summary, so the information is never colour-only.
 */
function ChartFrame({
  height,
  children,
  summary,
}: {
  height: number;
  children: React.ReactElement;
  summary: string;
}) {
  return (
    <figure className="w-full">
      <div style={{ width: '100%', height }} role="img" aria-label={summary}>
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
      <figcaption className="sr-only">{summary}</figcaption>
    </figure>
  );
}

export function BarChart({
  data,
  xKey,
  series,
  height = 260,
  stacked,
  horizontal,
  valueFormatter = (value: number) => formatCurrency(value),
}: {
  data: Record<string, unknown>[];
  xKey: string;
  series: SeriesSpec[];
  height?: number;
  stacked?: boolean;
  horizontal?: boolean;
  valueFormatter?: (value: number) => string;
}) {
  if (!data.length) return <EmptyState title={i18n.t('states.noChartData')} description={i18n.t('states.noChartDataHint')} />;

  const summary = i18n.t('states.barChartSummary', { series: series.map((s) => s.label).join(', '), count: data.length });

  return (
    <ChartFrame height={height} summary={summary}>
      <ReBarChart
        data={data}
        layout={horizontal ? 'vertical' : 'horizontal'}
        margin={{ top: 8, right: 8, bottom: 0, left: horizontal ? 8 : -12 }}
        barGap={4}
      >
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={horizontal} horizontal={!horizontal} />
        {horizontal ? (
          <>
            <XAxis type="number" tick={AXIS_STYLE} tickFormatter={shortAmount} axisLine={false} tickLine={false} />
            <YAxis
              type="category"
              dataKey={xKey}
              tick={AXIS_STYLE}
              width={92}
              axisLine={false}
              tickLine={false}
            />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} tick={AXIS_STYLE} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={AXIS_STYLE} tickFormatter={shortAmount} axisLine={false} tickLine={false} width={52} />
          </>
        )}
        <Tooltip content={<ChartTooltip valueFormatter={valueFormatter} />} cursor={{ fill: 'rgba(8,102,255,0.05)' }} />
        {series.length > 1 && (
          <Legend
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 12, color: '#626F84', paddingTop: 8 }}
          />
        )}
        {series.map((item, index) => (
          <Bar
            key={item.key}
            dataKey={item.key}
            name={item.label}
            fill={item.color ?? seriesColor(index)}
            radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
            stackId={stacked ? 'stack' : undefined}
            maxBarSize={horizontal ? 18 : 38}
          />
        ))}
      </ReBarChart>
    </ChartFrame>
  );
}

export function LineChart({
  data,
  xKey,
  series,
  height = 260,
  valueFormatter = (value: number) => formatCurrency(value),
}: {
  data: Record<string, unknown>[];
  xKey: string;
  series: SeriesSpec[];
  height?: number;
  valueFormatter?: (value: number) => string;
}) {
  if (!data.length) return <EmptyState title={i18n.t('states.noChartData')} description={i18n.t('states.noChartDataHint')} />;

  const summary = i18n.t('states.lineChartSummary', { series: series.map((s) => s.label).join(', '), count: data.length });

  return (
    <ChartFrame height={height} summary={summary}>
      <ReLineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
        <XAxis dataKey={xKey} tick={AXIS_STYLE} axisLine={false} tickLine={false} interval="preserveStartEnd" />
        <YAxis tick={AXIS_STYLE} tickFormatter={shortAmount} axisLine={false} tickLine={false} width={52} />
        <Tooltip content={<ChartTooltip valueFormatter={valueFormatter} />} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: '#626F84', paddingTop: 8 }} />
        {series.map((item, index) => (
          <Line
            key={item.key}
            type="monotone"
            dataKey={item.key}
            name={item.label}
            stroke={item.color ?? seriesColor(index)}
            strokeWidth={2}
            dot={{ r: 2.5 }}
            activeDot={{ r: 4 }}
          />
        ))}
      </ReLineChart>
    </ChartFrame>
  );
}

export function DonutChart({
  data,
  height = 240,
  valueFormatter = (value: number) => formatCurrency(value),
  centerLabel,
}: {
  data: { name: string; value: number }[];
  height?: number;
  valueFormatter?: (value: number) => string;
  centerLabel?: { title: string; value: string };
}) {
  useTranslation();
  const filtered = data.filter((item) => item.value > 0);
  if (!filtered.length) {
    return <EmptyState title={i18n.t('states.nothingToShow')} description={i18n.t('states.nothingToShowHint')} />;
  }

  const total = filtered.reduce((sum, item) => sum + item.value, 0);
  const summary = i18n.t('states.donutChartSummary', {
    items: filtered.map((item) => `${item.name}: ${valueFormatter(item.value)}`).join('; '),
  });

  // The legend sits below the ring rather than beside it: these cards are often
  // only ~380px wide, and a side-by-side legend clips the category names.
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative w-full max-w-[280px]">
        <ChartFrame height={height} summary={summary}>
          <RePieChart>
            <Pie
              data={filtered}
              dataKey="value"
              nameKey="name"
              innerRadius="58%"
              outerRadius="84%"
              paddingAngle={2}
              stroke="#fff"
              strokeWidth={2}
            >
              {filtered.map((entry, index) => (
                // Recharts marks each sector role="img"; give it a name so the
                // sector is not an unlabelled image to assistive technology.
                <Cell
                  key={entry.name}
                  fill={seriesColor(index)}
                  aria-label={`${entry.name}: ${valueFormatter(entry.value)}`}
                />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip valueFormatter={valueFormatter} />} />
          </RePieChart>
        </ChartFrame>
        {centerLabel && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[11px] text-ink-muted">{centerLabel.title}</span>
            <span className="text-[16px] font-semibold text-ink tnum">{centerLabel.value}</span>
          </div>
        )}
      </div>

      {/* The legend doubles as the accessible value listing. */}
      <ul className="w-full space-y-1.5">
        {filtered.map((item, index) => (
          <li key={item.name} className="flex items-center gap-2 text-[12.5px]">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: seriesColor(index) }}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate text-ink-muted">{item.name}</span>
            <span className="shrink-0 font-semibold text-ink tnum">{valueFormatter(item.value)}</span>
            <span className="w-10 shrink-0 text-right text-[11px] text-ink-muted tnum">
              {total > 0 ? `${Math.round((item.value / total) * 100)}%` : '0%'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
