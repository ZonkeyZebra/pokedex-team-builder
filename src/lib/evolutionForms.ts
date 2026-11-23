export type EvolutionForm = {
  id: number;
  species_id: number;
  name: string;
  form_name: string | null;
  is_default: boolean;
  sprite_url: string | null;
  shiny_sprite_url: string | null;
};

export type EvolutionEdge = {
  from_species_id: number | null;
  to_species_id: number;
  from_pokemon_id?: number | null;
  to_pokemon_id?: number | null;
};

export type EvolutionStep = EvolutionEdge & {
  trigger: string;
  trigger_item?: string | null;
  minimum_level?: number | null;
  minimum_happiness?: number | null;
  time_of_day?: string | null;
  held_item?: string | null;
  details: string | null;
};

export type Region = "alola" | "galar" | "hisui" | "paldea";

export const REGIONS: Region[] = ["alola", "galar", "hisui", "paldea"];

export const REGION_LABELS: Record<Region, string> = {
  alola: "Alolan",
  galar: "Galarian",
  hisui: "Hisuian",
  paldea: "Paldean",
};

/**
 * Species that only evolve from a regional form (keyed by the species' default
 * form name in the pokemon table). The evolution table is species-level, so
 * without this Galarian Meowth would appear to evolve into Persian and regular
 * Meowth into Perrserker.
 */
const REGIONAL_ONLY: Record<string, Region> = {
  perrserker: "galar",
  cursola: "galar",
  sirfetchd: "galar",
  "mr-rime": "galar",
  runerigus: "galar",
  obstagoon: "galar",
  sneasler: "hisui",
  overqwil: "hisui",
  clodsire: "paldea",
};

/** "alola" -> "alola", "galar-zen" -> "galar", "alola-cap" (a Pikachu cap) -> null. */
export function regionOf(formName: string | null): Region | null {
  if (!formName) return null;
  if (/-(cap|totem)/.test(formName)) return null;
  return REGIONS.find((region) => formName === region || formName.startsWith(`${region}-`)) ?? null;
}

