#!/usr/bin/env python3
"""
Seed the Pokedex reference tables from PokeAPI's CSV data dump.

Setup:
    pip install "psycopg[binary]>=3.1"
    export DATABASE_URL="postgresql://postgres:<password>@<host>:5432/postgres"

Usage:
    python seed_pokedex.py --dry-run     # download + transform, print row counts, no database
    python seed_pokedex.py               # load into an EMPTY database (refuses otherwise)
    python seed_pokedex.py --reset       # wipe reference tables first (also deletes saved teams!)

Notes:
  * Use the connection string from Supabase's "Connect" dialog. If your network
    has no IPv6, use the "Session pooler" string instead of the direct one.
  * This connects as the postgres role, which bypasses Row Level Security,
    so it can write to the read-only reference tables.
  * Names are stored as PokeAPI identifiers ("mr-mime", "thunder-punch").
    Prettify them in the frontend: name.replace("-", " ") and title-case.
"""
import argparse
import csv
import os
import re
import sys
import urllib.request
from pathlib import Path

CSV_BASE = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv"
SPRITE_BASE = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites"
ENGLISH = "9"

CSV_FILES = [
    "version_groups", "types", "type_efficacy", "abilities", "ability_prose",
    "natures", "items", "item_flags", "item_flag_map", "item_prose",
    "moves", "move_effect_prose", "pokemon", "pokemon_species",
    "pokemon_species_flavor_text", "pokemon_stats", "pokemon_types",
    "pokemon_abilities", "pokemon_moves", "locations", "location_areas",
    "location_names", "encounters", "encounter_slots", "encounter_methods",
]

# Learnsets are collapsed to one row per generation. These version groups are
# skipped so spin-off movepools don't leak into mainline learnsets:
#   19 = Let's Go, 24 = Legends: Arceus, 30 = Legends: Z-A
EXCLUDED_LEARNSET_VERSION_GROUPS = {"19", "24", "30"}

LEARN_METHODS = {"1": "level-up", "2": "egg", "3": "tutor", "4": "machine"}
STAT_CODES = {"2": "atk", "3": "def", "4": "spa", "5": "spd", "6": "spe"}
DAMAGE_CLASSES = {"1": "status", "2": "physical", "3": "special"}
MAX_TYPE_ID = 18  # normal..fairy; drops unknown, shadow, stellar


# ---------------------------------------------------------------- helpers

def num(value):
    return int(value) if value not in ("", None) else None


def clean_text(text, effect_chance=None):
    """Strip PokeAPI markup and collapse whitespace into single spaces."""
    if not text:
        return None
    text = re.sub(r"\[([^\]]*)\]\{[^}]*\}", r"\1", text)   # [text]{link:xyz} -> text
    if effect_chance:
        text = text.replace("$effect_chance", str(effect_chance))
    text = text.replace("\u00ad\n", "").replace("\u00ad", "")  # soft hyphens
    return re.sub(r"\s+", " ", text).strip() or None


class Source:
    def __init__(self, cache_dir):
        self.dir = Path(cache_dir)

    def download(self):
        self.dir.mkdir(parents=True, exist_ok=True)
        for name in CSV_FILES:
            path = self.dir / f"{name}.csv"
            if path.exists():
                continue
            print(f"  downloading {name}.csv")
            urllib.request.urlretrieve(f"{CSV_BASE}/{name}.csv", path)

    def read(self, name):
        with open(self.dir / f"{name}.csv", newline="", encoding="utf-8") as f:
            yield from csv.DictReader(f)


# ---------------------------------------------------------------- builders
# Each returns a list of tuples in the column order used by TABLES below.

def build_version_groups(src):
    rows = [(int(r["id"]), r["identifier"], int(r["generation_id"]))
            for r in src.read("version_groups")]
    return rows, {str(r[0]): r[2] for r in rows}


def build_types(src):
    return [(int(r["id"]), r["identifier"]) for r in src.read("types")
            if int(r["id"]) <= MAX_TYPE_ID]


