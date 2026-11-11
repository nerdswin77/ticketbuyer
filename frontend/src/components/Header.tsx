import type { Theme } from '../hooks/useTheme';
import { useNow } from '../hooks/useNow';
import { clockTime, countdown } from '../lib/format';
import type { Gateway, Profile } from '../types';

interface Props {
  connected: boolean;
  gateway: Gateway;
  profile: Profile;
  theme: Theme;
  onToggleTheme: () => void;
  onAlerts: () => void;
  onPayment: () => void;
  onProfile: () => void;
  onReset: () => void;
  newFixtures: number;
  nextAnnouncementAt: number | null;
  page: Page;
  onPage: (p: Page) => void;
  myBadge: number;
  watchBadge: number;
}

export type Page = 'tickets' | 'watch' | 'schedule' | 'mine';

export function Header(p: Props) {
  const now = useNow();
  return (
    <header className="header">
      <div className="brand">
        <span className="brand-mark" aria-hidden>
          ⚽
        </span>
        <span className="brand-text">
          KickOff<b>Tickets</b>
          <small>Instant football ticketing</small>
        </span>
      </div>
      <nav className="main-nav" aria-label="Pages">
        <button className={p.page === 'tickets' ? 'on' : ''} onClick={() => p.onPage('tickets')} aria-current={p.page === 'tickets'}>
          🎟 Tickets
        </button>
        <button className={p.page === 'schedule' ? 'on' : ''} onClick={() => p.onPage('schedule')} aria-current={p.page === 'schedule'}>
          📅 Schedule
        </button>
        <button className={`badge-host ${p.page === 'watch' ? 'on' : ''}`} onClick={() => p.onPage('watch')} aria-current={p.page === 'watch'}>
          🎯 Watchlist
          {p.watchBadge > 0 && <span className="count-badge">{p.watchBadge}</span>}
        </button>
        <button className={`badge-host ${p.page === 'mine' ? 'on' : ''}`} onClick={() => p.onPage('mine')} aria-current={p.page === 'mine'}>
          🎫 My tickets
          {p.myBadge > 0 && <span className="count-badge">{p.myBadge}</span>}
        </button>
      </nav>
      <span className="clock" title="Synced to server clock">
        {clockTime(now)}
      </span>
      <span className={`pill ${p.connected ? 'pill-ok' : 'pill-bad'}`}>
        <span className="dot" /> {p.connected ? 'Live' : 'Reconnecting'}
      </span>
      <span className="pill">{p.gateway === 'stripe' ? 'Stripe' : 'Test payments'}</span>
      {p.nextAnnouncementAt && (
        <span className="pill pill-blue" title="Next fixture announcement">
          📅 Next fixtures in {countdown(p.nextAnnouncementAt - now)}
        </span>
      )}
      <span className="spacer" />
      <button className="ghost badge-host" onClick={p.onAlerts} title="Fixture alerts, auto pre-order and notifications">
        🔔 Alerts
        {p.newFixtures > 0 && <span className="count-badge">{p.newFixtures}</span>}
      </button>
      <button className={`ghost ${p.profile.has_payment_method ? '' : 'btn-warn'}`} onClick={p.onPayment}>
        💳 {p.profile.has_payment_method ? `${p.profile.card_brand?.toUpperCase()} •••• ${p.profile.card_last4}` : 'Add card'}
      </button>
      <button className="ghost" onClick={p.onProfile}>
        👤 {p.profile.full_name || 'Profile'}
      </button>
      <button className="ghost" onClick={p.onReset} title="Generate a new demo sale schedule">
        ↻ Reset demo
      </button>
      <button
        className="ghost icon"
        onClick={p.onToggleTheme}
        title={p.theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
        aria-label="Toggle theme"
      >
        {p.theme === 'light' ? '🌙' : '☀️'}
      </button>
    </header>
  );
}
