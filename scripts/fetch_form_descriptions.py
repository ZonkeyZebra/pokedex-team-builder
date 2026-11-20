#!/usr/bin/env python3
"""
Pull form-specific Pokédex descriptions from Bulbapedia for every alternate form
(Mega, Alolan, Galarian, Hisuian, Paldean, Gigantamax, Lycanroc Midnight/Dusk, ...)
and write them to a CSV that matches your override table: pokemon_id,description

How it works
  1. Reads PokeAPI's CSVs (same ./pokeapi_csv cache as your seed script) to get
     every non-default form, so the IDs match your `pokemon.id` column.
  2. Downloads each species' Bulbapedia page wikitext via the MediaWiki API
     (cached in ./bulbapedia_cache, polite delay between requests).
  3. Parses the "Pokédex entries" section. Entries after {{Dex/Form|Alolan Form}}
     belong to that form until the next {{Dex/Gen...}} block.
  4. Matches Bulbapedia's form labels to your forms, takes the most recent
     main-series entry, cleans the wikitext, and writes the CSV.

Outputs
  form_descriptions_generated.csv   pokemon_id,description  (import this)
  form_descriptions_report.csv      every form with a status, the source game,
                                    the Bulbapedia page URL, and the labels that
                                    were available (use it to fix unmatched forms
                                    and to credit Bulbapedia)

Usage
  python fetch_form_descriptions.py --species raichu vulpix lycanroc   # try a few first
  python fetch_form_descriptions.py                                    # everything
  python fetch_form_descriptions.py --existing my_overrides.csv        # never touch IDs you already filled in
  python fetch_form_descriptions.py --refresh                          # ignore the wikitext cache

Bulbapedia text is community-written. Check its reuse terms and credit it in your
project (the report CSV lists the page for every description).
"""
import argparse
import csv
import html
import json
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

POKEAPI_CSV = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv"
BULBA_API = "https://bulbapedia.bulbagarden.net/w/api.php"
BULBA_WIKI = "https://bulbapedia.bulbagarden.net/wiki/"
USER_AGENT = "pokedex-team-builder-class-project/0.1 (personal learning project)"
ENGLISH = "9"
POKEAPI_FILES = ["pokemon", "pokemon_species", "pokemon_species_names",
                 "pokemon_forms", "pokemon_form_names"]

# Spin-off / remake-of-old-text entries we don't want as "the" description.
SKIP_GAMES = {"Pokopia", "Stadium", "Stadium 2", "Colosseum", "XD"}

REGION_ADJECTIVES = {
    "alola": ("alolan", "alola"),
    "galar": ("galarian", "galar"),
    "hisui": ("hisuian", "hisui"),
    "paldea": ("paldean", "paldea"),
}


# ------------------------------------------------------------ PokeAPI side

def download_pokeapi(cache_dir):
    cache_dir.mkdir(parents=True, exist_ok=True)
    for name in POKEAPI_FILES:
        path = cache_dir / f"{name}.csv"
        if not path.exists():
            print(f"  downloading {name}.csv")
            urllib.request.urlretrieve(f"{POKEAPI_CSV}/{name}.csv", path)


def read_csv(cache_dir, name):
    with open(cache_dir / f"{name}.csv", newline="", encoding="utf-8") as f:
        yield from csv.DictReader(f)


def load_alt_forms(cache_dir):
    """Every non-default Pokémon row, with its species name and English form labels."""
    species_ident = {r["id"]: r["identifier"] for r in read_csv(cache_dir, "pokemon_species")}
    species_name = {r["pokemon_species_id"]: r["name"]
                    for r in read_csv(cache_dir, "pokemon_species_names")
                    if r["local_language_id"] == ENGLISH}
    form_to_pokemon = {r["id"]: r["pokemon_id"] for r in read_csv(cache_dir, "pokemon_forms")}
    labels = defaultdict(list)
    for r in read_csv(cache_dir, "pokemon_form_names"):
        if r["local_language_id"] != ENGLISH:
            continue
        pid = form_to_pokemon.get(r["pokemon_form_id"])
        for value in (r["form_name"], r["pokemon_name"]):
            if pid and value and value not in labels[pid]:
                labels[pid].append(value)

    rows = []
    for r in read_csv(cache_dir, "pokemon"):
        if r["is_default"] == "1":
            continue
        sp = species_ident.get(r["species_id"])
        if sp is None:
            continue
        prefix = sp + "-"
        form = r["identifier"][len(prefix):] if r["identifier"].startswith(prefix) else r["identifier"]
        rows.append({
            "id": int(r["id"]),
            "species_id": r["species_id"],
            "species": sp,
            "species_name": species_name.get(r["species_id"], sp.replace("-", " ").title()),
            "identifier": r["identifier"],
            "form": form,
            "labels": labels.get(r["id"], []),
        })
    rows.sort(key=lambda x: x["id"])
    return rows


