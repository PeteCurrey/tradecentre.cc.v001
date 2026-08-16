import "server-only";
import { env } from "@/lib/env";
import { closeUnitsBody } from "./close-units";
import type { GuardApproval } from "@/lib/execution/guards";
import type { OandaEnvironment } from "./types";

/* ==========================================================================
   ⚠️  THE ONLY MODULE IN THIS CODEBASE THAT CAN PLACE OR MODIFY AN ORDER  ⚠️
   --------------------------------------------------------------------------
   Deliberately separate from src/lib/oanda/client.ts, which stays read-only by
   construction and is asserted so by test. Nothing on the read path may import
   this file, and no-write.test.ts enforces that.

   Two properties make this safe to have in the codebase at all:

   1. GUARDS ARE ENFORCED BY THE TYPE SYSTEM. Every write takes a GuardApproval,
      which only approveOrder() can mint. There is no way to call these methods
      with a bare intent, so "someone forgot to check the guards" cannot happen.

   2. DRY RUN IS THE DEFAULT. `send: false` returns exactly what it would have
      submitted without contacting the broker. Live submission is opt-in per
      call, not a mode set once and forgotten.
   ========================================================================== */

const HOSTS: Record<OandaEnvironment, string> = {
  live: "https://api-fxtrade.oanda.com",
  practice: "https://api-fxpractice.oanda.com",
};

export class ExecutionError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = "ExecutionError";
  }
}

function token(environment: OandaEnvironment): string {
  const e = env();
  const t = environment === "live" ? e.OANDA_LIVE_TOKEN : e.OANDA_PRACTICE_TOKEN;
  if (!t) throw new ExecutionError(`No OANDA ${environment} token configured`, 401);
  return t;
}

export type SubmitResult = {
  /** False when this was a dry run — nothing was sent. */
  sent: boolean;
  ok: boolean;
  status: number;
  request: Record<string, unknown>;
  response: Record<string, unknown> | null;
  oandaOrderId: string | null;
  oandaTradeId: string | null;
  error: string | null;
};

/**
 * Build the OANDA order payload from an approved intent.
 *
 * Exported so a dry run and a live submission are provably the same request —
 * a dry run that constructs a different payload to the real one tests nothing.
 */
export function buildMarketOrder(approval: GuardApproval): Record<string, unknown> {
  const i = approval.intent;
  if (i.stopPrice === null) {
    // Unreachable: the stopRequired guard refuses this. Belt and braces,
    // because an order reaching the broker without a stop is unbounded risk.
    throw new ExecutionError("Refusing to build an order with no stop", 400);
  }

  return {
    order: {
      type: "MARKET",
      instrument: i.instrument,
      units: String(i.units),
      timeInForce: "FOK",
      positionFill: "DEFAULT",
      stopLossOnFill: { price: String(i.stopPrice), timeInForce: "GTC" },
      ...(i.targetPrice !== null
        ? { takeProfitOnFill: { price: String(i.targetPrice), timeInForce: "GTC" } }
        : {}),
      clientExtensions: {
        // Tags every autonomous order so it is distinguishable from a manual
        // one in the ledger, forever.
        tag: "auto",
        comment: i.patternId !== null ? `pattern:${i.patternId}` : "auto",
      },
    },
  };
}

export class OandaExecutionClient {
  constructor(readonly environment: OandaEnvironment) {}

