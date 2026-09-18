import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api } from '../api';
import type { League, Match, Team } from '../types';
import { LeagueLogo, TeamCrest } from './Crest';
import { Modal } from './Modal';

interface Props {
  leagues: League[];
  defaultLeague?: string;
  onCreate: (body: Parameters<typeof api.addMatch>[0]) => Promise<Match>;
  onCreated: (m: Match) => void;
  onClose: () => void;
}

const CUPS = new Set(['UCL', 'UEL', 'UECL']);
const today = () => new Date().toISOString().slice(0, 10);

/** Add a fixture that isn't listed yet, then pre-order exact seats for it. */
export function AddMatchModal({ leagues, defaultLeague, onCreate, onCreated, onClose }: Props) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [league, setLeague] = useState(defaultLeague ?? 'LIGA');
  const [home, setHome] = useState('');
  const [away, setAway] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('21:00');
  const [timeTbc, setTimeTbc] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.teams().then(setTeams).catch((e) => setError(String(e)));
  }, []);

  // Domestic leagues list their own clubs; European cups can pair any clubs.
  const options = useMemo(
    () => teams.filter((t) => CUPS.has(league) || t.leagues.includes(league)).sort((a, b) => a.name.localeCompare(b.name)),
    [teams, league],
  );
  const homeTeam = teams.find((t) => t.name === home);

  useEffect(() => {
    if (home && !options.some((t) => t.name === home)) setHome('');
    if (away && !options.some((t) => t.name === away)) setAway('');
  }, [options, home, away]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!home || !away || !date) return setError('Choose both teams and the match date');
    if (home === away) return setError('Home and away team must be different');
    setSaving(true);
    try {
      const m = await onCreate({ league_id: league, home_team: home, away_team: away, date, time: timeTbc ? null : time });
      onCreated(m);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Add a match" onClose={onClose}>
      <form className="form add-match" onSubmit={submit}>
        <p className="muted small">
          Know about a fixture that isn't listed yet? Add it here. You can pick your exact seats and pre-order straight away.
          The order is bought automatically the moment the ticket sale opens.
        </p>
        <label>
          Competition
          <select value={league} onChange={(e) => setLeague(e.target.value)}>
            {leagues.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <div className="am-teams">
          <label>
            Home team
            <select value={home} onChange={(e) => setHome(e.target.value)} required>
              <option value="">Choose…</option>
              {options.map((t) => (
                <option key={t.name} value={t.name} disabled={!t.stadium}>
                  {t.name}
                  {!t.stadium ? ' (home ground unknown)' : ''}
                </option>
              ))}
            </select>
          </label>
          <span className="am-vs">vs</span>
          <label>
            Away team
            <select value={away} onChange={(e) => setAway(e.target.value)} required>
              <option value="">Choose…</option>
              {options
                .filter((t) => t.name !== home)
                .map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name}
                  </option>
                ))}
            </select>
          </label>
        </div>

