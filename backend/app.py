"""
app.py — Smart Event Management Portal, Flask Backend
======================================================
Single-file REST API. All routes live here; DB logic lives in database.py.

Auth model (simple, no JWT):
  - Login returns { user: {id, name, email, role} } stored client-side.
  - Protected routes read the X-User-ID request header and verify the
    user's role directly in SQLite. Easy to swap for JWT later.

To run locally:
    pip install -r requirements.txt
    python app.py

To run in Docker (after building):
    docker run -p 5000:5000 semp-backend
"""

import os
import re
import random
import string
from datetime import datetime, timezone

from flask import Flask, request, jsonify
from flask_cors import CORS
from werkzeug.security import check_password_hash, generate_password_hash

import database

# ── App setup ──────────────────────────────────────────────────
app = Flask(__name__)

# Allow all origins so the static frontend (file:// or any origin)
# can reach the API. Tighten this in production.
CORS(app, resources={r"/api/*": {"origins": "*"}})


# ══════════════════════════════════════════════════════════════
# HELPERS
# ══════════════════════════════════════════════════════════════

def _error(message, status=400):
    """Return a standardised JSON error response."""
    return jsonify({"error": message}), status


def _is_valid_email(email: str) -> bool:
    return bool(re.match(r'^[^\s@]+@[^\s@]+\.[^\s@]+$', email))


def _gen_booking_id() -> str:
    """Generate a unique booking reference like BKG-A3X9KQ2P."""
    suffix = "".join(random.choices(string.ascii_uppercase + string.digits, k=8))
    return f"BKG-{suffix}"


def _event_to_dict(row) -> dict:
    """
    Serialise an events row to JSON-friendly dict.
    Includes both the DB column name AND the frontend camelCase alias
    so the JS rendering layer needs minimal changes.
    """
    return {
        "id":          row["id"],
        "title":       row["title"],
        "description": row["description"],
        "date":        row["date"],
        # Dual-name: DB uses 'venue', frontend expects 'location'
        "venue":       row["venue"],
        "location":    row["venue"],
        "price":       row["price"],
        # Dual-name: DB uses snake_case, frontend uses camelCase
        "total_seats": row["total_seats"],
        "seatsTotal":  row["total_seats"],
        "seats_left":  row["seats_left"],
        "seatsLeft":   row["seats_left"],
        "category":    row["category"],
        "color":       row["color"],
        "image":       row["image"] or "",
    }


def _booking_to_dict(row) -> dict:
    """
    Serialise a bookings JOIN row (bookings + events) to match the
    frontend history card field names.
    """
    return {
        "id":            row["id"],
        "userId":        row["user_id"],
        "eventId":       row["event_id"],
        "eventTitle":    row["title"],
        "eventDate":     row["date"],
        "eventLocation": row["venue"],
        "eventCategory": row["category"],
        "eventColor":    row["color"],
        "quantity":      row["quantity"],
        "priceEach":     row["price_each"],
        "totalPaid":     row["total_paid"],
        "status":        row["status"],
        "bookedAt":      row["booking_date"],
    }


def _get_requesting_admin():
    """
    Read X-User-ID header and verify the user has role='admin'.
    Returns the user row dict if valid, else None.
    """
    user_id = request.headers.get("X-User-ID")
    if not user_id:
        return None
    db = database.get_db()
    try:
        user = db.execute(
            "SELECT * FROM users WHERE id = ?", (user_id,)
        ).fetchone()
        if user and user["role"] == "admin":
            return dict(user)
        return None
    finally:
        db.close()


# ══════════════════════════════════════════════════════════════
# HEALTH CHECK
# ══════════════════════════════════════════════════════════════

@app.route("/api/health", methods=["GET"])
def health_check():
    """
    Kubernetes readiness and liveness probe endpoint.
    Returns 200 as long as the Flask process is alive.
    """
    return jsonify({"status": "ok"})


# ══════════════════════════════════════════════════════════════
# AUTH ROUTES
# ══════════════════════════════════════════════════════════════

