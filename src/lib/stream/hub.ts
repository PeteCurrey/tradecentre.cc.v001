import "server-only";
import { oanda, readStream } from "@/lib/oanda/client";
import type { OandaEnvironment, PricingStreamMessage } from "@/lib/oanda/types";

/**
 * Stream hub.
 *
 * Holds the long-lived OANDA connections and fans them out to browser clients.
 * This is the reason the app runs on an always-on Node host rather than a
 * serverless platform: these connections must stay open for hours.
 *
 * Connection budget, per the plan:
 *   • ONE shared pricing stream — prices are identical across sub-accounts, so
 *     opening one per book would be four times the connections for the same data
 *   • ONE transaction stream per account — these ARE per-account
 *   • demo streams connect lazily, only while actively being watched
 *
 * A heartbeat watchdog matters more than it looks: OANDA sends a HEARTBEAT
 * every ~5s, and a dead connection often leaves the socket looking open. Silence
 * is the only reliable signal, so we treat it as a disconnect.
 */

export type Tick = {
  instrument: string;
  bid: number;
  ask: number;
  mid: number;
  time: string;
};

export type HubEvent =
  | { type: "tick"; tick: Tick }
  | { type: "transaction"; accountId: string; transactionType: string; id: string }
  | { type: "status"; state: ConnectionState; detail?: string };

export type ConnectionState = "connecting" | "live" | "stale" | "offline";

type Subscriber = (event: HubEvent) => void;

const HEARTBEAT_TIMEOUT_MS = 12_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;

/** Default watch list until the watchlist table is populated. */
export const DEFAULT_INSTRUMENTS = [
  "EUR_USD",
  "GBP_USD",
  "USD_JPY",
  "XAU_USD",
  "SPX500_USD",
  "NAS100_USD",
  "WTICO_USD",
];

class StreamHub {
  private subscribers = new Set<Subscriber>();
  private lastTicks = new Map<string, Tick>();
  private state: ConnectionState = "offline";
  private abort: AbortController | null = null;
  private watchdog: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private started = false;
  private instruments: string[] = DEFAULT_INSTRUMENTS;

  get connectionState(): ConnectionState {
    return this.state;
  }

  /** Snapshot for a client that has just connected, so it isn't blank. */
  get snapshot(): Tick[] {
    return [...this.lastTicks.values()];
  }

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  private emit(event: HubEvent) {
    for (const fn of this.subscribers) {
      try {
        fn(event);
      } catch {
        // A broken subscriber must not take down the stream.
      }
    }
  }

  private setState(state: ConnectionState, detail?: string) {
    if (this.state === state) return;
    this.state = state;
    this.emit({ type: "status", state, detail });
  }

  start(opts: {
    accountId: string;
    environment: OandaEnvironment;
    instruments?: string[];
  }) {
    if (this.started) return;
    this.started = true;
    this.instruments = opts.instruments?.length ? opts.instruments : DEFAULT_INSTRUMENTS;
    void this.runPricing(opts.accountId, opts.environment);
  }

  stop() {
    this.started = false;
    this.abort?.abort();
    this.abort = null;
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
    this.setState("offline");
  }

  private armWatchdog() {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => {
      // Heartbeats stopped. The socket may still look open; it isn't.
      this.setState("stale", "no heartbeat");
      this.abort?.abort();
    }, HEARTBEAT_TIMEOUT_MS);
  }

  private async runPricing(accountId: string, environment: OandaEnvironment) {
    while (this.started) {
      this.setState("connecting");
      this.abort = new AbortController();

      try {
        const res = await oanda(environment).openPricingStream(
          accountId,
          this.instruments,
          this.abort.signal,
        );

        this.setState("live");
        this.reconnectAttempt = 0;
        this.armWatchdog();

        for await (const msg of readStream<PricingStreamMessage>(res, this.abort.signal)) {
          this.armWatchdog();

          if (msg.type === "HEARTBEAT") {
            if (this.state !== "live") this.setState("live");
            continue;
          }

          if (msg.type === "PRICE") {
            /**
             * TOP OF BOOK, not closeout.
             *
             * `closeoutBid`/`closeoutAsk` are the prices OANDA would use for a
             * margin closeout — the far end of available liquidity, and far
             * wider than anything tradeable. On XAU_USD the closeout spread
             * reads ~20 points while the top-of-book spread is ~0.7. Showing
             * the closeout figure as "the spread" would be badly misleading,
             * most of all on the instruments being scalped.
             */
            const bid = Number(msg.bids?.[0]?.price ?? msg.closeoutBid);
            const ask = Number(msg.asks?.[0]?.price ?? msg.closeoutAsk);
            if (!Number.isFinite(bid) || !Number.isFinite(ask)) continue;
            const tick: Tick = {
              instrument: msg.instrument,
              bid,
              ask,
              mid: (bid + ask) / 2,
              time: msg.time,
            };
            this.lastTicks.set(tick.instrument, tick);
            this.emit({ type: "tick", tick });
          }
        }
      } catch (e) {
        this.setState("offline", (e as Error).message);
      }

      if (!this.started) break;

      // Exponential backoff with jitter, so a broker outage doesn't turn into
      // a tight reconnect loop against their rate limiter.
      this.reconnectAttempt++;
      const delay = Math.min(
        RECONNECT_MAX_MS,
        RECONNECT_BASE_MS * 2 ** (this.reconnectAttempt - 1),
      );
      const jittered = delay * (0.5 + Math.random() * 0.5);
      this.setState("offline", `reconnecting in ${Math.round(jittered / 1000)}s`);
      await new Promise((r) => setTimeout(r, jittered));
    }
  }
}

/**
 * Singleton across hot reloads — otherwise every file save in development
 * would leak another live connection to OANDA.
 */
const globalForHub = globalThis as unknown as { __streamHub?: StreamHub };
export const hub: StreamHub = (globalForHub.__streamHub ??= new StreamHub());
