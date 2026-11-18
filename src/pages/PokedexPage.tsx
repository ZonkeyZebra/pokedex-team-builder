import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { formatIdentifier } from "../lib/format";

type Pokemon = {
  id: number;
  dex_number: number;
  name: string;
  generation: number;
  sprite_url: string | null;
  base_hp: number;
  base_atk: number;
  base_def: number;
  base_spa: number;
  base_spd: number;
  base_spe: number;
};

const PAGE_SIZE = 24;

export default function PokedexPage() {
  const [pokemon, setPokemon] = useState<Pokemon[]>([]);
  const [search, setSearch] = useState("");
  const [generation, setGeneration] = useState("");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    async function loadPokemon() {
      setLoading(true);
      setError(null);
      try {
        let query = supabase!
          .from("pokemon")
          .select(
            "id,dex_number,name,generation,sprite_url,base_hp,base_atk,base_def,base_spa,base_spd,base_spe",
            { count: "exact" },
          )
          .eq("is_default", true)
          .order("dex_number", { ascending: true })
          .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

        const trimmedSearch = search.trim();
        if (trimmedSearch) {
          query = query.ilike("name", `%${trimmedSearch.toLowerCase().replace(/\s+/g, "-")}%`);
        }
        if (generation) query = query.eq("generation", Number(generation));

        const { data, count, error: queryError } = await query;
        if (!active) return;
        if (queryError) {
          setError(queryError.message);
        } else {
          setPokemon((data ?? []) as Pokemon[]);
          setTotal(count ?? 0);
        }
      } catch (requestError) {
        if (!active) return;
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Could not load Pokémon.",
        );
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadPokemon();
    return () => { active = false; };
  }, [search, generation, page]);

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(0);
    const form = event.currentTarget;
    const input = form.elements.namedItem("pokemon-search") as HTMLInputElement;
    setSearch(input.value);
  }

  return (
    <main className="page">
      <section className="page-heading">
        <div>
          <p className="eyebrow">Field guide</p>
          <h1>Pokédex</h1>
          <p className="muted">The essentials for every Pokémon, all in one place.</p>
        </div>
        <span className="count-pill">{total.toLocaleString()} Pokémon</span>
      </section>

      <form className="filter-bar" onSubmit={handleSearch}>
        <label className="search-field">
          <span aria-hidden="true">⌕</span>
          <input
            defaultValue={search}
            key={search}
            name="pokemon-search"
            placeholder="Search by name"
            type="search"
          />
        </label>
        <label className="select-field">
          <span className="visually-hidden">Filter by generation</span>
          <select
            onChange={(event) => { setGeneration(event.target.value); setPage(0); }}
            value={generation}
          >
            <option value="">All generations</option>
            {Array.from({ length: 9 }, (_, index) => (
              <option key={index + 1} value={index + 1}>Generation {index + 1}</option>
            ))}
          </select>
        </label>
        <button className="button primary" type="submit">Search</button>
      </form>

      {error && <p className="notice error" role="alert">Couldn’t load the Pokédex: {error}</p>}
      {loading ? (
        <div className="empty-state"><p>Loading Pokémon…</p></div>
      ) : error ? null : pokemon.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">◎</span>
          <h2>{search ? "No matches yet" : "The Pokédex is waiting"}</h2>
          <p>{search ? "Try another name or clear the generation filter." : "Run the seed script to load the Pokémon reference data."}</p>
        </div>
      ) : (
        <>
          <section className="pokemon-grid" aria-label="Pokémon results">
            {pokemon.map((mon) => (
              <article className="pokemon-card" key={mon.id}>
                <div className="pokemon-art">
                  <span className="dex-number">#{String(mon.dex_number).padStart(3, "0")}</span>
                  {mon.sprite_url && <img alt="" loading="lazy" src={mon.sprite_url} />}
                </div>
                <div className="pokemon-info">
                  <p className="eyebrow">Generation {mon.generation}</p>
                  <h2>{formatIdentifier(mon.name)}</h2>
                  <div className="stat-list" aria-label="Base stats">
                    <span>HP <b>{mon.base_hp}</b></span>
                    <span>ATK <b>{mon.base_atk}</b></span>
                    <span>DEF <b>{mon.base_def}</b></span>
                    <span>SPA <b>{mon.base_spa}</b></span>
                    <span>SPD <b>{mon.base_spd}</b></span>
                    <span>SPE <b>{mon.base_spe}</b></span>
                  </div>
                </div>
              </article>
            ))}
          </section>
          <div className="pagination">
            <button
              className="button secondary"
              disabled={page === 0}
              onClick={() => setPage((current) => current - 1)}
            >Previous</button>
            <span>Page {page + 1} of {Math.max(1, Math.ceil(total / PAGE_SIZE))}</span>
            <button
              className="button secondary"
              disabled={(page + 1) * PAGE_SIZE >= total}
              onClick={() => setPage((current) => current + 1)}
            >Next</button>
          </div>
        </>
      )}
    </main>
  );
}
