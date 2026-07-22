#!/usr/bin/env python3
"""Pull housing listings for the S-train corridor from boligsiden.dk's public API
and write two compact files consumed by the static site:

    data/listings.json  – one trimmed record per listing (~0.3 KB each)
    data/meta.json       – generated-at, counts, municipality names, stations

No API key, no auth. Dependency-free (stdlib only) so it runs locally and in CI.
"""
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from stations import STATIONS, LINES, LINE_LABELS  # noqa: E402

API = "https://api.boligsiden.dk/search/cases"
PER_PAGE = 500

# S-train corridor: København → Hillerød + the northern coast, near the S-train.
MUNICIPALITIES = {
    "koebenhavn":      "København",
    "frederiksberg":   "Frederiksberg",
    "gentofte":        "Gentofte",
    "lyngby-taarbaek": "Lyngby-Taarbæk",
    "rudersdal":       "Rudersdal",
    "gladsaxe":        "Gladsaxe",
    "furesoe":         "Furesø",
    "alleroed":        "Allerød",
    "hilleroed":       "Hillerød",
    "hoersholm":       "Hørsholm",
    "ballerup":        "Ballerup",
    "herlev":          "Herlev",
    "egedal":          "Egedal",
    "fredensborg":     "Fredensborg",
}
TYPES = ["condo", "villa"]  # ejerlejlighed, villa

# "Near the S-train" heuristic (metres, straight-line to nearest S-train station).
STRAIN_NEAR_M = 1200


def fetch(muni, addr_type):
    """Yield every trimmed listing for one municipality + address type."""
    page = 1
    seen = 0
    while True:
        qs = urllib.parse.urlencode({
            "addressTypes": addr_type,
            "municipalities": muni,
            "per_page": PER_PAGE,
            "page": page,
        })
        req = urllib.request.Request(
            f"{API}?{qs}",
            headers={"Accept": "application/json", "User-Agent": "hovedstaden-boliger/1.0"},
        )
        for attempt in range(4):
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    data = json.load(r)
                break
            except Exception as e:  # transient network/5xx – back off and retry
                if attempt == 3:
                    raise
                print(f"    retry {muni}/{addr_type} p{page} ({e})", file=sys.stderr)
                time.sleep(2 * (attempt + 1))
        total = data.get("totalHits") or 0
        cases = data.get("cases") or []
        for c in cases:
            yield c
        seen += len(cases)
        if seen >= total or not cases:
            break
        page += 1
        time.sleep(0.3)


def haversine_m(lat1, lon1, lat2, lon2):
    R = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def nearest_station(lat, lon):
    """Return (name, corridor, dist_m, is_strain) for the closest rail station."""
    best = None
    for name, corridor, slat, slon, strain in STATIONS:
        d = haversine_m(lat, lon, slat, slon)
        if best is None or d < best[2]:
            best = (name, corridor, d, strain)
    return best


def pick_thumb(images):
    """Smallest image wider than ~250px, else the first source."""
    if not images:
        return None
    srcs = images[0].get("imageSources") or []
    if not srcs:
        return None
    wide = [s for s in srcs if (s.get("size") or {}).get("width", 0) >= 250]
    chosen = min(wide, key=lambda s: s["size"]["width"]) if wide else srcs[0]
    return chosen.get("url")


def address_line(addr):
    road = addr.get("roadName") or ""
    house = addr.get("houseNumber") or ""
    parts = [f"{road} {house}".strip()]
    fl = addr.get("floor")
    door = addr.get("door")
    if fl or door:
        parts.append(", ".join(x for x in [f"{fl}." if fl else "", door or ""] if x))
    return " ".join(p for p in parts if p).strip(", ").strip()


def trim(case):
    addr = case.get("address") or {}
    coords = case.get("coordinates") or {}
    lat, lon = coords.get("lat"), coords.get("lon")
    if lat is None or lon is None:
        return None
    st_name, st_corr, st_d, st_is = nearest_station(lat, lon)
    # nearest S-train specifically (may differ from overall nearest)
    strain_only = min(
        (s for s in STATIONS if s[4]),
        key=lambda s: haversine_m(lat, lon, s[2], s[3]),
    )
    strain_d = haversine_m(lat, lon, strain_only[2], strain_only[3])
    return {
        "id": case.get("caseID"),
        "t": "villa" if case.get("addressType") == "villa" else "condo",
        "p": case.get("priceCash"),
        "m2p": case.get("perAreaPrice"),
        "a": case.get("housingArea"),
        "lot": case.get("lotArea"),
        "r": case.get("numberOfRooms"),
        "d": case.get("daysOnMarket"),
        "chg": case.get("priceChangePercentage"),
        "y": case.get("yearBuilt"),
        "e": case.get("energyLabel"),
        "lat": round(lat, 6),
        "lon": round(lon, 6),
        "muni": (addr.get("municipality") or {}).get("slug"),
        "city": addr.get("cityName"),
        "zip": addr.get("zipCode"),
        "adr": address_line(addr),
        "img": pick_thumb(case.get("images")),
        "rt": (case.get("realtor") or {}).get("name"),
        "url": "https://www.boligsiden.dk/adresse/" + case["slug"] if case.get("slug") else case.get("caseUrl"),
        "elev": bool(case.get("hasElevator")),
        "balc": bool(case.get("hasBalcony")),
        # nearest rail station (any) + nearest S-train specifically
        "st": st_name,
        "sd": round(st_d),
        "sc": st_corr,
        "sst": round(strain_d),        # metres to nearest S-train station
        "ssn": strain_only[0],          # nearest S-train station name
        "near": strain_d <= STRAIN_NEAR_M,
    }


def main():
    out = []
    counts = {"condo": 0, "villa": 0}
    for muni, name in MUNICIPALITIES.items():
        for t in TYPES:
            got = 0
            for case in fetch(muni, t):
                rec = trim(case)
                if rec is None:
                    continue
                out.append(rec)
                counts[rec["t"]] += 1
                got += 1
            print(f"  {name:16} {t:6} {got}")
    # de-duplicate on id (a listing can appear once per muni only, but be safe)
    uniq = {r["id"]: r for r in out if r["id"]}
    listings = list(uniq.values())

    here = os.path.dirname(os.path.abspath(__file__))
    data_dir = os.path.join(here, "..", "data")
    os.makedirs(data_dir, exist_ok=True)

    with open(os.path.join(data_dir, "listings.json"), "w", encoding="utf-8") as f:
        json.dump(listings, f, ensure_ascii=False, separators=(",", ":"))

    meta = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "boligsiden.dk",
        "total": len(listings),
        "counts": {"condo": counts["condo"], "villa": counts["villa"]},
        "strainNearM": STRAIN_NEAR_M,
        "municipalities": [{"slug": s, "name": n} for s, n in MUNICIPALITIES.items()],
        "stations": [
            {"name": n, "corridor": c, "lat": la, "lon": lo, "strain": st}
            for (n, c, la, lo, st) in STATIONS
        ],
        "lines": [{"corridor": c, "label": LINE_LABELS[c], "stops": stops}
                  for c, stops in LINES.items()],
    }
    with open(os.path.join(data_dir, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, separators=(",", ":"))

    print(f"\nWrote {len(listings)} listings "
          f"(condo={counts['condo']}, villa={counts['villa']}) to data/")


if __name__ == "__main__":
    main()
