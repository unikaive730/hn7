import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
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

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 4, left: -22 }}>
          <defs>
            <linearGradient id="agentFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#fbbf24" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#fbbf24" stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis
            dataKey="assay"
            stroke="rgba(255,255,255,0.3)"
            tick={{ fontSize: 11 }}
            tickLine={false}
            label={{
              value: 'assays spent',
              position: 'insideBottom',
              offset: -2,
              fill: 'rgba(255,255,255,0.3)',
              fontSize: 11,
            }}
          />
          <YAxis
            stroke="rgba(255,255,255,0.3)"
            tick={{ fontSize: 11 }}
            tickLine={false}
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
            stroke="none"
            fill="rgba(255,255,255,0.07)"
            isAnimationActive={false}
          />
          <Line
            dataKey="random_median"
            stroke="rgba(255,255,255,0.35)"
            strokeWidth={1.5}
            strokeDasharray="4 4"
            dot={false}
            isAnimationActive={false}
          />
          <Area
            dataKey="agent"
            stroke="#fbbf24"
            strokeWidth={2.5}
            fill="url(#agentFill)"
            dot={false}
            animationDuration={900}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
