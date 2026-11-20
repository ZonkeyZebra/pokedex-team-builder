#!/usr/bin/env python3
"""
Peek at how Bulbapedia stores Pokédex entries for Pokémon with alternate forms.

Fetches each page's raw wikitext through the MediaWiki API and prints only the
lines that matter (section headings and {{Dex...}} / {{Ndex...}} templates), so
you can see how form-specific entries are laid out before building a parser.

Usage:
    python bulbapedia_form_sample.py                      # Meowth, Vulpix, Raichu
    python bulbapedia_form_sample.py Growlithe Tauros     # your own picks
    python bulbapedia_form_sample.py --full               # don't truncate long lines
    python bulbapedia_form_sample.py --save               # also save full wikitext to ./bulbapedia_samples/

Be polite: this sleeps between requests and sends a descriptive User-Agent.
Bulbapedia text is community-written; check its reuse terms and credit it if
you use any of it in your project.
"""
import argparse
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://bulbapedia.bulbagarden.net/w/api.php"
USER_AGENT = "pokedex-team-builder-class-project/0.1 (personal learning project)"
DEFAULT_SPECIES = ["Meowth", "Vulpix", "Raichu"]

# Lines worth showing: headings, and any Dex/Ndex template start.
INTERESTING = re.compile(r"^\s*(=+[^=].*?=+|\{\{\s*[ND]dex|\{\{\s*Dex)", re.IGNORECASE)


def fetch_wikitext(species):
    params = {
        "action": "parse",
        "page": f"{species} (Pokémon)",
        "prop": "wikitext",
        "redirects": "1",
        "format": "json",
        "formatversion": "2",
    }
    url = f"{API}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.load(resp)
    if "error" in data:
        raise RuntimeError(data["error"].get("info", "unknown API error"))
    return data["parse"]["wikitext"]


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("species", nargs="*", default=DEFAULT_SPECIES)
    ap.add_argument("--full", action="store_true", help="do not truncate long lines")
    ap.add_argument("--save", action="store_true", help="save full wikitext per species")
    args = ap.parse_args()

    out_dir = Path("bulbapedia_samples")
    if args.save:
        out_dir.mkdir(exist_ok=True)

    for i, species in enumerate(args.species):
        if i:
            time.sleep(1.5)
        print(f"\n{'=' * 70}\n{species}\n{'=' * 70}")
        try:
            text = fetch_wikitext(species)
        except Exception as exc:  # network, 403, missing page, etc.
            print(f"  could not fetch: {exc}", file=sys.stderr)
            continue

        if args.save:
            (out_dir / f"{species}.wikitext.txt").write_text(text, encoding="utf-8")

        lines = text.splitlines()
        shown = 0
        for n, line in enumerate(lines, 1):
            if INTERESTING.match(line):
                shown += 1
                if not args.full and len(line) > 160:
                    line = line[:157] + "..."
                print(f"{n:>5}: {line}")
        print(f"\n  ({shown} matching lines of {len(lines)} total)")


if __name__ == "__main__":
    main()