@app.route("/api/register", methods=["POST"])
def register():
    """
    Create a new user account with a hashed password.

    Request body: { name, email, password }
    Response 201: { user: { id, name, email, role } }
    Errors: 400 (validation), 409 (email already exists), 500 (DB error)
    """
    data     = request.get_json(silent=True) or {}
    name     = (data.get("name")     or "").strip()
    email    = (data.get("email")    or "").strip().lower()
    password = (data.get("password") or "").strip()

    # ── Input validation
    if not name:
        return _error("Full name is required.")
    if not email or not _is_valid_email(email):
        return _error("A valid email address is required.")
    if len(password) < 6:
        return _error("Password must be at least 6 characters.")

    db = database.get_db()
    try:
        # ── Uniqueness check
        if db.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone():
            return _error("An account with this email already exists.", 409)

        # ── Insert with hashed password
        db.execute(
            "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)",
            (name, email, generate_password_hash(password), "user"),
        )
        db.commit()

        user = db.execute(
            "SELECT id, name, email, role FROM users WHERE email = ?", (email,)
        ).fetchone()
        return jsonify({"user": dict(user)}), 201

    except Exception as exc:
        return _error(f"Registration failed: {exc}", 500)
    finally:
        db.close()


@app.route("/api/login", methods=["POST"])
def login():
    """
    Authenticate a user and return their profile.

    Request body: { email, password }
    Response 200: { user: { id, name, email, role } }
    Errors: 400 (missing fields), 401 (wrong credentials)
    """
    data     = request.get_json(silent=True) or {}
    email    = (data.get("email")    or "").strip().lower()
    password = (data.get("password") or "").strip()

    if not email or not password:
        return _error("Email and password are required.")

    db = database.get_db()
    try:
        user = db.execute(
            "SELECT * FROM users WHERE email = ?", (email,)
        ).fetchone()

        if not user or not check_password_hash(user["password_hash"], password):
            return _error("Incorrect email or password.", 401)

        return jsonify({
            "user": {
                "id":    user["id"],
                "name":  user["name"],
                "email": user["email"],
                "role":  user["role"],
            }
        })
    finally:
        db.close()


# ══════════════════════════════════════════════════════════════
# EVENT ROUTES
# ══════════════════════════════════════════════════════════════

@app.route("/api/events", methods=["GET"])
def get_events():
    """
    Return all events ordered by date ascending (soonest first).
    Public — no authentication required.
    """
    db = database.get_db()
    try:
        rows = db.execute("SELECT * FROM events ORDER BY date ASC").fetchall()
        return jsonify([_event_to_dict(r) for r in rows])
    finally:
        db.close()


@app.route("/api/events/<int:event_id>", methods=["GET"])
def get_event(event_id):
    """
    Return a single event by its integer ID.
    Public — no authentication required.
    """
    db = database.get_db()
    try:
        row = db.execute(
            "SELECT * FROM events WHERE id = ?", (event_id,)
        ).fetchone()
        if not row:
            return _error("Event not found.", 404)
        return jsonify(_event_to_dict(row))
    finally:
        db.close()


