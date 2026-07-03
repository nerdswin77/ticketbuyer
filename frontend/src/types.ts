export type Gateway = 'mock' | 'stripe';
export type WatchMode = 'auto' | 'alert';
export type WatchStatus =
  | 'watching'
  | 'armed'
  | 'sale_open'
  | 'purchasing'
  | 'requires_action'
  | 'purchased'
  | 'failed';
export type OrderStatus = 'pending' | 'requires_action' | 'paid' | 'failed' | 'refunded';
export type LogLevel = 'info' | 'ok' | 'warn' | 'error';

export interface AppConfig {
  gateway: Gateway;
  schedule_import_enabled: boolean;
  stripe_publishable_key: string | null;
  currency: string;
  max_tickets_per_order: number;
  server_time_ms: number;
}

export interface League {
  id: string;
  name: string;
  country: string;
  flag: string;
}

export type Strategy = 'best' | 'cheapest';
export type Stand = 'vip' | 'main' | 'opposite' | 'home_end' | 'away_end' | 'corner';

export interface SeatCategory {
  id: number;
  code: string;
  name: string;
  stand: Stand;
  description: string;
  sort_order: number;
  price_cents: number;
  capacity: number;
  available: number;
}

export interface Match {
  id: number;
  league_id: string;
  home_team: string;
  away_team: string;
  stadium: string;
  kickoff_ms: number;
  sale_opens_at_ms: number;
  famous_name: string | null;
  demand: number;
  city: string;
  country: string;
  capacity: number;
  timezone: string;
  round_label: string;
  published_at_ms: number | null;
  /** Ticket sale date not announced yet (pre-orders allowed). */
  sale_date_tba: boolean;
  kickoff_tbc: boolean;
  source: 'catalog' | 'feed' | 'user' | 'import';
  home_crest_url: string | null;
  away_crest_url: string | null;
  categories: SeatCategory[];
}

export interface Profile {
  full_name: string;
  email: string;
  fan_id: string;
  gateway: string | null;
  card_brand: string | null;
  card_last4: string | null;
  card_exp: string | null;
  has_payment_method: boolean;
  favorite_leagues: string[];
  fixture_alerts: FixtureAlerts;
  auto_preorder_favorites: boolean;
  auto_preorder_quantity: number;
}

export type FixtureAlerts = 'all' | 'favorites' | 'off';

export interface ScheduleInfo {
  pending: number;
  next_publish_at_ms: number | null;
  interval_s?: number;
}

export interface Watch {
  id: number;
  match_id: number;
  mode: WatchMode;
  strategy: Strategy;
  quantity: number;
  max_price_cents: number;
  category_codes: string[];
  exact_block: string | null;
  /** Exact seats chosen one by one: [row, seat] pairs. */
  exact_positions: Position[];
  exact_fallback: boolean;
  status: WatchStatus;
  message: string;
  order_id: string | null;
  created_at_ms: number;
}

export interface Order {
  id: string;
  watch_id: number | null;
  match_id: number;
  match_label: string;
  category_code: string;
  category_name: string;
  quantity: number;
  unit_price_cents: number;
  total_cents: number;
  currency: string;
  status: OrderStatus;
  gateway: Gateway;
  payment_id: string | null;
  failure_reason: string;
  latency_ms: number | null;
  trigger: 'auto' | 'manual';
  created_at_ms: number;
  stand: Stand;
  block: string;
  row: number;
  seats: number[];
  positions: Position[];
  gate: string;
  block_index: number;
  attendees: Attendee[];
  paid_at_ms: number | null;
  updated_at_ms: number;
  client_secret: string | null;
  payment_method_id: string | null;
}

export interface Team {
  name: string;
  stadium: string;
  city: string;
  leagues: string[];
}

export interface BlockSummary {
  block: string;
  zone_code: string;
  block_index: number;
  rank: number;
  gate: string;
  rows: number;
  seats_per_row: number;
  free: number;
}

export interface BlockDetail extends BlockSummary {
  /** One char per seat, row-major: '0' free, '1' sold/held. */
  state: string;
}

export interface Attendee {
  row: number;
  seat: number;
  name: string;
}

/** [row, seat] */
export type Position = [number, number];

export interface SeatSelection {
  block: string;
  positions: Position[];
}

export interface LogEntry {
  ts: number;
  level: LogLevel;
  message: string;
}

export interface MockCard {
  number: string;
  exp_month: number;
  exp_year: number;
  cvc: string;
  name: string;
}

export type ServerEvent =
  | { type: 'log'; data: LogEntry }
  | { type: 'watch'; data: Watch }
  | { type: 'watch_removed'; data: { id: number } }
  | { type: 'order'; data: Order }
  | { type: 'inventory'; data: Record<string, number> }
  | { type: 'sale_open'; data: { watch_id: number; match_id: number; label: string } }
  | { type: 'matches_reset'; data: Record<string, never> }
  | { type: 'fixture_published'; data: { match: Match; pending: number; next_publish_at_ms: number | null } }
  | { type: 'schedule'; data: ScheduleInfo }
  | { type: 'seats'; data: { match_id: number; block: string } }
  | { type: 'match_added'; data: Match }
  | { type: 'sale_announced'; data: Match };
