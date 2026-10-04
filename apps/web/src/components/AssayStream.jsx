import { motion, AnimatePresence } from 'framer-motion';
import { memo } from 'react';
import { Beaker, Check, HelpCircle } from 'lucide-react';

/** The assay queue, revealed one at a time.
 *
 *  Watching the hits land in the first few positions is the argument: the
 *  ordering is doing work. A molecule on a scaffold the model never saw is
 *  marked, because that is where the hypothesis later breaks.
 */
export function AssayStream({ assays, revealed, onOpen }) {
  const visible = assays.slice(0, revealed);

  return (
    <div className="space-y-1.5">
      <AnimatePresence initial={false}>
        {visible.map((assay) => (
          <Row key={`${assay.cid}-${assay.position}`} assay={assay} onOpen={onOpen} />
        ))}
      </AnimatePresence>

      {assays.slice(0, revealed).some((a) => !a.scaffold_seen) && (
        <p className="cap px-1 pt-1 text-white/40 sm:hidden">
          new = a scaffold the model never saw in training.
        </p>
      )}

      {revealed < assays.length && (
        <div className="flex items-center gap-2 px-3 py-2 text-xs text-white/35">
          <HelpCircle className="h-3.5 w-3.5" />
          {assays.length - revealed} more queued
        </div>
      )}
    </div>
  );
}

/* A row never changes once it is on screen, so memoising it keeps a long
 * reveal from re-rendering every earlier row on every step. */
const Row = memo(function Row({ assay, onOpen }) {
  return (
      <motion.button
        onClick={() => onOpen?.(assay.cid)}
        initial={{ opacity: 0, x: -14, scale: 0.98 }}
        animate={{ opacity: 1, x: 0, scale: 1 }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-sm transition hover:border-white/20 sm:gap-3 sm:px-3 ${
          assay.is_target
            ? 'border-signal/40 bg-signal/10'
            : 'border-white/5 bg-white/[0.02]'
        }`}
      >
        <span className="w-5 shrink-0 text-right text-xs tabular text-white/40 sm:w-7">
          {assay.position}
        </span>

        <span className="shrink-0">
          {assay.is_target ? (
            <Check className="h-4 w-4 text-signal" />
          ) : (
            <Beaker className="h-4 w-4 text-white/25" />
          )}
        </span>

        <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-white/80">
          {assay.name}
        </span>

        {!assay.scaffold_seen && (
          <span
            className="shrink-0 rounded border border-hive-400/30 px-1.5 py-0.5 cap-sm font-mono text-hive-400"
            title="This molecule sits on a scaffold the model never saw in training"
          >
            {/* The full words need room the phone does not have; the title and
                the legend in the Chemistry section carry the meaning. */}
            <span className="sm:hidden">new</span>
            <span className="hidden sm:inline">new scaffold</span>
          </span>
        )}

        <span className="w-9 shrink-0 text-right text-xs tabular text-white/45 sm:w-12">
          {assay.safe_score.toFixed(2)}
        </span>
      </motion.button>
  );
});