# ------------------------------------------------------------ Bulbapedia fetch

def fetch_wikitext(title, retries=4):
    """Return a page's wikitext, or None if the page does not exist."""
    params = {"action": "parse", "page": title, "prop": "wikitext",
              "redirects": "1", "format": "json", "formatversion": "2"}
    url = f"{BULBA_API}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.load(resp)
        except urllib.error.HTTPError as exc:
            if exc.code in (429, 500, 502, 503, 504) and attempt < retries - 1:
                time.sleep(3 * (attempt + 1))
                continue
            raise
        if "error" in data:
            if data["error"].get("code") == "missingtitle":
                return None
            raise RuntimeError(data["error"].get("info", "unknown API error"))
        return data["parse"]["wikitext"]
    return None


def get_species_wikitext(species_row, cache_dir, refresh, delay):
    """Cached fetch. Returns (title, wikitext_or_None, fetched_from_network)."""
    title = f"{species_row['species_name']} (Pokémon)"
    path = cache_dir / f"{species_row['species_id']}.wikitext"
    if path.exists() and not refresh:
        text = path.read_text(encoding="utf-8")
        return title, (text or None), False
    time.sleep(delay)
    text = fetch_wikitext(title)
    cache_dir.mkdir(parents=True, exist_ok=True)
    path.write_text(text or "", encoding="utf-8")
    return title, text, True


# ------------------------------------------------------------ wikitext parsing

def split_params(inner):
    """Split template contents on top-level pipes (ignoring pipes inside {{ }} and [[ ]])."""
    parts, buf, depth_t, depth_l, i = [], [], 0, 0, 0
    while i < len(inner):
        two = inner[i:i + 2]
        if two == "{{":
            depth_t += 1; buf.append(two); i += 2; continue
        if two == "}}":
            depth_t -= 1; buf.append(two); i += 2; continue
        if two == "[[":
            depth_l += 1; buf.append(two); i += 2; continue
        if two == "]]":
            depth_l -= 1; buf.append(two); i += 2; continue
        ch = inner[i]
        if ch == "|" and depth_t == 0 and depth_l == 0:
            parts.append("".join(buf)); buf = []
        else:
            buf.append(ch)
        i += 1
    parts.append("".join(buf))
    return parts


def named_params(parts):
    """Turn ['Dex/Entry1', 'v=Sun', 'entry=...'] into (name, {key: value}, [positional])."""
    named, positional = {}, []
    for p in parts[1:]:
        key, sep, value = p.partition("=")
        if sep and re.fullmatch(r"\s*[A-Za-z0-9_]+\s*", key):
            named[key.strip()] = value.strip()
        else:
            positional.append(p.strip())
    return parts[0].strip(), named, positional


def dex_section_lines(wikitext):
    """Lines of the top-level '===Pokédex entries===' section under Game data."""
    lines = wikitext.splitlines()
    start = next((i for i, l in enumerate(lines)
                  if re.match(r"^===\s*Pok[ée]dex entries\s*===\s*$", l)), None)
    if start is None:
        return []
    out = []
    for line in lines[start + 1:]:
        if re.match(r"^(={2,3})[^=].*\1\s*$", line) or line.strip().startswith("{{Dex/Footer"):
            break
        out.append(line)
    return out


def statements(lines):
    """Join multi-line templates into single statements."""
    buf, balance = [], 0
    for line in lines:
        if not buf and not line.lstrip().startswith("{{"):
            continue
        buf.append(line)
        balance += line.count("{{") - line.count("}}")
        if balance <= 0:
            yield "\n".join(buf).strip()
            buf, balance = [], 0
    if buf:
        yield "\n".join(buf).strip()


