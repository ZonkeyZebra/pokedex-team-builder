import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { formatIdentifier } from "../lib/format";

type Team = {
  id: number;
  name: string;
  generation: number;
};

type TeamMember = {
  slot: number;
  pokemon_id: number;
};

type PokemonOption = {
  id: number;
  dex_number: number;
  name: string;
  sprite_url: string | null;
};

export default function TeamBuilderPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [pokemonById, setPokemonById] = useState<Record<number, PokemonOption>>({});
  const [teamName, setTeamName] = useState("");
  const [pokemonSearch, setPokemonSearch] = useState("");
  const [pokemonResults, setPokemonResults] = useState<PokemonOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    async function loadTeams() {
      try {
        const { data, error: queryError } = await supabase!
          .from("team")
          .select("id,name,generation")
          .order("updated_at", { ascending: false });
        if (!active) return;
        if (queryError) {
          setError(queryError.message);
        } else {
          const loadedTeams = (data ?? []) as Team[];
          setTeams(loadedTeams);
          setSelectedTeamId((current) => current ?? loadedTeams[0]?.id ?? null);
        }
      } catch (requestError) {
        if (active) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Could not load teams.",
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadTeams();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!supabase || selectedTeamId === null) {
      setMembers([]);
      setPokemonById({});
      return;
    }
    let active = true;
    async function loadMembers() {
      try {
        const { data, error: memberError } = await supabase!
          .from("team_member")
          .select("slot,pokemon_id")
          .eq("team_id", selectedTeamId)
          .order("slot");
        if (!active) return;
        if (memberError) {
          setError(memberError.message);
          return;
        }
        const loadedMembers = (data ?? []) as TeamMember[];
        setMembers(loadedMembers);
        if (loadedMembers.length) {
          const { data: pokemonData, error: pokemonError } = await supabase!
            .from("pokemon")
            .select("id,dex_number,name,sprite_url")
            .in("id", loadedMembers.map((member) => member.pokemon_id));
          if (!active) return;
          if (pokemonError) {
            setError(pokemonError.message);
          } else {
            setPokemonById(
              Object.fromEntries(((pokemonData ?? []) as PokemonOption[]).map((mon) => [mon.id, mon])),
            );
          }
        } else {
          setPokemonById({});
        }
      } catch (requestError) {
        if (active) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Could not load this team's Pokémon.",
          );
        }
      }
    }
    void loadMembers();
    return () => { active = false; };
  }, [selectedTeamId]);

  async function handleCreateTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !teamName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const { data, error: insertError } = await supabase
        .from("team")
        .insert({ name: teamName.trim() })
        .select("id,name,generation")
        .single();
      if (insertError) {
        setError(insertError.message);
      } else {
        const newTeam = data as Team;
        setTeams((current) => [newTeam, ...current]);
        setSelectedTeamId(newTeam.id);
        setTeamName("");
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Could not create team.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handlePokemonSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !pokemonSearch.trim()) return;
    setError(null);
    setPokemonResults([]);
    const identifier = pokemonSearch.trim().toLowerCase().replace(/\s+/g, "-");
    try {
      const { data, error: searchError } = await supabase
        .from("pokemon")
        .select("id,dex_number,name,sprite_url")
        .eq("is_default", true)
        .ilike("name", `%${identifier}%`)
        .order("dex_number")
        .limit(12);
      if (searchError) {
        setError(searchError.message);
      } else {
        setPokemonResults((data ?? []) as PokemonOption[]);
        if (!data?.length) setError("No matching Pokémon found. Try another name.");
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not search Pokémon.",
      );
    }
  }

  async function handleAddPokemon(mon: PokemonOption) {
    if (!supabase || selectedTeamId === null || members.length >= 6) return;
    setSaving(true);
    setError(null);
    try {
      const { error: insertError } = await supabase.from("team_member").insert({
        team_id: selectedTeamId,
        slot: members.length + 1,
        pokemon_id: mon.id,
      });
      if (insertError) {
        setError(insertError.message);
      } else {
        setMembers((current) => [...current, {
          slot: current.length + 1,
          pokemon_id: mon.id,
        }]);
        setPokemonById((current) => ({ ...current, [mon.id]: mon }));
        setPokemonResults([]);
        setPokemonSearch("");
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not add Pokémon to team.",
      );
    } finally {
      setSaving(false);
    }
  }

  const selectedTeam = teams.find((team) => team.id === selectedTeamId);

  return (
    <main className="page">
      <section className="page-heading">
        <div>
          <p className="eyebrow">Your roster</p>
          <h1>Team builder</h1>
          <p className="muted">Create a team and start filling its six slots.</p>
        </div>
        <span className="count-pill">{members.length} / 6 slots</span>
      </section>

      {error && <p className="notice error" role="alert">{error}</p>}
      <section className="team-workspace">
        <aside className="team-sidebar">
          <h2>Your teams</h2>
          {loading ? <p className="muted">Loading teams…</p> : teams.length === 0 ? (
            <p className="muted small-copy">No teams yet. Give your first lineup a name.</p>
          ) : (
            <div className="team-list">
              {teams.map((team) => (
                <button
                  aria-pressed={selectedTeamId === team.id}
                  className={`team-list-item${selectedTeamId === team.id ? " selected" : ""}`}
                  key={team.id}
                  onClick={() => { setError(null); setSelectedTeamId(team.id); }}
                >
                  <span>{team.name}</span><span aria-hidden="true">→</span>
                </button>
              ))}
            </div>
          )}
          <form className="create-team-form" onSubmit={handleCreateTeam}>
            <label htmlFor="team-name">Start a new team</label>
            <input
              id="team-name"
              maxLength={60}
              onChange={(event) => setTeamName(event.target.value)}
              placeholder="e.g. Kanto favorites"
              required
              value={teamName}
            />
            <button className="button primary full" disabled={saving} type="submit">Create team</button>
          </form>
        </aside>

        <section className="roster-panel">
          {selectedTeam ? (
            <>
              <div className="roster-heading">
                <div><p className="eyebrow">Generation {selectedTeam.generation}</p><h2>{selectedTeam.name}</h2></div>
                <span className="count-pill">{members.length} / 6</span>
              </div>
              <div className="roster-grid">
                {Array.from({ length: 6 }, (_, index) => {
                  const member = members[index];
                  const mon = member ? pokemonById[member.pokemon_id] : null;
                  return (
                    <article className={`roster-slot${member ? " filled" : ""}`} key={index}>
                      <span className="slot-number">0{index + 1}</span>
                      {member && mon ? (
                        <>
                          {mon.sprite_url && <img alt="" src={mon.sprite_url} />}
                          <h3>{formatIdentifier(mon.name)}</h3>
                          <p>#{String(mon.dex_number).padStart(3, "0")}</p>
                        </>
                      ) : (
                        <><span className="slot-plus">+</span><p>Open slot</p></>
                      )}
                    </article>
                  );
                })}
              </div>
              {members.length < 6 && (
                <div className="add-pokemon">
                  <h3>Add a Pokémon</h3>
                  <form className="search-row" onSubmit={handlePokemonSearch}>
                    <input
                      onChange={(event) => setPokemonSearch(event.target.value)}
                      placeholder="Search by name"
                      value={pokemonSearch}
                    />
                    <button className="button secondary" type="submit">Find</button>
                  </form>
                  {pokemonResults.length > 0 && (
                    <div className="pokemon-results">
                      {pokemonResults.map((mon) => (
                        <button
                          className="pokemon-result"
                          disabled={saving}
                          key={mon.id}
                          onClick={() => void handleAddPokemon(mon)}
                        >
                          {mon.sprite_url && <img alt="" src={mon.sprite_url} />}
                          <span>{formatIdentifier(mon.name)}</span>
                          <span className="result-number">#{mon.dex_number}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="empty-state team-empty">
              <span className="empty-icon">✳</span>
              <h2>Your next team starts here</h2>
              <p>Create a team to save your first lineup. Pokémon will be available after you seed the database.</p>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
