import { describe, expect, it } from "vitest";
import {
  analyzeTeam, calculateDamageRange, calculateStats, exportShowdownTeam,
  parseShowdownTeams, typeMultiplier, type StatValues,
} from "./teamBuilder";

describe("team builder calculations", () => {
  it("calculates final stats with EVs, IVs, level, and nature", () => {
    const stats = calculateStats(
      { hp: 100, atk: 100, def: 100, spa: 100, spd: 100, spe: 100 },
      50,
      { hp: 0, atk: 252, def: 0, spa: 0, spd: 0, spe: 0 },
      { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      { increased_stat: "atk", decreased_stat: "spa" },
    );
    expect(stats).toEqual({ hp: 175, atk: 167, def: 120, spa: 108, spd: 120, spe: 120 });
  });

  it("multiplies dual-type effectiveness and summarizes coverage and threats", () => {
    const chart = new Map([
      ["1:2", 2], ["1:3", 0.5], ["4:2", 2], ["4:3", 2],
      ["2:1", 0.5], ["3:1", 2],
    ]);
    expect(typeMultiplier(1, [2, 3], chart)).toBe(1);
    const analysis = analyzeTeam([
      { name: "One", types: [1], speed: 90, moveTypes: [1] },
      { name: "Two", types: [1], speed: 60, moveTypes: [4] },
    ], [1, 2, 3], chart);
    expect(analysis.coverage).toContain(2);
    expect(analysis.threats.map((entry) => entry.typeId)).toContain(3);
    expect(analysis.speeds.map((member) => member.speed)).toEqual([90, 60]);
  });

  it("returns minimum and maximum damage across the 85-100% rolls", () => {
    expect(calculateDamageRange({
      level: 50, power: 80, attack: 150, defense: 100,
      stab: true, effectiveness: 2, critical: false,
    })).toEqual([137, 162]);
  });
});

describe("Showdown team text", () => {
  it("parses sets and round-trips set details", () => {
    const [set] = parseShowdownTeams(
      "Sparky (Pikachu) @ Light Ball\nAbility: Static\nLevel: 50\nEVs: 4 HP / 252 SpA / 252 Spe\nTimid Nature\n- Thunderbolt\n- Volt Switch",
    );
    expect(set).toMatchObject({
      name: "Sparky", species: "Pikachu", item: "Light Ball", ability: "Static",
      level: 50, nature: "Timid", evs: { hp: 4, spa: 252, spe: 252 },
      moves: ["Thunderbolt", "Volt Switch"],
    });
    const values: StatValues = { hp: 4, atk: 0, def: 0, spa: 252, spd: 0, spe: 252 };
    const text = exportShowdownTeam([{
      pokemon: "Pikachu", nickname: "Sparky", item: "Light Ball", ability: "Static", level: 50,
      nature: "Timid", evs: values, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      moves: ["Thunderbolt", "Volt Switch"],
    }]);
    expect(text).toContain("Sparky (Pikachu) @ Light Ball");
    expect(text).toContain("- Thunderbolt");
  });

  it("rejects Showdown EV spreads outside game limits", () => {
    expect(() => parseShowdownTeams(
      "Pikachu\nEVs: 252 HP / 252 Atk / 252 Spe",
    )).toThrow("EVs are outside the allowed limits.");
  });
});
