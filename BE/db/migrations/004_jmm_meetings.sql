-- JMM meetings and their agendas — CLAUDE.md §8 decision 2.
--
-- Closes the gap that made MENUNGGU_JMM unreachable: "placed on a JMM agenda"
-- is now a row in jmm_meeting_items. Runs before 005 so the status backfill
-- there can see agenda placement.

BEGIN;

CREATE TYPE jmm_meeting_status_enum AS ENUM (
    'DIJADUALKAN',   -- scheduled / still open
    'SELESAI'        -- held and closed
);

CREATE TABLE jmm_meetings (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    meeting_no    TEXT NOT NULL UNIQUE,            -- e.g. 'JMM Bil. 3/2026'
    meeting_date  DATE NOT NULL,
    venue         TEXT,
    status        jmm_meeting_status_enum NOT NULL DEFAULT 'DIJADUALKAN',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_meeting_no CHECK (char_length(btrim(meeting_no)) > 0)
);

CREATE INDEX idx_jmm_meetings_date   ON jmm_meetings(meeting_date);
CREATE INDEX idx_jmm_meetings_status ON jmm_meetings(status);

CREATE TABLE jmm_meeting_items (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    meeting_id    BIGINT NOT NULL REFERENCES jmm_meetings(id) ON DELETE CASCADE,
    complaint_id  BIGINT NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
    agenda_order  INTEGER NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_meeting_item UNIQUE (meeting_id, complaint_id),
    CONSTRAINT chk_agenda_order CHECK (agenda_order > 0)
);

CREATE INDEX idx_jmm_meeting_items_complaint ON jmm_meeting_items(complaint_id);

-- A decision may record the meeting it was made at. RESTRICT, not SET NULL:
-- nulling the column would rewrite a signed decision, which rule 8 forbids.
ALTER TABLE jmm_decisions
    ADD COLUMN meeting_id BIGINT REFERENCES jmm_meetings(id) ON DELETE RESTRICT;

CREATE INDEX idx_jmm_decisions_meeting ON jmm_decisions(meeting_id);

-- ----------------------------------------------------------------------------
-- A complaint may be on only one open (DIJADUALKAN) meeting at a time.
--
-- The rule spans two tables, so it can't be a plain UNIQUE index. The API
-- checks it first for a friendly error; these triggers are the backstop.
-- Locking the complaint row serialises concurrent agenda inserts for the same
-- complaint, so two requests can't both pass the check.
-- ----------------------------------------------------------------------------

CREATE FUNCTION jmm_meeting_items_one_open_meeting() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM 1 FROM complaints WHERE id = NEW.complaint_id FOR UPDATE;

    IF EXISTS (
        SELECT 1
        FROM jmm_meeting_items i
        JOIN jmm_meetings m ON m.id = i.meeting_id
        WHERE i.complaint_id = NEW.complaint_id
          AND i.id <> NEW.id
          AND m.status = 'DIJADUALKAN'
    ) AND EXISTS (
        SELECT 1 FROM jmm_meetings WHERE id = NEW.meeting_id AND status = 'DIJADUALKAN'
    ) THEN
        RAISE EXCEPTION 'Aduan % sudah berada dalam agenda mesyuarat JMM yang belum selesai', NEW.complaint_id
            USING ERRCODE = 'unique_violation';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_jmm_meeting_items_one_open_meeting
    BEFORE INSERT OR UPDATE OF meeting_id, complaint_id ON jmm_meeting_items
    FOR EACH ROW EXECUTE FUNCTION jmm_meeting_items_one_open_meeting();

-- Reopening a closed meeting must not put a complaint on two open meetings.
CREATE FUNCTION jmm_meetings_reopen_check() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM jmm_meeting_items mine
        JOIN jmm_meeting_items other ON other.complaint_id = mine.complaint_id
                                    AND other.meeting_id <> mine.meeting_id
        JOIN jmm_meetings m ON m.id = other.meeting_id
        WHERE mine.meeting_id = NEW.id
          AND m.status = 'DIJADUALKAN'
    ) THEN
        RAISE EXCEPTION 'Mesyuarat % tidak boleh dibuka semula: aduan di dalamnya sudah berada dalam mesyuarat lain yang belum selesai', NEW.meeting_no
            USING ERRCODE = 'unique_violation';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_jmm_meetings_reopen_check
    BEFORE UPDATE OF status ON jmm_meetings
    FOR EACH ROW
    WHEN (NEW.status = 'DIJADUALKAN' AND OLD.status <> 'DIJADUALKAN')
    EXECUTE FUNCTION jmm_meetings_reopen_check();

COMMIT;
