import type {
  AppConfig,
  Attendee,
  BlockDetail,
  BlockSummary,
  League,
  LogEntry,
  Match,
  MockCard,
  Order,
  Profile,
  ScheduleInfo,
  SeatSelection,
  Strategy,
  Team,
  Watch,
  WatchMode,
} from './types';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { detail?: unknown };
      if (typeof body.detail === 'string') detail = body.detail;
      else if (Array.isArray(body.detail))
        detail = body.detail.map((d: { msg?: string }) => d.msg ?? JSON.stringify(d)).join('; ');
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, detail);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});

export interface BuyOptions {
  quantity: number;
  /** Exact seats; when given, quantity = seats.length and zones/max price are derived from the block. */
  seats?: SeatSelection;
  exact_fallback?: boolean;
  strategy?: Strategy;
  max_price_cents?: number;
  category_codes?: string[];
}
export interface WatchCreate extends BuyOptions {
  match_ids: number[];
  mode: WatchMode;
}
export type WatchUpdate = Partial<Pick<Watch, 'mode' | 'strategy' | 'quantity' | 'max_price_cents' | 'category_codes' | 'exact_fallback'>>;

export const api = {
  config: () => request<AppConfig>('/config'),
  leagues: () => request<League[]>('/leagues'),
  matches: () => request<Match[]>('/matches'),
  teams: () => request<Team[]>('/teams'),
  addMatch: (body: { league_id: string; home_team: string; away_team: string; date: string; time: string | null }) =>
    request<Match>('/matches', json('POST', body)),
  announceSale: (matchId: number, opensInSeconds: number) =>
    request<Match>(`/matches/${matchId}/announce-sale`, json('POST', { opens_in_seconds: opensInSeconds })),
  seatmap: (matchId: number, signal?: AbortSignal) => request<BlockSummary[]>(`/matches/${matchId}/seatmap`, { signal }),
  block: (matchId: number, block: string, signal?: AbortSignal) =>
    request<BlockDetail>(`/matches/${matchId}/blocks/${encodeURIComponent(block)}`, { signal }),
  logs: () => request<LogEntry[]>('/logs'),

  profile: () => request<Profile>('/profile'),
  updateProfile: (p: Pick<Profile, 'full_name' | 'email' | 'fan_id'>) => request<Profile>('/profile', json('PUT', p)),
  schedule: () => request<ScheduleInfo>('/schedule'),
  publishNext: () => request<{ match_id: number | null }>('/demo/publish-next', json('POST')),
  setPreferences: (p: Pick<Profile, 'fixture_alerts' | 'auto_preorder_favorites' | 'auto_preorder_quantity'>) =>
    request<Profile>('/profile/preferences', json('PUT', p)),
  setFavorites:(leagues: string[]) => request<Profile>('/profile/favorites', json('PUT', { leagues })),
  setupPaymentMethod:() => request<{ gateway: string; client_secret: string | null }>('/payment-methods/setup', json('POST')),
  saveMockCard: (card: MockCard) => request<Profile>('/payment-methods', json('POST', { mock_card: card })),
  saveStripeCard: (setupIntentId: string) =>
    request<Profile>('/payment-methods', json('POST', { setup_intent_id: setupIntentId })),
  removePaymentMethod: () => request<Profile>('/payment-methods', json('DELETE')),

  watches: () => request<Watch[]>('/watches'),
  createWatches: (body: WatchCreate) => request<Watch[]>('/watches', json('POST', body)),
  updateWatch: (id: number, body: WatchUpdate) => request<Watch>(`/watches/${id}`, json('PATCH', body)),
  deleteWatch: (id: number) => request<void>(`/watches/${id}`, json('DELETE')),
  /** Returns immediately (202). Buys in the background, or pre-orders if the sale isn't open yet. */
  buy: (id: number) => request<Watch>(`/watches/${id}/buy`, json('POST')),
  quickBuy: (matchId: number, opts: BuyOptions) => request<Watch>('/watches/quick-buy', json('POST', { match_id: matchId, ...opts })),
  retry: (id: number) => request<Watch>(`/watches/${id}/retry`, json('POST')),

  orders: () => request<Order[]>('/orders'),
  confirmOrder: (id: string) => request<Order>(`/orders/${id}/confirm`, json('POST')),
  refundOrder: (id: string) => request<Order>(`/orders/${id}/refund`, json('POST')),
  setAttendees: (id: string, attendees: Attendee[]) => request<Order>(`/orders/${id}/attendees`, json('PUT', { attendees })),
  calendarUrl: (id: string) => `/api/orders/${id}/calendar.ics`,

  importSchedule: () => request<{ created: number; results: Record<string, unknown> }>('/schedule/import', json('POST')),
  resetDemo: () => request<{ status: string }>('/demo/reset', json('POST')),
};
