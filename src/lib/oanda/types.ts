/**
 * OANDA v20 response shapes — only the parts this app consumes.
 *
 * Note that OANDA returns numbers as STRINGS throughout, to avoid float
 * precision loss. We keep them as strings here and convert at the point of use
 * so the raw ledger stays byte-faithful to what the broker sent.
 */

export type OandaEnvironment = "live" | "practice";

export type AccountSummary = {
  id: string;
  alias?: string;
  currency: string;
  balance: string;
  NAV: string;
  unrealizedPL: string;
  realizedPL: string;
  marginUsed: string;
  marginAvailable: string;
  openTradeCount: number;
  openPositionCount: number;
  pendingOrderCount: number;
  financing: string;
  lastTransactionID: string;
};

export type Instrument = {
  name: string;
  type: string; // CURRENCY | CFD | METAL
  displayName: string;
  pipLocation: number;
  displayPrecision: number;
  marginRate?: string;
};

export type Price = {
  instrument: string;
  time: string;
  closeoutBid: string;
  closeoutAsk: string;
  bids: Array<{ price: string; liquidity: number }>;
  asks: Array<{ price: string; liquidity: number }>;
  tradeable: boolean;
};

export type Candle = {
  time: string;
  volume: number;
  complete: boolean;
  mid?: { o: string; h: string; l: string; c: string };
  bid?: { o: string; h: string; l: string; c: string };
  ask?: { o: string; h: string; l: string; c: string };
};

export type CandlesResponse = {
  instrument: string;
  granularity: string;
  candles: Candle[];
};

export type OpenTrade = {
  id: string;
  instrument: string;
  price: string;
  openTime: string;
  initialUnits: string;
  currentUnits: string;
  realizedPL: string;
  unrealizedPL: string;
  financing: string;
  state: string;
  stopLossOrder?: { price?: string; distance?: string; id: string };
  takeProfitOrder?: { price?: string; id: string };
  trailingStopLossOrder?: { distance?: string; id: string };
};

/**
 * A transaction from the account ledger. Deliberately loose: we store the
 * payload verbatim and derive from it, rather than modelling all ~40 types.
 */
export type Transaction = {
  id: string;
  time: string;
  type: string;
  accountID: string;
  [key: string]: unknown;
};

export type TransactionsSinceResponse = {
  transactions: Transaction[];
  lastTransactionID: string;
};

export type PricingStreamMessage =
  | ({ type: "PRICE" } & Price)
  | { type: "HEARTBEAT"; time: string };

export type TransactionStreamMessage =
  | ({ type: string } & Transaction)
  | { type: "HEARTBEAT"; time: string; lastTransactionID: string };

export const GRANULARITIES = [
  "S5", "S10", "S30",
  "M1", "M2", "M4", "M5", "M10", "M15", "M30",
  "H1", "H2", "H3", "H4", "H6", "H8", "H12",
  "D", "W", "M",
] as const;

export type Granularity = (typeof GRANULARITIES)[number];
