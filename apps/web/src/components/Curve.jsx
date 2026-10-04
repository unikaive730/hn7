import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/** The discovery curve: our ordering against the band random ordering falls in.
 *
 *  The single speedup number is the headline. This is the shape behind it,
 *  and it is where the lead is visible over the whole run instead of at one
 *  point.
 */
export function DiscoveryCurve({ data, targets }) {
  if (!data?.points?.length) return null;

  const points = data.points.map((p) => ({
    ...p,
    band: [p.random_low, p.random_high],
  }));

  // The assay where the ordering has them all, read off the curve itself.
  const allFoundAt = targets ? points.find((p) => p.agent >= targets)?.assay : null;
  const lastAssay = points[points.length - 1]?.assay;
  const xTicks = [1, 10, 20, allFoundAt, lastAssay].filter(
    (v, i, a) => v != null && a.indexOf(v) === i,
  );
  const yTicks = targets
    ? [...new Set([...Array(Math.floor(targets / 5) + 1).keys()].map((i) => i * 5).concat(targets))]
    : undefined;

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 18, left: -22 }}>
          <defs>
            <linearGradient id="agentFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#fbbf24" stopOpacity={0.18} />
              <stop offset="100%" stopColor="#fbbf24" stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis
            dataKey="assay"
            stroke="rgba(255,255,255,0.3)"
            tick={{ fontSize: 11 }}
            tickLine={false}
            ticks={xTicks}
            label={{
              value: 'assays spent',
              position: 'insideBottom',
              offset: -8,
              fill: 'rgba(255,255,255,0.3)',
              fontSize: 11,
            }}
          />
          <YAxis
            stroke="rgba(255,255,255,0.3)"
            tick={{ fontSize: 11 }}
            tickLine={false}
            ticks={yTicks}
            domain={[0, targets ?? 'auto']}
          />
          <Tooltip
            contentStyle={{
              background: '#12121a',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 8,
              fontSize: 12,
            }}
            labelFormatter={(value) => `after ${value} assays`}
            formatter={(value, name) => {
              if (name === 'band') return [`${value[0]}–${value[1]}`, 'random, 10th–90th'];
              if (name === 'agent') return [value, 'this lab'];
              if (name === 'random_median') return [value, 'random, median'];
              return [value, name];
            }}
          />

          <Area
            dataKey="band"
            type="stepAfter"
            stroke="rgba(255,255,255,0.22)"
            strokeWidth={1}
            fill="rgba(255,255,255,0.14)"
            isAnimationActive={false}
          />
          <Line
            dataKey="random_median"
            type="stepAfter"
            stroke="rgba(255,255,255,0.55)"
            strokeWidth={1.5}
            strokeDasharray="4 4"
            dot={false}
            isAnimationActive={false}
          />
          <Area
            dataKey="agent"
            type="stepAfter"
            stroke="#fbbf24"
            strokeWidth={2.5}
            fill="url(#agentFill)"
            dot={false}
            animationDuration={450}
          />
          {allFoundAt != null && (
            <ReferenceLine
              x={allFoundAt}
              stroke="rgba(251,191,36,0.55)"
              strokeDasharray="3 3"
              label={{
                value: `all ${targets} found`,
                position: 'insideTopRight',
                fill: 'rgba(251,191,36,0.9)',
                fontSize: 10,
              }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
