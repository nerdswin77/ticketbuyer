/**
 * Visual identity for competitions and clubs.
 * Official crests are served from /public/logos (downloaded from crests.football-data.org).
 * They are trademarks of their respective clubs and competitions. The colour data below is
 * used for the drawn fallback badge if an image is missing.
 */

const slug = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const SVG_LOGOS = new Set(['marseille']);
// No verified official artwork available: render the drawn badge directly (avoids 404 requests).
const NO_TEAM_LOGO = new Set(['rangers', 'hearts', 'hibernian', 'aberdeen']);
const NO_LEAGUE_LOGO = new Set(['TUR', 'BEL', 'BRA', 'UECL']);

export function teamLogoUrl(team: string): string | null {
  const s = slug(team);
  if (NO_TEAM_LOGO.has(s)) return null;
  return `/logos/teams/${s}.${SVG_LOGOS.has(s) ? 'svg' : 'png'}`;
}

export const leagueLogoUrl = (leagueId: string): string | null =>
  NO_LEAGUE_LOGO.has(leagueId) ? null : `/logos/leagues/${leagueId}.png`;

export type Region = 'europe' | 'americas' | 'uefa';

export interface LeagueBrand {
  short: string;
  from: string;
  to: string;
  star?: boolean;
  country: string;
  region: Region;
}

export const LEAGUE_BRAND: Record<string, LeagueBrand> = {
  EPL: { short: 'PL', from: '#3d195b', to: '#6a2c91', country: 'England', region: 'europe' },
  LIGA: { short: 'LL', from: '#ff4b44', to: '#c81d25', country: 'Spain', region: 'europe' },
  SA: { short: 'SA', from: '#008fd7', to: '#024494', country: 'Italy', region: 'europe' },
  BUN: { short: 'BL', from: '#d20515', to: '#8a0410', country: 'Germany', region: 'europe' },
  L1: { short: 'L1', from: '#1b2a5a', to: '#091c3e', country: 'France', region: 'europe' },
  ERE: { short: 'ED', from: '#f26b21', to: '#c2410c', country: 'Netherlands', region: 'europe' },
  POR: { short: 'PT', from: '#00843d', to: '#005a2b', country: 'Portugal', region: 'europe' },
  ELC: { short: 'CH', from: '#1d3b8b', to: '#0f1f4d', country: 'England', region: 'europe' },
  SCO: { short: 'SP', from: '#3c1a6e', to: '#24104a', country: 'Scotland', region: 'europe' },
  TUR: { short: 'SL', from: '#e30a17', to: '#a3060f', country: 'Turkey', region: 'europe' },
  BEL: { short: 'PL', from: '#1f2a44', to: '#0b1325', country: 'Belgium', region: 'europe' },
  BRA: { short: 'BR', from: '#009c3b', to: '#006b29', country: 'Brazil', region: 'americas' },
  UCL: { short: 'CL', from: '#1e3a8a', to: '#0b1e5b', star: true, country: 'Europe', region: 'uefa' },
  UEL: { short: 'EL', from: '#f59e0b', to: '#d97706', star: true, country: 'Europe', region: 'uefa' },
  UECL: { short: 'ECL', from: '#16a34a', to: '#0f7a37', star: true, country: 'Europe', region: 'uefa' },
};

export type CrestPattern = 'split' | 'stripes' | 'band' | 'hoop' | 'solid';

export interface TeamBrand {
  abbr: string;
  primary: string;
  secondary: string;
  pattern: CrestPattern;
}

