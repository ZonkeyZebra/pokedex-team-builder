BEGIN;

ALTER TABLE team_member
    DROP CONSTRAINT IF EXISTS team_member_team_id_slot_key,
    DROP CONSTRAINT IF EXISTS team_member_team_slot_unique;

ALTER TABLE team_member
    ADD CONSTRAINT team_member_team_slot_unique
    UNIQUE (team_id, slot) DEFERRABLE INITIALLY IMMEDIATE;

CREATE OR REPLACE FUNCTION swap_team_member_slots(
    p_team_id bigint,
    p_first_slot integer,
    p_second_slot integer
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    locked_count integer;
BEGIN
    IF p_first_slot NOT BETWEEN 1 AND 6 OR p_second_slot NOT BETWEEN 1 AND 6 THEN
        RAISE EXCEPTION 'Team slots must be between 1 and 6.';
    END IF;
    IF p_first_slot = p_second_slot THEN
        RETURN;
    END IF;

    PERFORM 1
    FROM team_member
    WHERE team_id = p_team_id AND slot IN (p_first_slot, p_second_slot)
    ORDER BY slot
    FOR UPDATE;
    GET DIAGNOSTICS locked_count = ROW_COUNT;
    IF locked_count <> 2 THEN
        RAISE EXCEPTION 'Both slots must contain a Pokémon in a team you own.';
    END IF;

    SET CONSTRAINTS team_member_team_slot_unique DEFERRED;
    UPDATE team_member
    SET slot = CASE slot
        WHEN p_first_slot THEN p_second_slot
        ELSE p_first_slot
    END
    WHERE team_id = p_team_id AND slot IN (p_first_slot, p_second_slot);
END;
$$;

REVOKE ALL ON FUNCTION swap_team_member_slots(bigint, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION swap_team_member_slots(bigint, integer, integer) TO authenticated;

COMMIT;
