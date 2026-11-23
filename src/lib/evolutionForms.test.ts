import { describe, expect, it } from "vitest";
import {
  buildLineages,
  formTag,
  groupFormsBySpecies,
  otherFormsByFamily,
  regionOf,
  type EvolutionForm,
  type EvolutionStep,
} from "./evolutionForms";

function form(
  id: number,
  species_id: number,
  name: string,
  form_name: string | null = null,
): EvolutionForm {
  return {
    id, species_id, name, form_name,
    is_default: form_name === null,
    sprite_url: null,
    shiny_sprite_url: null,
  };
}

function evolutionStep(
  from_species_id: number,
  to_species_id: number,
  condition: Partial<EvolutionStep>,
): EvolutionStep {
  return {
    from_species_id,
    to_species_id,
    trigger: condition.trigger ?? "level-up",
    trigger_item: condition.trigger_item ?? null,
    minimum_level: condition.minimum_level ?? null,
    minimum_happiness: condition.minimum_happiness ?? null,
    time_of_day: condition.time_of_day ?? null,
    held_item: condition.held_item ?? null,
    details: condition.details ?? null,
  };
}

describe("regionOf", () => {
  it("recognizes regional forms and ignores caps and totems", () => {
    expect(regionOf("alola")).toBe("alola");
    expect(regionOf("galar-zen")).toBe("galar");
    expect(regionOf("paldea-combat-breed")).toBe("paldea");
    expect(regionOf("alola-cap")).toBeNull();
    expect(regionOf("totem-alola")).toBeNull();
    expect(regionOf("mega-x")).toBeNull();
    expect(regionOf(null)).toBeNull();
  });
});