export function formTag(form: Pick<EvolutionForm, "name" | "form_name">): string {
  const region = regionOf(form.form_name);
  if (region) return `${REGION_LABELS[region]} form`;
  const raw = form.form_name ?? form.name;
  return raw
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function groupFormsBySpecies(forms: EvolutionForm[]): Record<number, EvolutionForm[]> {
  const grouped: Record<number, EvolutionForm[]> = {};
  for (const form of [...forms].sort((a, b) => a.id - b.id)) {
    (grouped[form.species_id] ??= []).push(form);
  }
  return grouped;
}

/** Group species into evolution stages (stage 0 = basic, stage 1 = their evolutions, ...). */
export function evolutionStages(evolutions: EvolutionEdge[]): number[][] {
  const toIds = new Set(evolutions.map((evolution) => evolution.to_species_id));
  const fromIds = new Set(
    evolutions
      .map((evolution) => evolution.from_species_id)
      .filter((speciesId): speciesId is number => speciesId !== null),
  );
  let current = [...fromIds].filter((speciesId) => !toIds.has(speciesId));
  if (!current.length) current = [...fromIds];

  const stages: number[][] = [];
  const visited = new Set<number>();
  while (current.length) {
    stages.push(current);
    current.forEach((speciesId) => visited.add(speciesId));
    current = [...new Set(
      evolutions
        .filter((evolution) => evolution.from_species_id !== null
          && current.includes(evolution.from_species_id))
        .map((evolution) => evolution.to_species_id)
        .filter((speciesId) => !visited.has(speciesId)),
    )];
  }
  return stages;
}

export type StageCard<E extends EvolutionEdge> = {
  speciesId: number;
  speciesName: string;
  form: EvolutionForm | undefined;
  evolution: E | undefined;
  evolutionDetails: string | null;
};

export type Lineage<E extends EvolutionEdge> = {
  key: string;
  region: Region | null;
  label: string;
  formIds: number[];
  stages: Array<Array<StageCard<E>>>;
};

function defaultForm(forms: EvolutionForm[] | undefined) {
  return forms?.find((form) => form.is_default);
}

function regionForm(forms: EvolutionForm[] | undefined, region: Region) {
  return forms?.find((form) => regionOf(form.form_name) === region);
}

type EvolutionCondition = Pick<
  EvolutionStep,
  "trigger" | "trigger_item" | "minimum_level" | "minimum_happiness" | "time_of_day" | "held_item"
>;

type FormEvolutionRule = {
  from: string;
  to: string;
  condition: EvolutionCondition;
  details: string;
};

const FORM_EVOLUTION_RULES: FormEvolutionRule[] = [
  {
    from: "rattata-alola",
    to: "raticate-alola",
    condition: { trigger: "level-up", minimum_level: 20, time_of_day: "night" },
    details: "Level 20; Night time",
  },
  {
    from: "sandshrew-alola",
    to: "sandslash-alola",
    condition: { trigger: "use-item", trigger_item: "ice-stone" },
    details: "Use ice-stone",
  },
  {
    from: "vulpix-alola",
    to: "ninetales-alola",
    condition: { trigger: "use-item", trigger_item: "ice-stone" },
    details: "Use ice-stone",
  },
  {
    from: "meowth-alola",
    to: "persian-alola",
    condition: { trigger: "level-up", minimum_happiness: 160 },
    details: "Happiness 160",
  },
  {
    from: "cubone",
    to: "marowak-alola",
    condition: { trigger: "level-up", minimum_level: 28, time_of_day: "night" },
    details: "Level 28; Night time",
  },
  {
    from: "slowpoke-galar",
    to: "slowbro-galar",
    condition: { trigger: "use-item", trigger_item: "galarica-cuff" },
    details: "Use galarica-cuff",
  },
  {
    from: "slowpoke-galar",
    to: "slowking-galar",
    condition: { trigger: "use-item", trigger_item: "galarica-wreath" },
    details: "Use galarica-wreath",
  },
  {
    from: "voltorb-hisui",
    to: "electrode-hisui",
    condition: { trigger: "use-item", trigger_item: "leaf-stone" },
    details: "Use leaf-stone",
  },
  {
    from: "darumaka-galar",
    to: "darmanitan-galar-standard",
    condition: { trigger: "use-item", trigger_item: "ice-stone" },
    details: "Use ice-stone",
  },
  {
    from: "dartrix",
    to: "decidueye-hisui",
    condition: { trigger: "level-up", minimum_level: 36 },
    details: "Level 36",
  },
  {
    from: "sneasel-hisui",
    to: "sneasler",
    condition: { trigger: "use-item", trigger_item: "razor-claw", time_of_day: "day" },
    details: "Use razor-claw; Day time",
  },
];

function matchesEvolutionCondition(
  evolution: EvolutionEdge & Partial<EvolutionStep>,
  condition: EvolutionCondition,
) {
  return (condition.trigger === undefined || evolution.trigger === condition.trigger)
    && (condition.trigger_item === undefined || evolution.trigger_item === condition.trigger_item)
    && (condition.minimum_level === undefined || evolution.minimum_level === condition.minimum_level)
    && (condition.minimum_happiness === undefined || evolution.minimum_happiness === condition.minimum_happiness)
    && (condition.time_of_day === undefined || evolution.time_of_day === condition.time_of_day)
    && (condition.held_item === undefined || evolution.held_item === condition.held_item);
}

function evolutionForForms<E extends EvolutionEdge & Partial<EvolutionStep>>(
  candidates: E[],
  fromForm: EvolutionForm | undefined,
  toForm: EvolutionForm | undefined,
) {
  const exactFormMatch = candidates.filter((candidate) =>
    candidate.from_pokemon_id === fromForm?.id
    && candidate.to_pokemon_id === toForm?.id);
  const formMatched = candidates.filter((candidate) =>
    (candidate.from_pokemon_id == null || candidate.from_pokemon_id === fromForm?.id)
    && (candidate.to_pokemon_id == null || candidate.to_pokemon_id === toForm?.id));
  const available = exactFormMatch.length
    ? exactFormMatch
    : formMatched.length ? formMatched : candidates;
  const rule = FORM_EVOLUTION_RULES.find((entry) =>
    entry.from === fromForm?.name && entry.to === toForm?.name);
  const matched = rule && available.find((candidate) =>
    matchesEvolutionCondition(candidate, rule.condition));
  const evolution = matched ?? available[0];
  return {
    evolution,
    details: matched?.details ?? rule?.details ?? evolution?.details ?? null,
  };
}

function formPathForTarget<E extends EvolutionEdge & Partial<EvolutionStep>>(
  targetForm: EvolutionForm,
  evolutions: E[],
  formsBySpecies: Record<number, EvolutionForm[]>,
  formsById: Map<number, EvolutionForm>,
  firstEdge?: E,
) {
  const forms = new Map<number, EvolutionForm>();
  const pathEdges: E[] = [];
  const visited = new Set<number>();
  let currentForm = targetForm;
  let nextEdge = firstEdge;

  while (!visited.has(currentForm.species_id)) {
    visited.add(currentForm.species_id);
    forms.set(currentForm.species_id, currentForm);
    const incoming = evolutions.filter((evolution) =>
      evolution.to_species_id === currentForm.species_id
      && (evolution.to_pokemon_id == null || evolution.to_pokemon_id === currentForm.id));
    const edge = nextEdge
      ?? incoming.find((evolution) => evolution.to_pokemon_id === currentForm.id)
      ?? incoming.find((evolution) => evolution.to_pokemon_id == null)
      ?? incoming[0];
    nextEdge = undefined;
    if (!edge || edge.from_species_id === null) break;

    pathEdges.push(edge);
    const sourceForm = edge.from_pokemon_id == null
      ? defaultForm(formsBySpecies[edge.from_species_id])
      : formsById.get(edge.from_pokemon_id);
    if (!sourceForm) break;
    currentForm = sourceForm;
  }

  return { forms, edges: pathEdges.reverse() };
}

/** The given species plus every species that evolves (directly or not) into one of them. */
function withAncestors(targets: Set<number>, evolutions: EvolutionEdge[]) {
  const result = new Set(targets);
  let changed = true;
  while (changed) {
    changed = false;
    for (const evolution of evolutions) {
      if (
        evolution.from_species_id !== null
        && result.has(evolution.to_species_id)
        && !result.has(evolution.from_species_id)
      ) {
        result.add(evolution.from_species_id);
        changed = true;
      }
    }
  }
  return result;
}

/**
 * Split one evolution chain into standard, regional, and explicitly form-specific
 * paths. Each card points at the matching form and evolution condition.
 */
export function buildLineages<E extends EvolutionEdge>(
  evolutions: E[],
  formsBySpecies: Record<number, EvolutionForm[]>,
  currentRegion: Region | null,
  currentFormId?: number,
): Array<Lineage<E>> {
  const speciesIds = new Set<number>();
  for (const evolution of evolutions) {
    if (evolution.from_species_id !== null) speciesIds.add(evolution.from_species_id);
    speciesIds.add(evolution.to_species_id);
  }

  const branchRegion = (speciesId: number): Region | null => {
    const name = defaultForm(formsBySpecies[speciesId])?.name;
    return name ? REGIONAL_ONLY[name] ?? null : null;
  };

  const regions = REGIONS.filter((region) =>
    [...speciesIds].some((speciesId) => regionForm(formsBySpecies[speciesId], region)));
  let keys: Array<Region | null> = [null, ...regions];
  if (currentRegion && keys.includes(currentRegion)) {
    keys = [currentRegion, ...keys.filter((key) => key !== currentRegion)];
  }

  const lineages = keys.map((region) => {
    let members: Set<number>;
    if (region === null) {
      members = new Set([...speciesIds].filter((speciesId) => branchRegion(speciesId) === null));
    } else {
      const targets = new Set(
        [...speciesIds].filter((speciesId) =>
          regionForm(formsBySpecies[speciesId], region) || branchRegion(speciesId) === region),
      );
      members = withAncestors(targets, evolutions);
    }

    const edges = evolutions.filter((evolution) =>
      evolution.from_species_id !== null
      && members.has(evolution.from_species_id)
      && members.has(evolution.to_species_id));

    const stages = evolutionStages(edges).map((stage) =>
      stage.map((speciesId): StageCard<E> => {
        const forms = formsBySpecies[speciesId];
        const form = region ? regionForm(forms, region) ?? defaultForm(forms) : defaultForm(forms);
        const incoming = edges.filter((edge) => edge.to_species_id === speciesId);
        const fromSpeciesId = incoming[0]?.from_species_id;
        const fromForms = fromSpeciesId === null || fromSpeciesId === undefined
          ? undefined
          : formsBySpecies[fromSpeciesId];
        const fromForm = region
          ? regionForm(fromForms, region) ?? defaultForm(fromForms)
          : defaultForm(fromForms);
        const resolvedEvolution = evolutionForForms(incoming, fromForm, form);
        return {
          speciesId,
          speciesName: defaultForm(forms)?.name ?? `species-${speciesId}`,
          form,
          evolution: resolvedEvolution.evolution,
          evolutionDetails: resolvedEvolution.details,
        };
      }));

    return {
      key: region ?? "standard",
      region,
      label: region ? REGION_LABELS[region] : "Standard",
      formIds: [...new Set(
        stages.flatMap((stage) => stage
          .map((card) => card.form)
          .filter((form): form is EvolutionForm => !!form && !form.is_default)
          .map((form) => form.id)),
      )],
      stages,
    };
  });

  const formsById = new Map(
    Object.values(formsBySpecies).flat().map((form) => [form.id, form]),
  );
  const formPathSeeds = evolutions.filter((evolution) => {
    const fromForm = evolution.from_pokemon_id == null
      ? undefined
      : formsById.get(evolution.from_pokemon_id);
    const toForm = evolution.to_pokemon_id == null
      ? undefined
      : formsById.get(evolution.to_pokemon_id);
    return (fromForm && !fromForm.is_default && !regionOf(fromForm.form_name))
      || (toForm && !toForm.is_default && !regionOf(toForm.form_name));
  });
  const seenFormPaths = new Set<string>();
  for (const seed of formPathSeeds) {
    const targetForm = seed.to_pokemon_id == null
      ? defaultForm(formsBySpecies[seed.to_species_id])
      : formsById.get(seed.to_pokemon_id);
    if (!targetForm || regionOf(targetForm.form_name)) continue;

    const path = formPathForTarget(targetForm, evolutions, formsBySpecies, formsById, seed);
    const nonDefaultForms = [...path.forms.values()].filter((form) => !form.is_default);
    const signature = nonDefaultForms.map((form) => form.id).sort((a, b) => a - b).join(",");
    if (!signature || seenFormPaths.has(signature)) continue;
    seenFormPaths.add(signature);

    const labelForm = nonDefaultForms.find((form) => form.id === targetForm.id)
      ?? nonDefaultForms[0];
    const stages = evolutionStages(path.edges).map((stage) =>
      stage.map((speciesId): StageCard<E> => {
        const form = path.forms.get(speciesId) ?? defaultForm(formsBySpecies[speciesId]);
        const incoming = path.edges.filter((edge) => edge.to_species_id === speciesId);
        const fromSpeciesId = incoming[0]?.from_species_id;
        const fromForm = fromSpeciesId == null
          ? undefined
          : path.forms.get(fromSpeciesId) ?? defaultForm(formsBySpecies[fromSpeciesId]);
        const resolvedEvolution = evolutionForForms(incoming, fromForm, form);
        return {
          speciesId,
          speciesName: defaultForm(formsBySpecies[speciesId])?.name ?? `species-${speciesId}`,
          form,
          evolution: resolvedEvolution.evolution,
          evolutionDetails: resolvedEvolution.details,
        };
      }));

    lineages.push({
      key: `form-${signature}`,
      region: null,
      label: formTag(labelForm),
      formIds: nonDefaultForms.map((form) => form.id),
      stages,
    });
  }

  const activeFormPath = currentFormId === undefined
    ? undefined
    : lineages.find((lineage) => lineage.formIds.includes(currentFormId));
  if (activeFormPath) {
    return [activeFormPath, ...lineages.filter((lineage) => lineage !== activeFormPath)];
  }
  if (currentRegion && keys.includes(currentRegion)) {
    const activeRegion = lineages.find((lineage) => lineage.region === currentRegion);
    if (activeRegion) {
      return [activeRegion, ...lineages.filter((lineage) => lineage !== activeRegion)];
    }
  }
  return lineages;
}

/** Alternate forms of the chain's species that are not already shown as a card. */
export function otherFormsByFamily<E extends EvolutionEdge>(
  formsBySpecies: Record<number, EvolutionForm[]>,
  lineages: Array<Lineage<E>>,
) {
  const shown = new Set<number>();
  const order: number[] = [];
  for (const lineage of lineages) {
    for (const stage of lineage.stages) {
      for (const card of stage) {
        if (card.form) shown.add(card.form.id);
        if (!order.includes(card.speciesId)) order.push(card.speciesId);
      }
    }
  }
  for (const key of Object.keys(formsBySpecies)) {
    const speciesId = Number(key);
    if (!order.includes(speciesId)) order.push(speciesId);
  }

  return order
    .map((speciesId) => ({
      speciesId,
      speciesName: defaultForm(formsBySpecies[speciesId])?.name ?? `species-${speciesId}`,
      forms: (formsBySpecies[speciesId] ?? []).filter((form) => !form.is_default && !shown.has(form.id)),
    }))
    .filter((group) => group.forms.length > 0);
}
