/**
 * Sanity check for the book/horizon split.
 *
 *   node scripts/check-horizons.mjs
 */
process.loadEnvFile(".env.local");
const postgres = (await import("postgres")).default;
const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: "require" });

const acc = await sql`select id, alias, book, environment from accounts order by id`;
console.log("ACCOUNTS (book = instrument class, from the OANDA alias):");
for (const a of acc) {
  console.log(`  ${a.id}  "${a.alias}"  →  ${a.book}`);
}

const h = await sql`
  select horizon, count(*)::int as n,
         round(avg(r_multiple)::numeric, 3) as avg_r,
         round(min(extract(epoch from (exit_time - entry_time)))::numeric / 60, 1) as min_min,
         round(max(extract(epoch from (exit_time - entry_time)))::numeric / 60, 1) as max_min
  from trades
  where state = 'closed'
  group by horizon
  order by min_min`;
console.log("\nHORIZONS (inferred from hold time):");
for (const r of h) {
  console.log(
    `  ${String(r.horizon ?? "null").padEnd(10)} ${String(r.n).padStart(4)} trades   ` +
      `avgR ${String(r.avg_r).padStart(7)}   hold ${r.min_min}–${r.max_min} min`,
  );
}

const cross = await sql`
  select book, horizon, count(*)::int as n,
         round(avg(r_multiple)::numeric, 3) as avg_r
  from trades where state = 'closed'
  group by book, horizon order by book, horizon`;
console.log("\nBOOK × HORIZON — the whole point of splitting them:");
for (const r of cross) {
  console.log(
    `  ${String(r.book).padEnd(12)} ${String(r.horizon ?? "—").padEnd(10)} ` +
      `${String(r.n).padStart(4)} trades   avgR ${r.avg_r}`,
  );
}

const cfg = await sql`select horizon_thresholds from app_config where id = 1`;
console.log("\nTHRESHOLDS:", JSON.stringify(cfg[0]?.horizon_thresholds));

await sql.end();
