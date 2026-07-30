"""
database.py — SQLite connection and first-run initialisation for SEMP.
=======================================================================
Responsibilities:
  - get_db()   : open a connection with Row factory (dict-like access)
  - init_db()  : create tables from schema.sql + seed demo data
  - _seed_*()  : idempotent seed helpers (skip if data already exists)

The database file (events.db) lives next to this module so that a
Docker volume mount or K8s PersistentVolumeClaim can target one path.
"""

import os
import sqlite3

from werkzeug.security import generate_password_hash

# ── Path constants ─────────────────────────────────────────────
_HERE     = os.path.dirname(os.path.abspath(__file__))
DATABASE  = os.path.join(_HERE, 'events.db')
SCHEMA    = os.path.join(_HERE, 'schema.sql')


# ── Connection helper ──────────────────────────────────────────
def get_db():
    """
    Open and return a new SQLite connection.
    Row factory is set so rows behave like dicts (row['column']).
    Foreign-key enforcement is enabled per connection.
    Callers are responsible for closing the connection.
    """
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


# ── Initialisation ─────────────────────────────────────────────
def init_db():
    """
    Create all tables (idempotent via CREATE IF NOT EXISTS) and
    seed demo data on the very first run.
    Safe to call on every application startup.
    """
    conn = get_db()
    try:
        # Execute schema DDL
        with open(SCHEMA) as f:
            conn.executescript(f.read())
        conn.commit()

        # Seed in dependency order: users first, then events
        _seed_users(conn)
        _seed_events(conn)
    finally:
        conn.close()


# ── Seed helpers ───────────────────────────────────────────────
def _seed_users(conn):
    """
    Create the admin and demo user accounts if the users table is empty.
    Passwords are hashed with Werkzeug's generate_password_hash.
    """
    count = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    if count > 0:
        return  # already seeded

    accounts = [
        (
            "Admin User",
            "admin@semp.com",
            generate_password_hash("admin123"),
            "admin",
        ),
        (
            "Demo User",
            "user@semp.com",
            generate_password_hash("user123"),
            "user",
        ),
    ]
    conn.executemany(
        "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)",
        accounts,
    )
    conn.commit()
    print("[DB] Seeded 2 demo user accounts.")


def _seed_events(conn):
    """
    Populate the events table with 8 sample events if it is empty.
    Image paths are relative to the frontend's root (served by nginx).
    """
    count = conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
    if count > 0:
        return  # already seeded

    # Columns: title, description, date, venue, price, total_seats,
    #          seats_left, category, color, image
    events = [
        (
            "Jazz & Blues Night",
            "An intimate evening of live jazz and blues featuring top artists "
            "from across the country. Cocktails and light bites included.",
            "2026-08-15T20:00",
            "The Foundry, New York City",
            45.00, 120, 120,
            "Music", "#7C4A2D", "images/event_jazz.png",
        ),
        (
            "TechSummit 2026",
            "The premier technology conference of the year. Keynotes, workshops, "
            "and networking with industry leaders shaping tomorrow's landscape.",
            "2026-09-03T09:00",
            "Moscone Center, San Francisco",
            299.00, 500, 500,
            "Conference", "#1A4A6B", "images/event_tech.png",
        ),
        (
            "Street Food Festival",
            "Over 50 vendors serving street food from around the world. Live music, "
            "craft beer garden, and family-friendly activities all day long.",
            "2026-08-22T12:00",
            "Riverside Park, Chicago",
            15.00, 800, 800,
            "Food", "#5D4037", "images/event_food.png",
        ),
        (
            "Contemporary Art Expo",
            "A curated showcase of emerging contemporary artists pushing the "
            "boundaries of modern expression. Guided tours available hourly.",
            "2026-09-10T10:00",
            "East Wing Gallery, MOMA",
            25.00, 200, 200,
            "Art", "#4A1942", "images/event_art.png",
        ),
        (
            "Trail Running Championship",
            "A challenging 25K trail run through the breathtaking Blue Ridge "
            "Mountains. All skill levels welcome. Medals for every finisher.",
            "2026-10-05T07:00",
            "Blue Ridge Mountains, Virginia",
            60.00, 300, 300,
            "Sports", "#2E5E2E", "images/event_trail.png",
        ),
        (
            "Sustainable Living Workshop",
            "Hands-on workshops on zero-waste living, urban gardening, renewable "
            "energy for homes, and mindful consumerism. Includes a take-home kit.",
            "2026-08-30T09:30",
            "Green Hub, Portland",
            35.00, 80, 80,
            "Workshop", "#4A6741", "images/event_sustain.png",
        ),
        (
            "Indie Film Screening Night",
            "An evening of award-winning independent short films followed by a "
            "panel Q&A with the filmmakers. Popcorn and drinks included.",
            "2026-08-18T19:00",
            "The Rex Cinema, Austin",
            20.00, 150, 150,
            "Film", "#37474F", "images/event_film.png",
        ),
        (
            "Startup Pitch Night",
            "Watch 10 promising startups pitch to a panel of top venture "
            "capitalists. Network with founders and investors shaping tomorrow.",
            "2026-09-20T18:00",
            "Innovation Hub, Boston",
            0.00, 250, 250,
            "Business", "#1C3F6E", "images/event_startup.png",
        ),
    ]

    conn.executemany(
        """INSERT INTO events
               (title, description, date, venue, price, total_seats,
                seats_left, category, color, image)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        events,
    )
    conn.commit()
    print(f"[DB] Seeded {len(events)} sample events.")
