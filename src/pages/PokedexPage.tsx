import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
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

const PAGE_SIZE = 48;
const COLUMNS =
  "id,dex_number,name,generation,sprite_url,base_hp,base_atk,base_def,base_spa,base_spd,base_spe";

export default function PokedexPage() {
  const [pokemon, setPokemon] = useState<Pokemon[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [generation, setGeneration] = useState("");
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestRequest = useRef(0);

  // Search as you type: wait a moment after the last keystroke, then query.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => clearTimeout(timer);
  }, [searchInput]);

  async function fetchPage(offset: number, replace: boolean) {
    if (!supabase) return;
    const requestId = ++latestRequest.current;
    if (replace) setLoading(true);
    else setLoadingMore(true);
    setError(null);
    try {
      let query = supabase
        .from("pokemon")
        .select(COLUMNS, { count: "exact" })
        .eq("is_default", true)
        .order("dex_number", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);

      if (search) {
        // Numbers search by dex number; anything else searches by name.
        query = /^\d+$/.test(search)
          ? query.eq("dex_number", Number(search))
          : query.ilike("name", `%${search.toLowerCase().replace(/\s+/g, "-")}%`);
      }
      if (generation) query = query.eq("generation", Number(generation));

      const { data, count, error: queryError } = await query;
      if (requestId !== latestRequest.current) return;
      if (queryError) {
        setError(queryError.message);
      } else {
        const rows = (data ?? []) as Pokemon[];
        setPokemon((current) => (replace ? rows : [...current, ...rows]));
        setTotal(count ?? 0);
      }
    } catch (requestError) {
      if (requestId !== latestRequest.current) return;
      setError(
        requestError instanceof Error ? requestError.message : "Could not load Pokémon.",
      );
    } finally {
      if (requestId === latestRequest.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }

  useEffect(() => {
    void fetchPage(0, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, generation]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearch(searchInput.trim());
  }

  const hasMore = pokemon.length < total;

  return (
    <main className="page">
      <section className="page-heading">
        <div>
          <p className="eyebrow">Field guide</p>
          <h1>Pokédex</h1>
          <p className="muted">Search by name or dex number, or filter by generation.</p>
        </div>
        <span className="count-pill">{total.toLocaleString()} Pokémon</span>
      </section>

      <form className="filter-bar" onSubmit={handleSubmit} role="search">
        <label className="search-field">
          <span aria-hidden="true">⌕</span>
          <span className="visually-hidden">Search Pokémon</span>
          <input
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search by name or number"
            type="search"
            value={searchInput}
          />
        </label>
        <label className="select-field">
          <span className="visually-hidden">Filter by generation</span>
          <select onChange={(event) => setGeneration(event.target.value)} value={generation}>
            <option value="">All generations</option>
            {Array.from({ length: 9 }, (_, index) => (
              <option key={index + 1} value={index + 1}>Generation {index + 1}</option>
            ))}
          </select>
        </label>
      </form>

      {error && <p className="notice error" role="alert">Couldn’t load the Pokédex: {error}</p>}
      {loading ? (
        <div className="empty-state"><p>Loading Pokémon…</p></div>
      ) : error && pokemon.length === 0 ? null : pokemon.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">◎</span>
          <h2>{search ? "No matches yet" : "The Pokédex is waiting"}</h2>
          <p>{search ? "Try another name or number, or clear the generation filter." : "Run the seed script to load the Pokémon reference data."}</p>
        </div>
      ) : (
        <>
          <section className="pokemon-grid" aria-label="Pokémon results">
            {pokemon.map((mon) => (
              <Link
                aria-label={`View ${formatIdentifier(mon.name)} details`}
                className="pokemon-card"
                key={mon.id}
                to={`/pokedex/${mon.id}`}
              >
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
              </Link>
            ))}
          </section>
          <div className="list-footer">
            <span>Showing {pokemon.length.toLocaleString()} of {total.toLocaleString()}</span>
            {hasMore && (
              <button
                className="button secondary"
                disabled={loadingMore}
                onClick={() => void fetchPage(pokemon.length, false)}
                type="button"
              >
                {loadingMore ? "Loading…" : `Load ${Math.min(PAGE_SIZE, total - pokemon.length)} more`}
              </button>
            )}
          </div>
        </>
      )}
    </main>
  );
}
