/**
 * Server startup hook.
 *
 * Opens the OANDA price stream once, when the process boots — not per request.
 * This is what an always-on host buys us: one connection to the broker serving
 * every browser tab, rather than a connection per request.
 */
export async function register() {
  // Only the Node runtime; the edge runtime cannot hold a long-lived stream.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { db } = await import("@/lib/db");
  const { hub, DEFAULT_INSTRUMENTS } = await import("@/lib/stream/hub");
  const { accounts, watchlistLevels } = await import("@/lib/db/schema");

  try {
    const rows = await db.select().from(accounts);
    // Prefer a live account; fall back to practice so the desk still streams
    // before real money is connected.
    const account =
      rows.find((a) => a.environment === "live" && a.active) ??
      rows.find((a) => a.active);

    if (!account) {
      console.log("[stream] no account configured — price feed not started");
      return;
    }

    const watched = await db
      .select({ instrument: watchlistLevels.instrument })
      .from(watchlistLevels);

    const instruments = [
      ...new Set([...DEFAULT_INSTRUMENTS, ...watched.map((w) => w.instrument)]),
    ];

    hub.start({
      accountId: account.id,
      environment: account.environment,
      instruments,
    });

    console.log(
      `[stream] price feed started on ${account.id} (${account.environment}) — ` +
        `${instruments.length} instruments`,
    );
  } catch (e) {
    // A dashboard that fails to boot because the broker is down is worse than
    // one that boots without live prices.
    console.error("[stream] failed to start:", (e as Error).message);
  }
}
