import { useEffect, useId, useRef, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';

/** Slim sticky nav. It lists only the sections that exist on the page (other
 *  panels mount after their data arrives, so it keeps checking), and marks the
 *  one under the reading line. */

const SECTIONS = [
  { id: 'lab', label: 'Lab' },
  { id: 'agents', label: 'Agents' },
  { id: 'discovery', label: 'Discovery' },
  { id: 'chemistry', label: 'Chemistry' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'rigor', label: 'Rigor' },
  { id: 'candidates', label: 'Candidates' },
  { id: 'method', label: 'Method' },
];

const REPO = 'https://github.com/unikaive730/hn7';

function presentIds() {
  return SECTIONS.filter((s) => document.getElementById(s.id)).map((s) => s.id);
}

export function BeeMark({ className = 'h-5 w-5' }) {
  // The nav and the footer both draw this mark, so the clip id must differ.
  const clipId = `beemark-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        <clipPath id={clipId}>
          <ellipse cx="32" cy="39.5" rx="8" ry="12" />
        </clipPath>
      </defs>
      <path
        d="M32 4 56.2 18v28L32 60 7.8 46V18Z"
        fill="#fbbf24"
        stroke="#fbbf24"
        strokeWidth="5"
        strokeLinejoin="round"
      />
      <ellipse cx="22" cy="25.5" rx="9.5" ry="5.4" transform="rotate(-30 22 25.5)" fill="#fff4cf" stroke="#0a0a0f" strokeWidth="2.4" />
      <ellipse cx="42" cy="25.5" rx="9.5" ry="5.4" transform="rotate(30 42 25.5)" fill="#fff4cf" stroke="#0a0a0f" strokeWidth="2.4" />
      <circle cx="32" cy="17.5" r="4.6" fill="#0a0a0f" />
      <ellipse cx="32" cy="27.5" rx="5.6" ry="5" fill="#0a0a0f" />
      <ellipse cx="32" cy="39.5" rx="8" ry="12" fill="#0a0a0f" />
      <g clipPath={`url(#${clipId})`} fill="#fbbf24">
        <rect x="20" y="35" width="24" height="3.2" />
        <rect x="20" y="42" width="24" height="3.2" />
      </g>
    </svg>
  );
}

export default function SiteNav() {
  const [present, setPresent] = useState([]);
  const [active, setActive] = useState(null);
  const [scrolled, setScrolled] = useState(false);
  const listRef = useRef(null);
  const linkRefs = useRef({});

  // Which sections exist. Re-checked when the DOM changes, debounced.
  useEffect(() => {
    let timer = null;
    const check = () => {
      const ids = presentIds();
      setPresent((prev) => (prev.join() === ids.join() ? prev : ids));
    };
    check();
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(check, 150);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, []);

  // Which section is under the reading line (30% down the viewport).
  useEffect(() => {
    let frame = null;
    const measure = () => {
      frame = null;
      setScrolled(window.scrollY > 8);
      const line = window.innerHeight * 0.3;
      let current = null;
      for (const id of present) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) current = id;
      }
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      if (atBottom && present.length) current = present[present.length - 1];
      setActive(current);
    };
    const onScroll = () => {
      if (frame == null) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame != null) cancelAnimationFrame(frame);
    };
  }, [present]);

  // On narrow screens the list scrolls sideways; keep the active item in view.
  useEffect(() => {
    const list = listRef.current;
    const link = active ? linkRefs.current[active] : null;
    if (!list || !link || list.scrollWidth <= list.clientWidth) return;
    const target = link.offsetLeft - list.clientWidth / 2 + link.clientWidth / 2;
    list.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
  }, [active]);

  const items = SECTIONS.filter((s) => present.includes(s.id));

  return (
    <nav
      aria-label="Sections"
      className={`sticky top-0 z-50 h-12 border-b transition-colors duration-300 ${
        scrolled
          ? 'border-wax/10 bg-night-950/85 backdrop-blur-md'
          : 'border-transparent bg-night-950/40 backdrop-blur-sm'
      }`}
    >
      <div className="mx-auto flex h-full max-w-6xl items-center gap-3 px-4 sm:px-6 md:px-8">
        <a
          href="#top"
          className="flex shrink-0 items-center gap-2 text-wax/90 transition-colors hover:text-wax"
          aria-label="BeeGuard Lab, back to top"
        >
          <BeeMark className="h-5 w-5" />
          <span className="font-serif-display hidden text-[17px] leading-none sm:inline">BeeGuard Lab</span>
        </a>

        <span className="hidden h-4 w-px shrink-0 bg-wax/15 sm:block" aria-hidden="true" />

        <ul ref={listRef} className="fade-x flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {items.map((s) => {
            const on = s.id === active;
            return (
              <li key={s.id} className="shrink-0">
                <a
                  ref={(el) => {
                    linkRefs.current[s.id] = el;
                  }}
                  href={`#${s.id}`}
                  aria-current={on ? 'true' : undefined}
                  className={`relative block px-2.5 py-3 text-[13px] transition-colors ${
                    on ? 'text-wax' : 'text-wax/50 hover:text-wax/85'
                  }`}
                >
                  {s.label}
                  <span
                    className={`absolute inset-x-2.5 bottom-[7px] h-px origin-left bg-hive-400 transition-transform duration-300 ${
                      on ? 'scale-x-100' : 'scale-x-0'
                    }`}
                    aria-hidden="true"
                  />
                </a>
              </li>
            );
          })}
        </ul>

        <a
          href={REPO}
          target="_blank"
          rel="noreferrer"
          className="hidden shrink-0 items-center gap-1 font-mono text-[11px] text-wax/55 transition-colors hover:text-hive-400 md:inline-flex"
        >
          Code
          <ArrowUpRight className="h-3 w-3" />
        </a>
      </div>
    </nav>
  );
}