@app.route("/api/events", methods=["POST"])
def create_event():
    """
    Create a new event. Admin only (verified via X-User-ID header).

    Request body: { title, description, date, venue, price, total_seats,
                    category, color, image }
    Response 201: the newly created event dict
    """
    admin = _get_requesting_admin()
    if not admin:
        return _error("Admin access required.", 403)

    data = request.get_json(silent=True) or {}

    # ── Collect and normalise fields
    title       = (data.get("title")                               or "").strip()
    date        = (data.get("date")                                or "").strip()
    # Accept either 'venue' (backend name) or 'location' (frontend alias)
    venue       = (data.get("venue") or data.get("location")      or "").strip()
    description = (data.get("description")                        or "").strip()
    category    = (data.get("category")                           or "General").strip()
    color       = (data.get("color")                              or "#C8521A").strip()
    image       = (data.get("image")                              or "").strip()

    try:
        price       = float(data.get("price", 0) or 0)
        total_seats = int(data.get("total_seats") or data.get("seatsTotal") or 0)
    except (ValueError, TypeError):
        return _error("price must be a number and total_seats must be an integer.")

    # ── Validation
    if not title:
        return _error("Event title is required.")
    if not date:
        return _error("Event date is required.")
    if not venue:
        return _error("Event venue / location is required.")
    if total_seats <= 0:
        return _error("total_seats must be a positive integer.")

    db = database.get_db()
    try:
        cur = db.execute(
            """INSERT INTO events
                   (title, description, date, venue, price,
                    total_seats, seats_left, category, color, image)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (title, description, date, venue, price,
             total_seats, total_seats, category, color, image),
        )
        db.commit()
        row = db.execute(
            "SELECT * FROM events WHERE id = ?", (cur.lastrowid,)
        ).fetchone()
        return jsonify(_event_to_dict(row)), 201

    except Exception as exc:
        return _error(f"Failed to create event: {exc}", 500)
    finally:
        db.close()


@app.route("/api/events/<int:event_id>", methods=["PUT"])
def update_event(event_id):
    """
    Partially update an event. Admin only.
    Unspecified fields keep their existing values (merge update).

    Response 200: the updated event dict
    """
    admin = _get_requesting_admin()
    if not admin:
        return _error("Admin access required.", 403)

    db = database.get_db()
    try:
        existing = db.execute(
            "SELECT * FROM events WHERE id = ?", (event_id,)
        ).fetchone()
        if not existing:
            return _error("Event not found.", 404)

        data = request.get_json(silent=True) or {}

        # Merge: incoming value OR fall back to existing DB value
        title       = (data.get("title")   or existing["title"]).strip()
        date        = (data.get("date")    or existing["date"]).strip()
        venue       = (
            data.get("venue") or data.get("location") or existing["venue"]
        ).strip()
        description = data.get("description", existing["description"] or "")
        category    = (data.get("category") or existing["category"]).strip()
        color       = (data.get("color")    or existing["color"]).strip()
        image       = data.get("image",      existing["image"] or "")

        try:
            price       = float(data.get("price",       existing["price"]))
            total_seats = int(
                data.get("total_seats") or data.get("seatsTotal") or existing["total_seats"]
            )
            seats_left  = int(
                data.get("seats_left")  or data.get("seatsLeft")  or existing["seats_left"]
            )
        except (ValueError, TypeError):
            return _error("price, total_seats, and seats_left must be numbers.")

        db.execute(
            """UPDATE events
               SET title=?, description=?, date=?, venue=?, price=?,
                   total_seats=?, seats_left=?, category=?, color=?, image=?
               WHERE id=?""",
            (title, description, date, venue, price,
             total_seats, seats_left, category, color, image, event_id),
        )
        db.commit()

        row = db.execute(
            "SELECT * FROM events WHERE id = ?", (event_id,)
        ).fetchone()
        return jsonify(_event_to_dict(row))

    finally:
        db.close()


@app.route("/api/events/<int:event_id>", methods=["DELETE"])
def delete_event(event_id):
    """
    Permanently delete an event (admin only).
    Associated bookings are cascade-deleted by the FK constraint.

    Response 200: { message: "Event deleted successfully." }
    """
    admin = _get_requesting_admin()
    if not admin:
        return _error("Admin access required.", 403)

    db = database.get_db()
    try:
        if not db.execute(
            "SELECT id FROM events WHERE id = ?", (event_id,)
        ).fetchone():
            return _error("Event not found.", 404)

        db.execute("DELETE FROM events WHERE id = ?", (event_id,))
        db.commit()
        return jsonify({"message": "Event deleted successfully."})

    except Exception as exc:
        return _error(f"Failed to delete event: {exc}", 500)
    finally:
        db.close()


# ══════════════════════════════════════════════════════════════
# BOOKING ROUTES
# ══════════════════════════════════════════════════════════════

@app.route("/api/bookings", methods=["POST"])
def create_booking():
    """
    Create a booking and atomically decrement event.seats_left.

    Request body: { user_id, event_id, quantity }
    Response 201: { booking: { ... full booking dict with event details } }
    Errors:
      400 — missing/invalid fields
      404 — user or event not found
      409 — not enough seats available
    """
    data = request.get_json(silent=True) or {}

    try:
        user_id  = int(data.get("user_id")  or 0)
        event_id = int(data.get("event_id") or 0)
        quantity = int(data.get("quantity") or 0)
    except (ValueError, TypeError):
        return _error("user_id, event_id, and quantity must be integers.")

    if not user_id  : return _error("user_id is required.")
    if not event_id : return _error("event_id is required.")
    if quantity < 1 : return _error("Quantity must be at least 1.")
    if quantity > 10: return _error("Maximum 10 tickets per booking.")

    db = database.get_db()
    try:
        # ── Verify user exists
        if not db.execute(
            "SELECT id FROM users WHERE id = ?", (user_id,)
        ).fetchone():
            return _error("User not found.", 404)

        # ── Verify event and seat availability
        event = db.execute(
            "SELECT * FROM events WHERE id = ?", (event_id,)
        ).fetchone()
        if not event:
            return _error("Event not found.", 404)
        if event["seats_left"] < quantity:
            return _error(
                f"Not enough seats. Only {event['seats_left']} left.", 409
            )

        # ── Atomically decrement seats and insert booking
        booking_id = _gen_booking_id()
        total_paid = event["price"] * quantity
        now        = datetime.now(timezone.utc).isoformat()

        db.execute(
            "UPDATE events SET seats_left = seats_left - ? WHERE id = ?",
            (quantity, event_id),
        )
        db.execute(
            """INSERT INTO bookings
                   (id, user_id, event_id, quantity, price_each, total_paid, status)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (booking_id, user_id, event_id, quantity,
             event["price"], total_paid, "Confirmed"),
        )
        db.commit()

        return jsonify({
            "booking": {
                "id":            booking_id,
                "userId":        user_id,
                "eventId":       event_id,
                "eventTitle":    event["title"],
                "eventDate":     event["date"],
                "eventLocation": event["venue"],
                "eventCategory": event["category"],
                "eventColor":    event["color"],
                "quantity":      quantity,
                "priceEach":     event["price"],
                "totalPaid":     total_paid,
                "status":        "Confirmed",
                "bookedAt":      now,
            }
        }), 201

    except Exception as exc:
        return _error(f"Booking failed: {exc}", 500)
    finally:
        db.close()


