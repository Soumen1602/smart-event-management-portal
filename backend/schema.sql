-- ============================================================
-- SMART EVENT MANAGEMENT PORTAL — schema.sql
-- SQLite table definitions. Executed by database.init_db()
-- on every startup via CREATE IF NOT EXISTS (idempotent).
-- ============================================================

-- ── Users ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    email         TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL DEFAULT 'user',   -- 'user' | 'admin'
    created_at    TIMESTAMP        DEFAULT CURRENT_TIMESTAMP
);

-- ── Events ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    date        TEXT    NOT NULL,               -- ISO-8601 e.g. '2026-08-15T20:00'
    venue       TEXT    NOT NULL,
    price       REAL    NOT NULL DEFAULT 0.0,
    total_seats INTEGER NOT NULL,
    seats_left  INTEGER NOT NULL,
    category    TEXT    NOT NULL DEFAULT 'General',
    color       TEXT    NOT NULL DEFAULT '#C8521A',
    image       TEXT             DEFAULT ''    -- relative path e.g. 'images/event_jazz.png'
);

-- ── Bookings ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bookings (
    id           TEXT    PRIMARY KEY,           -- e.g. 'BKG-A3X9KQ2P'
    user_id      INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    event_id     INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    quantity     INTEGER NOT NULL,
    price_each   REAL    NOT NULL,
    total_paid   REAL    NOT NULL,
    booking_date TIMESTAMP        DEFAULT CURRENT_TIMESTAMP,
    status       TEXT    NOT NULL DEFAULT 'Confirmed'  -- 'Confirmed' | 'Cancelled'
);

-- ── Indexes for common query patterns ────────────────────────
CREATE INDEX IF NOT EXISTS idx_bookings_user_id  ON bookings (user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_event_id ON bookings (event_id);
CREATE INDEX IF NOT EXISTS idx_events_date       ON events   (date);
