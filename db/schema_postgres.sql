-- Pokedex + Team Builder schema (Postgres / Supabase)
-- Part 1: reference data, seeded once from PokeAPI (public read-only)
-- Part 2: user data, owned by Supabase Auth users and protected by RLS
--
-- Seed with the service role / direct DB connection (bypasses RLS).

-- =====================================================
-- PART 1: REFERENCE DATA
-- =====================================================

CREATE TABLE version_group (            -- e.g. "red-blue", "sword-shield"
    id          integer PRIMARY KEY,
    name        text NOT NULL UNIQUE,
    generation  integer NOT NULL
);

CREATE TABLE type (
    id    integer PRIMARY KEY,
    name  text NOT NULL UNIQUE
);

-- Modern (Gen 6+) chart, including Fairy. One row per attacker/defender pair.
-- Powers the type chart page, coverage, weaknesses, and the damage calc.
CREATE TABLE type_effectiveness (
    attacking_type_id  integer NOT NULL REFERENCES type(id),
    defending_type_id  integer NOT NULL REFERENCES type(id),
    multiplier         numeric(3,2) NOT NULL CHECK (multiplier IN (0, 0.5, 1, 2)),
    PRIMARY KEY (attacking_type_id, defending_type_id)
);

CREATE TABLE pokemon (
    id            integer PRIMARY KEY,   -- PokeAPI id (alternate forms get their own row)
    dex_number    integer NOT NULL,
    name          text NOT NULL,
    form_name     text,                  -- NULL for the default form
    is_default    boolean NOT NULL DEFAULT true,
    generation    integer NOT NULL,      -- generation introduced
    height_dm     integer,
    weight_hg     integer,
    base_hp       integer NOT NULL,
    base_atk      integer NOT NULL,
    base_def      integer NOT NULL,
    base_spa      integer NOT NULL,
    base_spd      integer NOT NULL,
    base_spe      integer NOT NULL,
    sprite_url    text,
    artwork_url   text,
    description   text                   -- Pokedex flavor text
);
CREATE INDEX idx_pokemon_name ON pokemon (name);
CREATE INDEX idx_pokemon_dex  ON pokemon (dex_number);
CREATE INDEX idx_pokemon_gen  ON pokemon (generation);

CREATE TABLE pokemon_type (
    pokemon_id  integer NOT NULL REFERENCES pokemon(id) ON DELETE CASCADE,
    type_id     integer NOT NULL REFERENCES type(id),
    slot        integer NOT NULL CHECK (slot IN (1, 2)),
    PRIMARY KEY (pokemon_id, slot)
);

CREATE TABLE ability (
    id           integer PRIMARY KEY,
    name         text NOT NULL UNIQUE,
    description  text
);

CREATE TABLE pokemon_ability (
    pokemon_id  integer NOT NULL REFERENCES pokemon(id) ON DELETE CASCADE,
    ability_id  integer NOT NULL REFERENCES ability(id),
    slot        integer NOT NULL CHECK (slot IN (1, 2, 3)),
    is_hidden   boolean NOT NULL DEFAULT false,
    PRIMARY KEY (pokemon_id, slot)
);

CREATE TABLE move (
    id            integer PRIMARY KEY,
    name          text NOT NULL UNIQUE,
    type_id       integer NOT NULL REFERENCES type(id),
    damage_class  text NOT NULL CHECK (damage_class IN ('physical', 'special', 'status')),
    power         integer,               -- NULL for status / variable power
    accuracy      integer,               -- NULL = never misses
    pp            integer,
    priority      integer NOT NULL DEFAULT 0,
    description   text
);

