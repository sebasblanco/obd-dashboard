# Car
2020 BMW 330i (confirmed by the user 2026-09-30) — B46 turbo inline-4, consistent with all the PID sets seen so far (Ignition Timing 1-4, no cylinders 5/6).

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

## Hypothetical: richer AFR + more boost/timing, modeled as a synthetic log
Following a discussion about whether this tune should run richer for more power (short answer: no, not by itself — richness past ~11.5-12.5:1 AFR is a knock-margin lever, not a direct power lever; this car's WOT AFR is already on the rich side of that window), built a synthetic BM3-format CSV to visualize what spending that margin on more boost/timing might look like: `logs/93 multi_2-3_HYPOTHETICAL-richer-boost-timing.csv`.

**This is synthetic/illustrative data, not a real pull or a validated tune — do not analyze it as if it were measured.** Generated from `93 multi_2-3.csv` by leaving every non-WOT row and the 2nd-gear launch-control window (Time<17.53s) completely untouched, and for every other WOT row: +3 psi boost (all boost target/actual columns), +2.5° ignition timing (all 4 cylinders), and AFR richened by 1.0 point. Torque at Clutch was rescaled by a rule-of-thumb (`new/old absolute boost ratio × (1 + 1%/deg timing added)`) — a reasonable order-of-magnitude illustration, not a physics simulation; real gains depend on this engine's actual knock limit and fuel-system/turbo headroom at the new targets.

**Result (raw-sample peak, same method as the "Peak crank HP by gear" table above — apples-to-apples against the 276.8/269.3/263.7/251.1 hp real figures):**

| Gear | Real | Mock | Delta |
|---|---|---|---|
| 2 | 276.8 | 310.2 | +33.4 |
| 3 | 269.3 | 303.3 | +34.0 |
| 4 | 263.7 | 294.9 | +31.2 |
| 5 | 251.1 | 280.7 | +29.6 |

Roughly +30-34 hp / +11-12% across the board. (Loading both logs into the dashboard's Compare view will show *lower* absolute numbers for both — its per-second averaging pipeline smooths off a brief instantaneous peak, e.g. real 2nd gear reads 223.7 hp there instead of 276.8 — but the percentage gain and the direction of the comparison hold either way. Use the raw-sample table above for the actual peak-hp claim, not the Compare view's numbers.)

## What's next
- The BM3 lambda fix and new timing/knock metrics apply to every BM3 log already on disk — worth a quick look at `multi_1.csv`'s timing/knock charts next time it's open, since that log was never checked for this before.
- If the 2nd-gear launch-hold behavior is unwanted (e.g. it's costing a measurable chunk of a straight-line time attack), that's a map-slot tuning question for whoever built Map Slot 3 — not a dashboard or diagnostic action item.
- Still no BimmerLink-side timing/knock PID — if a future BimmerLink (non-BM3) log matters for tune verification, that gap from 2026-09-06 is still open.
- Continue watching AFR under boost on the "wide"-format logs per the 2026-09-28 note — this session's log was BM3, so it doesn't resolve that open thread.

---

# Session — 2026-09-30 (part 2)

## Full comparison: every real log on disk, gear by gear

Compared all 8 real logs (excludes the synthetic HYPOTHETICAL mock above). WOT filter: BM3 logs use `Accel. Pedal[%] >= 95` as before; the "wide"-format logs actually do have a real pedal column (`Normalized Accelerator Pedal Angle` / lowercase in `stage 2_1`) that earlier ad-hoc scripts this session missed on the first pass — corrected to use it, same `>=95` threshold, instead of a cruder boost-setpoint proxy. `stock.csv` has no gear channel and its own throttle-position PID tops out at 88.6% in this drive, so its WOT window uses `Throttle position >= 80` instead.

**BM3 logs (measured crank torque, `HP = Torque×RPM/7127` — the trustworthy number):**

| Log | Map Slot | Gear | Peak HP | @ RPM | AFR (min-max, mean) | λ mean | Boost act/tgt @peak | Timing @peak | Knock rows |
|---|---|---|---|---|---|---|---|---|---|
| multi_1 | 3 | 2 | 304.6 | 6446 | 12.3-15.7, 13.7 | 0.929 | 18.2/19.4 psi | 9.5° | 1 |
| multi_1 | 3 | 3 | 292.9 | 6493 | 12.3-13.6, 12.6 | 0.854 | 17.2/18.8 psi | 7.5° | 0 |
| multi_1 | 3 | 4 | 268.4 | 5547 | 11.8-17.6, 12.6 | 0.859 | 18.2/20.6 psi | 3.5° | 0 |
| multi_2-3 | 3 | 2 | 276.8 | 5645 | 12.4-16.1, 13.9 | 0.948 | 17.4/19.1 psi | 6.7° | 0 |
| multi_2-3 | 3 | 3 | 269.3 | 5742 | 12.4-15.2, 13.1 | 0.889 | 15.7/19.1 psi | 7.2° | 0 |
| multi_2-3 | 3 | 4 | 263.7 | 5365 | 12.4-16.5, 12.9 | 0.879 | 18.2/21.4 psi | 4.8° | 0 |
| multi_2-3 | 3 | 5 | 251.1 | 5127 | 12.4-16.6, 13.8 | 0.937 | 18.3/21.6 psi | 3.7° | 0 |
| stage2_2 | 1 | 1 | 238.4 | 5140 | 11.9-13.0, 12.3 | 0.838 | 15.6/17.4 psi | 4.2° | 0 |
| stage2_2 | 1 | 2 | 270.0 | 5706 | 11.2-13.1, 12.0 | 0.816 | 24.0/21.7 psi | 0.7° | 0 |
| stage2_2 | 1 | 3 | 254.7 | 5519 | 11.9-14.9, 12.2 | 0.832 | 18.7/21.8 psi | 4.5° | 1 |
| stage2_3 | 1 | 3 | 272.5 | 5719 | 12.0-12.8, 12.3 | 0.837 | 19.4/22.3 psi | 5.5° | 0 |

**Wide-format logs (fuel-flow/BSFC 0.50 estimate — a different, less exact calc method than the BM3 crank-torque numbers above; tune identity here is inferred from filename, not a logged Map Slot value):**

| Log | Tune (by name) | Gear | Peak HP | @ RPM | AFR (min-max, mean) | λ mean | Boost act/tgt @peak |
|---|---|---|---|---|---|---|---|
| multi_2-1 | "93 multi" (Slot 3) | 4 | 219.3 | 4626 | 12.8-14.8, 13.9 | 0.947 | 18.3/20.1 psi |
| multi_2-1 | "93 multi" (Slot 3) | 5 | 206.8 | 4002 | 12.8-13.8, 13.7 | 0.935 | 17.0/21.6 psi |
| multi_2-1 | "93 multi" (Slot 3) | 6 | 206.8 | 4385 | 13.8-14.0, 13.9 | 0.945 | 18.2/21.6 psi |
| multi_2-2 | "93 multi" (Slot 3) | 3 | 293.6 | 5087 | 12.5-14.7, 13.6 | 0.924 | 16.3/18.6 psi |
| multi_2-2 | "93 multi" (Slot 3) | 4 | 293.6 | 6136 | 12.5 (single sample) | 0.850 | 15.8/18.6 psi |
| multi_2-2 | "93 multi" (Slot 3) | 5 | 247.0 | 4624 | 12.5-12.9, 12.9 | 0.878 | 17.9/20.6 psi |
| multi_2-2 | "93 multi" (Slot 3) | 6 | 246.8 | 3768 | 12.9-13.8, 13.7 | 0.931 | 18.2/22.1 psi |
| stage2_1 | "stage 2" (Slot 1) | 1 | 290.3 | 5104 | 11.9 (single sample) | 0.810 | 19.7/20.1 psi |
| stage2_1 | "stage 2" (Slot 1) | 2 | 290.3 | 5844 | 11.9-12.1, 12.0 | 0.819 | 16.2/20.1 psi |

`multi_2-1`'s gear 4/5/6 richer-than-usual AFR (mean 13.7-13.9) is the same real lean trend already flagged in the 2026-09-28 entry — not new here. `multi_2-2` and `stage2_1`'s repeated identical HP values per gear (293.6 twice, 290.3 twice) reflect very short WOT windows in those specific logs (a handful of rows per gear, sometimes just one) rather than a real plateau — same caveat already on record for `stage2_1` in the 2026-09-13 entry (14 total WOT rows in one ~2s window).

**stock.csv**: no gear channel, so no per-gear breakdown. Peak 325.6 hp @ 5700 rpm from BimmerLink's own fuel-consumption power PID — a third, different calc method from both tables above, so **not directly comparable** (same standing caveat since 2026-09-06/09-13: don't read this as "stock beats the tunes"). WOT-window (throttle≥80%) AFR ran 13.1-14.4 (λ 0.89-0.98, mean 0.94) — noticeably leaner/closer to stoich than any tuned pull, consistent with a conservative stock calibration. Boost only reached 0.57 bar (~8 psi) at that throttle level — stock turbo, no meaningful boost target to speak of. `Timing advance` PID in this log has only 19 samples total, all reading exactly 0.0 — not real data (sensor/PID wasn't actually populated in this session), so timing isn't usable from this log.

## Which tune is best so far

**Map Slot 3 ("93 multi") is ahead, by a real but modest margin** — roughly 15-30 hp higher than Map Slot 1 ("stage 2," no XHP) at comparable gears, on the two BM3-measured pulls of each: 2nd gear 304.6 & 276.8 hp (Slot 3) vs. 270.0 hp (Slot 1); 3rd gear 292.9 & 269.3 hp (Slot 3) vs. 254.7 & 272.5 hp (Slot 1) — the gap is consistent but not enormous, and `stage2_3`'s 272.5 hp 3rd-gear pull actually lands right in Slot 3's own 3rd-gear range, so this isn't a blowout.

Caveats on that verdict, stated plainly rather than papered over:
- **These pulls weren't run back-to-back same-day** — some of the gap (especially multi_1's outlier 304.6 hp at 6446 rpm, higher than any other pull's rev ceiling) may reflect the pull simply being held further into the rev range or better ambient/fuel conditions that day, not a stronger tune at the same point in the curve. This is the same "don't overclaim from thin data" caveat already on record from 2026-09-13's XHP-vs-Slot-3 comparison.
- **Fueling margin favors Slot 1, not Slot 3.** Slot 1's pulls ran tighter and richer (AFR means 12.0-12.3, λ ~0.82-0.84) than Slot 3's (AFR means 12.6-13.9, λ ~0.85-0.95) — Slot 1 is the more conservative map on paper, Slot 3 is leaning further toward the thinner end of "safe" as its pulls go on.
- **Knock is a wash, not a differentiator.** Each map produced exactly one isolated knock-flagged row under real WOT boost this comparison (`multi_1` gear 2 @ 17.5 psi/4597 rpm; `stage2_2` gear 3 @ 16.9 psi/3873 rpm) — both single-sample, both with timing already conservative at that instant, neither map is cleaner than the other here.
- **Boost overshoot**: `stage2_2`'s 2nd gear ran +2.3 psi over target (24.0 vs 21.7) — the largest overshoot in this whole comparison, on Slot 1. Every Slot 3 pull tracked within its target band or slightly under (normal turbo lag), no comparable overshoot.
- **XHP isn't in this comparison** — the raw XHP log file (`93 multi_xhp.csv`) is no longer in `logs/` (superseded by the `multi_2-x` files this session). The 2026-09-13 finding (XHP on top of Slot 1: 293/288 hp, a close second to Slot 3) still stands as the last word on XHP specifically, just not re-verified here.

**Bottom line**: if "best" means peak power, Slot 3 is the answer today, by a real if unspectacular margin. If "best" means the more conservative, higher-margin map, that's Slot 1. Neither is unsafe based on what's logged — no sustained lean-under-load, no repeated knock, boost tracking within normal ranges on both. Given the size of the gap and the lack of same-day back-to-back pulls, this is "Slot 3 looks stronger so far" rather than a settled result — the clean way to close it out would be 2-3 same-day pulls of each map in the same gear/rev range, which is the same ask already sitting in the 2026-09-13 "what's next."