@app.route("/api/bookings/user/<int:user_id>", methods=["GET"])
def get_user_bookings(user_id):
    """
    Return all bookings for a user, newest first.
    Joins with events to embed event details in each booking row
    (avoids N+1 queries on the history page).
    """
    db = database.get_db()
    try:
        rows = db.execute(
            """SELECT b.*, e.title, e.date, e.venue, e.category, e.color, e.image
               FROM   bookings b
               JOIN   events   e ON b.event_id = e.id
               WHERE  b.user_id = ?
               ORDER  BY b.booking_date DESC""",
            (user_id,),
        ).fetchall()
        return jsonify([_booking_to_dict(r) for r in rows])
    finally:
        db.close()


# ══════════════════════════════════════════════════════════════
# ADMIN STATS ROUTE
# ══════════════════════════════════════════════════════════════

@app.route("/api/admin/stats", methods=["GET"])
def admin_stats():
    """
    Aggregate platform statistics for the admin dashboard stat bar.
    Admin only (verified via X-User-ID header).

    Response 200: {
        events_count, bookings_count, total_revenue, seats_available
    }
    """
    admin = _get_requesting_admin()
    if not admin:
        return _error("Admin access required.", 403)

    db = database.get_db()
    try:
        events_count    = db.execute("SELECT COUNT(*)    FROM events").fetchone()[0]
        bookings_count  = db.execute("SELECT COUNT(*)    FROM bookings").fetchone()[0]
        total_revenue   = db.execute("SELECT SUM(total_paid) FROM bookings").fetchone()[0] or 0.0
        seats_available = db.execute("SELECT SUM(seats_left)  FROM events").fetchone()[0] or 0

        return jsonify({
            "events_count":    events_count,
            "bookings_count":  bookings_count,
            "total_revenue":   round(total_revenue, 2),
            "seats_available": seats_available,
        })
    finally:
        db.close()


# ══════════════════════════════════════════════════════════════
# ENTRY POINT
# ══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    # Initialise DB (create tables + seed) on startup
    print("[SEMP] Initialising database…")
    database.init_db()
    print("[SEMP] Starting Flask server on http://0.0.0.0:5000")
    # debug=True is fine for local dev; set to False in production
    app.run(host="0.0.0.0", port=5000, debug=True)
