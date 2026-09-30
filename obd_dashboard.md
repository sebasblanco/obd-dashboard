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

---

# Session — 2026-09-28

## New logs: `93 multi_2-1.csv` and `93 multi_2-2.csv`
Two new pulls uploaded same evening (22:33, 22:38). Format: "simple wide" (same as `stock.csv`'s cousin `93 stage 2_1.csv`) — has `Actual gear` (a real gear channel, unlike the older stock/intake_pipe wide logs) and `Coordinated target torque on the wheel`, but no crank-torque channel, so crank HP still needs the fuel-flow/BSFC(0.50) estimate, same method as `93 stage 2_1.csv`.

**Tried and rejected: wheel-torque × wheel-angular-velocity as a WHP method.** Computed `whp = torque_wheel × (speed_mph×0.447/r_wheel) / 745.7` across 3 tire-radius guesses (24.0/24.9/26.0 in). Result was physically impossible — `93 stage 2_1.csv` gear-1 gave 377-408 whp, *higher* than that same log's own fuel-flow crank-hp estimate (290.3 hp), which cannot happen (WHP must be less than crank HP after drivetrain loss). Confirms the existing caveat on `Coordinated target torque on the wheel` (2026-09-06 entry above) — it's a "target," not measured/delivered torque, and it's unusable for absolute HP by this method, not just for feeding a crank-torque formula. Don't retry this approach without a real crank-torque or dyno channel.

**Peak crank-equiv HP (fuel-flow/BSFC 0.50, WOT pedal≥95%, method matches `93 stage 2_1.csv`):**

| Log | Peak crank-hp | @ | Gear(s) captured |
|---|---|---|---|
| `multi_2-1.csv` | **219.3 hp** | 4626 rpm, 72 mph | 4, 5, 6 only (log started after launch — missed 1st-3rd) |
| `multi_2-2.csv` | **293.6 hp** | 5087 rpm, 63 mph | 3, 4, 5, 6 |
| `93 stage 2_1.csv` (reference, same format) | 290.3 hp | 5104 rpm, 25 mph | 1, 2 |

`multi_2-2.csv`'s 293.6 hp lands right in the established Map-Slot-3/XHP band (290-305 hp, see 2026-09-13 table above) — this tune is performing as expected. `multi_2-1.csv`'s 219 hp is the lowest crank-hp estimate logged for this car to date, but it's not evidence of a real power loss: the pull only captured 4th-6th gear (missed the strongest part of the curve) and — see below — ran leaner than any prior pull, which alone would drag the fuel-flow estimate down.

## Reliability check
- **`multi_2-1.csv` ran genuinely lean under boosted load** — mean λ 0.930, 55 of 70 WOT+under-load rows above 0.90λ (max 0.95λ). This is *not* the benign shift/lift-off lean-spike artifact documented 2026-09-06 (excluded those by requiring `boost_sp > 5psi`) — it's sustained leaning through real load. Every other WOT pull logged for this car to date (stage-2 tune, `multi_2-2`, and the BM3 logs) has stayed ≤0.82-0.90λ under load. Worth watching; same blind spot as always applies — no timing advance/knock retard PID in this log format, so can't confirm or rule out knock from it directly.
- **`multi_2-2.csv` fuel/boost look normal** — mean λ 0.87 under load (only 6/61 rows crept above 0.90λ, max 0.94λ), boost overshoot peaked +3.3 psi (slightly above the historical ~1-3 psi norm but not alarming), undershoot -4.1 psi (typical turbo-lag range).
- **Thermals normal in both**: oil 212-219°F, coolant 208-210°F, IAT 94-95°F — no heat-soak trend across the two back-to-back pulls.

## What's next
- Re-log a clean full-pull (from a stop, through at least 2nd-4th gear) on this map to confirm `multi_2-1`'s low 219 hp reading was just an incomplete/rolling capture and not a real regression — `multi_2-2` from the same evening already argues for "incomplete capture," but one more clean pull would remove the doubt.
- Keep an eye on AFR under boost going forward — `multi_2-1`'s lean trend is a first for this car's logs; if it repeats on the next pull it's worth pulling timing/knock data (add that PID) rather than assuming it's a one-off.
- Wheel-torque-based WHP is a dead end with this PID set — don't spend more time on it unless a real crank-torque channel (BM3-style) or dyno pull becomes available.

---

# Session — 2026-09-30

## Renamed: BimmerLink Dashboard → OBD Dashboard
Now that bootmod3 (BM3) logs are a first-class format alongside BimmerLink's own exports (not a one-off), the BimmerLink-specific name no longer fit. Renamed everywhere:
- Folder: `projects/bimmerlink/` → `projects/obd-dashboard/`
- This notes file: `bim_dashboard.md` → `obd_dashboard.md`
- GitHub repo: `sebasblanco/bimmerlink-logs` → `sebasblanco/obd-dashboard` (via `gh repo rename`, description updated too)
- Page `<title>` and header label in `template.html`, startup message in `server.py`
- Project Hub's card (name, description, GitHub link) updated to match
- BimmerLink-specific terms were left alone where they're still accurate (the "long"/"wide" format names, `LONG_PID`/`WIDE_PID` code comments) — only the project-level branding changed, not the actual format documentation.

## Fixed: BM3 lambda was silently empty on every BM3 log
`BM3_PID`'s `"lambda"` entry pointed at `Lambda Act.[AFR]`, but despite the column name saying "AFR," it stores real gasoline AFR values (~12-19, stoich 14.7) — not a unitless lambda ratio like every other format in this dashboard uses for the same metric key. The existing sanity clamp (`series.between(0.5, 1.3)`) was written for a lambda ratio, so it silently zeroed out 100% of the AFR data on every BM3 log ever loaded (`multi_1`, `multi_2-3`, the 2026-09-13 `xhp`/`multi_3`/`multi_4` logs) — the Lambda chart has been blank for BM3 logs since BM3 support was added, this just hadn't been noticed because none of the BM3 analysis so far went through the dashboard's lambda chart (it was all done via one-off scripts). Fixed by converting AFR → lambda (`÷14.7`) before the existing clamp, in `dashboard.py`'s `build_bm3()`.

## Added: Timing and Knock metrics for BM3 logs
BM3 exports already carry `Ignition Timing 1-4[deg]` and `Knock Detected[0-n]` per row — this closes the "no timing/knock PID logged" blind spot flagged in the 2026-09-06 and 2026-09-13 sessions, at least for BM3 logs (still a real gap for BimmerLink wide-format logs, which don't carry these columns). Added both to `BM3_PID` (`timing` → `Ignition Timing 1[deg]`, cylinder 1 as representative; `knock` → `Knock Detected[0-n]`) and to the frontend's `METRIC_DEFS` in `dashboard.js` so they render as charts. This also retroactively lights up timing/knock for the already-logged `multi_1.csv`, `multi_2-1/2/3.csv`, and the 2026-09-13 BM3 logs — not re-analyzed here, but available next time any of them are opened.

## Fixed: README was still describing the old standalone-script workflow
Said to run `python3 dashboard.py` then `open dashboard.html` — stale since the project moved to a Flask server (`server.py`) on 2026-09-20. Rewrote to describe the actual `pip install pandas flask` → `python3 server.py` → open `localhost:8000` flow, documented all three supported formats and the three different power-calculation methods (with the "not directly comparable" caveat this file has been building up), and updated the project structure block to match the real file set (`server.py`, `dashboard.js`, `dashboard.css` weren't mentioned at all before).

## New log: `93 multi_2-3.csv` — clean single continuous pull, Map Slot 3, BM3 format
This is the clean full pull the 2026-09-28 session's "what's next" asked for — one continuous WOT run from a 2nd-gear launch through 5th gear (14.6s–25.4s), not the fragmented/partial captures of prior sessions. 116s total log, idling in gear 1 beforehand, no WOT after the pull (drive/cooldown for the rest of the file). Map Slot 3 throughout (same tune as the strongest result in the 2026-09-13 comparison table). Ethanol 0% (pure 93 octane, matches the filename).

**Peak crank HP by gear (Torque×RPM/7127, exact for BM3):**

| Gear | Peak HP | @ RPM | Time |
|---|---|---|---|
| 2 | 276.8 | 5645 | 19.1s |
| 3 | 269.3 | 5742 | 19.3s |
| 4 | 263.7 | 5365 | 22.1s |
| 5 | 251.1 | 5127 | 24.6s |

A smooth, monotonic per-gear decline — no red flags in the shape of the curve. 3rd gear's 269.3 hp sits right inside the historical Map-Slot-3 band (275-293 hp, 2026-09-13 table). 2nd gear's 276.8 hp is ~15-25 hp under that session's Map-Slot-3 2nd-gear band (290-305 hp) — see the launch-retard note below for the likely reason; not treating it as a regression. 4th and 5th gear are new data points for this tune (no prior BM3 pull captured past 3rd gear).

**First ~2.5s of the pull (14.6s-17.5s) is a real launch/traction-control hold, not a data or tune problem.** During this window in 2nd gear, boost climbs fast to 24-31 psi while ignition timing on all four cylinders is pulled hard to -22° to -23° (vs. single digits everywhere else in the pull) and Torque-at-Clutch stays low (~90-145 Nm) and tracks its own target closely, despite full pedal and full boost. The `(RAM) Torque Limit Active` flag columns are non-zero right where the hold releases (17.5s), where torque and timing both snap back to normal and HP climbs cleanly from ~192 hp to the 276.8 hp peak in about 1.6s. Read this as the map intentionally holding power back during the 2nd-gear launch (likely wheel-slip/traction management) rather than turbo lag or a fueling issue — actual boost was already present, torque just wasn't being allowed to follow it. This also explains why 2nd gear's peak came in under the historical band: the effective full-power window in 2nd was shorter than usual because ~2.5s of it was spent held back.

**Knock Detected fired 6 times, all under light-throttle/low-boost conditions (11-14% pedal, <1 psi boost) — not during the WOT pull.** Two clusters: t≈1.7-4.3s (gear 4, ~1700-1800 rpm, likely off-throttle/cruise before the pull) and t≈75.1-75.5s (gear 1, ~1200 rpm, well after the pull). Both look like ordinary low-load knock-sensor noise rather than real detonation — no knock recorded anywhere in the WOT window itself, and ignition timing during the pull's real full-power stretches (excluding the launch-hold above) sat in a normal single-digit-to-low-teens range, not retarded.

**Fueling**: WOT lambda averaged 0.928 (~13.6:1 AFR), min 0.841 (~12.4:1) at the power peak — safely rich, consistent with every prior WOT pull on this car. The handful of lambda readings pinned at the 1.3 clamp ceiling are shift-transient artifacts (fuel cut during the 2→3, 3→4, 4→5 shifts lands in the same rounded-second bucket as valid data and gets averaged/clamped) — same known artifact class as the 2026-09-06 shift-lean findings, not a real air-fuel event.

**Boost tracking**: held within ~1-2 psi of target through the clean parts of the pull (e.g. 17.4 actual vs 19.1 target at the 2nd-gear peak) — normal. Excluding the launch-hold window (where target itself reads 0 while actual climbs — an artifact of the traction-control state, not a real overboost), tracking looks the same as every prior pull on this tune.

**Thermals**: coolant peaked 212°F, IAT peaked 102°F — normal, no heat-soak concern.

## What's next
- The BM3 lambda fix and new timing/knock metrics apply to every BM3 log already on disk — worth a quick look at `multi_1.csv`'s timing/knock charts next time it's open, since that log was never checked for this before.
- If the 2nd-gear launch-hold behavior is unwanted (e.g. it's costing a measurable chunk of a straight-line time attack), that's a map-slot tuning question for whoever built Map Slot 3 — not a dashboard or diagnostic action item.
- Still no BimmerLink-side timing/knock PID — if a future BimmerLink (non-BM3) log matters for tune verification, that gap from 2026-09-06 is still open.
- Continue watching AFR under boost on the "wide"-format logs per the 2026-09-28 note — this session's log was BM3, so it doesn't resolve that open thread.
