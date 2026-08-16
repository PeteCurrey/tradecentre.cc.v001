import { currentUser } from "@/lib/identity/user";
import { hub } from "@/lib/stream/hub";
import type { HubEvent } from "@/lib/stream/events";

/**
 * Live price feed, as Server-Sent Events.
 *
 * SSE rather than WebSockets, deliberately:
 *   • the feed is one-way — the browser only ever receives ticks
 *   • it runs inside a normal route handler, so `server-only` still guards the
 *     OANDA client; a standalone WebSocket server could not import it
 *   • EventSource reconnects on its own, with no client-side backoff to write
 *   • no custom server, so `next dev` and `next start` work unchanged
 *
 * This still requires an always-on host. A serverless platform would cut the
 * response at its function timeout, which is the whole reason for Railway.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEEPALIVE_MS = 15_000;

export async function GET(req: Request) {
  /**
   * The feed carries live account data, so it is gated like every other route —
   * but it needs the member, not just the fact of a session. Every private
   * frame on this stream is routed by the id resolved here.
   */
  const user = await currentUser();
  if (!user) {
    return new Response("unauthenticated", { status: 401 });
  }
  const userId = user.id;

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let keepalive: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          // Client vanished mid-write; cleanup runs via the abort handler.
        }
      };

      /**
       * Prime the client so it isn't blank until the next push arrives.
       *
       * The desk push in particular can be up to five seconds away, and a hero
       * that renders empty for five seconds on every navigation is exactly the
       * "is this thing working?" impression this feed exists to dispel.
       */
      send("status", { state: hub.connectionState });
      for (const tick of hub.snapshot) send("tick", tick);

      const priorDesk = hub.deskSnapshotFor(userId);
      if (priorDesk) send("desk", priorDesk);
      const priorScan = hub.scanSnapshotFor(userId);
      if (priorScan) send("scan", priorScan);

      // Subscribing AS a member, not merely as a signed-in browser. The hub
      // drops every private event that isn't theirs before it reaches here.
      unsubscribe = hub.subscribeFor(userId, (e: HubEvent) => {
        if (e.type === "tick") send("tick", e.tick);
        else if (e.type === "status") send("status", { state: e.state, detail: e.detail });
        else if (e.type === "transaction") send("transaction", e);
        else if (e.type === "desk") send("desk", e.desk);
        else if (e.type === "scan") send("scan", e.scan);
        else if (e.type === "engine") send("engine", e.event);
      });

      /**
       * A browser connecting is the one moment a stale desk push is most
       * visible, so refresh it rather than waiting out the interval. Deliberately
       * not awaited: the response headers should go out now, and the push will
       * arrive over the stream that is already open.
       */
      void import("@/lib/desk/broadcast")
        .then((m) => m.broadcastNow())
        .catch(() => {
          /* the periodic loop will cover it */
        });

      // Proxies drop idle connections; a comment line keeps it warm without
      // being delivered to any EventSource listener.
      keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          /* closing */
        }
      }, KEEPALIVE_MS);

      const cleanup = () => {
        unsubscribe?.();
        unsubscribe = null;
        if (keepalive) clearInterval(keepalive);
        keepalive = null;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      /**
       * Cleanup is driven ONLY by the client disconnecting.
       *
       * Note for anyone tempted to add `after()` here: it fires once the
       * response is considered sent, which for a streamed response is as soon
       * as the headers go out — it closes the stream immediately and the feed
       * silently delivers nothing but its initial snapshot.
       */
      req.signal.addEventListener("abort", cleanup);
    },

    cancel() {
      unsubscribe?.();
      if (keepalive) clearInterval(keepalive);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disable proxy buffering, which would otherwise hold ticks back.
      "X-Accel-Buffering": "no",
    },
  });
}