def build_type_effectiveness(src, type_ids):
    rows = []
    for r in src.read("type_efficacy"):
        a, d = int(r["damage_type_id"]), int(r["target_type_id"])
        if a in type_ids and d in type_ids:
            rows.append((a, d, int(r["damage_factor"]) / 100))
    return rows


def build_abilities(src):
    prose = {r["ability_id"]: clean_text(r["short_effect"])
             for r in src.read("ability_prose") if r["local_language_id"] == ENGLISH}
    return [(int(r["id"]), r["identifier"], prose.get(r["id"]))
            for r in src.read("abilities")]


def build_natures(src):
    rows = []
    for r in src.read("natures"):
        inc, dec = STAT_CODES.get(r["increased_stat_id"]), STAT_CODES.get(r["decreased_stat_id"])
        if r["increased_stat_id"] == r["decreased_stat_id"]:  # neutral nature
            inc = dec = None
        rows.append((int(r["id"]), r["identifier"], inc, dec))
    return rows


def build_items(src):
    holdable_flags = {r["id"] for r in src.read("item_flags")
                      if r["identifier"].startswith("holdable")}
    holdable = {r["item_id"] for r in src.read("item_flag_map")
                if r["item_flag_id"] in holdable_flags}
    prose = {r["item_id"]: clean_text(r["short_effect"])
             for r in src.read("item_prose") if r["local_language_id"] == ENGLISH}
    return [(int(r["id"]), r["identifier"], prose.get(r["id"]),
             f"{SPRITE_BASE}/items/{r['identifier']}.png")
            for r in src.read("items") if r["id"] in holdable]


def build_moves(src, type_ids):
    effects = {r["move_effect_id"]: r["short_effect"]
               for r in src.read("move_effect_prose") if r["local_language_id"] == ENGLISH}
    rows = []
    for r in src.read("moves"):
        if int(r["type_id"]) not in type_ids or r["damage_class_id"] not in DAMAGE_CLASSES:
            continue
        rows.append((
            int(r["id"]), r["identifier"], int(r["type_id"]),
            DAMAGE_CLASSES[r["damage_class_id"]],
            num(r["power"]), num(r["accuracy"]), num(r["pp"]), int(r["priority"] or 0),
            clean_text(effects.get(r["effect_id"]), r["effect_chance"]),
        ))
    return rows


def build_pokemon(src):
    species = {r["id"]: r for r in src.read("pokemon_species")}

    flavor = {}  # species_id -> (version_id, text), keeping the newest English entry
    for r in src.read("pokemon_species_flavor_text"):
        if r["language_id"] != ENGLISH:
            continue
        v = int(r["version_id"])
        if r["species_id"] not in flavor or v > flavor[r["species_id"]][0]:
            flavor[r["species_id"]] = (v, r["flavor_text"])

    stats = {}
    for r in src.read("pokemon_stats"):
        stats.setdefault(r["pokemon_id"], {})[r["stat_id"]] = int(r["base_stat"])

    rows = []
    for r in src.read("pokemon"):
        sp, st = species.get(r["species_id"]), stats.get(r["id"], {})
        if sp is None or not all(str(i) in st for i in range(1, 7)):
            continue
        is_default = r["is_default"] == "1"
        prefix = sp["identifier"] + "-"
        if is_default:  # default forms use the plain species name ("deoxys", not "deoxys-normal")
            name, form = sp["identifier"], None
        else:
            name = r["identifier"]
            form = name[len(prefix):] if name.startswith(prefix) else name
        text = flavor.get(r["species_id"], (0, None))[1]
        rows.append((
            int(r["id"]), int(r["species_id"]), name, form, is_default,
            int(sp["generation_id"]), num(r["height"]), num(r["weight"]),
            st["1"], st["2"], st["3"], st["4"], st["5"], st["6"],
            f"{SPRITE_BASE}/pokemon/{r['id']}.png",
            f"{SPRITE_BASE}/pokemon/other/official-artwork/{r['id']}.png",
            clean_text(text),
        ))
    return rows


