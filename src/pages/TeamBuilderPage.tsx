import { useEffect, useMemo, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { formatIdentifier } from "../lib/format";
import {
  analyzeTeam, calculateStats, exportShowdownTeam, parseShowdownTeams, STAT_KEYS,
  type BaseStats, type Nature, type ShowdownSet, type StatKey, type StatValues,
} from "../lib/teamBuilder";

type Team = { id: number; name: string; generation: number };
type Member = {
  id: number; slot: number; pokemon_id: number; nickname: string | null; level: number;
  nature_id: number | null; ability_id: number | null; item_id: number | null;
  ev_hp: number; ev_atk: number; ev_def: number; ev_spa: number; ev_spd: number; ev_spe: number;
  iv_hp: number; iv_atk: number; iv_def: number; iv_spa: number; iv_spd: number; iv_spe: number;
  moves: Array<number | null>;
};
type Pokemon = {
  id: number; dex_number: number; name: string; sprite_url: string | null;
  base_hp: number; base_atk: number; base_def: number; base_spa: number; base_spd: number; base_spe: number;
};
type Type = { id: number; name: string };
type Move = { id: number; name: string; type_id: number; damage_class: string; power: number | null };
type Named = { id: number; name: string };
type NatureRow = Named & Nature;

const GENERATIONS = [3, 4, 5, 6, 7, 8, 9];

function baseStats(mon: Pokemon): BaseStats {
  return { hp: mon.base_hp, atk: mon.base_atk, def: mon.base_def, spa: mon.base_spa, spd: mon.base_spd, spe: mon.base_spe };
}

function toIdentifier(value: string) {
  return value.toLowerCase().replace(/[.'’]/g, "").replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

export default function TeamBuilderPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamId, setTeamId] = useState<number | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [pokemon, setPokemon] = useState<Record<number, Pokemon>>({});
  const [types, setTypes] = useState<Type[]>([]);
  const [pokemonTypes, setPokemonTypes] = useState<Record<number, number[]>>({});
  const [chart, setChart] = useState<Map<string, number>>(new Map());
  const [natures, setNatures] = useState<NatureRow[]>([]);
  const [abilities, setAbilities] = useState<Named[]>([]);
  const [availableAbilityIds, setAvailableAbilityIds] = useState<number[]>([]);
  const [items, setItems] = useState<Named[]>([]);
  const [moves, setMoves] = useState<Record<number, Move>>({});
  const [activeMember, setActiveMember] = useState<number | null>(null);
  const [learnableMoves, setLearnableMoves] = useState<Move[]>([]);
  const [panel, setPanel] = useState<"build" | "analysis" | "import-export">("build");
  const [teamName, setTeamName] = useState("");
  const [pokemonSearch, setPokemonSearch] = useState("");
  const [pokemonResults, setPokemonResults] = useState<Pokemon[]>([]);
  const [showdownText, setShowdownText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const selectedTeam = teams.find((team) => team.id === teamId);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    let active = true;
    async function load() {
      try {
        const [teamResult, typeResult, chartResult, natureResult, abilityResult, itemResult] = await Promise.all([
          supabase!.from("team").select("id,name,generation").order("updated_at", { ascending: false }),
          supabase!.from("type").select("id,name").order("id"),
          supabase!.from("type_effectiveness").select("attacking_type_id,defending_type_id,multiplier"),
          supabase!.from("nature").select("id,name,increased_stat,decreased_stat").order("name"),
          supabase!.from("ability").select("id,name").order("name"),
          supabase!.from("item").select("id,name").order("name"),
        ]);
        if (!active) return;
        const failed = [teamResult, typeResult, chartResult, natureResult, abilityResult, itemResult].find((result) => result.error);
        if (failed?.error) throw failed.error;
        const loadedTeams = (teamResult.data ?? []) as Team[];
        setTeams(loadedTeams);
        setTeamId(loadedTeams[0]?.id ?? null);
        setTypes((typeResult.data ?? []) as Type[]);
        setNatures((natureResult.data ?? []) as NatureRow[]);
        setAbilities((abilityResult.data ?? []) as Named[]);
        setItems((itemResult.data ?? []) as Named[]);
        setChart(new Map((chartResult.data ?? []).map((row) => {
          const value = row as { attacking_type_id: number; defending_type_id: number; multiplier: number | string };
          return [`${value.attacking_type_id}:${value.defending_type_id}`, Number(value.multiplier)];
        })));
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "Could not load team builder data.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!supabase || teamId === null) { setMembers([]); setPokemon({}); setPokemonTypes({}); return; }
    let active = true;
    async function loadMembers() {
      try {
        const { data: memberRows, error: memberError } = await supabase!
          .from("team_member").select("*").eq("team_id", teamId).order("slot");
        if (memberError) throw memberError;
        const loaded = (memberRows ?? []).map((row) => ({ ...(row as Omit<Member, "moves">), moves: [] }));
        const ids = loaded.map((member) => member.pokemon_id);
        if (!ids.length) {
          if (active) {           setMembers([]); setPokemon({}); setPokemonTypes({}); setMoves({}); }
          return;
        }
        const memberIds = loaded.map((member) => member.id);
        const [pokemonResult, typeResult, moveRowsResult] = await Promise.all([
          supabase!.from("pokemon").select("id,dex_number,name,sprite_url,base_hp,base_atk,base_def,base_spa,base_spd,base_spe").in("id", ids),
          supabase!.from("pokemon_type").select("pokemon_id,type_id").in("pokemon_id", ids),
          supabase!.from("team_member_move").select("team_member_id,slot,move_id").in("team_member_id", memberIds).order("slot"),
        ]);
        const failure = [pokemonResult, typeResult, moveRowsResult].find((result) => result.error);
        if (failure?.error) throw failure.error;
        const loadedPokemon = (pokemonResult.data ?? []) as Pokemon[];
        const moveRows = (moveRowsResult.data ?? []) as Array<{ team_member_id: number; slot: number; move_id: number }>;
        const nextMembers = loaded.map((member) => ({
          ...member,
          moves: moveRows.filter((move) => move.team_member_id === member.id)
            .reduce<Array<number | null>>((slots, move) => {
              slots[move.slot - 1] = move.move_id;
              return slots;
            }, [null, null, null, null]),
        }));
        const moveIds = [...new Set(moveRows.map((row) => row.move_id))];
        let moveData: Move[] = [];
        if (moveIds.length) {
          const { data, error: moveError } = await supabase!.from("move").select("id,name,type_id,damage_class,power").in("id", moveIds);
          if (moveError) throw moveError;
          moveData = (data ?? []) as Move[];
        }
        if (!active) return;
        setMembers(nextMembers);
        setPokemon(Object.fromEntries(loadedPokemon.map((mon) => [mon.id, mon])));
        setPokemonTypes(Object.fromEntries(ids.map((id) => [
          id, ((typeResult.data ?? []) as Array<{ pokemon_id: number; type_id: number }>)
            .filter((row) => row.pokemon_id === id).map((row) => row.type_id),
        ])));
        setMoves(Object.fromEntries(moveData.map((move) => [move.id, move])));
        setActiveMember((current) => current && nextMembers.some((member) => member.id === current)
          ? current : nextMembers[0]?.id ?? null);
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "Could not load this team's Pokémon.");
      }
    }
    void loadMembers();
    return () => { active = false; };
  }, [teamId]);

  const selectedMember = members.find((member) => member.id === activeMember);
  const selectedPokemon = selectedMember ? pokemon[selectedMember.pokemon_id] : null;

  useEffect(() => {
    if (!supabase || !selectedMember || !selectedTeam) { setLearnableMoves([]); return; }
    let active = true;
    async function loadMoves() {
      const { data: learnset, error: learnsetError } = await supabase!
        .from("pokemon_move").select("move_id").eq("pokemon_id", selectedMember!.pokemon_id)
        .eq("generation", selectedTeam!.generation);
      if (learnsetError) { if (active) setError(learnsetError.message); return; }
      const ids = [...new Set((learnset ?? []).map((row) => (row as { move_id: number }).move_id))];
      if (!ids.length) { if (active) setLearnableMoves([]); return; }
      const { data, error: movesError } = await supabase!.from("move")
        .select("id,name,type_id,damage_class,power").in("id", ids).order("name");
      if (!active) return;
      if (movesError) setError(movesError.message);
      else setLearnableMoves((data ?? []) as Move[]);
    }
    void loadMoves();
    return () => { active = false; };
  }, [selectedMember?.id, selectedMember?.pokemon_id, selectedTeam?.generation]);

  useEffect(() => {
    if (!supabase || !selectedMember) { setAvailableAbilityIds([]); return; }
    let active = true;
    async function loadAbilities() {
      const { data, error: abilityError } = await supabase!.from("pokemon_ability")
        .select("ability_id").eq("pokemon_id", selectedMember!.pokemon_id);
      if (!active) return;
      if (abilityError) setError(abilityError.message);
      else setAvailableAbilityIds([...new Set((data ?? []).map((row) => (row as { ability_id: number }).ability_id))]);
    }
    void loadAbilities();
    return () => { active = false; };
  }, [selectedMember?.id, selectedMember?.pokemon_id]);

  useEffect(() => {
    if (panel === "import-export") setShowdownText(buildExport());
  }, [panel, members, pokemon, moves, natures, items, abilities]);

  function buildExport() {
    return exportShowdownTeam(members.map((member) => {
      const mon = pokemon[member.pokemon_id];
      const nature = natures.find((row) => row.id === member.nature_id);
      const ability = abilities.find((row) => row.id === member.ability_id);
      const item = items.find((row) => row.id === member.item_id);
      return {
        pokemon: mon?.name ?? "Unknown", nickname: member.nickname, item: item ? formatIdentifier(item.name) : null,
        ability: ability ? formatIdentifier(ability.name) : null, level: member.level,
        nature: nature ? formatIdentifier(nature.name) : null,
        evs: Object.fromEntries(STAT_KEYS.map((stat) => [stat, member[`ev_${stat}`]])) as StatValues,
        ivs: Object.fromEntries(STAT_KEYS.map((stat) => [stat, member[`iv_${stat}`]])) as StatValues,
        moves: member.moves.map((id) => id ? moves[id]?.name : undefined)
          .filter((name): name is string => Boolean(name)).map(formatIdentifier),
      };
    }));
  }

  async function createTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !teamName.trim()) return;
    setSaving(true); setError(null);
    try {
      const { data, error: insertError } = await supabase.from("team")
        .insert({ name: teamName.trim() }).select("id,name,generation").single();
      if (insertError) throw insertError;
      const team = data as Team;
      setTeams((current) => [team, ...current]); setTeamId(team.id); setTeamName("");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not create team.");
    } finally { setSaving(false); }
  }

  async function searchPokemon(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !pokemonSearch.trim()) return;
    setError(null);
    const term = pokemonSearch.trim().toLowerCase().replace(/\s+/g, "-");
    const { data, error: searchError } = await supabase.from("pokemon")
      .select("id,dex_number,name,sprite_url,base_hp,base_atk,base_def,base_spa,base_spd,base_spe")
      .eq("is_default", true).ilike("name", `%${term}%`).order("dex_number").limit(15);
    if (searchError) setError(searchError.message);
    else {
      setPokemonResults((data ?? []) as Pokemon[]);
      if (!data?.length) setError("No matching Pokémon found.");
    }
  }

  async function loadPokemonTypes(id: number) {
    if (pokemonTypes[id]) return pokemonTypes[id];
    const { data, error: queryError } = await supabase!.from("pokemon_type").select("type_id").eq("pokemon_id", id).order("slot");
    if (queryError) throw queryError;
    const result = (data ?? []).map((row) => (row as { type_id: number }).type_id);
    setPokemonTypes((current) => ({ ...current, [id]: result }));
    return result;
  }

  async function addPokemon(mon: Pokemon) {
    if (!supabase || teamId === null || members.length >= 6) return;
    setSaving(true); setError(null);
    try {
      const occupied = new Set(members.map((member) => member.slot));
      const slot = [1, 2, 3, 4, 5, 6].find((value) => !occupied.has(value)) ?? 1;
      const { data, error: insertError } = await supabase.from("team_member")
        .insert({ team_id: teamId, slot, pokemon_id: mon.id }).select("*").single();
      if (insertError) throw insertError;
      await loadPokemonTypes(mon.id);
      setPokemon((current) => ({ ...current, [mon.id]: mon }));
      setMembers((current) => [...current, { ...(data as Omit<Member, "moves">), moves: [null, null, null, null] }].sort((a, b) => a.slot - b.slot));
      setActiveMember((data as Member).id); setPokemonResults([]); setPokemonSearch("");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not add Pokémon.");
    } finally { setSaving(false); }
  }

  async function removeMember(member: Member) {
    if (!supabase) return;
    if (!window.confirm(`Remove ${formatIdentifier(pokemon[member.pokemon_id]?.name ?? "Pokémon")} from this team?`)) return;
    const { error: deleteError } = await supabase.from("team_member").delete().eq("id", member.id);
    if (deleteError) { setError(deleteError.message); return; }
    setMembers((current) => current.filter((entry) => entry.id !== member.id));
    if (activeMember === member.id) setActiveMember(members.find((entry) => entry.id !== member.id)?.id ?? null);
  }

  async function saveMember(member: Member) {
    if (!supabase) return;
    const { id, moves: _moves, ...values } = member;
    const { error: updateError } = await supabase.from("team_member").update(values).eq("id", id);
    if (updateError) setError(updateError.message);
  }

  function editMember(id: number, patch: Partial<Member>) {
    setMembers((current) => current.map((member) => member.id === id ? { ...member, ...patch } : member));
  }

  async function setMemberMove(member: Member, slot: number, moveId: number) {
    if (!supabase) return;
    const next = [...member.moves];
    next[slot] = moveId || null;
    if (moveId) {
      const { error: moveError } = await supabase.from("team_member_move")
        .upsert({ team_member_id: member.id, slot: slot + 1, move_id: moveId });
      if (moveError) { setError(moveError.message); return; }
      const selected = learnableMoves.find((move) => move.id === moveId);
      if (selected) setMoves((current) => ({ ...current, [selected.id]: selected }));
    } else {
      const { error: deleteError } = await supabase.from("team_member_move")
        .delete().eq("team_member_id", member.id).eq("slot", slot + 1);
      if (deleteError) { setError(deleteError.message); return; }
    }
    editMember(member.id, { moves: next });
  }

  async function changeGeneration(generation: number) {
    if (!supabase || !selectedTeam) return;
    setError(null);
    setMessage(null);
    const { error: updateError } = await supabase.from("team").update({ generation }).eq("id", selectedTeam.id);
    if (updateError) setError(updateError.message);
    else {
      setTeams((current) => current.map((team) => team.id === selectedTeam.id ? { ...team, generation } : team));
      if (!members.length) return;
      const { data, error: learnsetError } = await supabase.from("pokemon_move").select("pokemon_id,move_id")
        .in("pokemon_id", members.map((member) => member.pokemon_id)).eq("generation", generation);
      if (learnsetError) { setError(learnsetError.message); return; }
      const learned = new Set((data ?? []).map((row) => `${(row as { pokemon_id: number }).pokemon_id}:${(row as { move_id: number }).move_id}`));
      let removedCount = 0;
      const updates = members.map(async (member) => {
        const invalid = member.moves.map((id, slot) => ({ id, slot })).filter(({ id }) => id !== null
          && !learned.has(`${member.pokemon_id}:${id}`));
        if (!invalid.length) return;
        removedCount += invalid.length;
        for (const move of invalid) {
          const { error: deleteError } = await supabase!.from("team_member_move").delete()
            .eq("team_member_id", member.id).eq("slot", move.slot + 1);
          if (deleteError) throw deleteError;
        }
        editMember(member.id, { moves: member.moves.map((id) => id !== null
          && !learned.has(`${member.pokemon_id}:${id}`) ? null : id) });
      });
      try { await Promise.all(updates); }
      catch (moveError) { setError(moveError instanceof Error ? moveError.message : "Could not remove moves unavailable in this generation."); }
      if (removedCount) setMessage(`Removed ${removedCount} move${removedCount === 1 ? "" : "s"} not learnable in Gen ${generation}.`);
    }
  }

  async function importShowdown(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || teamId === null) return;
    let sets: ShowdownSet[];
    try { sets = parseShowdownTeams(showdownText); }
    catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : "Could not parse the Showdown text.");
      return;
    }
    if (!sets.length || sets.length + members.length > 6) {
      setError(`There are only ${6 - members.length} open team slots. Remove Pokémon or import fewer sets.`); return;
    }
    setSaving(true); setError(null); setMessage(null);
    const warnings: string[] = [];
    const currentMembers = [...members];
    try {
      for (const set of sets) {
        const identifier = toIdentifier(set.species);
        const { data: found, error: findError } = await supabase.from("pokemon")
          .select("id,dex_number,name,sprite_url,base_hp,base_atk,base_def,base_spa,base_spd,base_spe")
          .eq("is_default", true).ilike("name", identifier).limit(1).maybeSingle();
        if (findError) throw findError;
        if (!found) throw new Error(`Pokémon "${set.species}" was not found.`);
        const mon = found as Pokemon;
        const [nature, ability, item] = await Promise.all([
          set.nature ? supabase.from("nature").select("id").ilike("name", toIdentifier(set.nature)).maybeSingle() : Promise.resolve({ data: null, error: null }),
          set.ability ? supabase.from("ability").select("id").ilike("name", toIdentifier(set.ability)).maybeSingle() : Promise.resolve({ data: null, error: null }),
          set.item ? supabase.from("item").select("id").ilike("name", toIdentifier(set.item)).maybeSingle() : Promise.resolve({ data: null, error: null }),
        ]);
        const lookupFailure = [nature, ability, item].find((result) => result.error);
        if (lookupFailure?.error) throw lookupFailure.error;
        if (set.nature && !nature.data) warnings.push(`Unknown nature "${set.nature}" on ${set.name}.`);
        if (set.ability && !ability.data) warnings.push(`Unknown ability "${set.ability}" on ${set.name}.`);
        if (set.item && !item.data) warnings.push(`Unknown item "${set.item}" on ${set.name}.`);
        const occupied = new Set(currentMembers.map((member) => member.slot));
        const slot = [1, 2, 3, 4, 5, 6].find((value) => !occupied.has(value));
        if (slot === undefined) throw new Error("The team has no open slots.");
        const evs = Object.fromEntries(STAT_KEYS.map((stat) => [`ev_${stat}`, Math.min(252, Math.max(0, set.evs[stat] ?? 0))]));
        const ivs = Object.fromEntries(STAT_KEYS.map((stat) => [`iv_${stat}`, Math.min(31, Math.max(0, set.ivs[stat] ?? 31))]));
        const { data: inserted, error: insertError } = await supabase.from("team_member").insert({
          team_id: teamId, slot, pokemon_id: mon.id, nickname: set.name === set.species ? null : set.name,
          level: Math.min(100, Math.max(1, set.level)), nature_id: nature.data?.id ?? null,
          ability_id: ability.data?.id ?? null, item_id: item.data?.id ?? null, ...evs, ...ivs,
        }).select("*").single();
        if (insertError) throw insertError;
        const member: Member = { ...(inserted as Omit<Member, "moves">), moves: [null, null, null, null] };
        currentMembers.push(member);
        setPokemon((current) => ({ ...current, [mon.id]: mon }));
        await loadPokemonTypes(mon.id);
        const { data: learnset, error: learnError } = await supabase.from("pokemon_move").select("move_id")
          .eq("pokemon_id", mon.id).eq("generation", selectedTeam?.generation);
        if (learnError) throw learnError;
        const learnableIds = (learnset ?? []).map((row) => (row as { move_id: number }).move_id);
        const { data: candidates, error: moveError } = await supabase.from("move").select("id,name,type_id,damage_class,power").in("id", learnableIds);
        if (moveError) throw moveError;
        const normalized = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
        const byName = new Map(((candidates ?? []) as Move[]).map((move) => [normalized(move.name), move]));
        const selectedMoves = set.moves.map((name) => byName.get(normalized(name))).filter((move): move is Move => Boolean(move)).slice(0, 4);
        const skippedMoves = set.moves.filter((name) => !byName.has(normalized(name)));
        if (skippedMoves.length) warnings.push(`${set.name}: skipped unavailable moves ${skippedMoves.join(", ")}.`);
        if (selectedMoves.length) {
          const { error: addMovesError } = await supabase.from("team_member_move").insert(
            selectedMoves.map((move, moveIndex) => ({ team_member_id: member.id, slot: moveIndex + 1, move_id: move.id })),
          );
          if (addMovesError) throw addMovesError;
          selectedMoves.forEach((move, moveIndex) => { member.moves[moveIndex] = move.id; });
          setMoves((current) => ({ ...current, ...Object.fromEntries(selectedMoves.map((move) => [move.id, move])) }));
        }
      }
      setMembers(currentMembers.sort((a, b) => a.slot - b.slot));
      setActiveMember(currentMembers[currentMembers.length - 1]?.id ?? null);
      setMessage(`Imported ${sets.length} set${sets.length === 1 ? "" : "s"}.`
        + (warnings.length ? ` ${warnings.join(" ")}` : ""));
    } catch (importError) {
      setMembers(currentMembers.sort((a, b) => a.slot - b.slot));
      setActiveMember(currentMembers[currentMembers.length - 1]?.id ?? null);
      setError(importError instanceof Error ? importError.message : "Could not import team.");
    } finally { setSaving(false); }
  }

  const analysisMembers = useMemo(() => members.flatMap((member) => {
    const mon = pokemon[member.pokemon_id];
    if (!mon) return [];
    const nature = natures.find((row) => row.id === member.nature_id);
    const speed = calculateStats(baseStats(mon), member.level,
      Object.fromEntries(STAT_KEYS.map((stat) => [stat, member[`ev_${stat}`]])) as StatValues,
      Object.fromEntries(STAT_KEYS.map((stat) => [stat, member[`iv_${stat}`]])) as StatValues, nature ?? null).spe;
    return [{ name: member.nickname || formatIdentifier(mon.name), types: pokemonTypes[mon.id] ?? [], speed,
      moveTypes: member.moves.map((id) => id ? moves[id]?.type_id : undefined)
        .filter((id): id is number => id !== undefined) }];
  }), [members, pokemon, natures, pokemonTypes, moves]);
  const analysis = useMemo(() => analyzeTeam(analysisMembers, types.map((type) => type.id), chart),
    [analysisMembers, types, chart]);

  return (
    <main className="page">
      <section className="page-heading">
        <div><p className="eyebrow">Your roster</p><h1>Team builder</h1>
          <p className="muted">Build legal sets, compare matchups, and check final stats as you edit.</p></div>
        <span className="count-pill">{members.length} / 6 slots</span>
      </section>
      {error && <p className="notice error" role="alert">{error}</p>}
      {message && <p className="notice success" role="status">{message}</p>}
      <section className="team-workspace">
        <aside className="team-sidebar">
          <h2>Your teams</h2>
          {loading ? <p className="muted">Loading teams…</p> : teams.length === 0
            ? <p className="muted small-copy">No teams yet. Give your first lineup a name.</p>
            : <div className="team-list">{teams.map((team) => (
              <button aria-pressed={teamId === team.id}
                className={`team-list-item${teamId === team.id ? " selected" : ""}`} key={team.id}
                onClick={() => { setError(null); setTeamId(team.id); }}>
                <span>{team.name}</span><span aria-hidden="true">→</span>
              </button>
            ))}</div>}
          <form className="create-team-form" onSubmit={createTeam}>
            <label htmlFor="team-name">Start a new team</label>
            <input id="team-name" maxLength={60} onChange={(event) => setTeamName(event.target.value)}
              placeholder="e.g. Kanto favorites" required value={teamName} />
            <button className="button primary full" disabled={saving} type="submit">Create team</button>
          </form>
        </aside>
        <section className="roster-panel">
          {selectedTeam ? <>
            <div className="roster-heading">
              <div><p className="eyebrow">Generation {selectedTeam.generation}</p><h2>{selectedTeam.name}</h2></div>
              <label className="generation-control">Move generation
                <select aria-label="Move generation" value={selectedTeam.generation}
                  onChange={(event) => void changeGeneration(Number(event.target.value))}>
                  {GENERATIONS.map((generation) => <option key={generation} value={generation}>Gen {generation}</option>)}
                </select>
              </label>
            </div>
            <div className="team-tabs" role="tablist" aria-label="Team sections">
              {([["build", "Build"], ["analysis", "Analysis"], ["import-export", "Import / Export"]] as const).map(([key, label]) =>
                <button aria-selected={panel === key} className={panel === key ? "active" : ""}
                  key={key} onClick={() => setPanel(key)} role="tab">{label}</button>)}
            </div>
            {panel === "build" ? <>
              <div className="roster-grid">
                {Array.from({ length: 6 }, (_, index) => {
                  const member = members.find((entry) => entry.slot === index + 1);
                  const mon = member ? pokemon[member.pokemon_id] : null;
                  return <article className={`roster-slot${member ? " filled" : ""}${member?.id === activeMember ? " active-slot" : ""}`}
                    aria-label={member ? `Edit ${member.nickname || formatIdentifier(mon?.name ?? "Pokémon")}, slot ${index + 1}` : `Open team slot ${index + 1}`}
                    aria-pressed={member ? member.id === activeMember : undefined}
                    key={index} onClick={() => member && setActiveMember(member.id)}
                    onKeyDown={(event) => {
                      if (member && (event.key === "Enter" || event.key === " ")) {
                        event.preventDefault();
                        setActiveMember(member.id);
                      }
                    }} role={member ? "button" : undefined} tabIndex={member ? 0 : undefined}>
                    <span className="slot-number">0{index + 1}</span>
                    {member && mon ? <>
                      {mon.sprite_url && <img alt="" src={mon.sprite_url} />}
                      <h3>{member.nickname || formatIdentifier(mon.name)}</h3>
                      <p>#{String(mon.dex_number).padStart(3, "0")} · Lv. {member.level}</p>
                    </> : <><span className="slot-plus">+</span><p>Open slot</p></>}
                  </article>;
                })}
              </div>
              {members.length < 6 && <div className="add-pokemon">
                <h3>Add a Pokémon</h3>
                <form className="search-row" onSubmit={searchPokemon}>
                  <input aria-label="Search Pokémon" onChange={(event) => setPokemonSearch(event.target.value)}
                    placeholder="Search by name" value={pokemonSearch} />
                  <button className="button secondary" type="submit">Find</button>
                </form>
                {pokemonResults.length > 0 && <div className="pokemon-results">{pokemonResults.map((mon) =>
                  <button className="pokemon-result" disabled={saving} key={mon.id} onClick={() => void addPokemon(mon)}>
                    {mon.sprite_url && <img alt="" src={mon.sprite_url} />}
                    <span>{formatIdentifier(mon.name)}</span><span className="result-number">#{mon.dex_number}</span>
                  </button>)}</div>}
              </div>}
              {selectedMember && selectedPokemon && <section className="member-editor" aria-label={`${selectedPokemon.name} set editor`}>
                <div className="editor-title">
                  <div><p className="eyebrow">Set editor · slot {selectedMember.slot}</p>
                    <h3>{selectedMember.nickname || formatIdentifier(selectedPokemon.name)}</h3></div>
                  <button className="text-button" onClick={() => void removeMember(selectedMember)} type="button">Remove</button>
                </div>
                <div className="editor-fields">
                  <label>Nickname<input maxLength={30} onBlur={() => void saveMember(selectedMember)}
                    onChange={(event) => editMember(selectedMember.id, { nickname: event.target.value || null })}
                    placeholder={formatIdentifier(selectedPokemon.name)} value={selectedMember.nickname ?? ""} /></label>
                  <label>Level<input max={100} min={1} onBlur={() => void saveMember(selectedMember)}
                    onChange={(event) => editMember(selectedMember.id, { level: Math.min(100, Math.max(1, Number(event.target.value) || 1)) })}
                    type="number" value={selectedMember.level} /></label>
                  <label>Nature<select value={selectedMember.nature_id ?? ""} onChange={(event) => {
                    const member = { ...selectedMember, nature_id: event.target.value ? Number(event.target.value) : null };
                    editMember(member.id, { nature_id: member.nature_id }); void saveMember(member);
                  }}><option value="">Hardy (neutral)</option>{natures.map((nature) =>
                    <option key={nature.id} value={nature.id}>{formatIdentifier(nature.name)}</option>)}</select></label>
                  <label>Ability<select value={selectedMember.ability_id ?? ""} onChange={(event) => {
                    const member = { ...selectedMember, ability_id: event.target.value ? Number(event.target.value) : null };
                    editMember(member.id, { ability_id: member.ability_id }); void saveMember(member);
                  }}><option value="">Choose ability</option>{abilities.filter((ability) => availableAbilityIds.includes(ability.id)).map((ability) =>
                    <option key={ability.id} value={ability.id}>{formatIdentifier(ability.name)}</option>)}</select></label>
                  <label>Held item<select value={selectedMember.item_id ?? ""} onChange={(event) => {
                    const member = { ...selectedMember, item_id: event.target.value ? Number(event.target.value) : null };
                    editMember(member.id, { item_id: member.item_id }); void saveMember(member);
                  }}><option value="">No item</option>{items.map((item) =>
                    <option key={item.id} value={item.id}>{formatIdentifier(item.name)}</option>)}</select></label>
                </div>
                <div className="stats-editor">
                  <h4>Final stats</h4>
                  <div className="stat-table">
                    <span>Stat</span><span>Base</span><span>EVs</span><span>IVs</span><span>Final</span>
                    {STAT_KEYS.map((stat) => <StatRow key={stat} stat={stat} member={selectedMember}
                      pokemon={selectedPokemon} onChange={(field, value) => editMember(selectedMember.id, { [field]: value })}
                      onBlur={() => void saveMember(selectedMember)}
                      nature={natures.find((nature) => nature.id === selectedMember.nature_id) ?? null} />)}
                  </div>
                  <p className="muted small-copy">EVs: {STAT_KEYS.reduce((sum, stat) => sum + selectedMember[`ev_${stat}`], 0)} / 510</p>
                </div>
                <div className="move-editor"><h4>Moves · learnable in Gen {selectedTeam.generation}</h4>
                  <div className="move-grid">{Array.from({ length: 4 }, (_, index) =>
                    <label key={index}>Move {index + 1}<select aria-label={`Move ${index + 1}`}
                      value={selectedMember.moves[index] ?? ""} onChange={(event) =>
                        void setMemberMove(selectedMember, index, Number(event.target.value))}>
                      <option value="">— Empty —</option>{learnableMoves.map((move) =>
                        <option key={move.id} value={move.id}>{formatIdentifier(move.name)} · {formatIdentifier(move.damage_class)}</option>)}
                    </select></label>)}</div>
                </div>
              </section>}
            </> : panel === "analysis" ? <TeamAnalysis analysis={analysis} types={types} members={members}
              pokemon={pokemon} pokemonTypes={pokemonTypes} chart={chart} natures={natures} /> : <section className="showdown-panel">
                <h3>Showdown-style team text</h3>
                <p className="muted small-copy">Import sets into open slots. Moves unavailable to that Pokémon in the selected generation are skipped.</p>
                <form onSubmit={importShowdown}>
                  <textarea aria-label="Showdown team text" onChange={(event) => setShowdownText(event.target.value)}
                    placeholder={"Pikachu @ Light Ball\nAbility: Static\nLevel: 50\nTimid Nature\nEVs: 4 HP / 252 SpA / 252 Spe\n- Thunderbolt\n- Volt Switch"} value={showdownText} />
                  <div className="showdown-actions">
                    <button className="button primary" disabled={saving} type="submit">Import sets</button>
                    <button className="button secondary" onClick={() => setShowdownText(buildExport())} type="button">Refresh export</button>
                  </div>
                </form>
              </section>}
          </> : <div className="empty-state team-empty"><span className="empty-icon">✳</span>
            <h2>Your next team starts here</h2><p>Create a team to save your first lineup.</p></div>}
        </section>
      </section>
    </main>
  );
}

