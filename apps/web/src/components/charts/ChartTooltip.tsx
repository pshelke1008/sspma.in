import { formatCurrency } from '@/lib/utils/format';

interface TooltipPayloadItem {
  name?: string;
  value?: number | string;
  color?: string;
  payload?: Record<string, unknown>;
}

export function ChartTooltip({
  active,
  payload,
  label,
  valueFormatter = (value: number) => formatCurrency(value),
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string | number;
  valueFormatter?: (value: number) => string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-control border border-line bg-white px-3 py-2 shadow-pop">
      {label !== undefined && label !== '' && (
        <p className="mb-1 text-[11.5px] font-semibold text-ink">{String(label)}</p>
      )}
      <ul className="space-y-0.5">
        {payload.map((item, index) => (
          <li key={index} className="flex items-center gap-2 text-[12px]">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: item.color }}
              aria-hidden="true"
            />
            <span className="text-ink-muted">{item.name}</span>
            <span className="ml-auto font-semibold text-ink tnum">{valueFormatter(Number(item.value ?? 0))}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
