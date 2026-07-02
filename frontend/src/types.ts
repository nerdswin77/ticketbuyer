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

