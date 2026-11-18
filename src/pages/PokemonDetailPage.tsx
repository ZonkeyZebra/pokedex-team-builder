import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { formatIdentifier } from "../lib/format";
import { supabase } from "../lib/supabase";

type Pokemon = {
  id: number;
  dex_number: number;
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
  description: string | null;
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
type PokemonDetail = {
  pokemon: Pokemon;
  types: TypeRow[];
  abilities: Array<PokemonAbilityRow & { ability: Ability }>;
  moves: MoveDetail[];
  encounters: EncounterDetail[];
  encounterCount: number;
  matchups: Matchup[];
};

const ENCOUNTER_PAGE_SIZE = 12;

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

export default function PokemonDetailPage() {
  const { pokemonId } = useParams();
  const id = Number(pokemonId);
  const [detail, setDetail] = useState<PokemonDetail | null>(null);
  const [moveGeneration, setMoveGeneration] = useState(9);
  const [moveMethod, setMoveMethod] = useState("all");
  const [encounterGame, setEncounterGame] = useState("");
  const [encounterPage, setEncounterPage] = useState(0);
  const [encounters, setEncounters] = useState<EncounterDetail[]>([]);
  const [encounterCount, setEncounterCount] = useState(0);
  const [encounterGames, setEncounterGames] = useState<VersionGroup[]>([]);
  const [encounterLoading, setEncounterLoading] = useState(false);
  const [encounterError, setEncounterError] = useState<string | null>(null);
  const [artMode, setArtMode] = useState<"artwork" | "sprite">("artwork");
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
          .select("id,dex_number,name,form_name,is_default,generation,height_dm,weight_hg,base_hp,base_atk,base_def,base_spa,base_spd,base_spe,sprite_url,artwork_url,description")
          .eq("id", id)
          .maybeSingle();
        if (pokemonError) throw pokemonError;
        if (!pokemonData) {
          if (active) setError("That Pokémon could not be found.");
          return;
        }
        const pokemon = pokemonData as Pokemon;

        const [pokemonTypesResult, pokemonAbilitiesResult, learnsetResult, typeCatalogResult] =
          await Promise.all([
            supabase!.from("pokemon_type").select("type_id,slot").eq("pokemon_id", id).order("slot"),
            supabase!.from("pokemon_ability").select("ability_id,slot,is_hidden").eq("pokemon_id", id).order("slot"),
            supabase!.from("pokemon_move").select("move_id,learn_method,level_learned").eq("pokemon_id", id).eq("generation", moveGeneration).order("level_learned").limit(300),
            supabase!.from("type").select("id,name").order("id"),
          ]);

        const baseError = pokemonTypesResult.error
          ?? pokemonAbilitiesResult.error
          ?? learnsetResult.error
          ?? typeCatalogResult.error;
        if (baseError) throw baseError;

        const pokemonTypes = (pokemonTypesResult.data ?? []) as PokemonTypeRow[];
        const pokemonAbilities = (pokemonAbilitiesResult.data ?? []) as PokemonAbilityRow[];
        const learnset = (learnsetResult.data ?? []) as LearnsetRow[];
        const typeCatalog = (typeCatalogResult.data ?? []) as TypeRow[];
        const typeIds = pokemonTypes.map((row) => row.type_id);
        const abilityIds = [...new Set(pokemonAbilities.map((row) => row.ability_id))];
        const moveIds = [...new Set(learnset.map((row) => row.move_id))];

        const [effectiveness, abilities, moves] = await Promise.all([
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
          encounters: [],
          encounterCount: 0,
          matchups,
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

  const visibleMoves = detail?.moves.filter(
    (row) => moveMethod === "all" || row.learn_method === moveMethod,
  ) ?? [];
  const pokemon = detail?.pokemon;
  const artUrl = artMode === "artwork"
    ? pokemon?.artwork_url ?? pokemon?.sprite_url
    : pokemon?.sprite_url ?? pokemon?.artwork_url;

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
        {!loading && detail && (
          <>
            <section className="detail-hero">
              <div className="detail-art-panel">
                <div className="detail-art-glow" aria-hidden="true" />
                {artUrl && <img alt={formatIdentifier(pokemon!.name)} src={artUrl} />}
                <div className="art-switcher" aria-label="Pokémon artwork">
                  <button
                    aria-pressed={artMode === "artwork"}
                    className={artMode === "artwork" ? "active" : ""}
                    onClick={() => setArtMode("artwork")}
                  >Artwork</button>
                  <button
                    aria-pressed={artMode === "sprite"}
                    className={artMode === "sprite" ? "active" : ""}
                    onClick={() => setArtMode("sprite")}
                  >Sprite</button>
                </div>
              </div>
              <div className="detail-identity">
                <p className="detail-dex">#{String(pokemon!.dex_number).padStart(4, "0")}</p>
                <h1>{formatIdentifier(pokemon!.name)}</h1>
                {pokemon!.form_name && <p className="detail-form">{formatIdentifier(pokemon!.form_name)} form</p>}
                <div className="detail-type-badges">
                  {detail.types.map((type) => (
                    <span className={`type-badge type-${type.name}`} key={type.id}>{formatIdentifier(type.name)}</span>
                  ))}
                </div>
                <p className="detail-generation">Introduced in Generation {pokemon!.generation}</p>
                <p className="detail-description">
                  {pokemon!.description ?? "No Pokédex description is available for this Pokémon."}
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
              </div>
            </section>

            <section className="detail-facts" aria-label="Physical details">
              <div><span>Height</span><strong>{formatMeasure(pokemon!.height_dm, 10, "m")}</strong></div>
              <div><span>Weight</span><strong>{formatMeasure(pokemon!.weight_hg, 10, "kg")}</strong></div>
              <div><span>Form</span><strong>{pokemon!.form_name ? formatIdentifier(pokemon!.form_name) : "Default"}</strong></div>
            </section>

            <section className="detail-section">
              <div className="detail-section-heading">
                <div><p className="detail-kicker">At a glance</p><h2>Base stats</h2></div>
                <span className="detail-total">Total {STAT_FIELDS.reduce((sum, stat) => sum + pokemon![stat.field], 0)}</span>
              </div>
              <div className="stats-panel">
                {STAT_FIELDS.map((stat) => {
                  const value = pokemon![stat.field];
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

            <section className="detail-section detail-columns">
              <div>
                <div className="detail-section-heading">
                  <div><p className="detail-kicker">Defending matchups</p><h2>Type effectiveness</h2></div>
                </div>
                <div className="matchup-panel">
                  {MATCHUP_ORDER.map((multiplier) => {
                    const types = detail.matchups.filter((matchup) => matchup.multiplier === multiplier);
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
                  {!detail.matchups.length && <p className="detail-muted">No matchup data available.</p>}
                </div>
              </div>
              <div className="detail-data-note">
                <p className="detail-kicker">Species data</p>
                <h2>More to discover</h2>
                <p>Evolution chains, capture rates, and egg groups aren’t included in the current database seed.</p>
              </div>
            </section>

            <section className="detail-section">
              <div className="detail-section-heading move-heading">
                <div><p className="detail-kicker">Learnset</p><h2>Moves <span>{detail.moves.length}</span></h2></div>
                <div className="move-filters">
                  <label>
                    <span className="visually-hidden">Move generation</span>
                    <select value={moveGeneration} onChange={(event) => setMoveGeneration(Number(event.target.value))}>
                      {Array.from({ length: 9 }, (_, index) => 9 - index).map((generation) => (
                        <option key={generation} value={generation}>Generation {generation}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className="visually-hidden">Learn method</span>
                    <select value={moveMethod} onChange={(event) => setMoveMethod(event.target.value)}>
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
                <div className="detail-table-wrap">
                  <table className="detail-table">
                    <thead><tr><th>Name</th><th>Type</th><th>Power</th><th>Accuracy</th><th>Method</th><th>Level</th></tr></thead>
                    <tbody>
                      {visibleMoves.map((row) => (
                        <tr key={`${row.move_id}-${row.learn_method}`}>
                          <td>{formatIdentifier(row.move.name)}</td>
                          <td><span className={`type-badge compact type-${row.type_name}`}>{formatIdentifier(row.type_name)}</span></td>
                          <td>{row.move.power ?? "—"}</td>
                          <td>{row.move.accuracy === null ? "—" : `${row.move.accuracy}%`}</td>
                          <td>{learnMethodLabel(row.learn_method)}</td>
                          <td>{row.learn_method === "level-up" && row.level_learned > 0 ? row.level_learned : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="detail-empty">No moves are listed for this Pokémon in Generation {moveGeneration}.</div>
              )}
            </section>

            <section className="detail-section">
              <div className="detail-section-heading">
                <div><p className="detail-kicker">Where to find it</p><h2>Wild locations <span>{encounterCount}</span></h2></div>
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
          </>
        )}
      </div>
    </main>
  );
}