def parse_dex_entries(wikitext):
    """
    Returns {form_label: [ {games: [...], raw: '...'}, ... ]} in page order.
    Base-form entries (before any {{Dex/Form}} in a generation block) use label None.
    """
    result = defaultdict(list)
    current = None
    for stmt in statements(dex_section_lines(wikitext)):
        if not (stmt.startswith("{{") and stmt.endswith("}}")):
            continue
        parts = split_params(stmt[2:-2])
        name, named, positional = named_params(parts)
        lname = name.lower()
        if lname.startswith("dex/gen"):
            current = None
        elif lname == "dex/form":
            current = clean_wikitext(positional[0]) if positional else None
        elif lname.startswith("dex/entry") and "entry" in named:
            games = [named[k] for k in sorted(named) if re.fullmatch(r"v\d*", k)]
            result[current].append({"games": games, "raw": named["entry"]})
    return result


# ------------------------------------------------------------ text cleaning

_TEMPLATE = re.compile(r"\{\{([^{}]*)\}\}")
# Invisible / layout characters that sit between words where the game text broke lines.
_TO_SPACE = dict.fromkeys(map(ord, "\f\v\r\n\t\u00ad\u200b\u200c\u200d\u2060\ufeff\u00a0"), " ")


def _template_to_text(match):
    parts = [p.strip() for p in match.group(1).split("|")]
    name = parts[0].lower()
    if name == "scpkmn":
        return "Pokémon"
    if name == "br":
        return " "
    args = [p for p in parts[1:] if "=" not in p]
    return args[0] if args else ""


def clean_wikitext(text):
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    text = re.sub(r"<ref[^>]*/>", "", text)
    text = re.sub(r"<ref[^>]*>.*?</ref>", "", text, flags=re.S)
    text = re.sub(r"<small>.*?</small>", "", text, flags=re.S | re.I)
    while True:
        new = _TEMPLATE.sub(_template_to_text, text)
        if new == text:
            break
        text = new
    text = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", text)
    text = text.replace("'''", "").replace("''", "")
    text = re.sub(r"<br\s*/?>", " ", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text).translate(_TO_SPACE)
    return re.sub(r"\s+", " ", text).strip()


# ------------------------------------------------------------ matching

def norm(value):
    value = unicodedata.normalize("NFKD", value.lower())
    return re.sub(r"[^a-z0-9]", "", value)


def candidate_keys(row):
    """Normalized Bulbapedia labels this form might go by, best guess first."""
    sp, form = row["species_name"], row["form"]
    words = form.replace("-", " ")
    cands = list(row["labels"])
    if form in REGION_ADJECTIVES:
        for adj in REGION_ADJECTIVES[form]:
            cands += [f"{adj} form", f"{adj} {sp}"]
    elif form.startswith("mega"):
        suffix = form[5:].replace("-", " ")
        cands.append(f"mega {sp} {suffix}".strip())
    elif form == "gmax":
        cands += [f"gigantamax {sp}", "gigantamax form"]
    elif form == "primal":
        cands += [f"primal {sp}", "primal form"]
    else:
        cands += [f"{words} form", f"{words} {sp}", f"{sp} {words}", words]
    seen, keys = set(), []
    for c in cands:
        k = norm(c)
        if k and k not in seen:
            seen.add(k)
            keys.append(k)
    return keys


def match_forms(rows, entries_by_label):
    """
    rows: alternate-form rows of ONE species. entries_by_label: parse_dex_entries output.
    Returns {pokemon_id: (status, label)} where status is 'matched', 'ambiguous'
    or 'no_matching_label'.
    """
    label_by_key = {norm(lbl): lbl for lbl in entries_by_label if lbl}
    claims = defaultdict(list)
    chosen = {}
    for row in rows:
        for key in candidate_keys(row):
            if key in label_by_key:
                chosen[row["id"]] = label_by_key[key]
                claims[key].append(row["id"])
                break
    out = {}
    for row in rows:
        lbl = chosen.get(row["id"])
        if lbl is None:
            out[row["id"]] = ("no_matching_label", "")
        elif len(claims[norm(lbl)]) > 1:
            out[row["id"]] = ("ambiguous", lbl)
        else:
            out[row["id"]] = ("matched", lbl)
    return out


def best_entry(entries):
    """Most recent main-series entry (last in page order) with usable text."""
    for entry in reversed(entries):
        if entry["games"] and all(g in SKIP_GAMES for g in entry["games"]):
            continue
        text = clean_wikitext(entry["raw"])
        if text:
            return ", ".join(entry["games"]), text
    return None


