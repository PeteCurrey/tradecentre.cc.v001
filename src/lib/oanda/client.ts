import "server-only";
import { env } from "@/lib/env";
import type {
  AccountSummary,
  CandlesResponse,
  Granularity,
  Instrument,
  OandaEnvironment,
  OpenTrade,
  Price,
  TransactionsSinceResponse,
} from "./types";

/* ==========================================================================
   READ-ONLY BY CONSTRUCTION
   --------------------------------------------------------------------------
   OANDA personal access tokens are full trading credentials — the v20 API has
   no read-only scope. The only protection available is that this client is
   incapable of writing.

   Therefore:
     • `request()` below hardcodes method: "GET" and is private
     • there is no post/put/patch/delete anywhere in this module
     • no method touches order-placement or position-closing endpoints
     • a test asserts these properties so a future edit can't quietly undo them

   If order placement is ever genuinely wanted, it belongs in a separate,
   explicitly-named module with its own confirmation flow — never here.
   ========================================================================== */

const HOSTS: Record<OandaEnvironment, { rest: string; stream: string }> = {
  live: {
    rest: "https://api-fxtrade.oanda.com",
    stream: "https://stream-fxtrade.oanda.com",
  },
  practice: {
    rest: "https://api-fxpractice.oanda.com",
    stream: "https://stream-fxpractice.oanda.com",
  },
};

export class OandaError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = "OandaError";
  }
}

function tokenFor(environment: OandaEnvironment): string {
  const e = env();
  const token =
    environment === "live" ? e.OANDA_LIVE_TOKEN : e.OANDA_PRACTICE_TOKEN;
  if (!token) {
    throw new OandaError(
      `No OANDA ${environment} token configured. Set OANDA_${environment === "live" ? "LIVE" : "PRACTICE"}_TOKEN.`,
      401,
    );
  }
  return token;
}

function headers(environment: OandaEnvironment): HeadersInit {
  return {
    Authorization: `Bearer ${tokenFor(environment)}`,
    "Content-Type": "application/json",
    "Accept-Datetime-Format": "RFC3339",
  };
}

export class OandaClient {
  constructor(readonly environment: OandaEnvironment) {}

  get restHost() {
    return HOSTS[this.environment].rest;
  }

  get streamHost() {
    return HOSTS[this.environment].stream;
  }

  /**
   * The ONLY request path in this module. Hardcoded to GET — this is the
   * structural guarantee that the app cannot place or modify an order.
   */
  private async request<T>(
    path: string,
    params?: Record<string, string | number | undefined>,
    attempt = 0,
  ): Promise<T> {
    const url = new URL(path, this.restHost);
    for (const [k, v] of Object.entries(params ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }

    const res = await fetch(url, {
      method: "GET",
      headers: headers(this.environment),
      cache: "no-store",
    });

    // Retry transient failures with backoff; never retry a 4xx other than 429.
    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < 3) {
        await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
        return this.request<T>(path, params, attempt + 1);
      }
      const body = await res.text().catch(() => "");
      throw new OandaError(
        `OANDA ${this.environment} ${res.status} on ${path}`,
        res.status,
        body.slice(0, 500),
      );
    }