function StatRow({ stat, member, pokemon, nature, onChange, onBlur }: {
  stat: StatKey; member: Member; pokemon: Pokemon; nature: Nature | null;
  onChange: (field: keyof Member, value: number) => void; onBlur: () => void;
}) {
  const evField = `ev_${stat}` as const;
  const ivField = `iv_${stat}` as const;
  const evs = Object.fromEntries(STAT_KEYS.map((key) => [key, member[`ev_${key}`]])) as StatValues;
  const ivs = Object.fromEntries(STAT_KEYS.map((key) => [key, member[`iv_${key}`]])) as StatValues;
  const maxEV = Math.min(252, member[evField] + 510 - STAT_KEYS.reduce((sum, key) => sum + member[`ev_${key}`], 0));
  const finalStats = calculateStats(baseStats(pokemon), member.level, evs, ivs, nature);
  return <><strong>{stat.toUpperCase()}</strong><span>{baseStats(pokemon)[stat]}</span>
    <input aria-label={`${stat.toUpperCase()} EVs`} max={maxEV}
      min={0} onBlur={onBlur} onChange={(event) => onChange(evField, Math.min(maxEV, Math.max(0, Number(event.target.value) || 0)))}
      type="number" value={member[evField]} />
    <input aria-label={`${stat.toUpperCase()} IVs`} max={31} min={0} onBlur={onBlur}
      onChange={(event) => onChange(ivField, Math.min(31, Math.max(0, Number(event.target.value) || 0)))}
      type="number" value={member[ivField]} /><strong>{finalStats[stat]}</strong></>;
}