# ------------------------------------------------------------ main

def read_existing_ids(path):
    if not path:
        return set()
    ids = set()
    with open(path, newline="", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            if (r.get("description") or "").strip() and (r.get("pokemon_id") or "").strip():
                ids.add(int(r["pokemon_id"]))
    return ids


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--species", nargs="*", help="only these species identifiers (e.g. raichu lycanroc)")
    ap.add_argument("--existing", help="your override CSV; IDs with a description are left alone")
    ap.add_argument("--output", default="form_descriptions_generated.csv")
    ap.add_argument("--report", default="form_descriptions_report.csv")
    ap.add_argument("--pokeapi-cache", default="pokeapi_csv")
    ap.add_argument("--wiki-cache", default="bulbapedia_cache")
    ap.add_argument("--delay", type=float, default=1.5, help="seconds between Bulbapedia requests")
    ap.add_argument("--refresh", action="store_true", help="ignore cached wikitext")
    args = ap.parse_args()

    pokeapi_cache, wiki_cache = Path(args.pokeapi_cache), Path(args.wiki_cache)
    download_pokeapi(pokeapi_cache)
    rows = load_alt_forms(pokeapi_cache)
    if args.species:
        wanted = {s.lower() for s in args.species}
        rows = [r for r in rows if r["species"] in wanted]
    existing = read_existing_ids(args.existing)

    by_species = defaultdict(list)
    for r in rows:
        by_species[r["species_id"]].append(r)
    print(f"{len(rows)} alternate forms across {len(by_species)} species")

    generated, report = [], []
    for n, (species_id, forms) in enumerate(sorted(by_species.items(), key=lambda kv: int(kv[0])), 1):
        first = forms[0]
        print(f"[{n}/{len(by_species)}] {first['species_name']} ({len(forms)} forms)")
        base_report = lambda row, status, **kw: {  # noqa: E731
            "pokemon_id": row["id"], "identifier": row["identifier"], "status": status,
            "bulbapedia_label": kw.get("label", ""), "source_game": kw.get("game", ""),
            "page_url": kw.get("url", ""), "available_labels": kw.get("available", ""),
            "description": kw.get("text", ""),
        }
        try:
            title, wikitext, _ = get_species_wikitext(first, wiki_cache, args.refresh, args.delay)
        except Exception as exc:  # network failure etc.
            print(f"    could not fetch: {exc}", file=sys.stderr)
            report += [base_report(r, "fetch_error") for r in forms]
            continue
        url = BULBA_WIKI + urllib.parse.quote(title.replace(" ", "_"), safe="_():'")
        if not wikitext:
            report += [base_report(r, "no_page", url=url) for r in forms]
            continue

        entries = parse_dex_entries(wikitext)
        available = "; ".join(lbl for lbl in entries if lbl)
        if not entries:
            report += [base_report(r, "no_dex_section", url=url) for r in forms]
            continue

        matches = match_forms(forms, entries)
        for row in forms:
            status, label = matches[row["id"]]
            if row["id"] in existing:
                report.append(base_report(row, "skipped_existing", label=label, url=url, available=available))
                continue
            if status != "matched":
                report.append(base_report(row, status, label=label, url=url, available=available))
                continue
            picked = best_entry(entries[label])
            if not picked:
                report.append(base_report(row, "no_usable_entry", label=label, url=url, available=available))
                continue
            game, text = picked
            generated.append({"pokemon_id": row["id"], "description": text})
            report.append(base_report(row, "matched", label=label, game=game, url=url,
                                      available=available, text=text))

    with open(args.output, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["pokemon_id", "description"])
        w.writeheader()
        w.writerows(sorted(generated, key=lambda r: r["pokemon_id"]))
    fields = ["pokemon_id", "identifier", "status", "bulbapedia_label", "source_game",
              "page_url", "available_labels", "description"]
    with open(args.report, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(sorted(report, key=lambda r: r["pokemon_id"]))

    counts = defaultdict(int)
    for r in report:
        counts[r["status"]] += 1
    print(f"\nWrote {len(generated)} descriptions to {args.output}")
    print(f"Full report: {args.report}")
    for status, count in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f"  {status:<18} {count}")


if __name__ == "__main__":
    main()