    return (await res.json()) as T;
  }

  /* ---- Accounts -------------------------------------------------------- */

  /** Every account this token can see. Used by Settings to map accounts→books. */
  async listAccounts(): Promise<Array<{ id: string; tags: string[] }>> {
    const r = await this.request<{ accounts: Array<{ id: string; tags: string[] }> }>(
      "/v3/accounts",
    );
    return r.accounts;
  }

  async accountSummary(accountId: string): Promise<AccountSummary> {
    const r = await this.request<{ account: AccountSummary }>(
      `/v3/accounts/${accountId}/summary`,
    );
    return r.account;
  }

  /** Tradeable instruments — the definitive answer on crypto CFD availability. */
  async instruments(accountId: string): Promise<Instrument[]> {
    const r = await this.request<{ instruments: Instrument[] }>(
      `/v3/accounts/${accountId}/instruments`,
    );
    return r.instruments;
  }

  /* ---- The ledger ------------------------------------------------------ */

  /**
   * Transactions since a given id. This is the sync primitive: store the last
   * seen id per account and this returns exactly what's new, so re-running is
   * cheap and idempotent.
   *
   * OANDA caps each response, so callers must loop until caught up.
   */
  async transactionsSince(
    accountId: string,
    sinceId: string,
  ): Promise<TransactionsSinceResponse> {
    return this.request<TransactionsSinceResponse>(
      `/v3/accounts/${accountId}/transactions/sinceid`,
      { id: sinceId },
    );
  }

  /** Bounded id range — used for backfilling history in chunks. */
  async transactionRange(
    accountId: string,
    from: string,
    to: string,
  ): Promise<TransactionsSinceResponse> {
    return this.request<TransactionsSinceResponse>(
      `/v3/accounts/${accountId}/transactions/idrange`,
      { from, to },
    );
  }

  /* ---- Positions ------------------------------------------------------- */

  async openTrades(accountId: string): Promise<OpenTrade[]> {
    const r = await this.request<{ trades: OpenTrade[] }>(
      `/v3/accounts/${accountId}/openTrades`,
    );
    return r.trades;
  }

  /* ---- Market data ----------------------------------------------------- */

  async pricing(accountId: string, instruments: string[]): Promise<Price[]> {
    const r = await this.request<{ prices: Price[] }>(
      `/v3/accounts/${accountId}/pricing`,
      { instruments: instruments.join(",") },
    );
    return r.prices;
  }

  /**
   * Candles for auto-rendered trade charts.
   *
   * `price: "M"` returns midpoint. Bid/ask are available but midpoint is what
   * you want on a chart — using bid for longs and ask for shorts would make
   * charts inconsistent between trades on the same instrument.
   */
  async candles(
    instrument: string,
    opts: {
      granularity: Granularity;
      from?: string;
      to?: string;
      count?: number;
      price?: "M" | "B" | "A";
    },
  ): Promise<CandlesResponse> {
    return this.request<CandlesResponse>(`/v3/instruments/${instrument}/candles`, {
      granularity: opts.granularity,
      from: opts.from,
      to: opts.to,
      count: opts.count,
      price: opts.price ?? "M",
    });
  }

  /* ---- Streaming ------------------------------------------------------- */

  /**
   * Long-lived streams. Returns the raw Response so the caller owns the read
   * loop and reconnection policy.
   *
   * Connection budget (see plan): ONE shared pricing stream for all live books
   * — prices are identical across sub-accounts — plus one transaction stream
   * per book. Demo streams connect lazily, only while actively testing.
   */
  async openPricingStream(
    accountId: string,
    instruments: string[],
    signal?: AbortSignal,
  ): Promise<Response> {
    const url = new URL(`/v3/accounts/${accountId}/pricing/stream`, this.streamHost);
    url.searchParams.set("instruments", instruments.join(","));
    const res = await fetch(url, {
      method: "GET",
      headers: headers(this.environment),
      signal,
      cache: "no-store",
    });
    if (!res.ok || !res.body) {
      throw new OandaError(`Pricing stream failed (${res.status})`, res.status);
    }
    return res;
  }

  async openTransactionStream(
    accountId: string,
    signal?: AbortSignal,
  ): Promise<Response> {
    const url = new URL(
      `/v3/accounts/${accountId}/transactions/stream`,
      this.streamHost,
    );
    const res = await fetch(url, {
      method: "GET",
      headers: headers(this.environment),
      signal,
      cache: "no-store",
    });
    if (!res.ok || !res.body) {
      throw new OandaError(`Transaction stream failed (${res.status})`, res.status);
    }
    return res;
  }
}

/** Client cache — one per environment, since each carries a different token. */
const clients = new Map<OandaEnvironment, OandaClient>();

export function oanda(environment: OandaEnvironment): OandaClient {
  let c = clients.get(environment);
  if (!c) {
    c = new OandaClient(environment);
    clients.set(environment, c);
  }
  return c;
}

/**
 * Parse a newline-delimited OANDA stream into typed messages.
 *
 * OANDA sends one JSON object per line, with HEARTBEAT roughly every 5s. A gap
 * longer than ~10s means the connection is dead even though the socket may
 * still look open — callers should treat heartbeat silence as a disconnect.
 */
export async function* readStream<T>(
  res: Response,
  signal?: AbortSignal,
): AsyncGenerator<T> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (!signal?.aborted) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });

      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try {
          yield JSON.parse(line) as T;
        } catch {
          // A partial or malformed line is not worth killing the stream over.
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}