  /**
   * Place a market order with an attached stop.
   *
   * @param approval  proof the intent passed every guard
   * @param send      MUST be explicitly true to contact the broker
   */
  async submitMarketOrder(
    approval: GuardApproval,
    send: boolean,
  ): Promise<SubmitResult> {
    const body = buildMarketOrder(approval);
    const accountId = approval.intent.accountId;

    if (!send) {
      return {
        sent: false,
        ok: true,
        status: 0,
        request: body,
        response: null,
        oandaOrderId: null,
        oandaTradeId: null,
        error: null,
      };
    }

    const url = new URL(`/v3/accounts/${accountId}/orders`, HOSTS[this.environment]);

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token(this.environment)}`,
          "Content-Type": "application/json",
          "Accept-Datetime-Format": "RFC3339",
        },
        body: JSON.stringify(body),
        cache: "no-store",
      });
    } catch (e) {
      // Never retried automatically: a network failure after the broker may
      // already have accepted the order would risk a duplicate position.
      return {
        sent: true,
        ok: false,
        status: 0,
        request: body,
        response: null,
        oandaOrderId: null,
        oandaTradeId: null,
        error: `Network error: ${(e as Error).message}`,
      };
    }

    const text = await res.text().catch(() => "");
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      /* non-JSON response is captured in `error` below */
    }

    const fill = parsed?.orderFillTransaction as
      | { id?: string; tradeOpened?: { tradeID?: string } }
      | undefined;
    const created = parsed?.orderCreateTransaction as { id?: string } | undefined;

    return {
      sent: true,
      ok: res.ok,
      status: res.status,
      request: body,
      response: parsed,
      oandaOrderId: created?.id ?? fill?.id ?? null,
      oandaTradeId: fill?.tradeOpened?.tradeID ?? null,
      error: res.ok ? null : text.slice(0, 500) || `HTTP ${res.status}`,
    };
  }

  /**
   * Move the stop on an open trade.
   *
   * Takes the CURRENT stop and the direction, and refuses any move that would
   * increase risk. manage.ts already clamps this, but a stop-loosening bug is
   * expensive enough that the invariant is enforced again at the boundary
   * where the request is actually built — defence in depth on the one property
   * that must never fail.
   */
  async modifyStop(
    accountId: string,
    tradeId: string,
    newStop: number,
    send: boolean,
    context?: { direction: "long" | "short"; currentStop: number | null },
  ): Promise<SubmitResult> {
    if (!Number.isFinite(newStop)) {
      throw new ExecutionError("Refusing a non-finite stop price", 400);
    }
    if (context?.currentStop != null) {
      const loosens =
        context.direction === "long"
          ? newStop < context.currentStop
          : newStop > context.currentStop;
      if (loosens) {
        throw new ExecutionError(
          `Refusing to move a ${context.direction} stop from ${context.currentStop} ` +
            `to ${newStop} — that increases risk`,
          400,
        );
      }
    }

    const body = { stopLoss: { price: String(newStop), timeInForce: "GTC" } };

    if (!send) {
      return {
        sent: false,
        ok: true,
        status: 0,
        request: { tradeId, ...body },
        response: null,
        oandaOrderId: null,
        oandaTradeId: tradeId,
        error: null,
      };
    }

    const url = new URL(
      `/v3/accounts/${accountId}/trades/${tradeId}/orders`,
      HOSTS[this.environment],
    );

    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token(this.environment)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const text = await res.text().catch(() => "");
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      /* captured in `error` */
    }

    return {
      sent: true,
      ok: res.ok,
      status: res.status,
      request: { tradeId, ...body },
      response: parsed,
      oandaOrderId: null,
      oandaTradeId: tradeId,
      error: res.ok ? null : text.slice(0, 500) || `HTTP ${res.status}`,
    };
  }

  /**
   * Close an open trade, wholly or in part.
   *
   * Takes an explicit trade id rather than an approval: closing reduces risk,
   * and a kill switch that could be blocked by a guard would be worse than
   * useless.
   *
   * `units` omitted closes everything. Passing a magnitude closes that many
   * units and leaves the rest running — OANDA takes an unsigned count here and
   * infers the direction from the trade, so a caller's signed "units to close"
   * must have its magnitude taken. Getting that wrong is not a rounding error:
   * a negative string is rejected outright, and the position stays fully open
   * while the log records an attempt.
   *
   * Refuses a non-positive or non-integer count rather than sending it. OANDA
   * would reject it anyway, but failing here keeps the reason in our own log
   * instead of buried in a broker error body.
   */
  async closeTrade(
    accountId: string,
    tradeId: string,
    send: boolean,
    units?: number,
  ): Promise<SubmitResult> {
    const resolved = closeUnitsBody(units);
    if (!resolved.ok) {
      return {
        sent: false,
        ok: false,
        status: 0,
        request: { tradeId, units },
        response: null,
        oandaOrderId: null,
        oandaTradeId: tradeId,
        error: resolved.error,
      };
    }
    const body = resolved.body;
    if (!send) {
      return {
        sent: false,
        ok: true,
        status: 0,
        request: { tradeId, ...body },
        response: null,
        oandaOrderId: null,
        oandaTradeId: tradeId,
        error: null,
      };
    }

    const url = new URL(
      `/v3/accounts/${accountId}/trades/${tradeId}/close`,
      HOSTS[this.environment],
    );

    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token(this.environment)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const text = await res.text().catch(() => "");
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      /* captured in `error` */
    }

    return {
      sent: true,
      ok: res.ok,
      status: res.status,
      request: { tradeId, ...body },
      response: parsed,
      oandaOrderId: null,
      oandaTradeId: tradeId,
      error: res.ok ? null : text.slice(0, 500) || `HTTP ${res.status}`,
    };
  }
}

const clients = new Map<OandaEnvironment, OandaExecutionClient>();

export function execution(environment: OandaEnvironment): OandaExecutionClient {
  let c = clients.get(environment);
  if (!c) {
    c = new OandaExecutionClient(environment);
    clients.set(environment, c);
  }
  return c;
}
