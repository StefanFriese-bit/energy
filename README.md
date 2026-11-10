# Home Energy

A phone web app for one house: the Hive heating week (easy per-day editing, copy a day, saved weeks, boost, mode)
and Octopus Energy electricity + gas use, prices and cost per half hour.

Runs entirely on the phone: it talks straight to Octopus's official API and to Hive (the same unofficial route as
Hive's own app and Home Assistant). Account numbers, API keys and Hive sign-in stay on the phone; nothing is stored
in this repository.

- `npm test` — calculations (UK time, clock changes, tariffs, Economy 7, gas m³ → kWh, schedule rules)
- `npm run e2e` — the app in iPhone + Chrome engines with Octopus and Hive stood in
- `LIVE=1 npx vitest run tests/live-octopus.test.ts` — against Octopus's real public price lists (no account needed)