function TeamAnalysis({ analysis, types, members, pokemon, pokemonTypes, chart, natures }: {
  analysis: ReturnType<typeof analyzeTeam>; types: Type[]; members: Member[]; pokemon: Record<number, Pokemon>;
  pokemonTypes: Record<number, number[]>; chart: Map<string, number>; natures: NatureRow[];
}) {
  const typeName = (id: number) => formatIdentifier(types.find((type) => type.id === id)?.name ?? "Unknown");
  const defenses = analysis.defenses.filter((entry) => entry.weak || entry.resist);
  return <section className="analysis-panel">
    <div className="analysis-grid">
      <article className="analysis-card"><h3>Move coverage</h3><p className="muted small-copy">Types hit super-effectively by your selected moves.</p>
        <div className="type-chip-list">{analysis.coverage.map((id) => <span className="type-chip" key={id}>{typeName(id)}</span>)}
          {!analysis.coverage.length && <span className="muted">Add moves to see coverage.</span>}</div></article>
      <article className="analysis-card"><h3>Shared weaknesses & resistances</h3>
        {defenses.map((entry) => <div className="defense-row" key={entry.typeId}>
          <strong>{typeName(entry.typeId)}</strong><span>{entry.weak} weak</span><span>{entry.resist} resist</span>
        </div>)}
      </article>
      <article className="analysis-card"><h3>Team loses to</h3><p className="muted small-copy">Attacking types that hit multiple team members super-effectively.</p>
        {analysis.threats.length ? analysis.threats.map((entry) => <div className="defense-row" key={entry.typeId}>
          <strong>{typeName(entry.typeId)}</strong><span>{entry.weak} members weak</span></div>) : <p className="muted">No shared type threats identified.</p>}</article>
      <article className="analysis-card"><h3>Speed comparison</h3>
        {analysis.speeds.map((entry) => <div className="speed-row" key={entry.name}>
          <span>{entry.name}</span><div className="speed-track"><i style={{ width: `${Math.min(100, entry.speed / 3)}%` }} /></div><strong>{entry.speed}</strong>
        </div>)}
      </article>
    </div>
    <div className="analysis-card team-resistances"><h3>Defensive matchups by Pokémon</h3>
      {!members.length && <p className="muted">Add Pokémon to analyze your team.</p>}
      {members.map((member) => {
        const mon = pokemon[member.pokemon_id];
        if (!mon) return null;
        const weak = types.filter((type) => typeMultiplierForTeam(type.id, pokemonTypes[mon.id] ?? [], chart) > 1);
        const speed = calculateStats(baseStats(mon), member.level,
          Object.fromEntries(STAT_KEYS.map((stat) => [stat, member[`ev_${stat}`]])) as StatValues,
          Object.fromEntries(STAT_KEYS.map((stat) => [stat, member[`iv_${stat}`]])) as StatValues,
          natures.find((nature) => nature.id === member.nature_id) ?? null).spe;
        return <p className="member-matchup" key={member.id}>
          <strong>{member.nickname || formatIdentifier(mon.name)}</strong> · {speed} Spe
          <span>{weak.map((type) => type.name).map(formatIdentifier).join(", ") || "No weaknesses"}</span>
        </p>;
      })}
    </div>
  </section>;
}

function typeMultiplierForTeam(attack: number, defenses: number[], chart: Map<string, number>) {
  return defenses.reduce((value, defense) => value * (chart.get(`${attack}:${defense}`) ?? 1), 1);
}
