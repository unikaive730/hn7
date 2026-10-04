import { motion, useMotionValue, useTransform, animate } from 'framer-motion';
import { useEffect, useState } from 'react';

/** A number that counts to its new value instead of snapping, so a change reads
 *  as the lab having learned something rather than the page having re-rendered. */
export function Counter({ value, decimals = 0, suffix = '', className = '' }) {
  const motionValue = useMotionValue(0);
  const [shown, setShown] = useState('0');

  useEffect(() => {
    const controls = animate(motionValue, value ?? 0, {
      duration: 0.75,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (latest) => setShown(latest.toFixed(decimals)),
    });
    return () => controls.stop();
  }, [value, decimals, motionValue]);

  return (
    <span className={`tabular ${className}`}>
      {shown}
      {suffix}
    </span>
  );
}

/** The speedup dial: the one number a judge should remember. */
export function SpeedupDial({ speedup, found, total, budget, label = 'fewer assays than random' }) {
  const ratio = Math.min((speedup ?? 0) / 10, 1);
  const circumference = 2 * Math.PI * 54;

  return (
    <div className="grid place-items-center">
      <div className="relative grid place-items-center">
      <svg viewBox="0 0 128 128" className="h-44 w-44 -rotate-90">
        <circle
          cx="64"
          cy="64"
          r="54"
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth="10"
        />
        <motion.circle
          cx="64"
          cy="64"
          r="54"
          fill="none"
          stroke="url(#dialGradient)"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference * (1 - ratio) }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
        />
        <defs>
          <linearGradient id="dialGradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#fbbf24" />
            <stop offset="100%" stopColor="#34d399" />
          </linearGradient>
        </defs>
      </svg>

      <div className="absolute grid place-items-center text-center">
        <div className="text-[2.6rem] font-semibold leading-none text-hive-400">
          <Counter value={speedup ?? 0} decimals={2} suffix="×" />
        </div>
        <div className="mt-1.5 cap max-w-[8rem] font-mono leading-tight text-white/50">{label}</div>
      </div>
      </div>
      <div className="mt-2 text-xs text-white/55">
        <Counter value={found ?? 0} /> of {total ?? 0} found in {budget ?? 0} assays
      </div>
    </div>
  );
}
