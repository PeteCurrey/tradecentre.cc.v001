/**
 * Server startup hook.
 *
 * Two jobs, in order:
 *   1. apply any pending database migrations
 *   2. open the OANDA price stream
 *
 * Migrations run at boot because the alternative — remembering to run them by
 * hand after every deploy that adds a table — has already caused one broken
 * deployment. Drizzle records applied migrations in a journal table, so this is
 * a no-op when there is nothing pending.
 *
 * This is safe HERE specifically because the app runs as a single instance. On
 * a horizontally-scaled deployment several instances would race, and migrations
 * would belong in a release step instead.
 */

async function runMigrations(): Promise<void> {
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  const { db } = await import("@/lib/db");

  const started = Date.now();
  await migrate(db, { migrationsFolder: "drizzle" });
  console.log(`[migrate] schema up to date (${Date.now() - started}ms)`);
}

async function startPriceStream(): Promise<void> {
  const { db } = await import("@/lib/db");
  const { hub, DEFAULT_INSTRUMENTS } = await import("@/lib/stream/hub");
  const { accounts, watchlistLevels } = await import("@/lib/db/schema");

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
}

export async function register() {
  // Only the Node runtime; the edge runtime can neither migrate nor hold a
  // long-lived stream open.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Each step is isolated. A dashboard that refuses to boot because the broker
  // is unreachable is worse than one that boots without live prices — and
  // /api/health reports whatever is actually broken.
  try {
    await runMigrations();
  } catch (e) {
    console.error("[migrate] FAILED:", (e as Error).message);
  }

  try {
    await startPriceStream();
  } catch (e) {
    console.error("[stream] failed to start:", (e as Error).message);
  }

  try {
    await startEngine();
  } catch (e) {
    console.error("[engine] failed to start:", (e as Error).message);
  }
}

/**
 * Start the execution scheduler.
 *
 * Starting the timer is not the same as starting to trade: every book is
 * created disarmed, and a tick with nothing armed returns after one query. The
 * scheduler exists so that arming a book in the UI takes effect without a
 * redeploy — arming remains the only thing that causes an order.
 */
async function startEngine(): Promise<void> {
  const { ensureExecutionState } = await import("@/lib/execution/engine");
  const { startScheduler } = await import("@/lib/execution/scheduler");

  await ensureExecutionState();
  startScheduler();
}
