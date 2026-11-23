from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from scripts.seed_pokedex import build_evolutions, build_pokemon, load_form_descriptions


class FixtureSource:
    def __init__(self, data):
        self.data = data

    def read(self, name):
        return iter(self.data.get(name, []))


def ninetales_source():
    stats = [
        {"pokemon_id": str(pokemon_id), "stat_id": str(stat_id), "base_stat": "50"}
        for pokemon_id in (38, 10104)
        for stat_id in range(1, 7)
    ]
    return FixtureSource({
        "pokemon_species": [{
            "id": "38",
            "identifier": "ninetales",
            "generation_id": "1",
            "evolution_chain_id": "14",
            "capture_rate": "75",
            "base_happiness": "70",
            "hatch_counter": "20",
            "gender_rate": "1",
            "growth_rate_id": "2",
            "color_id": "1",
            "shape_id": "8",
            "habitat_id": "3",
            "is_baby": "0",
            "is_legendary": "0",
            "is_mythical": "0",
        }],
        "pokemon_species_names": [{
            "pokemon_species_id": "38",
            "local_language_id": "9",
            "genus": "Fox Pokemon",
        }],
        "growth_rates": [{"id": "2", "identifier": "medium"}],
        "pokemon_species_flavor_text": [{
            "species_id": "38",
            "language_id": "9",
            "version_id": "1",
            "flavor_text": "The shared species description.",
        }],
        "pokemon_stats": stats,
        "pokemon": [
            {
                "id": "38",
                "species_id": "38",
                "is_default": "1",
                "identifier": "ninetales",
                "height": "11",
                "weight": "199",
            },
            {
                "id": "10104",
                "species_id": "38",
                "is_default": "0",
                "identifier": "ninetales-alola",
                "height": "11",
                "weight": "199",
            },
        ],
    })


class BuildPokemonTests(unittest.TestCase):
    def test_form_override_replaces_shared_species_description_only_for_that_form(self):
        rows = build_pokemon(
            ninetales_source(),
            {10104: "A curated description unique to Alolan Ninetales."},
        )

        descriptions_by_id = {row[0]: row[20] for row in rows}

        self.assertEqual(descriptions_by_id[38], "The shared species description.")
        self.assertEqual(
            descriptions_by_id[10104],
            "A curated description unique to Alolan Ninetales.",
        )

    def test_form_descriptions_load_by_pokemon_resource_id(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "form_descriptions.csv"
            path.write_text(
                "pokemon_id,description\n10104,Curated Alolan entry.\n",
                encoding="utf-8",
            )

            self.assertEqual(
                load_form_descriptions(path, {38, 10104}),
                {10104: "Curated Alolan entry."},
            )


class BuildEvolutionsTests(unittest.TestCase):
    def test_form_selectors_map_pokeapi_form_ids_to_pokemon_ids(self):
            def evolution_row(source_form_id, target_form_id, time_of_day):
                return {
                    "evolved_species_id": "745",
                    "evolution_trigger_id": "1",
                    "trigger_item_id": "",
                    "minimum_level": "25",
                    "minimum_happiness": "",
                    "minimum_beauty": "",
                    "minimum_affection": "",
                    "gender_id": "",
                    "time_of_day": time_of_day,
                    "held_item_id": "",
                    "location_id": "",
                    "trade_species_id": "",
                    "needs_overworld_rain": "0",
                    "turn_upside_down": "0",
                    "required_pokemon_form_id": str(source_form_id),
                    "evolved_pokemon_form_id": str(target_form_id),
                }

            source = FixtureSource({
                "pokemon_species": [{
                    "id": "745",
                    "evolution_chain_id": "383",
                    "evolves_from_species_id": "744",
                }],
                "pokemon_forms": [
                    {"id": "744", "pokemon_id": "744"},
                    {"id": "745", "pokemon_id": "745"},
                    {"id": "10228", "pokemon_id": "10126"},
                    {"id": "10310", "pokemon_id": "10151"},
                    {"id": "10311", "pokemon_id": "10152"},
                ],
                "pokemon_evolution": [
                    evolution_row("744", "745", "day"),
                    evolution_row("744", "10228", "night"),
                    evolution_row("10310", "10311", "dusk"),
                ],
                "evolution_triggers": [{"id": "1", "identifier": "level-up"}],
                "items": [],
                "locations": [],
                "location_names": [],
            })

            rows = build_evolutions(source)

            self.assertEqual(
                [(row[-2], row[-1]) for row in rows],
                [(744, 745), (744, 10126), (10151, 10152)],
            )


if __name__ == "__main__":
    unittest.main()
