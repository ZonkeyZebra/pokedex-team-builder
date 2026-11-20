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
    python seed_pokedex.py --update-form-descriptions  # update only curated form descriptions

Notes:
  * Use the connection string from Supabase's "Connect" dialog. If your network
    has no IPv6, use the "Session pooler" string instead of the direct one.
  * This connects as the postgres role, which bypasses Row Level Security,
    so it can write to the read-only reference tables.
  * Names are stored as PokeAPI identifiers ("mr-mime", "thunder-punch").
    Prettify them in the frontend: name.replace("-", " ") and title-case.
  * PokeAPI flavor text is species-level. Add hand-curated overrides by Pokemon
    resource ID to data/pokemon_form_descriptions.csv when a form needs its own text.
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
    "pokemon_species_flavor_text", "pokemon_species_names", "pokemon_stats", "pokemon_types",
    "pokemon_abilities", "pokemon_moves", "locations", "location_areas",
    "location_names", "encounters", "encounter_slots", "encounter_methods",
    "pokemon_evolution", "evolution_triggers", "pokemon_egg_groups", "egg_groups",
    "egg_group_prose", "growth_rates", "pokemon_habitats", "pokemon_habitat_names",
    "pokemon_colors", "pokemon_color_names", "pokemon_shapes", "pokemon_shape_prose",
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


def format_identifier(value):
    return str(value).replace("-", " ").title()


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


def load_form_descriptions(path, pokemon_ids=None):
    descriptions = {}
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames != ["pokemon_id", "description"]:
            raise ValueError(
                f"{path} must have exactly these columns: pokemon_id,description"
            )
        for line_number, row in enumerate(reader, start=2):
            try:
                pokemon_id = int(row["pokemon_id"])
            except (TypeError, ValueError) as error:
                raise ValueError(f"{path}:{line_number}: invalid pokemon_id") from error
            description = (row["description"] or "").strip()
            if not description:
                raise ValueError(f"{path}:{line_number}: description must not be empty")
            if pokemon_ids is not None and pokemon_id not in pokemon_ids:
                raise ValueError(
                    f"{path}:{line_number}: Pokemon id {pokemon_id} is not in the PokeAPI data"
                )
            if pokemon_id in descriptions:
                raise ValueError(f"{path}:{line_number}: duplicate Pokemon id {pokemon_id}")
            descriptions[pokemon_id] = description
    return descriptions


def update_form_descriptions(database_url, descriptions):
    import psycopg

    with psycopg.connect(database_url) as conn, conn.cursor() as cur:
        for pokemon_id, description in descriptions.items():
            cur.execute(
                "UPDATE pokemon SET description = %s WHERE id = %s",
                (clean_text(description), pokemon_id),
            )
            if cur.rowcount != 1:
                raise ValueError(
                    f"Expected one Pokémon row for id {pokemon_id}; updated {cur.rowcount}"
                )
    print(f"Updated descriptions for {len(descriptions)} Pokémon forms.")


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


def build_pokemon(src, form_descriptions=None):
    form_descriptions = form_descriptions or {}
    species = {r["id"]: r for r in src.read("pokemon_species")}
    species_names = {
        r["pokemon_species_id"]: r
        for r in src.read("pokemon_species_names")
        if r["local_language_id"] == ENGLISH
    }
    growth_rates = {r["id"]: r["identifier"] for r in src.read("growth_rates")}
    habitats = {
        r["pokemon_habitat_id"]: r["name"]
        for r in src.read("pokemon_habitat_names")
        if r["local_language_id"] == ENGLISH
    }
    colors = {
        r["pokemon_color_id"]: r["name"]
        for r in src.read("pokemon_color_names")
        if r["local_language_id"] == ENGLISH
    }
    shapes = {
        r["pokemon_shape_id"]: r["name"]
        for r in src.read("pokemon_shape_prose")
        if r["local_language_id"] == ENGLISH
    }

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
        species_name = species_names.get(r["species_id"], {})
        rows.append((
            int(r["id"]), int(r["species_id"]), int(r["species_id"]), int(sp["evolution_chain_id"]),
            name, form, is_default,
            int(sp["generation_id"]), num(r["height"]), num(r["weight"]),
            st["1"], st["2"], st["3"], st["4"], st["5"], st["6"],
            f"{SPRITE_BASE}/pokemon/{r['id']}.png",
            f"{SPRITE_BASE}/pokemon/other/official-artwork/{r['id']}.png",
            f"{SPRITE_BASE}/pokemon/shiny/{r['id']}.png",
            f"{SPRITE_BASE}/pokemon/other/official-artwork/shiny/{r['id']}.png",
            clean_text(form_descriptions.get(int(r["id"]), text)),
            num(sp["capture_rate"]), num(sp["base_happiness"]), num(sp["hatch_counter"]),
            num(sp["gender_rate"]), growth_rates.get(sp["growth_rate_id"]),
            colors.get(sp["color_id"]), shapes.get(sp["shape_id"]), habitats.get(sp["habitat_id"]),
            species_name.get("genus") or None,
            sp["is_baby"] == "1", sp["is_legendary"] == "1", sp["is_mythical"] == "1",
        ))
    return rows


