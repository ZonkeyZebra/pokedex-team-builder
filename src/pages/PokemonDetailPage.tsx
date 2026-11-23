import { useEffect, useState, type KeyboardEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { formatIdentifier } from "../lib/format";
import { supabase } from "../lib/supabase";
import EvolutionChain from "../components/EvolutionChain";
import { groupFormsBySpecies, type EvolutionForm } from "../lib/evolutionForms";

type Pokemon = {
  id: number;
  dex_number: number;
  species_id: number;
  evolution_chain_id: number | null;
  name: string;
  form_name: string | null;
  is_default: boolean;
  generation: number;
  height_dm: number | null;
  weight_hg: number | null;
  base_hp: number;
  base_atk: number;
  base_def: number;
  base_spa: number;
  base_spd: number;
  base_spe: number;
  sprite_url: string | null;
  artwork_url: string | null;
  shiny_sprite_url: string | null;
  shiny_artwork_url: string | null;
  description: string | null;
  capture_rate: number | null;
  base_happiness: number | null;
  hatch_counter: number | null;
  gender_rate: number | null;
  growth_rate: string | null;
  color: string | null;
  shape: string | null;
  habitat: string | null;
  genus: string | null;
  is_baby: boolean;
  is_legendary: boolean;
  is_mythical: boolean;
};

type TypeRow = { id: number; name: string };
type PokemonTypeRow = { type_id: number; slot: number };
type PokemonAbilityRow = { ability_id: number; slot: number; is_hidden: boolean };
type Ability = { id: number; name: string; description: string | null };
type LearnsetRow = { move_id: number; learn_method: string; level_learned: number };
type Move = {
  id: number;
  name: string;
  type_id: number;
  damage_class: string;
  power: number | null;
  accuracy: number | null;
};
type TypeEffectiveness = {
  attacking_type_id: number;
  defending_type_id: number;
  multiplier: number | string;
};
type Encounter = {
  id: number;
  version_group_id: number;
  location_name: string;
  method: string | null;
  min_level: number | null;
  max_level: number | null;
  chance: number | null;
};
type VersionGroup = { id: number; name: string; generation: number };
type MoveDetail = LearnsetRow & { move: Move; type_name: string };
type EncounterDetail = Encounter & { version_group: VersionGroup | null };
type Matchup = { name: string; multiplier: number };
type PokemonForm = Pick<Pokemon, "id" | "name" | "form_name" | "is_default" | "sprite_url" | "shiny_sprite_url">;
type EggGroup = { id: number; name: string };
// type EvolutionSpecies = { id: number; species_id: number; name: string; sprite_url: string | null };
type Evolution = {
  from_species_id: number | null;
  to_species_id: number;
  from_pokemon_id: number | null;
  to_pokemon_id: number | null;
  trigger: string;
  trigger_item: string | null;
  minimum_level: number | null;
  minimum_happiness: number | null;
  minimum_beauty: number | null;
  minimum_affection: number | null;
  gender: string | null;
  time_of_day: string | null;
  held_item: string | null;
  location: string | null;
  trade_species_id: number | null;
  needs_overworld_rain: boolean;
  turn_upside_down: boolean;
  details: string | null;
};
type PokemonDetail = {
  pokemon: Pokemon;
  types: TypeRow[];
  abilities: Array<PokemonAbilityRow & { ability: Ability }>;
  moves: MoveDetail[];
  matchups: Matchup[];
  offensiveMatchups: Matchup[];
  forms: PokemonForm[];
  eggGroups: EggGroup[];
  evolutions: Evolution[];
  evolutionForms: Record<number, EvolutionForm[]>;
};

type TabId = "overview" | "moves" | "locations" | "species";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "moves", label: "Moves" },
  { id: "locations", label: "Locations" },
  { id: "species", label: "Species data" },
];

const ENCOUNTER_PAGE_SIZE = 12;
const MOVE_PAGE_SIZE = 20;

const STAT_FIELDS = [
  { label: "HP", field: "base_hp" },
  { label: "Attack", field: "base_atk" },
  { label: "Defense", field: "base_def" },
  { label: "Sp. Atk", field: "base_spa" },
  { label: "Sp. Def", field: "base_spd" },
  { label: "Speed", field: "base_spe" },
] as const;

