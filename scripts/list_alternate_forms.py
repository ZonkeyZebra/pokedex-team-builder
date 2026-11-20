#!/usr/bin/env python3
"""
List every alternate form of a Pokémon (Mega, Alolan, Galarian, Hisuian,
Paldean, Gigantamax, Primal, and everything else) with its ID and description.

Uses the same PokeAPI CSV dump as seed_pokedex.py, so the IDs match the `id`
column in your `pokemon` table. CSVs are cached in ./pokeapi_csv (shared with
the seed script), so nothing is re-downloaded if you've already seeded.

Usage:
    python list_alternate_forms.py                       # summary + full table
    python list_alternate_forms.py --summary             # just category counts
    python list_alternate_forms.py --category alolan     # one category
    python list_alternate_forms.py --species raichu      # one species
    python list_alternate_forms.py --csv forms.csv       # also write a CSV

Categories: mega, gigantamax, primal, alolan, galarian, hisuian, paldean, other

A note on descriptions: PokeAPI stores Pokédex flavor text per SPECIES, not per
form. So Alolan Raichu and regular Raichu share the same text. The "Form label"
column (e.g. "Alolan Form") is the closest thing to a form-specific description.
"""
import argparse
import csv
import re
import sys
import urllib.request
from collections import Counter
from pathlib import Path

CSV_BASE = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv"
ENGLISH = "9"
FILES = ["pokemon", "pokemon_species", "pokemon_forms", "pokemon_form_names",
         "pokemon_species_flavor_text"]


def download(cache_dir):
    cache_dir.mkdir(parents=True, exist_ok=True)
    for name in FILES:
        path = cache_dir / f"{name}.csv"
        if not path.exists():
            print(f"  downloading {name}.csv", file=sys.stderr)
            urllib.request.urlretrieve(f"{CSV_BASE}/{name}.csv", path)


def read(cache_dir, name):
    with open(cache_dir / f"{name}.csv", newline="", encoding="utf-8") as f:
        yield from csv.DictReader(f)


def clean_text(text):
    if not text:
        return ""
    text = text.replace("\u00ad\n", "").replace("\u00ad", "")
    return re.sub(r"\s+", " ", text).strip()


def categorize(form_name):
    """Bucket a form by its identifier suffix (e.g. 'mega-x', 'alola', 'galar')."""
    f = form_name.lower()
    if "mega" in f:
        return "mega"
    if "gmax" in f:
        return "gigantamax"
    if "primal" in f:
        return "primal"
    if "alola" in f:
        return "alolan"
    if "galar" in f:
        return "galarian"
    if "hisui" in f:
        return "hisuian"
    if "paldea" in f:
        return "paldean"
    return "other"


def pretty(value):
    return value.replace("-", " ").title()


def build_rows(cache_dir):
    species = {r["id"]: r["identifier"] for r in read(cache_dir, "pokemon_species")}

    # Newest English flavor text per species (same rule the seed script uses).
    flavor = {}
    for r in read(cache_dir, "pokemon_species_flavor_text"):
        if r["language_id"] != ENGLISH:
            continue
        v = int(r["version_id"])
        if r["species_id"] not in flavor or v > flavor[r["species_id"]][0]:
            flavor[r["species_id"]] = (v, r["flavor_text"])

    # Form labels like "Alolan Form" / "Mega Venusaur", keyed by pokemon_id.
    forms_by_pokemon = {}
    form_id_to_pokemon = {}
    for r in read(cache_dir, "pokemon_forms"):
        form_id_to_pokemon[r["id"]] = r["pokemon_id"]
        forms_by_pokemon.setdefault(r["pokemon_id"], []).append(r)
    labels = {}
    for r in read(cache_dir, "pokemon_form_names"):
        if r["local_language_id"] != ENGLISH:
            continue
        pid = form_id_to_pokemon.get(r["pokemon_form_id"])
        if pid and (r["form_name"] or r["pokemon_name"]):
            labels.setdefault(pid, r["form_name"] or r["pokemon_name"])

    rows = []
    for r in read(cache_dir, "pokemon"):
        if r["is_default"] == "1":
            continue
        sp = species.get(r["species_id"])
        if sp is None:
            continue
        prefix = sp + "-"
        form = r["identifier"][len(prefix):] if r["identifier"].startswith(prefix) else r["identifier"]
        battle_only = any(f["is_battle_only"] == "1" for f in forms_by_pokemon.get(r["id"], []))
        rows.append({
            "id": int(r["id"]),
            "species_id": int(r["species_id"]),
            "species": sp,
            "identifier": r["identifier"],
            "form": form,
            "category": categorize(form),
            "form_label": labels.get(r["id"], ""),
            "battle_only": battle_only,
            "description": clean_text(flavor.get(r["species_id"], (0, ""))[1]),
        })
    rows.sort(key=lambda x: x["id"])
    return rows


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--category", help="mega, gigantamax, primal, alolan, galarian, hisuian, paldean, other")
    ap.add_argument("--species", help="only forms of this species (e.g. raichu)")
    ap.add_argument("--summary", action="store_true", help="print only category counts")
    ap.add_argument("--csv", metavar="FILE", help="also write results to a CSV file")
    ap.add_argument("--cache-dir", default="pokeapi_csv")
    args = ap.parse_args()

    cache_dir = Path(args.cache_dir)
    download(cache_dir)
    rows = build_rows(cache_dir)

    if args.category:
        rows = [r for r in rows if r["category"] == args.category.lower()]
    if args.species:
        rows = [r for r in rows if r["species"] == args.species.lower()]

    counts = Counter(r["category"] for r in rows)
    print(f"\n{len(rows)} alternate forms")
    for cat, n in counts.most_common():
        print(f"  {cat:<11} {n}")
    if args.summary:
        return

    print()
    for r in rows:
        tags = f"{r['category']}" + (", battle-only" if r["battle_only"] else "")
        label = f" [{r['form_label']}]" if r["form_label"] else ""
        print(f"#{r['id']:<6} {pretty(r['identifier'])}{label}")
        print(f"        species: {pretty(r['species'])} (species id {r['species_id']})  |  {tags}")
        if r["description"]:
            print(f"        {r['description']}")
        print()

    if args.csv:
        with open(args.csv, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys()) if rows else ["id"])
            w.writeheader()
            w.writerows(rows)
        print(f"Wrote {len(rows)} rows to {args.csv}")


if __name__ == "__main__":
    main()