def build_pokemon_types(src, pokemon_ids, type_ids):
    return [(int(r["pokemon_id"]), int(r["type_id"]), int(r["slot"]))
            for r in src.read("pokemon_types")
            if int(r["pokemon_id"]) in pokemon_ids and int(r["type_id"]) in type_ids]


def build_egg_groups(src):
    names = {
        r["egg_group_id"]: r["name"]
        for r in src.read("egg_group_prose")
        if r["local_language_id"] == ENGLISH
    }
    groups = [(int(r["id"]), names.get(r["id"], r["identifier"]))
              for r in src.read("egg_groups")]
    links = [(int(r["species_id"]), int(r["egg_group_id"]))
             for r in src.read("pokemon_egg_groups")]
    return groups, links


def build_evolutions(src):
    species = {r["id"]: r for r in src.read("pokemon_species")}
    triggers = {r["id"]: r["identifier"] for r in src.read("evolution_triggers")}
    items = {r["id"]: r["identifier"] for r in src.read("items")}
    locations = {r["id"]: r["identifier"] for r in src.read("locations")}
    loc_names = {
        r["location_id"]: r["name"]
        for r in src.read("location_names")
        if r["local_language_id"] == ENGLISH
    }
    gender_names = {"1": "female", "2": "male"}
    rows = []

    for r in src.read("pokemon_evolution"):
        to_id = int(r["evolved_species_id"])
        species_row = species.get(str(to_id))
        if species_row is None:
            continue
        chain_id = int(species_row["evolution_chain_id"])
        from_id = num(species_row["evolves_from_species_id"])
        trigger = triggers.get(r["evolution_trigger_id"], r["evolution_trigger_id"])
        trigger_item = items.get(r["trigger_item_id"]) if r["trigger_item_id"] else None
        location = loc_names.get(r["location_id"]) or locations.get(r["location_id"])
        gender = gender_names.get(r["gender_id"])
        details = []
        if r["minimum_level"]:
            details.append(f"Level {r['minimum_level']}")
        if trigger_item:
            details.append(f"Use {format_identifier(trigger_item)}")
        if r["held_item_id"]:
            details.append(f"Hold {format_identifier(items.get(r['held_item_id'], r['held_item_id']))}")
        if r["minimum_happiness"]:
            details.append(f"Happiness {r['minimum_happiness']}")
        if r["minimum_affection"]:
            details.append(f"Affection {r['minimum_affection']}")
        if r["minimum_beauty"]:
            details.append(f"Beauty {r['minimum_beauty']}")
        if r["time_of_day"]:
            details.append(f"{format_identifier(r['time_of_day'])} time")
        if gender:
            details.append(f"{gender.title()} only")
        if r["trade_species_id"]:
            details.append("Trade")
        if r["needs_overworld_rain"] == "1":
            details.append("While raining")
        if r["turn_upside_down"] == "1":
            details.append("Console held upside down")

        rows.append((
            chain_id, from_id, to_id, trigger, trigger_item,
            num(r["minimum_level"]), num(r["minimum_happiness"]), num(r["minimum_beauty"]),
            num(r["minimum_affection"]), gender, r["time_of_day"] or None,
            None,
            items.get(r["held_item_id"]) if r["held_item_id"] else None,
            location,
            num(r["trade_species_id"]),
            r["needs_overworld_rain"] == "1",
            r["turn_upside_down"] == "1",
            "; ".join(details) or format_identifier(trigger),
        ))
    return rows

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
        cur.execute("""
            ALTER TABLE pokemon
                ADD COLUMN IF NOT EXISTS species_id integer,
                ADD COLUMN IF NOT EXISTS evolution_chain_id integer,
                ADD COLUMN IF NOT EXISTS shiny_sprite_url text,
                ADD COLUMN IF NOT EXISTS shiny_artwork_url text,
                ADD COLUMN IF NOT EXISTS capture_rate integer,
                ADD COLUMN IF NOT EXISTS base_happiness integer,
                ADD COLUMN IF NOT EXISTS hatch_counter integer,
                ADD COLUMN IF NOT EXISTS gender_rate integer,
                ADD COLUMN IF NOT EXISTS growth_rate text,
                ADD COLUMN IF NOT EXISTS color text,
                ADD COLUMN IF NOT EXISTS shape text,
                ADD COLUMN IF NOT EXISTS habitat text,
                ADD COLUMN IF NOT EXISTS genus text,
                ADD COLUMN IF NOT EXISTS is_baby boolean NOT NULL DEFAULT false,
                ADD COLUMN IF NOT EXISTS is_legendary boolean NOT NULL DEFAULT false,
                ADD COLUMN IF NOT EXISTS is_mythical boolean NOT NULL DEFAULT false
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS egg_group (
                id integer PRIMARY KEY,
                name text NOT NULL UNIQUE
            );
            CREATE TABLE IF NOT EXISTS pokemon_egg_group (
                species_id integer NOT NULL,
                egg_group_id integer NOT NULL REFERENCES egg_group(id),
                PRIMARY KEY (species_id, egg_group_id)
            );
            CREATE TABLE IF NOT EXISTS pokemon_evolution (
                evolution_chain_id integer NOT NULL,
                from_species_id integer,
                to_species_id integer NOT NULL,
                trigger text NOT NULL,
                trigger_item text,
                minimum_level integer,
                minimum_happiness integer,
                minimum_beauty integer,
                minimum_affection integer,
                gender text,
                time_of_day text,
                known_move text,
                held_item text,
                location text,
                trade_species_id integer,
                needs_overworld_rain boolean NOT NULL DEFAULT false,
                turn_upside_down boolean NOT NULL DEFAULT false,
                details text
            );
            CREATE INDEX IF NOT EXISTS idx_pokemon_species ON pokemon (species_id);
            CREATE INDEX IF NOT EXISTS idx_pokemon_evolution_chain ON pokemon_evolution (evolution_chain_id);
            ALTER TABLE egg_group ENABLE ROW LEVEL SECURITY;
            ALTER TABLE pokemon_egg_group ENABLE ROW LEVEL SECURITY;
            ALTER TABLE pokemon_evolution ENABLE ROW LEVEL SECURITY
        """)
        cur.execute("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_policies
                    WHERE schemaname = 'public' AND tablename = 'egg_group'
                      AND policyname = 'public read'
                ) THEN
                    CREATE POLICY "public read" ON egg_group
                    FOR SELECT TO anon, authenticated USING (true);
                END IF;
                IF NOT EXISTS (
                    SELECT 1 FROM pg_policies
                    WHERE schemaname = 'public' AND tablename = 'pokemon_egg_group'
                      AND policyname = 'public read'
                ) THEN
                    CREATE POLICY "public read" ON pokemon_egg_group
                    FOR SELECT TO anon, authenticated USING (true);
                END IF;
                IF NOT EXISTS (
                    SELECT 1 FROM pg_policies
                    WHERE schemaname = 'public' AND tablename = 'pokemon_evolution'
                      AND policyname = 'public read'
                ) THEN
                    CREATE POLICY "public read" ON pokemon_evolution
                    FOR SELECT TO anon, authenticated USING (true);
                END IF;
            END $$;
        """)
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
    ap.add_argument(
        "--form-descriptions",
        default="data/pokemon_form_descriptions.csv",
        help="CSV of curated per-form descriptions (default: data/pokemon_form_descriptions.csv)",
    )
    ap.add_argument(
        "--update-form-descriptions",
        action="store_true",
        help="update only curated descriptions in an already seeded database",
    )
    ap.add_argument("--database-url", default=os.environ.get("DATABASE_URL"))
    args = ap.parse_args()

    if args.update_form_descriptions:
        if args.reset or args.dry_run:
            ap.error("--update-form-descriptions cannot be combined with --reset or --dry-run")
        if not args.database_url:
            sys.exit("Set DATABASE_URL (or pass --database-url) to update form descriptions.")
        form_descriptions = load_form_descriptions(args.form_descriptions)
        if not form_descriptions:
            sys.exit(f"No descriptions found in {args.form_descriptions}.")
        update_form_descriptions(args.database_url, form_descriptions)
        return

    if not args.dry_run and not args.database_url:
        sys.exit("Set DATABASE_URL (or pass --database-url), or use --dry-run.")

    src = Source(args.cache_dir)
    print("Fetching CSVs (cached after first run)...")
    src.download()

    print("Transforming...")
    source_pokemon_ids = {int(r["id"]) for r in src.read("pokemon")}
    form_descriptions = load_form_descriptions(args.form_descriptions, source_pokemon_ids)
    print(f"  curated form descriptions {len(form_descriptions):>8,} rows")
    if len(form_descriptions) < len(source_pokemon_ids):
        print("  forms without overrides use their shared species flavor text")
    version_groups, vg_generation = build_version_groups(src)
    types = build_types(src)
    type_ids = {t[0] for t in types}
    effectiveness = build_type_effectiveness(src, type_ids)
    abilities = build_abilities(src)
    natures = build_natures(src)
    items = build_items(src)
    moves = build_moves(src, type_ids)
    pokemon = build_pokemon(src, form_descriptions)
    pokemon_ids = {p[0] for p in pokemon}
    missing_description_ids = set(form_descriptions) - pokemon_ids
    if missing_description_ids:
        raise ValueError(
            "Form descriptions reference Pokémon rows excluded from the seed: "
            + ", ".join(map(str, sorted(missing_description_ids)))
        )
    move_ids = {m[0] for m in moves}
    pokemon_types = build_pokemon_types(src, pokemon_ids, type_ids)
    pokemon_abilities = build_pokemon_abilities(src, pokemon_ids, {a[0] for a in abilities})
    pokemon_moves = build_pokemon_moves(src, vg_generation, pokemon_ids, move_ids)
    encounters = build_encounters(src, pokemon_ids)
    egg_groups, pokemon_egg_groups = build_egg_groups(src)
    pokemon_evolutions = build_evolutions(src)

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
        ("pokemon", ["id", "dex_number", "species_id", "evolution_chain_id", "name", "form_name",
                     "is_default", "generation", "height_dm", "weight_hg", "base_hp", "base_atk",
                     "base_def", "base_spa", "base_spd", "base_spe", "sprite_url", "artwork_url",
                     "shiny_sprite_url", "shiny_artwork_url", "description", "capture_rate",
                     "base_happiness", "hatch_counter", "gender_rate", "growth_rate", "color",
                     "shape", "habitat", "genus", "is_baby", "is_legendary", "is_mythical"], pokemon),
        ("egg_group", ["id", "name"], egg_groups),
        ("pokemon_egg_group", ["species_id", "egg_group_id"], pokemon_egg_groups),
        ("pokemon_evolution", ["evolution_chain_id", "from_species_id", "to_species_id",
                               "trigger", "trigger_item", "minimum_level", "minimum_happiness",
                               "minimum_beauty", "minimum_affection", "gender", "time_of_day",
                               "known_move", "held_item", "location", "trade_species_id",
                               "needs_overworld_rain", "turn_upside_down", "details"], pokemon_evolutions),
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
