# Hovedstaden Boliger

A small static site that gives an overview of the housing market in the greater
Copenhagen area — **ejerlejligheder** (owner-occupied flats) and **villaer** —
from København up to Hillerød, with a focus on proximity to the **S-train**.

Live: https://adamsinator.github.io/hovedstaden-boliger/

## What it shows

- Headline KPIs: number of listings, median price, median kr/m², median days on
  market, share with a price cut, share near an S-train station.
- A custom SVG map of the region with the S-train + Kystbane lines drawn in and
  every listing plotted, coloured by kr/m² / price / days-on-market / type.
- The **S-train premium**: median kr/m² by distance to the nearest S-train.
- Median kr/m² by municipality, and a days-on-market distribution.
- A filterable, sortable list of the actual listings, linking back to boligsiden.

Toggle **Ejerlejligheder / Villaer / Begge**, filter by municipality, max price,
rooms, "kun nær S-tog", or search by address/area.

## How it works

No backend, no API key. A scheduled **GitHub Action** (`.github/workflows/build.yml`)
runs `scripts/build_data.py` once a day, which pulls listings from boligsiden.dk's
public JSON API (`api.boligsiden.dk/search/cases`) for the corridor
municipalities, trims each listing to ~20 fields, computes the distance to the
nearest rail station, and writes two compact files:

- `data/listings.json` — one record per listing (~0.3 KB each, ~450 KB gzipped)
- `data/meta.json` — generated-at, counts, municipality names, station geometry

The static front-end (`index.html`, `styles.css`, `app.js`) loads those files and
computes all medians/aggregates client-side, so filtering is instant. GitHub Pages
serves everything.

## Coverage

København, Frederiksberg, Gentofte, Lyngby-Taarbæk, Rudersdal, Gladsaxe, Furesø,
Allerød, Hillerød, Hørsholm, Ballerup, Herlev, Egedal, Fredensborg.
Edit `MUNICIPALITIES` / `TYPES` in `scripts/build_data.py` to change the scope.

## Run locally

```bash
python3 scripts/build_data.py          # refresh data/*.json
python3 -m http.server 8777            # then open http://localhost:8777
```

## Notes

Unofficial hobby project. Prices are **asking prices**, not realised sale prices.
Data belongs to boligsiden.dk and the listing realtors; this project just
visualises the public feed and links back to the source. No affiliation.
