import { useMemo, useState, type ReactNode } from 'react';
import { clockTime } from '../lib/format';
import type { LogEntry, LogLevel } from '../types';

type Filter = 'all' | LogLevel;

const LEVELS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'ok', label: 'Success' },
  { key: 'info', label: 'Info' },
  { key: 'warn', label: 'Alerts' },
  { key: 'error', label: 'Errors' },
];

const ICON: Record<LogLevel, string> = { info: 'i', ok: '✓', warn: '!', error: '✕' };

// Leading emoji/symbols are replaced by the level icon for a consistent look.
const LEADING_SYMBOLS = /^[\p{Extended_Pictographic}️\s]+/u;
// Highlight latencies, money, order ids and countdowns inside messages.
const HIGHLIGHT = /(\d+ ms|€[\d,.]+|KO-[A-F0-9]{6}|\d+(?:\.\d)?s\b)/g;

function renderMessage(msg: string): ReactNode[] {
  const clean = msg.replace(LEADING_SYMBOLS, '');
  return clean.split(HIGHLIGHT).map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part));
}

export function EventLog({ logs }: { logs: LogEntry[] }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [clearedAt, setClearedAt] = useState(0);

  const visible = useMemo(() => logs.filter((l) => l.ts > clearedAt), [logs, clearedAt]);
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: visible.length, info: 0, ok: 0, warn: 0, error: 0 };
    for (const l of visible) c[l.level]++;
    return c;
  }, [visible]);
  const shown = filter === 'all' ? visible : visible.filter((l) => l.level === filter);

  return (
    <section className="panel log-panel">
      <div className="log-header">
        <h2>
          <span className="live-dot" /> Engine log
        </h2>
        <div className="segmented" role="tablist">
          {LEVELS.map((l) => (
            <button
              key={l.key}
              role="tab"
              aria-selected={filter === l.key}
              className={`seg seg-${l.key} ${filter === l.key ? 'on' : ''}`}
              onClick={() => setFilter(l.key)}
            >
              {l.label}
              <span className="seg-count">{counts[l.key]}</span>
            </button>
          ))}
        </div>
        <button className="ghost small" onClick={() => setClearedAt(Date.now())} disabled={!visible.length}>
          Clear
        </button>
      </div>

      <ol className="log-list">
        {shown.length === 0 && (
          <li className="log-empty">{visible.length ? 'Nothing in this category.' : 'Waiting for engine activity…'}</li>
        )}
        {shown.map((l, i) => (
          <li key={`${l.ts}-${i}`} className={`log-row lvl-${l.level}`}>
            <span className="log-icon" aria-hidden>
              {ICON[l.level]}
            </span>
            <span className="log-msg">{renderMessage(l.message)}</span>
            <time className="log-time">{clockTime(l.ts, true)}</time>
          </li>
        ))}
      </ol>
    </section>
  );
}