def build_pokemon_types(src, pokemon_ids, type_ids):
    return [(int(r["pokemon_id"]), int(r["type_id"]), int(r["slot"]))
            for r in src.read("pokemon_types")
            if int(r["pokemon_id"]) in pokemon_ids and int(r["type_id"]) in type_ids]


def build_pokemon_abilities(src, pokemon_ids, ability_ids):
    return [(int(r["pokemon_id"]), int(r["ability_id"]), int(r["slot"]), r["is_hidden"] == "1")
            for r in src.read("pokemon_abilities")
            if int(r["pokemon_id"]) in pokemon_ids and int(r["ability_id"]) in ability_ids]


def build_pokemon_moves(src, vg_generation, pokemon_ids, move_ids):
    """Collapse per-game learnsets to one row per (pokemon, move, generation, method)."""
    best = {}
    for r in src.read("pokemon_moves"):
        vg = r["version_group_id"]
        method = LEARN_METHODS.get(r["pokemon_move_method_id"])
        if method is None or vg in EXCLUDED_LEARNSET_VERSION_GROUPS or vg not in vg_generation:
            continue
        pid, mid = int(r["pokemon_id"]), int(r["move_id"])
        if pid not in pokemon_ids or mid not in move_ids:
            continue
        key = (pid, mid, vg_generation[vg], method)
        level = int(r["level"] or 0)
        if key not in best or level < best[key]:
            best[key] = level
    return [(*key, level) for key, level in sorted(best.items())]


def build_encounters(src, pokemon_ids):
    slots = {r["id"]: r for r in src.read("encounter_slots")}
    methods = {r["id"]: r["identifier"] for r in src.read("encounter_methods")}
    areas = {r["id"]: r["location_id"] for r in src.read("location_areas")}
    loc_names = {r["location_id"]: r["name"]
                 for r in src.read("location_names") if r["local_language_id"] == ENGLISH}
    loc_ids = {r["id"]: r["identifier"] for r in src.read("locations")}

    # Stage 1: one entry per (pokemon, version, area, method); sum slot rarities.
    stage1 = {}
    for r in src.read("encounters"):
        slot = slots.get(r["encounter_slot_id"])
        pid = int(r["pokemon_id"])
        if slot is None or pid not in pokemon_ids or r["location_area_id"] not in areas:
            continue
        key = (pid, r["version_id"], r["location_area_id"], slot["encounter_method_id"],
               slot["version_group_id"])
        lo, hi, rarity = int(r["min_level"]), int(r["max_level"]), num(slot["rarity"]) or 0
        cur = stage1.get(key)
        stage1[key] = [lo, hi, rarity] if cur is None else [
            min(cur[0], lo), max(cur[1], hi), cur[2] + rarity]

    # Stage 2: fold areas/versions into (pokemon, version_group, location, method).
    stage2 = {}
    for (pid, _ver, area, method, vg), (lo, hi, rarity) in stage1.items():
        loc = areas[area]
        key = (pid, int(vg), loc, method)
        cur = stage2.get(key)
        stage2[key] = [lo, hi, rarity] if cur is None else [
            min(cur[0], lo), max(cur[1], hi), max(cur[2], rarity)]

    rows = []
    for (pid, vg, loc, method), (lo, hi, rarity) in sorted(stage2.items()):
        name = loc_names.get(str(loc)) or loc_ids.get(str(loc), f"location-{loc}")
        rows.append((pid, vg, name, methods.get(method, method), lo, hi, min(rarity, 100) or None))
    return rows


# ---------------------------------------------------------------- loading

