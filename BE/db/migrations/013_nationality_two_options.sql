-- CLAUDE.md §8 decision 12. WARGANEGARA on Lampiran 2 becomes a two-option
-- answer instead of free text, because it now decides which identity document
-- a named portal complainant must give:
--   WARGANEGARA        -> NO. KAD PENGENALAN required (passport optional)
--   BUKAN_WARGANEGARA  -> NO. PASSPORT required (no IC asked)
-- The column keeps its name; it is still the form's WARGANEGARA field.

BEGIN;

CREATE TYPE nationality_enum AS ENUM (
    'WARGANEGARA',
    'BUKAN_WARGANEGARA'
);

-- Free text written before this migration: blank -> NULL, a Malaysian answer
-- -> WARGANEGARA, any other stated nationality -> BUKAN_WARGANEGARA.
ALTER TABLE complainants
    ALTER COLUMN nationality TYPE nationality_enum USING (
        CASE
            WHEN nationality IS NULL OR btrim(nationality) = '' THEN NULL
            WHEN lower(btrim(nationality)) IN ('malaysia', 'warganegara', 'warganegara malaysia')
                THEN 'WARGANEGARA'
            ELSE 'BUKAN_WARGANEGARA'
        END
    )::nationality_enum;

COMMIT;