export const TEAM_BRAND: Record<string, TeamBrand> = {
  'Real Madrid': { abbr: 'RMA', primary: '#ffffff', secondary: '#febe10', pattern: 'band' },
  Barcelona: { abbr: 'FCB', primary: '#a50044', secondary: '#004d98', pattern: 'stripes' },
  'Atlético Madrid': { abbr: 'ATM', primary: '#cb3524', secondary: '#ffffff', pattern: 'stripes' },
  Sevilla: { abbr: 'SEV', primary: '#ffffff', secondary: '#d8001e', pattern: 'hoop' },
  'Real Betis': { abbr: 'BET', primary: '#00954c', secondary: '#ffffff', pattern: 'stripes' },
  'Athletic Club': { abbr: 'ATH', primary: '#ee2523', secondary: '#ffffff', pattern: 'stripes' },
  Valencia: { abbr: 'VAL', primary: '#ffffff', secondary: '#ee7623', pattern: 'band' },
  Villarreal: { abbr: 'VIL', primary: '#ffe667', secondary: '#005187', pattern: 'solid' },
  'Manchester United': { abbr: 'MUN', primary: '#da291c', secondary: '#fbe122', pattern: 'solid' },
  Liverpool: { abbr: 'LIV', primary: '#c8102e', secondary: '#00b2a9', pattern: 'solid' },
  Arsenal: { abbr: 'ARS', primary: '#ef0107', secondary: '#ffffff', pattern: 'hoop' },
  Tottenham: { abbr: 'TOT', primary: '#ffffff', secondary: '#132257', pattern: 'band' },
  'Manchester City': { abbr: 'MCI', primary: '#6cabdd', secondary: '#1c2c5b', pattern: 'solid' },
  Everton: { abbr: 'EVE', primary: '#003399', secondary: '#ffffff', pattern: 'solid' },
  Chelsea: { abbr: 'CHE', primary: '#034694', secondary: '#ffffff', pattern: 'hoop' },
  Newcastle: { abbr: 'NEW', primary: '#241f20', secondary: '#ffffff', pattern: 'stripes' },
  Sunderland: { abbr: 'SUN', primary: '#eb172b', secondary: '#ffffff', pattern: 'stripes' },
  'Aston Villa': { abbr: 'AVL', primary: '#670e36', secondary: '#95bfe5', pattern: 'split' },
  Inter: { abbr: 'INT', primary: '#0068a8', secondary: '#111111', pattern: 'stripes' },
  'AC Milan': { abbr: 'MIL', primary: '#fb090b', secondary: '#111111', pattern: 'stripes' },
  Juventus: { abbr: 'JUV', primary: '#111111', secondary: '#ffffff', pattern: 'stripes' },
  Roma: { abbr: 'ROM', primary: '#8e1f2f', secondary: '#f0bc42', pattern: 'band' },
  Lazio: { abbr: 'LAZ', primary: '#87d8f7', secondary: '#ffffff', pattern: 'hoop' },
  Napoli: { abbr: 'NAP', primary: '#12a0d7', secondary: '#ffffff', pattern: 'solid' },
  Atalanta: { abbr: 'ATA', primary: '#1e71b8', secondary: '#111111', pattern: 'stripes' },
  'Bayern Munich': { abbr: 'FCB', primary: '#dc052d', secondary: '#0066b2', pattern: 'split' },
  'Borussia Dortmund': { abbr: 'BVB', primary: '#fde100', secondary: '#111111', pattern: 'hoop' },
  'Schalke 04': { abbr: 'S04', primary: '#004d9d', secondary: '#ffffff', pattern: 'band' },
  'Bayer Leverkusen': { abbr: 'B04', primary: '#e32221', secondary: '#111111', pattern: 'split' },
  'RB Leipzig': { abbr: 'RBL', primary: '#ffffff', secondary: '#dd0741', pattern: 'hoop' },
  'Eintracht Frankfurt': { abbr: 'SGE', primary: '#111111', secondary: '#e1000f', pattern: 'band' },
  'Paris Saint-Germain': { abbr: 'PSG', primary: '#004170', secondary: '#da291c', pattern: 'hoop' },
  Marseille: { abbr: 'OM', primary: '#2faee0', secondary: '#ffffff', pattern: 'band' },
  Lyon: { abbr: 'OL', primary: '#ffffff', secondary: '#1a3a8f', pattern: 'split' },
  'Saint-Étienne': { abbr: 'ASSE', primary: '#009a44', secondary: '#ffffff', pattern: 'solid' },
  Monaco: { abbr: 'ASM', primary: '#e7001f', secondary: '#ffffff', pattern: 'band' },
  Lille: { abbr: 'LOSC', primary: '#e01e13', secondary: '#20325f', pattern: 'split' },
  Lens: { abbr: 'RCL', primary: '#ffdd00', secondary: '#e30613', pattern: 'stripes' },
  Ajax: { abbr: 'AJA', primary: '#ffffff', secondary: '#d2122e', pattern: 'hoop' },
  Feyenoord: { abbr: 'FEY', primary: '#ed1c24', secondary: '#ffffff', pattern: 'split' },
  PSV: { abbr: 'PSV', primary: '#ed1c24', secondary: '#ffffff', pattern: 'stripes' },
  AZ: { abbr: 'AZ', primary: '#db0021', secondary: '#ffffff', pattern: 'solid' },
  Twente: { abbr: 'TWE', primary: '#e30613', secondary: '#ffffff', pattern: 'hoop' },
  Benfica: { abbr: 'SLB', primary: '#e20e0e', secondary: '#ffffff', pattern: 'solid' },
  Porto: { abbr: 'FCP', primary: '#003893', secondary: '#ffffff', pattern: 'stripes' },
  'Sporting CP': { abbr: 'SCP', primary: '#008057', secondary: '#ffffff', pattern: 'hoop' },
  Braga: { abbr: 'SCB', primary: '#e2001a', secondary: '#ffffff', pattern: 'split' },
  Rangers: { abbr: 'RFC', primary: '#1b458f', secondary: '#ffffff', pattern: 'hoop' },
  Hearts: { abbr: 'HMFC', primary: '#8b1e3f', secondary: '#ffffff', pattern: 'solid' },
  Hibernian: { abbr: 'HIB', primary: '#00703c', secondary: '#ffffff', pattern: 'split' },
  Aberdeen: { abbr: 'AFC', primary: '#d2001e', secondary: '#ffffff', pattern: 'solid' },
};

const PATTERNS: CrestPattern[] = ['split', 'stripes', 'band', 'hoop', 'solid'];

export function teamBrand(name: string): TeamBrand {
  const known = TEAM_BRAND[name];
  if (known) return known;
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const words = name.split(/\s+/);
  return {
    abbr: (words.length > 1 ? words.map((w) => w[0]).join('') : name.slice(0, 3)).toUpperCase().slice(0, 3),
    primary: `hsl(${h % 360} 65% 42%)`,
    secondary: '#ffffff',
    pattern: PATTERNS[h % PATTERNS.length]!,
  };
}
