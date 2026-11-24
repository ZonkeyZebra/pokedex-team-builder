export const STAT_KEYS = ["hp", "atk", "def", "spa", "spd", "spe"] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export type BaseStats = Record<StatKey, number>;
export type StatValues = Record<StatKey, number>;

export type Nature = {
  increased_stat: string | null;
  decreased_stat: string | null;
};

export function calculateStats(
  base: BaseStats,
  level: number,
  evs: StatValues,
  ivs: StatValues,
  nature: Nature | null,
): StatValues {
  const boundedLevel = Math.min(100, Math.max(1, Math.floor(level)));
  return Object.fromEntries(STAT_KEYS.map((stat) => {
    const core = Math.floor((2 * base[stat] + ivs[stat] + Math.floor(evs[stat] / 4)) * boundedLevel / 100);
    if (stat === "hp") return [stat, core + boundedLevel + 10];
    const multiplier = nature?.increased_stat === stat ? 1.1
      : nature?.decreased_stat === stat ? 0.9 : 1;
    return [stat, Math.floor((core + 5) * multiplier)];
  })) as StatValues;
}

export function typeMultiplier(
  attackTypeId: number,
  defenseTypeIds: number[],
  chart: Map<string, number>,
): number {
  return defenseTypeIds.reduce(
    (result, defenseTypeId) => result * (chart.get(`${attackTypeId}:${defenseTypeId}`) ?? 1),
    1,
  );
}

export type AnalysisMember = {
  name: string;
  types: number[];
  speed: number;
  moveTypes: number[];
};

export function analyzeTeam(members: AnalysisMember[], typeIds: number[], chart: Map<string, number>) {
  const coverage = typeIds.filter((defense) => members.some((member) =>
    member.moveTypes.some((attack) => typeMultiplier(attack, [defense], chart) > 1),
  ));
  const defenses = typeIds.map((attack) => ({
    typeId: attack,
    weak: members.filter((member) => typeMultiplier(attack, member.types, chart) > 1).length,
    resist: members.filter((member) => typeMultiplier(attack, member.types, chart) < 1).length,
  }));
  return {
    coverage,
    defenses,
    threats: defenses.filter((entry) => entry.weak > 1).sort((a, b) => b.weak - a.weak),
    speeds: [...members].sort((a, b) => b.speed - a.speed),
  };
}

export function calculateDamageRange(input: {
  level: number;
  power: number;
  attack: number;
  defense: number;
  stab: boolean;
  effectiveness: number;
  critical: boolean;
}): [number, number] {
  const { level, power, attack, defense, stab, effectiveness, critical } = input;
  const base = Math.floor(Math.floor(Math.floor(2 * level / 5 + 2) * power * attack / defense) / 50) + 2;
  const modifier = (stab ? 1.5 : 1) * effectiveness * (critical ? 1.5 : 1);
  return [
    Math.floor(base * 0.85 * modifier),
    Math.floor(base * modifier),
  ];
}

export type ShowdownSet = {
  name: string;
  species: string;
  item: string | null;
  ability: string | null;
  level: number;
  nature: string | null;
  evs: Partial<StatValues>;
  ivs: Partial<StatValues>;
  moves: string[];
};

const STAT_ALIASES: Record<string, StatKey> = {
  hp: "hp", atk: "atk", def: "def", spa: "spa", spd: "spd", spe: "spe",
  attack: "atk", defense: "def", "sp. atk": "spa", "sp. def": "spd", speed: "spe",
};

function parseStatLine(line: string): Partial<StatValues> {
  const result: Partial<StatValues> = {};
  for (const part of line.split("/")) {
    const match = part.trim().match(/^(\d+)\s+(.+)$/);
    if (match) {
      const key = STAT_ALIASES[match[2].trim().toLowerCase()];
      if (key) result[key] = Number(match[1]);
    }
  }
  return result;
}

export function parseShowdownTeams(text: string): ShowdownSet[] {
  return text.trim().split(/\r?\n\s*\r?\n/).filter(Boolean).map((block) => {
    const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const first = lines.shift() ?? "";
    const [namePart, itemPart] = first.split(/\s+@\s+/, 2);
    const nameMatch = namePart.match(/^(.*?)\s*\((.*?)\)$/);
    const name = (nameMatch?.[1] || namePart).trim();
    const species = (nameMatch?.[2] || name).trim();
    const set: ShowdownSet = {
      name, species, item: itemPart?.trim() || null, ability: null, level: 100,
      nature: null, evs: {}, ivs: {}, moves: [],
    };
    for (const line of lines) {
      if (line.startsWith("- ")) set.moves.push(line.slice(2).trim());
      else if (/^Ability:\s*/i.test(line)) set.ability = line.replace(/^Ability:\s*/i, "");
      else if (/^Level:\s*/i.test(line)) {
        const level = Number(line.replace(/^Level:\s*/i, ""));
        if (!Number.isInteger(level) || level < 1 || level > 100) throw new Error("Level must be between 1 and 100.");
        set.level = level;
      }
      else if (/^EVs:\s*/i.test(line)) set.evs = parseStatLine(line.replace(/^EVs:\s*/i, ""));
      else if (/^IVs:\s*/i.test(line)) set.ivs = parseStatLine(line.replace(/^IVs:\s*/i, ""));
      else if (/ Nature$/i.test(line)) set.nature = line.replace(/ Nature$/i, "");
    }
    for (const [label, stats, max, totalMax] of [
      ["EVs", set.evs, 252, 510], ["IVs", set.ivs, 31, Number.POSITIVE_INFINITY],
    ] as const) {
      const values = Object.values(stats);
      if (values.some((value) => !Number.isInteger(value) || value < 0 || value > max)
        || values.reduce((sum, value) => sum + value, 0) > totalMax) {
        throw new Error(`${label} are outside the allowed limits.`);
      }
    }
    return set;
  });
}

export function exportShowdownTeam(
  members: Array<{
    pokemon: string;
    nickname: string | null;
    item: string | null;
    ability: string | null;
    level: number;
    nature: string | null;
    evs: StatValues;
    ivs: StatValues;
    moves: string[];
  }>,
): string {
  return members.map((member) => {
    const title = member.nickname && member.nickname !== member.pokemon
      ? `${member.nickname} (${member.pokemon})` : member.pokemon;
    const lines = [`${title}${member.item ? ` @ ${member.item}` : ""}`];
    if (member.ability) lines.push(`Ability: ${member.ability}`);
    lines.push(`Level: ${member.level}`);
    const evs = STAT_KEYS.filter((stat) => member.evs[stat] > 0)
      .map((stat) => `${member.evs[stat]} ${stat.toUpperCase()}`);
    if (evs.length) lines.push(`EVs: ${evs.join(" / ")}`);
    if (member.nature) lines.push(`${member.nature} Nature`);
    const ivs = STAT_KEYS.filter((stat) => member.ivs[stat] !== 31)
      .map((stat) => `${member.ivs[stat]} ${stat.toUpperCase()}`);
    if (ivs.length) lines.push(`IVs: ${ivs.join(" / ")}`);
    lines.push(...member.moves.map((move) => `- ${move}`));
    return lines.join("\n");
  }).join("\n\n");
}
