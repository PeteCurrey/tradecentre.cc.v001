/**
 * Are the "swing" trades independent decisions, or one decision expressed as
 * many small positions closed together?
 *
 * A 100% win rate over 51 trades is far more likely to be a batch close than an
 * edge, and treating clustered positions as independent samples would inflate
 * every statistic built on them.
 */
process.loadEnvFile(".env.local");
const postgres = (await import("postgres")).default;
const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: "require" });

const rows = await sql`
  select horizon,
         count(*)::int                              as trades,
         count(distinct exit_time)::int             as distinct_exits,
         count(distinct date_trunc('minute', exit_time))::int as exit_minutes,
         count(distinct instrument)::int            as instruments,
         round(avg(r_multiple)::numeric, 3)         as avg_r
  from trades
  where state = 'closed'
  group by horizon
  order by trades desc`;

console.log("Trades vs. genuinely distinct exits:");
console.log("horizon      trades  distinct exits  exit minutes  instruments  avgR");
for (const r of rows) {
  console.log(
    `${String(r.horizon).padEnd(12)} ${String(r.trades).padStart(6)}  ` +
      `${String(r.distinct_exits).padStart(14)}  ${String(r.exit_minutes).padStart(12)}  ` +
      `${String(r.instruments).padStart(11)}  ${r.avg_r}`,
  );
}

const clusters = await sql`
  select date_trunc('minute', exit_time) as minute,
         count(*)::int as n,
         string_agg(distinct instrument, ', ') as instruments,
         round(sum(r_multiple)::numeric, 2) as total_r
  from trades
  where state = 'closed' and horizon = 'swing'
  group by 1 having count(*) > 1
  order by n desc limit 8`;

console.log("\nLargest simultaneous swing exits:");
for (const c of clusters) {
  console.log(
    `  ${c.minute.toISOString()}  ${String(c.n).padStart(3)} trades closed together  ` +
      `${c.total_r}R total  [${c.instruments}]`,
  );
}

const entries = await sql`
  select count(distinct date_trunc('minute', entry_time))::int as entry_minutes,
         count(*)::int as trades
  from trades where state = 'closed' and horizon = 'swing'`;
console.log(
  `\nSwing: ${entries[0].trades} trades opened across ${entries[0].entry_minutes} distinct minutes`,
);

await sql.end();
