import pandas as pd
import os, glob

LOGS_DIR = "logs"

# ── format detection ──────────────────────────────────────────────────────────

def detect_format(path):
    with open(path, encoding="utf-8", errors="replace") as f:
        header = f.readline()
    if "SECONDS" in header.upper() and ";" in header:
        return "long"
    # bootmod3 exports share the same Time,... comma header shape as "wide," but
    # carry their own column names (units baked into the header, e.g. "Gear[-]"),
    # so WIDE_PID never matches them — check for a BM3-only column first.
    if "Torque at Clutch" in header:
        return "bm3"
    if header.upper().startswith("TIME"):
        return "wide"
    return "unknown"

# ── long format (BimmerLink semicolon / long export) ─────────────────────────

LONG_PID = {
    "rpm":        ["Engine RPM", "Engine RPM x1000"],
    "speed":      ["Vehicle speed"],
    "throttle":   ["Throttle position"],
    "coolant":    ["Engine coolant temperature"],
    "maf":        ["MAF air flow rate"],
    "power":      ["Instant engine power (based on fuel consumption)"],
    "boost":      ["Calculated boost"],
    "intake_temp":["Intake air temperature"],
    "timing":     ["Timing advance"],
    "accel":      ["Vehicle acceleration"],
    "lambda":     ["Fuel/Air commanded equivalence ratio", "Oxygen sensor 1 Wide Range Equivalence ratio"],
}

def load_long(path):
    df = pd.read_csv(path, sep=";", quotechar='"', header=0)
    df = df[["SECONDS", "PID", "VALUE"]]
    df["SECONDS"] = pd.to_numeric(df["SECONDS"], errors="coerce")
    df["VALUE"]   = pd.to_numeric(df["VALUE"],   errors="coerce")
    return df.dropna(subset=["SECONDS", "VALUE"])

def pivot_long(df):
    df = df.copy()
    df["SEC"] = df["SECONDS"].round(0).astype(int)
    p = df.pivot_table(index="SEC", columns="PID", values="VALUE", aggfunc="mean")
    return p.ffill(limit=5)

def to_clock(s):
    s = int(s)
    return f"{s // 3600 % 24:02d}:{(s % 3600) // 60:02d}:{s % 60:02d}"

def build_long(p):
    timeline = [to_clock(s) for s in p.index]
    all_data, meta = {}, {}
    for key, pids in LONG_PID.items():
        for pid in pids:
            if pid not in p.columns:
                continue
            col  = p[pid]
            vals = [round(float(v), 2) if pd.notna(v) else None for v in col]
            if key == "rpm" and pid == "Engine RPM x1000":
                vals = [round(v * 1000, 0) if v is not None else None for v in vals]
            valid = [v for v in vals if v is not None]
            if not valid:
                continue
            all_data[key] = vals
            meta[key] = {"min": round(min(valid), 2), "max": round(max(valid), 2)}
            break
    return timeline, all_data, meta

# ── wide format (BimmerLink wide / comma export) ──────────────────────────────

WIDE_PID = {
    "rpm":          ["Engine speed"],
    "speed":        ["Actual speed"],
    "throttle":     ["Throttle valve angle from potentiometer 1"],
    "boost":        ["Boost pressure"],
    "coolant":      ["Coolant temperature"],
    "maf":          ["Air mass flow"],
    "intake_temp":  ["Intake air temperature"],
    "oil_temp":     ["Oil temperature"],
    "oil_pressure": ["Oil pressure"],
    "voltage":      ["Current battery voltage"],
    "lambda":       ["Lambda actual value"],
    "torque":       ["Coordinated target torque on the wheel"],
}

# lb fuel / hp-hr — typical turbo direct-injection gasoline estimate, used to
# back into an estimated crank hp from fuel flow when no dyno/torque channel exists
BSFC = 0.50

def load_wide(path):
    df = pd.read_csv(path, header=0)
    df.columns = [c.strip().strip('"') for c in df.columns]
    df["Time"] = pd.to_numeric(df["Time"], errors="coerce")
    return df.dropna(subset=["Time"])

def pivot_wide(df):
    df = df.copy()
    df["SEC"] = df["Time"].round(0).astype(int)
    num_cols = [c for c in df.select_dtypes(include="number").columns
                if c not in ("Time", "SEC")]
    p = df.groupby("SEC")[num_cols].mean()
    return p.ffill(limit=5)

def to_elapsed(s):
    s = int(s)
    return f"{s // 60}:{s % 60:02d}"