-- Learnsets are stored PER GENERATION (not per game) to keep the table small.
-- This is what the move picker's generation selector filters on.
-- When seeding, collapse duplicates across games in the same generation
-- (keep the lowest level_learned for level-up moves).
CREATE TABLE pokemon_move (
    pokemon_id     integer NOT NULL REFERENCES pokemon(id) ON DELETE CASCADE,
    move_id        integer NOT NULL REFERENCES move(id),
    generation     integer NOT NULL,
    learn_method   text NOT NULL,        -- level-up, machine, egg, tutor
    level_learned  integer NOT NULL DEFAULT 0,
    PRIMARY KEY (pokemon_id, move_id, generation, learn_method)
);
CREATE INDEX idx_pokemon_move_lookup ON pokemon_move (pokemon_id, generation);
CREATE INDEX idx_pokemon_move_move   ON pokemon_move (move_id);

-- Locations stay per game: where you can find a Pokemon really differs by version.
CREATE TABLE encounter (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    pokemon_id        integer NOT NULL REFERENCES pokemon(id) ON DELETE CASCADE,
    version_group_id  integer NOT NULL REFERENCES version_group(id),
    location_name     text NOT NULL,
    method            text,              -- walk, surf, old-rod, ...
    min_level         integer,
    max_level         integer,
    chance            integer            -- percent
);
CREATE INDEX idx_encounter_pokemon ON encounter (pokemon_id, version_group_id);

CREATE TABLE nature (
    id              integer PRIMARY KEY,
    name            text NOT NULL UNIQUE,
    increased_stat  text CHECK (increased_stat IN ('atk', 'def', 'spa', 'spd', 'spe')),
    decreased_stat  text CHECK (decreased_stat IN ('atk', 'def', 'spa', 'spd', 'spe'))
    -- both NULL = neutral nature
);

CREATE TABLE item (
    id           integer PRIMARY KEY,
    name         text NOT NULL UNIQUE,
    description  text,
    sprite_url   text
);

-- =====================================================
-- PART 2: USER DATA (owned by Supabase Auth users)
-- =====================================================
-- Anonymous sign-ins count as the "authenticated" role, so visitors can
-- build and save teams with no signup. Add Google/email login later to
-- keep teams across devices.

CREATE TABLE team (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
    name        text NOT NULL,
    notes       text,
    -- Generation the move picker filters learnsets by. Stat formula and
    -- type chart always use modern rules regardless of this value.
    generation  integer NOT NULL DEFAULT 9 CHECK (generation >= 3),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_team_user ON team (user_id);

CREATE TABLE team_member (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    team_id     bigint NOT NULL REFERENCES team(id) ON DELETE CASCADE,
    slot        integer NOT NULL CHECK (slot BETWEEN 1 AND 6),
    pokemon_id  integer NOT NULL REFERENCES pokemon(id),
    nickname    text,
    level       integer NOT NULL DEFAULT 50 CHECK (level BETWEEN 1 AND 100),
    nature_id   integer REFERENCES nature(id),
    ability_id  integer REFERENCES ability(id),
    item_id     integer REFERENCES item(id),

    ev_hp  integer NOT NULL DEFAULT 0 CHECK (ev_hp  BETWEEN 0 AND 252),
    ev_atk integer NOT NULL DEFAULT 0 CHECK (ev_atk BETWEEN 0 AND 252),
    ev_def integer NOT NULL DEFAULT 0 CHECK (ev_def BETWEEN 0 AND 252),
    ev_spa integer NOT NULL DEFAULT 0 CHECK (ev_spa BETWEEN 0 AND 252),
    ev_spd integer NOT NULL DEFAULT 0 CHECK (ev_spd BETWEEN 0 AND 252),
    ev_spe integer NOT NULL DEFAULT 0 CHECK (ev_spe BETWEEN 0 AND 252),

    iv_hp  integer NOT NULL DEFAULT 31 CHECK (iv_hp  BETWEEN 0 AND 31),
    iv_atk integer NOT NULL DEFAULT 31 CHECK (iv_atk BETWEEN 0 AND 31),
    iv_def integer NOT NULL DEFAULT 31 CHECK (iv_def BETWEEN 0 AND 31),
    iv_spa integer NOT NULL DEFAULT 31 CHECK (iv_spa BETWEEN 0 AND 31),
    iv_spd integer NOT NULL DEFAULT 31 CHECK (iv_spd BETWEEN 0 AND 31),
    iv_spe integer NOT NULL DEFAULT 31 CHECK (iv_spe BETWEEN 0 AND 31),

    UNIQUE (team_id, slot),
    CHECK (ev_hp + ev_atk + ev_def + ev_spa + ev_spd + ev_spe <= 510)
);

CREATE TABLE team_member_move (
    team_member_id  bigint NOT NULL REFERENCES team_member(id) ON DELETE CASCADE,
    slot            integer NOT NULL CHECK (slot BETWEEN 1 AND 4),
    move_id         integer NOT NULL REFERENCES move(id),
    PRIMARY KEY (team_member_id, slot)
);
-- Note: "is this move learnable in the team's generation?" is checked in the
-- app (the move picker only offers legal moves), not enforced by the database.

CREATE TABLE favorite_pokemon (
    user_id     uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
    pokemon_id  integer NOT NULL REFERENCES pokemon(id) ON DELETE CASCADE,
    added_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, pokemon_id)
);

