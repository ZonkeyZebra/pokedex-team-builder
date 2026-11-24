import { useEffect, useMemo, useState } from "react";
import { formatIdentifier } from "../lib/format";
import { supabase } from "../lib/supabase";
import { calculateDamageRange, typeMultiplier } from "../lib/teamBuilder";

type Type = { id: number; name: string };
type Effect = { attacking_type_id: number; defending_type_id: number; multiplier: number | string };

export default function ToolsPage() {
  const [types, setTypes] = useState<Type[]>([]);
  const [chartRows, setChartRows] = useState<Effect[]>([]);
  const [selectedType, setSelectedType] = useState<number | null>(null);
  const [mode, setMode] = useState<"attacking" | "defending">("attacking");
  const [level, setLevel] = useState(50);
  const [power, setPower] = useState(80);
  const [attack, setAttack] = useState(150);
  const [defense, setDefense] = useState(100);
  const [attackType, setAttackType] = useState<number | null>(null);
  const [defenseType, setDefenseType] = useState<number | null>(null);
  const [secondDefenseType, setSecondDefenseType] = useState<number | null>(null);
  const [stab, setStab] = useState(true);
  const [critical, setCritical] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    async function load() {
      const [typeResult, chartResult] = await Promise.all([
        supabase!.from("type").select("id,name").order("id"),
        supabase!.from("type_effectiveness").select("attacking_type_id,defending_type_id,multiplier"),
      ]);
      if (!active) return;
      if (typeResult.error || chartResult.error) {
        setError(typeResult.error?.message ?? chartResult.error?.message ?? "Could not load type data.");
        return;
      }
      const loaded = (typeResult.data ?? []) as Type[];
      setTypes(loaded); setChartRows((chartResult.data ?? []) as Effect[]);
      setSelectedType(loaded[0]?.id ?? null);
      setAttackType(loaded.find((type) => type.name === "fire")?.id ?? loaded[0]?.id ?? null);
      setDefenseType(loaded.find((type) => type.name === "grass")?.id ?? loaded[0]?.id ?? null);
    }
    void load();
    return () => { active = false; };
  }, []);

  const chart = useMemo(() => new Map(chartRows.map((row) =>
    [`${row.attacking_type_id}:${row.defending_type_id}`, Number(row.multiplier)])), [chartRows]);
  const selected = types.find((type) => type.id === selectedType);
  const matchups = types.map((type) => {
    const key = mode === "attacking" ? `${selectedType}:${type.id}` : `${type.id}:${selectedType}`;
    return { type, multiplier: chart.get(key) ?? 1 };
  });
  const defenseIds = [defenseType, secondDefenseType].filter((id): id is number => id !== null);
  const effectiveness = attackType === null ? 1 : typeMultiplier(attackType, defenseIds, chart);
  const damage = calculateDamageRange({
    level: Math.min(100, Math.max(1, level)), power: Math.max(1, power),
    attack: Math.max(1, attack), defense: Math.max(1, defense),
    stab, effectiveness, critical,
  });
  const name = (id: number | null) => formatIdentifier(types.find((type) => type.id === id)?.name ?? "Unknown");
  const typeSelect = (label: string, value: number | null, change: (id: number | null) => void, allowNone = false) =>
    <label>{label}<select value={value ?? ""} onChange={(event) => change(event.target.value ? Number(event.target.value) : null)}>
      {allowNone && <option value="">None</option>}
      {types.map((type) => <option key={type.id} value={type.id}>{formatIdentifier(type.name)}</option>)}
    </select></label>;
  const numberInput = (label: string, value: number, set: (value: number) => void, min: number, max: number) =>
    <label>{label}<input max={max} min={min} onChange={(event) => set(Math.min(max, Math.max(min, Number(event.target.value) || min)))}
      type="number" value={value} /></label>;

  return <main className="page">
    <section className="page-heading"><div><p className="eyebrow">Battle references</p>
      <h1>Type chart & damage</h1><p className="muted">Explore modern type matchups and estimate damage ranges.</p></div></section>
    {error && <p className="notice error" role="alert">{error}</p>}
    <div className="tools-layout">
      <section className="tool-card type-chart-tool">
        <div className="tool-title"><div><p className="eyebrow">Interactive chart</p><h2>Type matchups</h2></div>
          <label>Chart mode<select value={mode} onChange={(event) => setMode(event.target.value as "attacking" | "defending")}>
            <option value="attacking">Attacking type</option><option value="defending">Defending type</option>
          </select></label></div>
        <p className="muted small-copy">{mode === "attacking" ? "Select an attacking type to see its effectiveness against every type." : "Select a defending type to see what each attack does to it."}</p>
        <div className="chart-type-buttons">{types.map((type) => <button aria-pressed={selectedType === type.id}
          className={`type-chip${selectedType === type.id ? " selected" : ""}`} key={type.id}
          onClick={() => setSelectedType(type.id)}>{formatIdentifier(type.name)}</button>)}</div>
        <h3>{selected ? `${formatIdentifier(selected.name)} ${mode === "attacking" ? "attacking" : "defending"} matchups` : "Matchups"}</h3>
        <div className="matchup-grid">{matchups.map(({ type, multiplier }) =>
          <div className={`matchup-cell${multiplier > 1 ? " super" : multiplier < 1 ? " resisted" : ""}`} key={type.id}>
            <span>{formatIdentifier(type.name)}</span><strong>{multiplier}×</strong>
          </div>)}</div>
      </section>
      <section className="tool-card damage-tool">
        <div className="tool-title"><div><p className="eyebrow">Calculator</p><h2>Damage estimate</h2></div></div>
        <p className="muted small-copy">Gen 3+ base damage formula. Items, abilities, weather, and terrain are not included.</p>
        <div className="editor-fields damage-inputs">
          {numberInput("Level", level, setLevel, 1, 100)}
          {numberInput("Move power", power, setPower, 1, 300)}
          {numberInput("Attack stat", attack, setAttack, 1, 999)}
          {numberInput("Defense stat", defense, setDefense, 1, 999)}
          {typeSelect("Move type", attackType, setAttackType)}
          {typeSelect("Defending type", defenseType, setDefenseType)}
          {typeSelect("Second defending type", secondDefenseType, setSecondDefenseType, true)}
        </div>
        <div className="damage-toggles">
          <label><input checked={stab} onChange={(event) => setStab(event.target.checked)} type="checkbox" /> STAB</label>
          <label><input checked={critical} onChange={(event) => setCritical(event.target.checked)} type="checkbox" /> Critical hit</label>
        </div>
        <div className="damage-result" aria-live="polite">
          <span>{name(attackType)} vs. {defenseIds.map(name).join(" / ")}</span>
          <strong>{damage[0]}–{damage[1]} damage</strong>
          <span>{effectiveness}× effectiveness · {stab ? "STAB" : "no STAB"}{critical ? " · critical" : ""}</span>
        </div>
      </section>
    </div>
  </main>;
}
