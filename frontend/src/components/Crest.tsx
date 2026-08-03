import { useId, useState } from 'react';
import { LEAGUE_BRAND, leagueLogoUrl, teamBrand, teamLogoUrl } from '../lib/brand';

/** Official club crest on a neutral plate (readable in light and dark themes). */
/** Official club crest on a neutral plate. Tries local artwork, then a crest URL from the fixtures feed, then a drawn badge. */
export function TeamCrest({ team, size = 44, url }: { team: string; size?: number; url?: string | null }) {
  const sources = [teamLogoUrl(team), url].filter((s): s is string => !!s);
  const [attempt, setAttempt] = useState(0);
  const src = sources[attempt];
  return (
    <span className="crest-plate" style={{ width: size, height: size }}>
      {!src ? (
        <FallbackCrest team={team} size={size * 0.8} />
      ) : (
        <img
          key={src}
          src={src}
          alt={`${team} crest`}
          width={size * 0.78}
          height={size * 0.78}
          loading="lazy"
          onError={() => setAttempt((a) => a + 1)}
        />
      )}
    </span>
  );
}

/** Official competition logo on a white tile. */
export function LeagueLogo({ leagueId, size = 36 }: { leagueId: string; size?: number }) {
  const url = leagueLogoUrl(leagueId);
  const [failed, setFailed] = useState(false);
  if (failed || !url) return <FallbackLeague leagueId={leagueId} size={size} />;
  return (
    <span className="league-logo" style={{ width: size, height: size }}>
      <img src={url} alt={`${leagueId} logo`} loading="lazy" onError={() => setFailed(true)} />
    </span>
  );
}

// ------------------------------------------------------------------ drawn fallbacks

const SHIELD = 'M20 1.5 L37.5 6 V21 C37.5 33 30 40.5 20 44.5 C10 40.5 2.5 33 2.5 21 V6 Z';

function FallbackCrest({ team, size }: { team: string; size: number }) {
  const b = teamBrand(team);
  const clip = useId();
  return (
    <svg width={size} height={size * 1.15} viewBox="0 0 40 46" role="img" aria-label={`${team} crest`}>
      <defs>
        <clipPath id={clip}>
          <path d={SHIELD} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <rect width="40" height="46" fill={b.primary} />
        {b.pattern === 'split' && <rect x="20" width="20" height="46" fill={b.secondary} />}
        {b.pattern === 'stripes' && [8, 20, 32].map((x) => <rect key={x} x={x - 3} width="6" height="46" fill={b.secondary} />)}
        {b.pattern === 'band' && <path d="M-4 30 L44 6 L44 18 L-4 42 Z" fill={b.secondary} />}
        {b.pattern === 'hoop' && <rect y="17" width="40" height="12" fill={b.secondary} />}
        {b.pattern === 'solid' && <path d={SHIELD} fill="none" stroke={b.secondary} strokeWidth="5" />}
      </g>
      <path d={SHIELD} fill="none" stroke="rgba(15,23,42,.22)" strokeWidth="1.2" />
      <rect x="7" y="17.5" width="26" height="11" rx="5.5" fill="rgba(255,255,255,.94)" />
      <text x="20" y="25.6" textAnchor="middle" fontSize={b.abbr.length > 3 ? 7 : 8.5} fontWeight="800" fill="#0f172a">
        {b.abbr}
      </text>
    </svg>
  );
}

function FallbackLeague({ leagueId, size }: { leagueId: string; size: number }) {
  const b = LEAGUE_BRAND[leagueId] ?? { short: leagueId.slice(0, 2), from: '#64748b', to: '#334155', country: '', region: 'europe' };
  const grad = useId();
  return (
    <svg className="league-logo-svg" width={size} height={size} viewBox="0 0 36 36" role="img" aria-label={`${leagueId} logo`}>
      <defs>
        <linearGradient id={grad} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={b.from} />
          <stop offset="1" stopColor={b.to} />
        </linearGradient>
      </defs>
      <rect width="36" height="36" rx="9" fill={`url(#${grad})`} />
      <circle cx="30" cy="6" r="14" fill="rgba(255,255,255,.08)" />
      {b.star && (
        <path d="M18 4.5 l1.6 3.3 3.6.5 -2.6 2.5 .6 3.6 -3.2-1.7 -3.2 1.7 .6-3.6 -2.6-2.5 3.6-.5z" fill="rgba(255,255,255,.9)" />
      )}
      <text
        x="18"
        y={b.star ? 28 : 23.5}
        textAnchor="middle"
        fontSize={b.short.length > 2 ? 9.5 : b.star ? 11 : 13}
        fontWeight="800"
        fill="#fff"
        fontFamily="system-ui, Segoe UI, sans-serif"
      >
        {b.short}
      </text>
    </svg>
  );
}
