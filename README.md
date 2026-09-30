# OBD Dashboard

An interactive OBD session dashboard for car tuning logs. Drop in a CSV, start the server, and get a fully scrubable session viewer with live values, playback, and full graph mode — no manual regeneration step, no dyno required.

## Features

- **Scrub timeline** — single slider moves a vertical line across all charts simultaneously, showing the live value for each metric at that exact second
- **Playback** — play through a session at 0.5×, 1×, 2×, or 5× speed
- **Click-to-seek** — click or drag directly on any chart to jump to that timestamp
- **Multi-log support** — dropdown to switch between sessions instantly
- **Compare view** — overlay two or more logs (zoom/pan, side-by-side) to compare pulls directly
- **Auto-detects CSV format** — handles three log formats with no configuration:
  - BimmerLink "long" export (semicolon-delimited, one PID per row)
  - BimmerLink "wide" export (comma-delimited, one column per metric)
  - bootmod3 (BM3) datalogger export (comma-delimited, exposes real crank-equivalent torque, gear, map slot, ignition timing, and knock directly — no fuel-flow estimate needed)
- **Future dimming** — data to the right of the scrub line is grayed out so past vs future is always clear

## Metrics

Displays any available combination of, depending on what the source log provides: Engine RPM, Speed, Throttle, Coolant Temp, MAF, Power (measured or estimated — see below), Boost, Intake Temp, Timing Advance, Knock, Acceleration, Oil Temp, Oil Pressure, Voltage, Torque, Lambda/AFR, Gear, Map Slot.

**Power** is computed two different ways depending on the log source:
- **BM3 logs**: exact, from measured crank-equivalent torque (`HP = Torque × RPM / 7127`).
- **BimmerLink wide logs**: estimated from fuel mass flow at an assumed BSFC of 0.50 lb/hp-hr (a turbo-DI approximation) — a trend/sanity-check number, not a dyno-accurate one.
- **BimmerLink long logs**: BimmerLink's own built-in fuel-consumption-based power PID, where present.

These three numbers are not directly comparable to each other — see `obd_dashboard.md` for the unit gotchas and comparison caveats discovered log-to-log.

## Usage

**1. Export a log**
- BimmerLink: open the app → tap a session → share → Save to Files
- bootmod3: export the session log from the BM3 app
- Save either to the `logs/` folder as a `.csv`

**2. Run the dashboard**
```bash
pip install pandas flask
python3 server.py
```

**3. Open**
```
http://localhost:8000
```

The server reads and parses logs on request — no separate build/regenerate step, and no need to reopen a generated HTML file after adding a new log. Just refresh the page and pick it from the dropdown.

## Project Structure

```
obd-dashboard/
├── server.py         # Flask app — run this, then open localhost:8000
├── dashboard.py       # format detection + per-format parsing/derived metrics
├── dashboard.js        # frontend: charts, scrubbing, playback, compare view
├── dashboard.css        # frontend styling
├── template.html         # page shell served by server.py
├── logs/            # drop CSV exports here (BimmerLink or BM3)
├── analysis/         # notes and comparisons
└── obd_dashboard.md   # session notes: findings, gotchas, what's next
```