def load(database_url, tables, reset):
    import psycopg  # imported here so --dry-run works without it installed

    with psycopg.connect(database_url) as conn, conn.cursor() as cur:
        if reset:
            names = ", ".join(t[0] for t in tables)
            cur.execute(f"TRUNCATE {names} RESTART IDENTITY CASCADE")
            print("Reference tables truncated.")
        else:
            cur.execute("SELECT count(*) FROM pokemon")
            if cur.fetchone()[0] > 0:
                sys.exit("pokemon table already has data. Re-run with --reset to wipe and reload.")

        for table, columns, rows in tables:
            with cur.copy(f"COPY {table} ({', '.join(columns)}) FROM STDIN") as copy:
                for row in rows:
                    copy.write_row(row)
            print(f"  loaded {len(rows):>7,} rows into {table}")

        for table, _, _ in tables:
            cur.execute(f"ANALYZE {table}")

        print("\nTable sizes (data + indexes):")
        total = 0
        for table, _, _ in tables:
            cur.execute("SELECT pg_total_relation_size(%s::regclass)", (table,))
            size = cur.fetchone()[0]
            total += size
            print(f"  {table:<20} {size / 1_000_000:8.1f} MB")
        print(f"  {'TOTAL':<20} {total / 1_000_000:8.1f} MB  (free tier limit: 500 MB)")


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true", help="transform only; do not touch the database")
    ap.add_argument("--reset", action="store_true", help="truncate reference tables (cascades to saved teams)")
    ap.add_argument("--cache-dir", default="pokeapi_csv", help="where CSVs are cached (default: ./pokeapi_csv)")
    ap.add_argument("--database-url", default=os.environ.get("DATABASE_URL"))
    args = ap.parse_args()

    if not args.dry_run and not args.database_url:
        sys.exit("Set DATABASE_URL (or pass --database-url), or use --dry-run.")

    src = Source(args.cache_dir)
    print("Fetching CSVs (cached after first run)...")
    src.download()

    print("Transforming...")
    version_groups, vg_generation = build_version_groups(src)
    types = build_types(src)
    type_ids = {t[0] for t in types}
    effectiveness = build_type_effectiveness(src, type_ids)
    abilities = build_abilities(src)
    natures = build_natures(src)
    items = build_items(src)
    moves = build_moves(src, type_ids)
    pokemon = build_pokemon(src)
    pokemon_ids = {p[0] for p in pokemon}
    move_ids = {m[0] for m in moves}
    pokemon_types = build_pokemon_types(src, pokemon_ids, type_ids)
    pokemon_abilities = build_pokemon_abilities(src, pokemon_ids, {a[0] for a in abilities})
    pokemon_moves = build_pokemon_moves(src, vg_generation, pokemon_ids, move_ids)
    encounters = build_encounters(src, pokemon_ids)

    # Load order respects foreign keys.
    tables = [
        ("version_group", ["id", "name", "generation"], version_groups),
        ("type", ["id", "name"], types),
        ("type_effectiveness", ["attacking_type_id", "defending_type_id", "multiplier"], effectiveness),
        ("ability", ["id", "name", "description"], abilities),
        ("nature", ["id", "name", "increased_stat", "decreased_stat"], natures),
        ("item", ["id", "name", "description", "sprite_url"], items),
        ("move", ["id", "name", "type_id", "damage_class", "power", "accuracy", "pp",
                  "priority", "description"], moves),
        ("pokemon", ["id", "dex_number", "name", "form_name", "is_default", "generation",
                     "height_dm", "weight_hg", "base_hp", "base_atk", "base_def", "base_spa",
                     "base_spd", "base_spe", "sprite_url", "artwork_url", "description"], pokemon),
        ("pokemon_type", ["pokemon_id", "type_id", "slot"], pokemon_types),
        ("pokemon_ability", ["pokemon_id", "ability_id", "slot", "is_hidden"], pokemon_abilities),
        ("pokemon_move", ["pokemon_id", "move_id", "generation", "learn_method",
                          "level_learned"], pokemon_moves),
        ("encounter", ["pokemon_id", "version_group_id", "location_name", "method",
                       "min_level", "max_level", "chance"], encounters),
    ]

    for table, _, rows in tables:
        print(f"  {table:<20} {len(rows):>8,} rows")

    if args.dry_run:
        print("\nDry run complete; database untouched.")
        return

    print("\nLoading into the database...")
    load(args.database_url, tables, args.reset)
    print("\nDone.")


if __name__ == "__main__":
    main()