const MATCHUP_ORDER = [4, 2, 0.5, 0.25, 0];

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Could not load Pokémon details.";
}

function formatMultiplier(value: number) {
  return `${value}×`;
}

function formatMeasure(value: number | null, divisor: number, unit: string) {
  return value === null ? "—" : `${(value / divisor).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${unit}`;
}

function learnMethodLabel(method: string) {
  const labels: Record<string, string> = {
    "level-up": "Level up",
    machine: "TM / HM",
    egg: "Egg",
    tutor: "Tutor",
  };
  return labels[method] ?? formatIdentifier(method);
}

function formLabel(form: PokemonForm) {
  return form.is_default ? "Default" : formatIdentifier(form.form_name ?? form.name);
}

function MatchupList({ matchups }: { matchups: Matchup[] }) {
  return (
    <div className="matchup-panel">
      {MATCHUP_ORDER.map((multiplier) => {
        const types = matchups.filter((matchup) => matchup.multiplier === multiplier);
        return types.length ? (
          <div className="matchup-row" key={multiplier}>
            <strong>{formatMultiplier(multiplier)}</strong>
            <div>
              {types.map((matchup) => (
                <span className={`matchup-type type-${matchup.name}`} key={matchup.name}>
                  {formatIdentifier(matchup.name)}
                </span>
              ))}
            </div>
          </div>
        ) : null;
      })}
      {!matchups.length && <p className="detail-muted">No matchup data available.</p>}
    </div>
  );
}

