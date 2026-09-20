# Session — 2026-06-10

## What we built
BimmerLink dashboard (`projects/bimmerlink/dashboard.py`) — a single-command tool that reads OBD logs from BimmerLink and generates a self-contained HTML dashboard.

## Features built this session
- Reads all CSVs from `logs/` folder at build time and embeds them in the HTML
- Auto-detects two CSV formats: long (semicolon, one PID per row) and wide (comma, one column per metric)
- Scrub slider with playback at 0.5×, 1×, 2×, 5×
- Full graph mode: Chart.js line charts for all metrics
- Vertical orange scrub line across all charts with live value badge at top
- Future data dimmed (gray overlay right of scrub line)
- Click or drag any chart to seek — updates master slider + all other charts
- Log switcher dropdown (replaces file picker)
- New metrics added for wide format: Oil Temp, Oil Pressure, Voltage

## Key files
- `projects/bimmerlink/dashboard.py` — run this to regenerate dashboard
- `projects/bimmerlink/logs/` — drop BimmerLink CSV exports here
- `projects/bimmerlink/dashboard.html` — generated output, open in browser

## Repo
https://github.com/sebasblanco/bimmerlink-logs

## Bugs fixed this session
- Wide format CSVs weren't loading (different delimiter and layout)
- Full Graph button not working (`currentView` declared after `loadLog` call)
- Charts rendering empty (setting `display: ""` reverted to CSS `display:none` — needed `"block"`)
- Click-to-seek offset by ~2× on Retina display (was scaling by devicePixelRatio, Chart.js expects CSS pixels)

## What's next
- Export May 9th log from BimmerLink and drop in `logs/` folder
- Stock vs intake comparison (side-by-side view for two logs)
- Pattern recognition / LLM on top of the log data

---

# Session — 2026-09-06

