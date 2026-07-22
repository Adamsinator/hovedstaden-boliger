"""Rail stations for the greater-Copenhagen / North Zealand corridor.

Coordinates are curated (WGS84) and accurate to ~100 m, which is fine for a
schematic map and a "distance to nearest station" heuristic. Each station has a
corridor label and a `strain` flag (True = S-train, False = Kystbanen regional,
which is what serves the coastal Hørsholm/Fredensborg towns that have no S-train).
"""

# name, corridor, lat, lon, is_strain
STATIONS = [
    # --- Central trunk (shared) ---
    ("København H",   "central", 55.6726, 12.5641, True),
    ("Vesterport",    "central", 55.6785, 12.5561, True),
    ("Nørreport",     "central", 55.6831, 12.5713, True),
    ("Østerport",     "central", 55.6917, 12.5869, True),
    ("Nordhavn",      "central", 55.7046, 12.5896, True),
    ("Svanemøllen",   "central", 55.7106, 12.5771, True),
    ("Hellerup",      "central", 55.7304, 12.5762, True),

    # --- Hillerød line (A) north of Hellerup ---
    ("Bernstorffsvej", "hilleroed", 55.7377, 12.5726, True),
    ("Gentofte",       "hilleroed", 55.7472, 12.5527, True),
    ("Jægersborg",     "hilleroed", 55.7617, 12.5087, True),
    ("Lyngby",         "hilleroed", 55.7706, 12.5028, True),
    ("Sorgenfri",      "hilleroed", 55.7877, 12.5047, True),
    ("Virum",          "hilleroed", 55.7965, 12.4772, True),
    ("Holte",          "hilleroed", 55.8128, 12.4676, True),
    ("Birkerød",       "hilleroed", 55.8455, 12.4306, True),
    ("Allerød",        "hilleroed", 55.8730, 12.3622, True),
    ("Hillerød",       "hilleroed", 55.9276, 12.3086, True),

    # --- Klampenborg line (C) north of Hellerup ---
    ("Charlottenlund", "klampenborg", 55.7477, 12.5806, True),
    ("Ordrup",         "klampenborg", 55.7562, 12.5709, True),
    ("Klampenborg",    "klampenborg", 55.7686, 12.5936, True),

    # --- Farum line (B) via Gladsaxe / Furesø ---
    ("Buddinge",   "farum", 55.7519, 12.4869, True),
    ("Stengården", "farum", 55.7590, 12.4720, True),
    ("Bagsværd",   "farum", 55.7616, 12.4570, True),
    ("Skovbrynet", "farum", 55.7675, 12.4360, True),
    ("Hareskov",   "farum", 55.7760, 12.4165, True),
    ("Værløse",    "farum", 55.7835, 12.3720, True),
    ("Farum",      "farum", 55.8130, 12.3610, True),

    # --- Frederikssund line (H) via Herlev / Ballerup / Egedal ---
    ("Herlev",     "frederikssund", 55.7280, 12.4390, True),
    ("Skovlunde",  "frederikssund", 55.7300, 12.4030, True),
    ("Ballerup",   "frederikssund", 55.7314, 12.3630, True),
    ("Malmparken", "frederikssund", 55.7280, 12.3430, True),
    ("Måløv",      "frederikssund", 55.7505, 12.3210, True),
    ("Kildedal",   "frederikssund", 55.7570, 12.2895, True),
    ("Veksø",      "frederikssund", 55.7690, 12.2560, True),
    ("Ølstykke",   "frederikssund", 55.7930, 12.2010, True),

    # --- Kystbanen (regional, NOT S-train) — Hørsholm / Fredensborg coast ---
    ("Skodsborg",     "kystbanen", 55.8255, 12.5680, False),
    ("Vedbæk",        "kystbanen", 55.8535, 12.5715, False),
    ("Rungsted Kyst", "kystbanen", 55.8850, 12.5560, False),
    ("Kokkedal",      "kystbanen", 55.9015, 12.5420, False),
    ("Nivå",          "kystbanen", 55.9350, 12.5100, False),
]

# Order of stations along each corridor, for drawing schematic polylines.
LINES = {
    "central":       ["København H", "Vesterport", "Nørreport", "Østerport",
                      "Nordhavn", "Svanemøllen", "Hellerup"],
    "hilleroed":     ["Hellerup", "Bernstorffsvej", "Gentofte", "Jægersborg",
                      "Lyngby", "Sorgenfri", "Virum", "Holte", "Birkerød",
                      "Allerød", "Hillerød"],
    "klampenborg":   ["Hellerup", "Charlottenlund", "Ordrup", "Klampenborg"],
    "farum":         ["København H", "Buddinge", "Stengården", "Bagsværd",
                      "Skovbrynet", "Hareskov", "Værløse", "Farum"],
    "frederikssund": ["København H", "Herlev", "Skovlunde", "Ballerup",
                      "Malmparken", "Måløv", "Kildedal", "Veksø", "Ølstykke"],
    "kystbanen":     ["Klampenborg", "Skodsborg", "Vedbæk", "Rungsted Kyst",
                      "Kokkedal", "Nivå"],
}

LINE_LABELS = {
    "central":       "S-tog (city)",
    "hilleroed":     "S-tog · Hillerød (A)",
    "klampenborg":   "S-tog · Klampenborg (C)",
    "farum":         "S-tog · Farum (B)",
    "frederikssund": "S-tog · Frederikssund (H)",
    "kystbanen":     "Kystbanen (regional)",
}
