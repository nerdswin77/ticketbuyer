import { useState } from 'react';
import { enableAlerts } from '../lib/alerts';
import type { FixtureAlerts, League, Profile } from '../types';
import { Modal } from './Modal';

interface Props {
  profile: Profile;
  leagues: League[];
  maxTickets: number;
  onSave: (prefs: Pick<Profile, 'fixture_alerts' | 'auto_preorder_favorites' | 'auto_preorder_quantity'>) => Promise<Profile | undefined>;
  onAnnounceNow: () => void;
  onClose: () => void;
}

const permission = () => ('Notification' in window ? Notification.permission : 'unsupported');

export function AlertsModal({ profile, leagues, maxTickets, onSave, onAnnounceNow, onClose }: Props) {
  const [alerts, setAlerts] = useState<FixtureAlerts>(profile.fixture_alerts);
  const [auto, setAuto] = useState(profile.auto_preorder_favorites);
  const [qty, setQty] = useState(profile.auto_preorder_quantity);
  const [perm, setPerm] = useState<string>(permission());
  const [saving, setSaving] = useState(false);
  const favNames = leagues.filter((l) => profile.favorite_leagues.includes(l.id)).map((l) => l.name);

  const save = async () => {
    setSaving(true);
    const ok = await onSave({ fixture_alerts: alerts, auto_preorder_favorites: auto, auto_preorder_quantity: qty });
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <Modal title="Alerts & fixture announcements" onClose={onClose}>
      <div className="form alerts-form">
        <section>
          <h4>Desktop notifications</h4>
          <div className="row between">
            <span className="small">
              Status:{' '}
              <b className={perm === 'granted' ? 'ok' : perm === 'denied' ? 'bad' : 'warn'}>
                {perm === 'granted' ? 'Enabled' : perm === 'denied' ? 'Blocked in browser settings' : perm === 'unsupported' ? 'Not supported' : 'Not enabled'}
              </b>
            </span>
            <button onClick={async () => setPerm(String(await enableAlerts()))} disabled={perm === 'granted' || perm === 'unsupported'}>
              🔔 Enable &amp; test sound
            </button>
          </div>
        </section>

        <section>
          <h4>Tell me when new fixtures are announced</h4>
          {(
            [
              ['all', 'All competitions', 'Any fixture in any league or cup'],
              ['favorites', 'My favourite leagues only', favNames.length ? favNames.join(', ') : 'Star competitions in the sidebar first'],
              ['off', 'Off', 'New fixtures still appear in “Just scheduled”, without sound or pop-ups'],
            ] as const
          ).map(([value, label, hint]) => (
            <label key={value} className={`radio-card ${alerts === value ? 'on' : ''}`}>
              <input type="radio" name="fixture-alerts" checked={alerts === value} onChange={() => setAlerts(value)} />
              <span>
                <b>{label}</b>
                <small>{hint}</small>
              </span>
            </label>
          ))}
        </section>

        <section>
          <h4>Automatic pre-order</h4>
          <label className="switch-row">
            <span>
              <span className="switch-label">Auto pre-order new fixtures in my favourite leagues</span>
              <span className="switch-hint">
                The moment a fixture is announced, it is queued to buy automatically when tickets go on sale. Uses your saved card,
                best position first, all zones except VIP.
              </span>
            </span>
            <input type="checkbox" className="switch" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          </label>
          {auto && (
            <div className="row">
              <label>
                Tickets per fixture
                <select value={qty} onChange={(e) => setQty(Number(e.target.value))}>
                  {Array.from({ length: maxTickets }, (_, i) => i + 1).map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
              {!favNames.length && <span className="bad small">You have no favourite leagues yet: star some in the sidebar.</span>}
            </div>
          )}
        </section>

        <section className="demo-box">
          <span className="small muted">Demo: fixtures are announced automatically every ~45 s.</span>
          <button className="mini" onClick={onAnnounceNow}>
            📅 Announce next fixture now
          </button>
        </section>

        <div className="form-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
