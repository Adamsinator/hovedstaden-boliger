# Bolig Tracker

A small static site that gives an overview of the housing market in the greater
Copenhagen area — **ejerlejligheder** (owner-occupied flats) and **villaer** —
from København up to Hillerød, with a focus on proximity to the **S-train**.

Live: https://adamsinator.github.io/bolig-tracker/

## What it shows

- Headline KPIs: number of listings, median price, median kr/m², median days on
  market, share with a price cut, share near an S-train station.
- A **custom SVG map** with real municipality land/coastline (Dataforsyningen),
  the S-train + Kystbane lines, and every listing plotted, coloured by kr/m² /
  price / days-on-market / type. **Pan/zoom**, and it **auto-zooms to a kommune**
  when you select one.
- **Find a home between two addresses**: type your home and work addresses and a
  radius for each — the map draws the circles and only shows listings within reach
  of both, with per-listing distances.
- **Prisudvikling**, in two modes:
  - **kr/m² (1992–)** — Danmarks Statistik's quarterly price index (EJ56) scaled so
    the latest quarter equals today's actual median kr/m², so the axis reads in real
    kroner instead of an abstract index.
  - **Reale priser (1938–)** — Boligøkonomisk Videncenter's inflation-adjusted index
    for København+Frederiksberg (houses from 1938, condos from 1973), rebased to
    2000 = 100. Shows the 2006 bubble peak and the 2012 trough in real terms.
- **Marked over tid**: median kr/m², liggetid and price-cut share tracked from the
  daily snapshots (builds up over time).
- The **S-train premium**: median kr/m² by distance to the nearest S-train;
  median kr/m² by municipality; days-on-market distribution.
- A filterable, sortable list of the actual listings, linking back to boligsiden.

Toggle **Begge / Ejerlejligheder / Villaer**; filter by municipality, price
(min/max), rooms, m², grundstørrelse, etage, byggeår, dage til salg, energimærke,
kælder, elevator, altan, "kun nær S-tog", or search by address/area.

## How it works

No backend, no API key. A scheduled **GitHub Action** (`.github/workflows/build.yml`)
runs `scripts/build_data.py` once a day, which:

- pulls listings from boligsiden.dk's public JSON API (`api.boligsiden.dk/search/cases`),
  trims each to ~20 fields, computes distance to the nearest rail station →
  `data/listings.json` (~0.3 KB each, ~460 KB gzipped);
- fetches simplified municipality boundary polygons from Dataforsyningen (DAWA) →
  `data/geo.json`;
- fetches the property-price index (table EJ56) from Danmarks Statistik →
  `data/priceindex.json`;
- fetches Boligøkonomisk Videncenter's long real-price spreadsheet and extracts the
  1938– / 1973– inflation-adjusted series → `data/bvc.json`;
- appends a dated aggregate snapshot per (type, kommune) → `data/history.json`;
- writes `data/meta.json` (counts, municipality names, station geometry).

The static front-end (`index.html`, `styles.css`, `app.js`) loads those files and
computes all medians/aggregates client-side, so filtering is instant. Address
autocomplete for the home/work feature calls DAWA directly from the browser
(CORS-open, no key). GitHub Pages serves everything.

## Coverage

København, Frederiksberg, Gentofte, Lyngby-Taarbæk, Rudersdal, Gladsaxe, Furesø,
Allerød, Hillerød, Hørsholm, Ballerup, Herlev, Egedal, Fredensborg.
Edit `MUNICIPALITIES` / `TYPES` in `scripts/build_data.py` to change the scope.

## Run locally

```bash
python3 -m http.server 8777            # then open http://localhost:8777
python3 scripts/build_data.py          # refresh data/*.json (needs: pip install openpyxl)
```

Opening `index.html` via `file://` will not work — the page fetches `data/*.json`,
which browsers block on the file protocol. Serve it over http.

**Picking this up on another machine?** See **[DEVELOPMENT.md](DEVELOPMENT.md)** for
the architecture, the data-source quirks, and the gotchas (cache-busting, station
coordinates, the price-index anchoring, and a couple of bugs worth not repeating).

## Notes

Unofficial hobby project. Prices are **asking prices**, not realised sale prices.
Data belongs to boligsiden.dk and the listing realtors; this project just
visualises the public feed and links back to the source. No affiliation.