CREATE TABLE setting (                   -- default generation, theme, etc.
    user_id        uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
    setting_key    text NOT NULL,
    setting_value  text NOT NULL,
    PRIMARY KEY (user_id, setting_key)
);

-- Keep team.updated_at current
CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER team_set_updated_at
    BEFORE UPDATE ON team
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================

-- Reference tables: anyone can read, nobody can write via the API.
-- (No write policies exist; the service role used for seeding bypasses RLS.)
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'version_group', 'type', 'type_effectiveness', 'pokemon', 'pokemon_type',
        'ability', 'pokemon_ability', 'move', 'pokemon_move', 'encounter',
        'nature', 'item'
    ] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format(
            'CREATE POLICY "public read" ON %I FOR SELECT TO anon, authenticated USING (true)', t);
    END LOOP;
END $$;

-- User tables: each user only sees and edits their own rows.
ALTER TABLE team              ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_member       ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_member_move  ENABLE ROW LEVEL SECURITY;
ALTER TABLE favorite_pokemon  ENABLE ROW LEVEL SECURITY;
ALTER TABLE setting           ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own teams" ON team
    FOR ALL TO authenticated
    USING (user_id = (SELECT auth.uid()))
    WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "own team members" ON team_member
    FOR ALL TO authenticated
    USING (EXISTS (
        SELECT 1 FROM team t
        WHERE t.id = team_member.team_id AND t.user_id = (SELECT auth.uid())))
    WITH CHECK (EXISTS (
        SELECT 1 FROM team t
        WHERE t.id = team_member.team_id AND t.user_id = (SELECT auth.uid())));

CREATE POLICY "own team member moves" ON team_member_move
    FOR ALL TO authenticated
    USING (EXISTS (
        SELECT 1 FROM team_member m
        JOIN team t ON t.id = m.team_id
        WHERE m.id = team_member_move.team_member_id AND t.user_id = (SELECT auth.uid())))
    WITH CHECK (EXISTS (
        SELECT 1 FROM team_member m
        JOIN team t ON t.id = m.team_id
        WHERE m.id = team_member_move.team_member_id AND t.user_id = (SELECT auth.uid())));

CREATE POLICY "own favorites" ON favorite_pokemon
    FOR ALL TO authenticated
    USING (user_id = (SELECT auth.uid()))
    WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "own settings" ON setting
    FOR ALL TO authenticated
    USING (user_id = (SELECT auth.uid()))
    WITH CHECK (user_id = (SELECT auth.uid()));

-- Intentionally NOT stored (compute in code from the tables above):
--   final stats, coverage, shared weaknesses, speed tiers, damage rolls.