export default function PokemonDetailPage() {
  const { pokemonId } = useParams();
  const id = Number(pokemonId);
  const [detail, setDetail] = useState<PokemonDetail | null>(null);
  const [tab, setTab] = useState<TabId>("overview");
  const [moveGeneration, setMoveGeneration] = useState(9);
  const [moveMethod, setMoveMethod] = useState("all");
  const [moveLimit, setMoveLimit] = useState(MOVE_PAGE_SIZE);
  const [encounterGame, setEncounterGame] = useState("");
  const [encounterPage, setEncounterPage] = useState(0);
  const [encounters, setEncounters] = useState<EncounterDetail[]>([]);
  const [encounterCount, setEncounterCount] = useState(0);
  const [encounterGames, setEncounterGames] = useState<VersionGroup[]>([]);
  const [encounterLoading, setEncounterLoading] = useState(false);
  const [encounterError, setEncounterError] = useState<string | null>(null);
  const [artMode, setArtMode] = useState<"artwork" | "sprite">("artwork");
  const [shiny, setShiny] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    if (!Number.isInteger(id) || id < 1) {
      setLoading(false);
      setError("That Pokémon could not be found.");
      return;
    }

    let active = true;
    async function loadDetails() {
      setLoading(true);
      setError(null);
      try {
        const { data: pokemonData, error: pokemonError } = await supabase!
          .from("pokemon")
          .select("id,dex_number,species_id,evolution_chain_id,name,form_name,is_default,generation,height_dm,weight_hg,base_hp,base_atk,base_def,base_spa,base_spd,base_spe,sprite_url,artwork_url,shiny_sprite_url,shiny_artwork_url,description,capture_rate,base_happiness,hatch_counter,gender_rate,growth_rate,color,shape,habitat,genus,is_baby,is_legendary,is_mythical")
          .eq("id", id)
          .maybeSingle();
        if (pokemonError) throw pokemonError;
        if (!pokemonData) {
          if (active) setError("That Pokémon could not be found.");
          return;
        }
        const pokemon = pokemonData as Pokemon;

        const [pokemonTypesResult, pokemonAbilitiesResult, learnsetResult, typeCatalogResult, formResult, eggResult, evolutionResult] =
          await Promise.all([
            supabase!.from("pokemon_type").select("type_id,slot").eq("pokemon_id", id).order("slot"),
            supabase!.from("pokemon_ability").select("ability_id,slot,is_hidden").eq("pokemon_id", id).order("slot"),
            supabase!.from("pokemon_move").select("move_id,learn_method,level_learned").eq("pokemon_id", id).eq("generation", moveGeneration).order("level_learned").limit(300),
            supabase!.from("type").select("id,name").order("id"),
            supabase!.from("pokemon").select("id,name,form_name,is_default,sprite_url,shiny_sprite_url").eq("species_id", pokemon.species_id).order("id"),
            supabase!.from("pokemon_egg_group").select("egg_group_id").eq("species_id", pokemon.species_id),
            pokemon.evolution_chain_id
              ? supabase!.from("pokemon_evolution").select("from_species_id,to_species_id,from_pokemon_id,to_pokemon_id,trigger,trigger_item,minimum_level,minimum_happiness,minimum_beauty,minimum_affection,gender,time_of_day,held_item,location,trade_species_id,needs_overworld_rain,turn_upside_down,details").eq("evolution_chain_id", pokemon.evolution_chain_id)
              : Promise.resolve({ data: [], error: null }),
          ]);

        const baseError = pokemonTypesResult.error
          ?? pokemonAbilitiesResult.error
          ?? learnsetResult.error
          ?? typeCatalogResult.error
          ?? formResult.error
          ?? eggResult.error
          ?? evolutionResult.error;
        if (baseError) throw baseError;

        const pokemonTypes = (pokemonTypesResult.data ?? []) as PokemonTypeRow[];
        const pokemonAbilities = (pokemonAbilitiesResult.data ?? []) as PokemonAbilityRow[];
        const learnset = (learnsetResult.data ?? []) as LearnsetRow[];
        const typeCatalog = (typeCatalogResult.data ?? []) as TypeRow[];
        const typeIds = pokemonTypes.map((row) => row.type_id);
        const abilityIds = [...new Set(pokemonAbilities.map((row) => row.ability_id))];
        const moveIds = [...new Set(learnset.map((row) => row.move_id))];

        const eggIds = ((eggResult.data ?? []) as Array<{ egg_group_id: number }>).map((row) => row.egg_group_id);
        const [effectiveness, offensiveEffectiveness, abilities, moves, eggGroups] = await Promise.all([
          (async () => {
            if (!typeIds.length) return [] as TypeEffectiveness[];
            const { data, error: queryError } = await supabase!
              .from("type_effectiveness")
              .select("attacking_type_id,defending_type_id,multiplier")
              .in("defending_type_id", typeIds);
            if (queryError) throw queryError;
            return (data ?? []) as TypeEffectiveness[];
          })(),
          (async () => {
            if (!typeIds.length) return [] as TypeEffectiveness[];
            const { data, error: queryError } = await supabase!
              .from("type_effectiveness")
              .select("attacking_type_id,defending_type_id,multiplier")
              .in("attacking_type_id", typeIds);
            if (queryError) throw queryError;
            return (data ?? []) as TypeEffectiveness[];
          })(),
          (async () => {
            if (!abilityIds.length) return [] as Ability[];
            const { data, error: queryError } = await supabase!
              .from("ability")
              .select("id,name,description")
              .in("id", abilityIds);
            if (queryError) throw queryError;
            return (data ?? []) as Ability[];
          })(),
          (async () => {
            if (!moveIds.length) return [] as Move[];
            const { data, error: queryError } = await supabase!
              .from("move")
              .select("id,name,type_id,damage_class,power,accuracy")
              .in("id", moveIds);
            if (queryError) throw queryError;
            return (data ?? []) as Move[];
          })(),
          (async () => {
            if (!eggIds.length) return [] as EggGroup[];
            const { data, error: queryError } = await supabase!
              .from("egg_group")
              .select("id,name")
              .in("id", eggIds);
            if (queryError) throw queryError;
            return (data ?? []) as EggGroup[];
          })(),
        ]);

        const typeById = new Map(typeCatalog.map((type) => [type.id, type]));
        const abilityById = new Map(abilities.map((ability) => [ability.id, ability]));
        const moveById = new Map(moves.map((move) => [move.id, move]));
        const multiplierByAttacker = new Map<number, number>();

        for (const row of effectiveness) {
          multiplierByAttacker.set(
            row.attacking_type_id,
            (multiplierByAttacker.get(row.attacking_type_id) ?? 1) * Number(row.multiplier),
          );
        }

        const matchups = [...multiplierByAttacker]
          .filter(([, multiplier]) => multiplier !== 1)
          .map(([attackingTypeId, multiplier]) => ({
            name: typeById.get(attackingTypeId)?.name ?? "unknown",
            multiplier,
          }))
          .sort((a, b) => MATCHUP_ORDER.indexOf(a.multiplier) - MATCHUP_ORDER.indexOf(b.multiplier));

        const offensiveByDefender = new Map<number, number>();
        for (const row of offensiveEffectiveness) {
          offensiveByDefender.set(
            row.defending_type_id,
            (offensiveByDefender.get(row.defending_type_id) ?? 1) * Number(row.multiplier),
          );
        }
        const offensiveMatchups = [...offensiveByDefender]
          .filter(([, multiplier]) => multiplier !== 1)
          .map(([defendingTypeId, multiplier]) => ({
            name: typeById.get(defendingTypeId)?.name ?? "unknown",
            multiplier,
          }))
          .sort((a, b) => MATCHUP_ORDER.indexOf(a.multiplier) - MATCHUP_ORDER.indexOf(b.multiplier));

        const detailedMoves = learnset.flatMap((row) => {
          const move = moveById.get(row.move_id);
          if (!move) return [];
          return [{
            ...row,
            move,
            type_name: typeById.get(move.type_id)?.name ?? "unknown",
          }];
        });
        const detailedAbilities = pokemonAbilities.flatMap((row) => {
          const ability = abilityById.get(row.ability_id);
          return ability ? [{ ...row, ability }] : [];
        });
        const forms = (formResult.data ?? []) as PokemonForm[];
        const evolutions = (evolutionResult.data ?? []) as Evolution[];
        const evolutionSpeciesIds = [...new Set(
          evolutions.flatMap((evolution) => [
            evolution.from_species_id,
            evolution.to_species_id,
          ].filter((speciesId): speciesId is number => speciesId !== null)),
        )];

        let evolutionForms: Record<number, EvolutionForm[]> = {};
        if (evolutionSpeciesIds.length) {
          const { data: formRows, error: formsError } = await supabase!
            .from("pokemon")
            .select("id,species_id,name,form_name,is_default,sprite_url,shiny_sprite_url")
            .in("species_id", evolutionSpeciesIds)
            .order("id");
          if (formsError) throw formsError;
          evolutionForms = groupFormsBySpecies((formRows ?? []) as EvolutionForm[]);
        }
        if (!active) return;
        setDetail({
          pokemon,
          types: pokemonTypes
            .flatMap((row) => {
              const type = typeById.get(row.type_id);
              return type ? [type] : [];
            })
            .sort((a, b) => pokemonTypes.findIndex((row) => row.type_id === a.id) - pokemonTypes.findIndex((row) => row.type_id === b.id)),
          abilities: detailedAbilities,
          moves: detailedMoves,
          matchups,
          offensiveMatchups,
          forms,
          eggGroups,
          evolutions,
          evolutionForms,
        });
      } catch (requestError) {
        if (active) setError(getErrorMessage(requestError));
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadDetails();
    return () => { active = false; };
  }, [id, moveGeneration]);

  useEffect(() => {
    setShiny(false);
    setMoveLimit(MOVE_PAGE_SIZE);
  }, [id]);

  useEffect(() => {
    setEncounterGame("");
    setEncounterPage(0);
    setEncounters([]);
    setEncounterCount(0);
    setEncounterGames([]);
  }, [id]);

  useEffect(() => {
    if (!supabase || !Number.isInteger(id) || id < 1) return;

    let active = true;
    async function loadEncounterGames() {
      try {
        const { data: groups, error: groupsError } = await supabase!
          .from("version_group")
          .select("id,name,generation")
          .order("generation")
          .order("name");
        if (groupsError) throw groupsError;
        if (active) setEncounterGames((groups ?? []) as VersionGroup[]);
      } catch (requestError) {
        if (active) setEncounterError(getErrorMessage(requestError));
      }
    }

    void loadEncounterGames();
    return () => { active = false; };
  }, [id]);

  useEffect(() => {
    if (!supabase || !Number.isInteger(id) || id < 1) return;

    let active = true;
    async function loadEncounters() {
      setEncounterLoading(true);
      setEncounterError(null);
      try {
        let query = supabase!
          .from("encounter")
          .select("id,version_group_id,location_name,method,min_level,max_level,chance", { count: "exact" })
          .eq("pokemon_id", id)
          .order("location_name")
          .order("id")
          .range(encounterPage * ENCOUNTER_PAGE_SIZE, (encounterPage + 1) * ENCOUNTER_PAGE_SIZE - 1);

        if (encounterGame) {
          query = query.eq("version_group_id", Number(encounterGame));
        }

        const { data, count, error: queryError } = await query;
        if (queryError) throw queryError;

        const rows = (data ?? []) as Encounter[];
        const versionGroupIds = [...new Set(rows.map((row) => row.version_group_id))];
        let versionGroupById = new Map(encounterGames.map((group) => [group.id, group]));

        const missingIds = versionGroupIds.filter((versionGroupId) => !versionGroupById.has(versionGroupId));
        if (missingIds.length) {
          const { data: groups, error: groupsError } = await supabase!
            .from("version_group")
            .select("id,name,generation")
            .in("id", missingIds);
          if (groupsError) throw groupsError;
          versionGroupById = new Map([
            ...versionGroupById,
            ...((groups ?? []) as VersionGroup[]).map((group) => [group.id, group] as const),
          ]);
        }

        if (active) {
          setEncounters(rows.map((row) => ({
            ...row,
            version_group: versionGroupById.get(row.version_group_id) ?? null,
          })));
          setEncounterCount(count ?? 0);
        }
      } catch (requestError) {
        if (active) setEncounterError(getErrorMessage(requestError));
      } finally {
        if (active) setEncounterLoading(false);
      }
    }

    void loadEncounters();
    return () => { active = false; };
  }, [id, encounterGame, encounterPage, encounterGames]);

  function handleTabKeys(event: KeyboardEvent<HTMLDivElement>) {
    const index = TABS.findIndex((item) => item.id === tab);
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % TABS.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = TABS.length - 1;
    else return;
    event.preventDefault();
    setTab(TABS[next].id);
    document.getElementById(`pd-tab-${TABS[next].id}`)?.focus();
  }

  const filteredMoves = detail?.moves.filter(
    (row) => moveMethod === "all" || row.learn_method === moveMethod,
  ) ?? [];
  const visibleMoves = filteredMoves.slice(0, moveLimit);
  const pokemon = detail?.pokemon;
  const artUrl = shiny
    ? (artMode === "artwork"
      ? pokemon?.shiny_artwork_url ?? pokemon?.artwork_url ?? pokemon?.shiny_sprite_url ?? pokemon?.sprite_url
      : pokemon?.shiny_sprite_url ?? pokemon?.sprite_url ?? pokemon?.shiny_artwork_url ?? pokemon?.artwork_url)
    : (artMode === "artwork"
      ? pokemon?.artwork_url ?? pokemon?.sprite_url
      : pokemon?.sprite_url ?? pokemon?.artwork_url);

  return (
    <main className="pokemon-detail-page">
      <div className="detail-container">
        <Link className="detail-back" to="/pokedex">← Back to Pokédex</Link>
        {loading && <div className="detail-status">Loading Pokémon details…</div>}
        {!loading && error && (
          <div className="detail-status detail-error" role="alert">
            <p>{error}</p>
            <Link className="button secondary" to="/pokedex">Return to Pokédex</Link>
          </div>
        )}
        {!loading && detail && pokemon && (
          <div className="pd-layout">
            <aside className="pd-side">
              <div className={`pd-art${artMode === "sprite" ? " sprite" : ""}`}>
                {artUrl && <img alt={formatIdentifier(pokemon.name)} src={artUrl} />}
              </div>

              <div>
                <p className="pd-label" id="pd-image-label">Image</p>
                <div aria-labelledby="pd-image-label" className="pd-seg" role="group">
                  <button
                    aria-pressed={artMode === "artwork"}
                    className={artMode === "artwork" ? "active" : ""}
                    onClick={() => setArtMode("artwork")}
                    type="button"
                  >Artwork</button>
                  <button
                    aria-pressed={artMode === "sprite"}
                    className={artMode === "sprite" ? "active" : ""}
                    onClick={() => setArtMode("sprite")}
                    type="button"
                  >Pixel sprite</button>
                </div>
              </div>

              <div>
                <p className="pd-label" id="pd-color-label">Color</p>
                <div aria-labelledby="pd-color-label" className="pd-seg" role="group">
                  <button
                    aria-pressed={!shiny}
                    className={!shiny ? "active" : ""}
                    onClick={() => setShiny(false)}
                    type="button"
                  >Normal</button>
                  <button
                    aria-pressed={shiny}
                    className={shiny ? "active" : ""}
                    onClick={() => setShiny(true)}
                    type="button"
                  >Shiny ✦</button>
                </div>
              </div>

              {detail.forms.length > 1 && (
                <div>
                  <p className="pd-label" id="pd-forms-label">Forms</p>
                  <nav aria-labelledby="pd-forms-label" className="pd-forms">
                    {detail.forms.map((form) => (
                      <Link
                        aria-current={form.id === pokemon.id ? "page" : undefined}
                        className={form.id === pokemon.id ? "active" : ""}
                        key={form.id}
                        to={`/pokedex/${form.id}`}
                      >
                        {form.sprite_url && (
                          <img alt="" src={shiny ? form.shiny_sprite_url ?? form.sprite_url : form.sprite_url} />
                        )}
                        <span>{formLabel(form)}</span>
                      </Link>
                    ))}
                  </nav>
                </div>
              )}

              <div>
                <p className="pd-label">Quick facts</p>
                <dl className="pd-facts">
                  <div><dt>Height</dt><dd>{formatMeasure(pokemon.height_dm, 10, "m")}</dd></div>
                  <div><dt>Weight</dt><dd>{formatMeasure(pokemon.weight_hg, 10, "kg")}</dd></div>
                  <div><dt>Introduced</dt><dd>Generation {pokemon.generation}</dd></div>
                  <div>
                    <dt>Egg groups</dt>
                    <dd>{detail.eggGroups.length ? detail.eggGroups.map((group) => formatIdentifier(group.name)).join(", ") : "—"}</dd>
                  </div>
                </dl>
              </div>
            </aside>

            <div className="pd-main">
              <header className="detail-identity">
                <p className="detail-dex">#{String(pokemon.dex_number).padStart(4, "0")}</p>
                <h1>{formatIdentifier(pokemon.name)}</h1>
                {pokemon.form_name && <p className="detail-form">{formatIdentifier(pokemon.form_name)} form</p>}
                <div className="detail-type-badges">
                  {detail.types.map((type) => (
                    <span className={`type-badge type-${type.name}`} key={type.id}>{formatIdentifier(type.name)}</span>
                  ))}
                </div>
                {!pokemon.is_default && (
                  <p className="pd-banner">
                    <strong>Viewing the {formatIdentifier(pokemon.form_name ?? pokemon.name)} form.</strong>{" "}
                    Stats, types, abilities and matchups reflect this form.
                  </p>
                )}
              </header>

              <div aria-label="Pokémon sections" className="pd-tabs" onKeyDown={handleTabKeys} role="tablist">
                {TABS.map((item) => (
                  <button
                    aria-controls={`pd-panel-${item.id}`}
                    aria-selected={tab === item.id}
                    className={tab === item.id ? "active" : ""}
                    id={`pd-tab-${item.id}`}
                    key={item.id}
                    onClick={() => setTab(item.id)}
                    role="tab"
                    tabIndex={tab === item.id ? 0 : -1}
                    type="button"
                  >{item.label}</button>
                ))}
              </div>

              {tab === "overview" && (
                <div aria-labelledby="pd-tab-overview" id="pd-panel-overview" role="tabpanel">
                  <section className="pd-section">
                    <p className="detail-description">
                      {pokemon.description ?? "No Pokédex description is available for this Pokémon."}
                    </p>
                    <div className="detail-abilities">
                      <h2>Abilities</h2>
                      {detail.abilities.length ? detail.abilities.map((entry) => (
                        <div className="ability-item" key={entry.ability_id}>
                          <div>
                            <strong>{formatIdentifier(entry.ability.name)}</strong>
                            {entry.is_hidden && <span className="hidden-ability">Hidden</span>}
                          </div>
                          {entry.ability.description && <p>{entry.ability.description}</p>}
                        </div>
                      )) : <p className="detail-muted">No ability data available.</p>}
                    </div>
                  </section>

                  <section className="pd-section">
                    <h2>Evolution</h2>
                    {detail.evolutions.length ? (
                      <EvolutionChain
                        current={pokemon}
                        evolutions={detail.evolutions}
                        formsBySpecies={detail.evolutionForms}
                        shiny={shiny}
                      />
                    ) : (
                      <div className="detail-empty">This Pokémon does not evolve.</div>
                    )}
                  </section>

                  <section className="pd-section">
                    <div className="detail-section-heading">
                      <h2>Base stats</h2>
                      <span className="detail-total">Total {STAT_FIELDS.reduce((sum, stat) => sum + pokemon[stat.field], 0)}</span>
                    </div>
                    <div className="stats-panel">
                      {STAT_FIELDS.map((stat) => {
                        const value = pokemon[stat.field];
                        return (
                          <div className="stat-row" key={stat.field}>
                            <span className="stat-label">{stat.label}</span>
                            <strong>{value}</strong>
                            <div className="stat-track"><span style={{ width: `${Math.min(100, value / 180 * 100)}%` }} /></div>
                          </div>
                        );
                      })}
                    </div>
                  </section>

                  <section className="pd-section detail-columns">
                    <div>
                      <h2>Weak to and resists</h2>
                      <MatchupList matchups={detail.matchups} />
                    </div>
                    <div>
                      <h2>Hits well against</h2>
                      <MatchupList matchups={detail.offensiveMatchups} />
                    </div>
                  </section>
                </div>
              )}

              {tab === "moves" && (
                <section aria-labelledby="pd-tab-moves" className="pd-section" id="pd-panel-moves" role="tabpanel">
                  <div className="detail-section-heading move-heading">
                    <h2>Moves <span>{filteredMoves.length}</span></h2>
                    <div className="move-filters">
                      <label>
                        <span className="visually-hidden">Move generation</span>
                        <select
                          value={moveGeneration}
                          onChange={(event) => {
                            setMoveGeneration(Number(event.target.value));
                            setMoveLimit(MOVE_PAGE_SIZE);
                          }}
                        >
                          {Array.from({ length: 9 }, (_, index) => 9 - index).map((generation) => (
                            <option key={generation} value={generation}>Generation {generation}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span className="visually-hidden">Learn method</span>
                        <select
                          value={moveMethod}
                          onChange={(event) => {
                            setMoveMethod(event.target.value);
                            setMoveLimit(MOVE_PAGE_SIZE);
                          }}
                        >
                          <option value="all">All methods</option>
                          <option value="level-up">Level up</option>
                          <option value="machine">TM / HM</option>
                          <option value="egg">Egg</option>
                          <option value="tutor">Tutor</option>
                        </select>
                      </label>
                    </div>
                  </div>
                  {visibleMoves.length ? (
                    <>
                      <div className="detail-table-wrap pd-unbounded">
                        <table className="detail-table">
                          <thead><tr><th>Name</th><th>Type</th><th>Power</th><th>Accuracy</th><th>Method</th><th>Level</th></tr></thead>
                          <tbody>
                            {visibleMoves.map((row) => (
                              <tr key={`${row.move_id}-${row.learn_method}`}>
                                <td>{formatIdentifier(row.move.name)}</td>
                                <td><span className={`type-badge compact type-${row.type_name}`}>{formatIdentifier(row.type_name)}</span></td>
                                <td data-label="Power">{row.move.power ?? "—"}</td>
                                <td data-label="Acc.">{row.move.accuracy === null ? "—" : `${row.move.accuracy}%`}</td>
                                <td>{learnMethodLabel(row.learn_method)}</td>
                                <td data-label="Level">{row.learn_method === "level-up" && row.level_learned > 0 ? row.level_learned : "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="pd-more">
                        <span>Showing {visibleMoves.length} of {filteredMoves.length}</span>
                        {visibleMoves.length < filteredMoves.length && (
                          <button
                            className="button secondary"
                            onClick={() => setMoveLimit((limit) => limit + MOVE_PAGE_SIZE)}
                            type="button"
                          >
                            Show {Math.min(MOVE_PAGE_SIZE, filteredMoves.length - visibleMoves.length)} more
                          </button>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="detail-empty">No moves are listed for this Pokémon in Generation {moveGeneration}.</div>
                  )}
                </section>
              )}

              {tab === "locations" && (
                <section aria-labelledby="pd-tab-locations" className="pd-section" id="pd-panel-locations" role="tabpanel">
                  <div className="detail-section-heading">
                    <h2>Wild locations <span>{encounterCount}</span></h2>
                    {encounterGames.length > 0 && (
                      <label className="location-game-filter">
                        <span className="visually-hidden">Filter locations by game</span>
                        <select
                          value={encounterGame}
                          onChange={(event) => {
                            setEncounterGame(event.target.value);
                            setEncounterPage(0);
                          }}
                        >
                          <option value="">All games</option>
                          {encounterGames.map((group) => (
                            <option key={group.id} value={group.id}>
                              {formatIdentifier(group.name)}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                  {encounterError && <p className="notice error" role="alert">{encounterError}</p>}
                  {encounterLoading ? (
                    <div className="detail-empty">Loading locations…</div>
                  ) : encounters.length ? (
                    <div className="detail-table-wrap">
                      <table className="detail-table location-table">
                        <thead><tr><th>Location</th><th>Game</th><th>Method</th><th>Levels</th><th>Chance</th></tr></thead>
                        <tbody>
                          {encounters.map((row) => (
                            <tr key={row.id}>
                              <td>{formatIdentifier(row.location_name)}</td>
                              <td>{row.version_group ? formatIdentifier(row.version_group.name) : "—"}</td>
                              <td>{row.method ? formatIdentifier(row.method) : "—"}</td>
                              <td>{row.min_level === null ? "—" : `${row.min_level}${row.max_level !== null && row.max_level !== row.min_level ? `–${row.max_level}` : ""}`}</td>
                              <td>{row.chance === null ? "—" : `${row.chance}%`}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="location-pagination">
                        <button
                          className="button secondary"
                          disabled={encounterPage === 0}
                          onClick={() => setEncounterPage((page) => Math.max(0, page - 1))}
                          type="button"
                        >
                          Previous
                        </button>
                        <span>
                          Page {encounterPage + 1} of {Math.max(1, Math.ceil(encounterCount / ENCOUNTER_PAGE_SIZE))}
                          {" · "}Showing {encounters.length} of {encounterCount}
                        </span>
                        <button
                          className="button secondary"
                          disabled={(encounterPage + 1) * ENCOUNTER_PAGE_SIZE >= encounterCount}
                          onClick={() => setEncounterPage((page) => page + 1)}
                          type="button"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="detail-empty">No wild location data is available for this Pokémon.</div>
                  )}
                </section>
              )}

              {tab === "species" && (
                <section aria-labelledby="pd-tab-species" className="pd-section" id="pd-panel-species" role="tabpanel">
                  <h2>{pokemon.genus ?? "Pokémon species"}</h2>
                  <div className="species-facts">
                    <div><span>Capture rate</span><strong>{pokemon.capture_rate ?? "—"}</strong></div>
                    <div><span>Base happiness</span><strong>{pokemon.base_happiness ?? "—"}</strong></div>
                    <div><span>Growth rate</span><strong>{pokemon.growth_rate ? formatIdentifier(pokemon.growth_rate) : "—"}</strong></div>
                    <div><span>Egg cycles</span><strong>{pokemon.hatch_counter ?? "—"}</strong></div>
                    <div><span>Egg groups</span><strong>{detail.eggGroups.length ? detail.eggGroups.map((group) => formatIdentifier(group.name)).join(", ") : "—"}</strong></div>
                    <div><span>Gender</span><strong>{pokemon.gender_rate === null
                      ? "—"
                      : pokemon.gender_rate === -1
                        ? "Gender unknown"
                        : `${100 - pokemon.gender_rate * 12.5}% Male / ${pokemon.gender_rate * 12.5}% Female`}</strong></div>
                    <div><span>Color</span><strong>{pokemon.color ? formatIdentifier(pokemon.color) : "—"}</strong></div>
                    <div><span>Shape</span><strong>{pokemon.shape ? formatIdentifier(pokemon.shape) : "—"}</strong></div>
                    <div><span>Habitat</span><strong>{pokemon.habitat ? formatIdentifier(pokemon.habitat) : "—"}</strong></div>
                  </div>
                </section>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
