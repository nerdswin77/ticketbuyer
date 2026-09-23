import { useCallback, useEffect, useRef, useState } from 'react';
import { useNow } from '../hooks/useNow';
import { countdown, inZone } from '../lib/format';
import type { Match, Watch } from '../types';
import { TeamCrest } from './Crest';
import { BuyButton } from './MatchGrid';

interface Props {
  matches: Match[];
  watchByMatch: Map<number, Watch>;
  onPreorder: (m: Match) => void;
  onOpen: (m: Match) => void;
  onDismiss: (id: number) => void;
}

const AUTO_DISMISS_MS = 6_000;
const FADE_MS = 450;

/** Fade out after `ms`; hovering pauses the timer, leaving restarts a shorter one. */
export function useAutoDismiss(onDone: () => void, ms: number) {
  const [leaving, setLeaving] = useState(false);
  const timer = useRef<number>();
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const start = useCallback((delay: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setLeaving(true);
      timer.current = window.setTimeout(() => doneRef.current(), FADE_MS);
    }, delay);
  }, []);
  useEffect(() => {
    start(ms);
    return () => window.clearTimeout(timer.current);
  }, [ms, start]);
  return {
    leaving,
    hold: () => {
      window.clearTimeout(timer.current);
      setLeaving(false);
    },
    release: () => start(2500),
  };
}

/** Live pop-ups for fixtures announced while the page is open. */
export function FixtureToasts({ matches, watchByMatch, onPreorder, onOpen, onDismiss }: Props) {
  if (!matches.length) return null;
  return (
    <div className="fixture-toasts" role="region" aria-label="New fixture announcements">
      {matches.slice(0, 3).map((m) => (
        <FixtureToast key={m.id} match={m} watch={watchByMatch.get(m.id)} onPreorder={onPreorder} onOpen={onOpen} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

export function SuccessToast({ title, detail, onView, onDismiss }: { title: string; detail: string; onView: () => void; onDismiss: () => void }) {
  const { leaving, hold, release } = useAutoDismiss(onDismiss, 8_000);
  return (
    <div className={`toast-success ${leaving ? 'leaving' : ''}`} role="status" onMouseEnter={hold} onMouseLeave={release}>
      <span className="toast-icon">✓</span>
      <div className="grow">
        <b>{title}</b>
        <span>{detail}</span>
      </div>
      <button className="primary" onClick={onView}>
        View seats
      </button>
      <button className="ghost icon" aria-label="Dismiss" onClick={onDismiss}>
        ✕
      </button>
    </div>
  );
}

function FixtureToast({
  match: m,
  watch,
  onPreorder,
  onOpen,
  onDismiss,
}: {
  match: Match;
  watch: Watch | undefined;
  onPreorder: (m: Match) => void;
  onOpen: (m: Match) => void;
  onDismiss: (id: number) => void;
}) {
  const now = useNow();
  const { leaving, hold, release } = useAutoDismiss(() => onDismiss(m.id), AUTO_DISMISS_MS);
  const saleIn = m.sale_opens_at_ms - now;

  return (
    <div className={`fixture-toast ${leaving ? 'leaving' : ''}`} role="status" onMouseEnter={hold} onMouseLeave={release}>
      <div className="ft-top">
        <span className="ft-badge">📅 New fixture announced</span>
        <button className="js-close" aria-label="Dismiss" onClick={() => onDismiss(m.id)}>
          ✕
        </button>
      </div>
      <button className="ft-fixture" onClick={() => onOpen(m)}>
        <TeamCrest team={m.home_team} size={34} />
        <span>
          <b>{m.home_team}</b> v <b>{m.away_team}</b>
          <small>
            {inZone(m.kickoff_ms, m.timezone, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} ·{' '}
            {m.stadium}
          </small>
        </span>
        <TeamCrest team={m.away_team} size={34} />
      </button>
      <div className="ft-bottom">
        <span className={saleIn > 0 ? 'warn' : 'ok'}>
          {m.sale_date_tba ? 'Sale date TBA' : saleIn > 0 ? `On sale in ${countdown(saleIn)}` : 'On sale now'}
        </span>
        <BuyButton match={m} watch={watch} onBuy={() => onPreorder(m)} />
      </div>
    </div>
  );
}