def build_wide(p):
    timeline = [to_elapsed(s) for s in p.index]
    all_data, meta = {}, {}
    for key, col_names in WIDE_PID.items():
        for col in col_names:
            if col not in p.columns:
                continue
            series = p[col]
            if key == "lambda":
                # sensor reports 0 during warmup and pins at a 16.0 sentinel
                # during decel fuel cut — neither is a real air-fuel reading
                series = series.where(series.between(0.5, 1.3))
            vals  = [round(float(v), 2) if pd.notna(v) else None for v in series]
            valid = [v for v in vals if v is not None]
            if not valid:
                continue
            all_data[key] = vals
            meta[key] = {"min": round(min(valid), 2), "max": round(max(valid), 2)}
            break

    # derived: estimated crank hp from fuel flow, so logs without a power PID
    # (anything that isn't a stock BimmerLink long-format export) still get one.
    # Prefers measured fuel mass flow; falls back to air mass flow / lambda.
    # BimmerLink's wide-export Air/Fuel mass flow PIDs are in kg/h, not g/s.
    fuel_kg_h = None
    if "Fuel mass flow" in p.columns:
        fuel_kg_h = p["Fuel mass flow"]
    elif "Air mass flow" in p.columns and "Lambda actual value" in p.columns:
        lam = p["Lambda actual value"].where(p["Lambda actual value"].between(0.5, 1.3))
        fuel_kg_h = p["Air mass flow"] / (14.7 * lam)

    if fuel_kg_h is not None:
        hp = fuel_kg_h * 2.20462 / BSFC  # kg/h -> lb/hr -> hp @ BSFC
        vals  = [round(float(v), 1) if pd.notna(v) and v > 0 else None for v in hp]
        valid = [v for v in vals if v is not None]
        if valid:
            all_data["power"] = vals
            meta["power"] = {"min": round(min(valid), 2), "max": round(max(valid), 2)}

    return timeline, all_data, meta

# ── bm3 format (bootmod3 export) ──────────────────────────────────────────────

BM3_PID = {
    "rpm":         ["Engine speed[1/min]"],
    "speed":       ["Vehicle Speed[mph]"],
    "throttle":    ["Throttle Angle[%]"],
    "boost":       ["Boost (Pre-Throttle)[psig]"],
    "coolant":     ["Coolant Temp[F]"],
    "intake_temp": ["IAT[F]"],
    "lambda":      ["Lambda Act.[AFR]"],
    "gear":        ["Gear[-]"],
    "map_slot":    ["(BM3) Map Slot[]"],
    "torque":      ["(RAM) Torque at Clutch (Actual)[Nm]"],
}

def build_bm3(p):
    timeline = [to_elapsed(s) for s in p.index]
    all_data, meta = {}, {}
    for key, col_names in BM3_PID.items():
        for col in col_names:
            if col not in p.columns:
                continue
            series = p[col]
            if key == "lambda":
                series = series.where(series.between(0.5, 1.3))
            vals = [round(float(v), 2) if pd.notna(v) else None for v in series]
            if key in ("gear", "map_slot"):
                vals = [round(v, 0) if v is not None else None for v in vals]
            valid = [v for v in vals if v is not None]
            if not valid:
                continue
            all_data[key] = vals
            meta[key] = {"min": round(min(valid), 2), "max": round(max(valid), 2)}
            break

    # derived: real crank-equivalent hp. Unlike plain "wide" logs (which only have
    # wheel torque and need a fuel-flow/BSFC estimate), BM3 exposes actual crank
    # torque directly via "Torque at Clutch," so HP = T x RPM / 7127 is exact,
    # not an approximation.
    if "rpm" in all_data and "torque" in all_data:
        hp = [round(t * r / 7127, 1) if (t is not None and r is not None) else None
              for t, r in zip(all_data["torque"], all_data["rpm"])]
        valid = [v for v in hp if v is not None]
        if valid:
            all_data["power"] = hp
            meta["power"] = {"min": round(min(valid), 2), "max": round(max(valid), 2)}

    return timeline, all_data, meta

# ── load all logs ─────────────────────────────────────────────────────────────

def load_all_logs(logs_dir):
    logs = {}
    for path in sorted(glob.glob(os.path.join(logs_dir, "*.csv"))):
        name = os.path.basename(path).replace(".csv", "")
        fmt  = detect_format(path)
        print(f"  {name}  [{fmt}]")
        try:
            if fmt == "long":
                tl, ad, m = build_long(pivot_long(load_long(path)))
            elif fmt == "wide":
                tl, ad, m = build_wide(pivot_wide(load_wide(path)))
            elif fmt == "bm3":
                tl, ad, m = build_bm3(pivot_wide(load_wide(path)))
            else:
                print("    skipped (unknown format)"); continue
            logs[name] = {"timeline": tl, "all": ad, "meta": m}
            print(f"    {len(tl)} seconds, {len(ad)} metrics")
        except Exception as e:
            print(f"    error: {e}")
    return logs

# ── metrics definition ────────────────────────────────────────────────────────

METRICS = [
    ("rpm",         "Engine RPM",   "rpm", "#f97316"),
    ("speed",       "Speed",        "mph", "#38bdf8"),
    ("throttle",    "Throttle",     "%",   "#fb923c"),
    ("coolant",     "Coolant Temp", "°F",  "#f87171"),
    ("maf",         "MAF",          "g/s", "#a78bfa"),
    ("power",       "Power",        "hp",  "#4ade80"),
    ("boost",       "Boost",        "bar", "#facc15"),
    ("intake_temp", "Intake Temp",  "°F",  "#fb7185"),
    ("timing",      "Timing",       "°",   "#22d3ee"),
    ("accel",       "Accel",        "g",   "#e879f9"),
    ("oil_temp",    "Oil Temp",     "°F",  "#fbbf24"),
    ("oil_pressure","Oil Pressure", "bar", "#86efac"),
    ("voltage",     "Voltage",      "V",   "#94a3b8"),
    ("torque",      "Torque",       "Nm",  "#c084fc"),
    ("lambda",      "Lambda (AFR)", "λ",   "#2dd4bf"),
    ("gear",        "Gear",         "",    "#fde047"),
    ("map_slot",    "Map Slot",     "",    "#fca5a5"),
]

