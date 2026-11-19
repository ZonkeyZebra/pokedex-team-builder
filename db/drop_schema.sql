-- Drop app tables; CASCADE removes dependent tables, policies, and constraints.
DROP TABLE IF EXISTS
    team_member_move,
    team_member,
    team,
    favorite_pokemon,
    setting,
    pokemon_egg_group,
    pokemon_evolution,
    egg_group,
    encounter,
    pokemon_move,
    pokemon_ability,
    pokemon_type,
    pokemon,
    move,
    ability,
    nature,
    item,
    type_effectiveness,
    type,
    version_group
CASCADE;

DROP FUNCTION IF EXISTS set_updated_at() CASCADE;