describe("buildLineages", () => {
  const meowth = groupFormsBySpecies([
    form(52, 52, "meowth"),
    form(10107, 52, "meowth-alola", "alola"),
    form(10161, 52, "meowth-galar", "galar"),
    form(10200, 52, "meowth-gmax", "gmax"),
    form(53, 53, "persian"),
    form(10108, 53, "persian-alola", "alola"),
    form(863, 863, "perrserker"),
  ]);
  const meowthEdges = [
    { from_species_id: 52, to_species_id: 53 },
    { from_species_id: 52, to_species_id: 863 },
  ];

  it("keeps Perrserker out of the standard line and Persian out of the Galarian line", () => {
    const lineages = buildLineages(meowthEdges, meowth, null);
    expect(lineages.map((l) => l.key)).toEqual(["standard", "alola", "galar"]);

    const ids = (key: string) =>
      lineages.find((l) => l.key === key)!.stages.map((stage) => stage.map((c) => c.form?.id));
    expect(ids("standard")).toEqual([[52], [53]]);
    expect(ids("alola")).toEqual([[10107], [10108]]);
    expect(ids("galar")).toEqual([[10161], [863]]);
  });

  it("puts the lineage of the viewed form first", () => {
    const lineages = buildLineages(meowthEdges, meowth, "galar");
    expect(lineages.map((l) => l.key)).toEqual(["galar", "standard", "alola"]);
  });

  it("lists forms that are not shown as cards", () => {
    const lineages = buildLineages(meowthEdges, meowth, null);
    const more = otherFormsByFamily(meowth, lineages);
    expect(more).toEqual([
      { speciesId: 52, speciesName: "meowth", forms: [meowth[52][3]] },
    ]);
  });

  it("uses the default Pokémon for stages without a regional form (Pikachu in Alolan Raichu's line)", () => {
    const raichu = groupFormsBySpecies([
      form(172, 172, "pichu"),
      form(25, 25, "pikachu"),
      form(10094, 25, "pikachu-original-cap", "original-cap"),
      form(10099, 25, "pikachu-alola-cap", "alola-cap"),
      form(26, 26, "raichu"),
      form(10100, 26, "raichu-alola", "alola"),
    ]);
    const edges = [
      { from_species_id: 172, to_species_id: 25 },
      { from_species_id: 25, to_species_id: 26 },
    ];
    const lineages = buildLineages(edges, raichu, "alola");
    expect(lineages.map((l) => l.key)).toEqual(["alola", "standard"]);
    expect(lineages[0].stages.map((s) => s.map((c) => c.form?.id))).toEqual([[172], [25], [10100]]);
    // caps are not treated as regional forms
    const more = otherFormsByFamily(raichu, lineages);
    expect(more[0].forms.map((f) => f.id)).toEqual([10094, 10099]);
  });

  it("returns a single standard line when the chain has no regional forms", () => {
    const eevee = groupFormsBySpecies([form(133, 133, "eevee"), form(134, 134, "vaporeon")]);
    const lineages = buildLineages([{ from_species_id: 133, to_species_id: 134 }], eevee, null);
    expect(lineages).toHaveLength(1);
    expect(lineages[0].stages).toHaveLength(2);
  });

  it("selects form-specific conditions for regional evolution paths", () => {
    const cases = [
      {
        from: 19, fromName: "rattata", to: 20, toName: "raticate", region: "alola" as const,
        fromForm: "rattata-alola", toForm: "raticate-alola", formName: "alola",
        choices: [
          { trigger: "level-up", minimum_level: 20, details: "Level 20" },
          { trigger: "level-up", minimum_level: 20, time_of_day: "night", details: "Level 20; Night time" },
        ],
        expected: "Level 20; Night time",
      },
      {
        from: 27, fromName: "sandshrew", to: 28, toName: "sandslash", region: "alola" as const,
        fromForm: "sandshrew-alola", toForm: "sandslash-alola", formName: "alola",
        choices: [
          { trigger: "level-up", minimum_level: 22, details: "Level 22" },
          { trigger: "use-item", trigger_item: "ice-stone", details: "Use ice-stone" },
        ],
        expected: "Use ice-stone",
      },
      {
        from: 37, fromName: "vulpix", to: 38, toName: "ninetales", region: "alola" as const,
        fromForm: "vulpix-alola", toForm: "ninetales-alola", formName: "alola",
        choices: [
          { trigger: "use-item", trigger_item: "fire-stone", details: "Use fire-stone" },
          { trigger: "use-item", trigger_item: "ice-stone", details: "Use ice-stone" },
        ],
        expected: "Use ice-stone",
        expectedDefault: "Use fire-stone",
      },
      {
        from: 52, fromName: "meowth", to: 53, toName: "persian", region: "alola" as const,
        fromForm: "meowth-alola", toForm: "persian-alola", formName: "alola",
        choices: [
          { trigger: "level-up", minimum_level: 28, details: "Level 28" },
          { trigger: "level-up", minimum_happiness: 160, details: "Happiness 160" },
        ],
        expected: "Happiness 160",
      },
      {
        from: 104, fromName: "cubone", to: 105, toName: "marowak", region: "alola" as const,
        toForm: "marowak-alola", formName: "alola",
        choices: [
          { trigger: "level-up", minimum_level: 28, details: "Level 28" },
          { trigger: "level-up", minimum_level: 28, time_of_day: "night", details: "Level 28; Night time" },
        ],
        expected: "Level 28; Night time",
      },
      {
        from: 79, fromName: "slowpoke", to: 80, toName: "slowbro", region: "galar" as const,
        fromForm: "slowpoke-galar", toForm: "slowbro-galar", formName: "galar",
        choices: [
          { trigger: "level-up", minimum_level: 37, details: "Level 37" },
          { trigger: "use-item", trigger_item: "galarica-cuff", details: "Use galarica-cuff" },
        ],
        expected: "Use galarica-cuff",
      },
      {
        from: 79, fromName: "slowpoke", to: 199, toName: "slowking", region: "galar" as const,
        fromForm: "slowpoke-galar", toForm: "slowking-galar", formName: "galar",
        choices: [
          { trigger: "trade", details: "Trade" },
          { trigger: "use-item", trigger_item: "galarica-wreath", details: "Use galarica-wreath" },
        ],
        expected: "Use galarica-wreath",
      },
      {
        from: 100, fromName: "voltorb", to: 101, toName: "electrode", region: "hisui" as const,
        fromForm: "voltorb-hisui", toForm: "electrode-hisui", formName: "hisui",
        choices: [
          { trigger: "level-up", minimum_level: 30, details: "Level 30" },
          { trigger: "use-item", trigger_item: "leaf-stone", details: "Use leaf-stone" },
        ],
        expected: "Use leaf-stone",
      },
      {
        from: 554, fromName: "darumaka", to: 555, toName: "darmanitan", region: "galar" as const,
        fromForm: "darumaka-galar", toForm: "darmanitan-galar-standard", formName: "galar-standard",
        choices: [
          { trigger: "level-up", minimum_level: 35, details: "Level 35" },
          { trigger: "use-item", trigger_item: "ice-stone", details: "Use ice-stone" },
        ],
        expected: "Use ice-stone",
      },
      {
        from: 723, fromName: "dartrix", to: 724, toName: "decidueye", region: "hisui" as const,
        toForm: "decidueye-hisui", formName: "hisui",
        choices: [
          { trigger: "level-up", minimum_level: 34, details: "Level 34" },
          { trigger: "level-up", minimum_level: 36, details: "Level 36" },
        ],
        expected: "Level 36",
      },
      {
        from: 215, fromName: "sneasel", to: 903, toName: "sneasler", region: "hisui" as const,
        fromForm: "sneasel-hisui", formName: "hisui",
        choices: [
          { trigger: "use-item", trigger_item: "razor-claw", time_of_day: "day", details: "Use razor-claw; Day time" },
          { trigger: "level-up", held_item: "razor-claw", time_of_day: "day", details: "Hold razor-claw; Day time" },
        ],
        expected: "Use razor-claw; Day time",
      },
    ];

    for (const [index, testCase] of cases.entries()) {
      const sourceForms = [
        form(testCase.from, testCase.from, testCase.fromName),
        ...(testCase.fromForm
          ? [form(20000 + index, testCase.from, testCase.fromForm, testCase.formName ?? null)]
          : []),
      ];
      const targetForms = [
        form(testCase.to, testCase.to, testCase.toName),
        ...(testCase.toForm
          ? [form(30000 + index, testCase.to, testCase.toForm, testCase.formName ?? null)]
          : []),
      ];
      const forms = groupFormsBySpecies([...sourceForms, ...targetForms]);
      const evolutions = testCase.choices.map((choice) =>
        evolutionStep(testCase.from, testCase.to, choice));
      const lineage = buildLineages(evolutions, forms, testCase.region)
        .find((entry) => entry.region === testCase.region);
      const target = lineage?.stages.flat().find((card) => card.speciesId === testCase.to);

      expect(target?.evolutionDetails, `${testCase.fromName} -> ${testCase.toName}`).toBe(testCase.expected);
      if ("expectedDefault" in testCase) {
        const standardTarget = buildLineages(evolutions, forms, null)
          .find((entry) => entry.region === null)
          ?.stages.flat().find((card) => card.speciesId === testCase.to);
        expect(standardTarget?.evolutionDetails).toBe(testCase.expectedDefault);
      }
    }
  });

  it("builds and selects the matching Lycanroc form path", () => {
    const forms = groupFormsBySpecies([
      form(744, 744, "rockruff"),
      form(10151, 744, "rockruff-own-tempo", "own-tempo"),
      form(745, 745, "lycanroc-midday"),
      form(10126, 745, "lycanroc-midnight", "midnight"),
      form(10152, 745, "lycanroc-dusk", "dusk"),
    ]);
    const evolutions = [
      {
        ...evolutionStep(744, 745, {
          trigger: "level-up",
          minimum_level: 25,
          time_of_day: "day",
          details: "Level 25; Day time",
        }),
        from_pokemon_id: 744,
        to_pokemon_id: 745,
      },
      {
        ...evolutionStep(744, 745, {
          trigger: "level-up",
          minimum_level: 25,
          time_of_day: "night",
          details: "Level 25; Night time",
        }),
        from_pokemon_id: 744,
        to_pokemon_id: 10126,
      },
      {
        ...evolutionStep(744, 745, {
          trigger: "level-up",
          minimum_level: 25,
          time_of_day: "dusk",
          details: "Level 25; Dusk time",
        }),
        from_pokemon_id: 10151,
        to_pokemon_id: 10152,
      },
    ];

    const midnightLineages = buildLineages(evolutions, forms, null, 10126);
    expect(midnightLineages[0].stages.flat().map((card) => card.form?.id)).toEqual([744, 10126]);
    expect(midnightLineages[0].stages[1][0].evolutionDetails).toBe("Level 25; Night time");

    const duskLineages = buildLineages(evolutions, forms, null, 10152);
    expect(duskLineages[0].stages.flat().map((card) => card.form?.id)).toEqual([10151, 10152]);
    expect(duskLineages[0].stages[1][0].evolutionDetails).toBe("Level 25; Dusk time");

    const standardLineages = buildLineages(evolutions, forms, null, 745);
    expect(standardLineages[0].stages.flat().map((card) => card.form?.id)).toEqual([744, 745]);
    expect(standardLineages[0].stages[1][0].evolutionDetails).toBe("Level 25; Day time");
  });
});

describe("formTag", () => {
  it("labels regional and other forms", () => {
    expect(formTag({ name: "meowth-alola", form_name: "alola" })).toBe("Alolan form");
    expect(formTag({ name: "charizard-mega-x", form_name: "mega-x" })).toBe("Mega X");
  });
});