## What changed
- New log added: `logs/stage 2 tune 9:4:26.csv` (wide format).
- Added estimated horsepower as a real metric (`power`) for wide-format logs — previously only the long-format `stock.csv` export had power (BimmerLink's own "Instant engine power" PID). Method: fuel-mass-flow × BSFC (0.50 lb/hp-hr assumed for a turbo DI engine). Uses measured "Fuel mass flow" when present (`intake_pipe.csv`), else derives fuel flow from Air mass flow ÷ (14.7 × Lambda) (`stage 2 tune` log, which has no direct fuel-flow PID).
- Added `torque` and `lambda` as new chart metrics for wide-format logs (`Coordinated target torque on the wheel`, `Lambda actual value`).
- Fixed a real bug: `dashboard.js` was fetching `/api/logs/${name}` unencoded — broke on any log name with spaces/colons (like the new stage-2-tune filename). Now uses `encodeURIComponent`. Verified via curl against the Flask server.
- Fixed lambda display: raw `Lambda actual value` pins at `0` during sensor warmup and a `16.0` sentinel during decel fuel-cut — both are now masked out (clamped to real range 0.5–1.3) so the chart and HP calc aren't corrupted by them.

## Key unit gotchas discovered (don't relitigate these)
- Wide-format `Air mass flow` / `Fuel mass flow` are in **kg/h**, not g/s — using g/s inflated horsepower estimates ~3.6-4x (caught this because stage-2 peak came out to 1045 hp, which is absurd).
- `Boost pressure` units differ **per log session** depending on what BimmerLink's unit setting was at export time — `stock.csv` and `intake_pipe.csv` read in bar (peak ~0.7 bar), `stage 2 tune` log reads in **psi** (peak ~19.8 psi ≈ 1.36 bar). No units row exists in the wide CSVs to detect this automatically — just have to sanity-check against plausible boost levels per log.
- `Coordinated target torque on the wheel` is wheel torque (gear-multiplied), not crank torque — explains why it spikes to 1000-4400 Nm in 1st/2nd gear. Don't feed it into a crank-torque HP formula (torque×rpm/7127) — that's why HP here is derived from fuel flow instead.

## Analysis: stage 2 tune log — is it running good?
Looks healthy overall, no red flags found:
- **Fueling**: holds a safe rich ~0.82λ (≈12:1 AFR) throughout sustained boost/WOT — good margin against knock.
- **The only lean spikes** (λ up to 0.99–1.11) during the pull coincide exactly with 2 shift/lift-off events, where boost setpoint drops to ~0 but actual boost hasn't bled off yet (turbo lag) — this is a benign no-load artifact, not a real lean-under-load condition.
- **Boost tracking**: holds within ~1-3 psi of setpoint once spooled; only lags target during the initial spool ramp (normal turbo lag, not a leak/wastegate problem). One minor overshoot at absolute peak (19.78 vs 18.02 target, +1.76 psi) — small, not alarming.
- **Thermals**: coolant, oil temp, IAT all stayed in normal ranges across the session, no heat-soak trend.
- **Estimated peak power**: ~290 hp (fuel-flow estimate) vs. stock log's own ~326 hp (BimmerLink's built-in PID) — **do not read this as "the tune lost power."** These two numbers come from different calculation methods (fuel-flow-derived estimate vs. BimmerLink's fuel-consumption PID), and the stage-2 log may not have captured the true peak of the pull. Not a valid apples-to-apples comparison as-is.
- **Blind spot**: no timing advance / knock retard PID was logged in either wide-format session. That's the most direct way to catch a marginal tune before it causes damage — worth adding to the BimmerLink PID list for the next log.

## Follow-up: peak HP restricted to true full throttle
Filtered the stage-2 log to rows where `Normalized accelerator pedal angle` = 100% — only 14 rows exist, a single ~2s WOT window from 131.8s-133.8s (1st-to-2nd shift, 5,104 → 5,845 rpm). Peak estimated HP inside that window is the same 290.3 hp already reported — the earlier number was already anchored to the one real WOT moment, not diluted by partial-throttle averaging. Real limitation: the pull never got past 5,845 rpm, so 290 hp is a peak-of-what-was-captured, not the engine's actual peak (likely a bit higher toward redline).

## Follow-up: "just multiply g/s by 1.5" HP shortcut
Confirmed this is the same fuel-flow/BSFC formula collapsed into one constant — `HP = air(g/s) × 7.94 / (14.7 × λ × BSFC)`. The multiplier IS the BSFC assumption:
- BSFC 0.50 (what `dashboard.py` uses) → ×1.33 → 290 hp
- BSFC 0.45 (more optimistic) → ×1.48 (≈ user's "1.5") → ~323 hp
- BSFC 0.40 (aggressive) → ×1.67 → ~363 hp

Realistic range for this car at the WOT peak: **~290-325 hp**, depending on how generous the BSFC assumption is. Anything north of ~325 needs a leaner AFR than this tune's actual lambda trace (0.81λ) supports — don't just hand over the flat-1.5 number without this context, it overstates vs. the dashboard's default.

**Trap to remember:** raw `Air mass flow` is kg/h, not g/s — must divide by 3.6 before applying any g/s-based multiplier, or the result comes out 3.6x too high.

## What's next
- Possibly add a BSFC toggle (0.40/0.45/0.50) to the dashboard's power card so the hp range is visible live instead of computed by hand each time — offered, not yet built.
- Add Timing Advance / Knock Retard to the BimmerLink PID list before the next log — biggest gap in being able to fully vet a tune.
- Capture a clean, dedicated WOT pull with the intake-only setup (the current `intake_pipe.csv` only reached 3187 rpm / mild boost — not usable for a real power comparison), and hold WOT longer/through more of the rev range on the next stage-2 pull to get a real peak instead of a single 2s data point.
- If a real before/after HP number matters, get a dyno pull — the fuel-flow estimate is a trend/sanity-check tool, not a substitute.

---

# Session — 2026-09-13

## New log format discovered: bootmod3 (BM3) export
`93 multi_1-4.csv`, `93 multi_xhp.csv`, and `93 stage 2_2/_3.csv` are a **third CSV format**, distinct from the "long" (BimmerLink semicolon) and "simple wide" (`Time,"Oil temperature",...`) formats documented above. Same `Time,...` header start as "wide" so `dashboard.py`'s `detect_format()` currently misfiles it as plain "wide" — it happens to still parse (all-numeric columns), but the metric name lookups in `WIDE_PID` don't match BM3's column names, so `rpm`/`gear`/`torque`/`boost` come from `dashboard.py`'s wide path came back empty for these files. Not fixed yet — analysis below was done in a standalone script, not through `dashboard.py`.

Key BM3 columns: `Gear[-]` (real gear, not inferred), `(BM3) Map Slot[]` (which tune map was active), `(RAM) Torque at Clutch (Actual)[Nm]`.

**Torque at Clutch (Actual) is crank-equivalent torque, not wheel torque** — verified by inspection: it stays continuous (~300-390 Nm) across 2→3→4 gear shifts in `93 multi_1.csv`, rather than dropping by the gear-ratio factor the way `Coordinated target torque on the wheel` does in the older simple-wide logs. This makes `HP = Torque_Nm × RPM / 7127` usable directly here — no fuel-flow/BSFC estimate needed for these logs.

One filename gotcha: `93 multi_2csv` is missing its `.` before `csv` (typo at export) — `glob("*.csv")` skips it silently. Confirmed it's not a real WOT pull anyway (pedal never exceeds 28%), so no impact on the analysis, but worth fixing the filename before it trips up tooling later.

## Analysis: where does the car pull hardest? (2nd→3rd gear WOT pulls)
Per-gear peak HP (Torque × RPM / 7127) across every genuine WOT pull found in this morning's logs, by which BM3 map slot was active:

| Tune | Map Slot | File(s) | 2nd gear peak | 3rd gear peak |
|---|---|---|---|---|
| **93 multi** | 3 | multi_1 (×2 pulls), multi_3, multi_4 | 290–305 hp (avg ~297) | 275–293 hp (avg ~283*) |
| **XHP** (piggyback on top of the stage-2 map) | 1 | multi_xhp | 293 hp | 288 hp |
| **Stage 2** (map only, no XHP) | 1 | stage 2_2, stage 2_3 | 270 hp | 255–275 hp |
| Stock | — | stock.csv | ~326 hp (BimmerLink's own fuel-consumption PID — different calc method, see caveat below) | not confirmed (no gear channel logged) |

\*excludes one 3rd-gear sample in `multi_3.csv` that's only 7 rows / 0.7s — too short to trust.

**Result: Map Slot 3 ("93 multi") pulls hardest**, consistently ~290-305 hp in 2nd and high-270s–low-290s in 3rd across 4 separate pulls in 3 different files — the most repeatable strong result of the session. **XHP is a close second** (293/288 hp) — since it shares Map Slot 1 with the plain stage-2 runs but clearly outperforms them, the XHP piggyback is adding real power on top of that base map, not just riding along. **Plain Stage 2 (Slot 1, no XHP) is the weakest of the three tunes** at 270-275 hp, a real ~20-30 hp gap under both Slot 3 and XHP.

**Stock's ~326 hp is not a fair comparison** — same trap flagged in the 2026-09-06 session: it's BimmerLink's own fuel-consumption-based power PID, a different calculation method than the Torque×RPM figure used for the BM3 logs above. Don't read it as "stock beats the tunes." No gear channel exists in `stock.csv` either, so the 2nd-3rd gear window there is inferred from the WOT/RPM trace, not confirmed directly.

Also not usable this session: `intake_pipe.csv` and `93 multi_2csv` never reached WOT (pedal maxed at 45% and 28% respectively) — cruising/logging runs, not pulls.

## What's next
- Fix `93 multi_2csv` → `93 multi_2.csv` filename.
- Teach `dashboard.py`'s `detect_format()` to recognize the BM3 header (`"(RAM) Torque at Clutch" in header`) as its own format, with its own PID map (`Gear[-]`, `(BM3) Map Slot[]`, `(RAM) Torque at Clutch (Actual)[Nm]` → real crank-equivalent HP) — this is a strictly better data source than the fuel-flow estimate for any future BM3 export, and lets the dashboard show gear + map slot directly instead of needing a one-off script.
- Get a clean 2nd-3rd gear WOT pull on stock with a gear channel logged (or at least confirm gear via speed/RPM ratio) so the stock comparison isn't an asterisk.
- If deciding between Slot 3 and XHP matters for a real decision (e.g. keeping the XHP box permanently vs. just running Slot 3), worth a few more back-to-back pulls same day/same conditions — today's XHP vs. Slot 3 gap is small enough (293 vs ~297 hp) that ambient temp/fuel variation between pulls could account for it.
