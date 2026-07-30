/* ============================================================
 * SMART EVENT MANAGEMENT PORTAL — script.js  (v2 — API backend)
 * ============================================================
 * Data layer migrated from localStorage to a real Flask REST API.
 * All EVENTS, BOOKINGS, and AUTH operations are now async fetch()
 * calls to the backend.
 *
 * To point at a different backend host (Docker / K8s / staging),
 * set window.SEMP_API_BASE before this script loads:
 *
 *   <script>window.SEMP_API_BASE = 'http://backend-service:5000/api';</script>
 *
 * Storage strategy:
 *   sessionStorage → semp_current_user   (auth session; clears on tab close)
 *   localStorage   → semp_dark_mode      (UI preference; survives restarts)
 *   localStorage   → semp_selected_event (event id passed events→booking page)
 * ============================================================ */

'use strict';

/* ─── CONFIGURATION ─────────────────────────────────────────── */
const API_BASE =
  (typeof window !== 'undefined' && window.SEMP_API_BASE)
    ? window.SEMP_API_BASE
    : 'http://localhost:5000/api';

/* ─── STORAGE KEYS — only UI/session state lives here ───────── */
const KEYS = {
  CURRENT_USER:   'semp_current_user',
  DARK_MODE:      'semp_dark_mode',
  SELECTED_EVENT: 'semp_selected_event',  // integer event id
};

/* ─── API — centralised fetch wrapper ───────────────────────── */
/**
 * All data calls go through API.request().
 * - Automatically sets Content-Type and X-User-ID headers.
 * - Throws a plain Error with a readable message on non-2xx responses,
 *   so every caller can just use try/catch + UI.toast.
 */
const API = {
  async request(method, path, body = null) {
    const headers = { 'Content-Type': 'application/json' };

    // Send the logged-in user's ID so the backend can verify admin role
    const user = AUTH.getCurrentUser();
    if (user) headers['X-User-ID'] = String(user.id);

    const opts = { method, headers };
    if (body !== null) opts.body = JSON.stringify(body);

    let res;
    try {
      res = await fetch(API_BASE + path, opts);
    } catch (_networkErr) {
      throw new Error(
        'Cannot reach the server. Make sure the backend is running on ' + API_BASE
      );
    }

    // Parse body whether ok or not (error messages live in the body)
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.error || `Request failed (HTTP ${res.status})`);
    }
    return data;
  },

  get:    (path)       => API.request('GET',    path),
  post:   (path, body) => API.request('POST',   path, body),
  put:    (path, body) => API.request('PUT',    path, body),
  delete: (path)       => API.request('DELETE', path),
};


/* ─── AUTH — session management + async login/register ──────── */
const AUTH = {
  /**
   * Return the logged-in user object from sessionStorage, or null.
   * sessionStorage is scoped to the browser tab and cleared automatically
   * when the tab closes — correct behaviour for an auth session.
   */
  getCurrentUser() {
    return JSON.parse(sessionStorage.getItem(KEYS.CURRENT_USER) || 'null');
  },

  /** Persist the user object to sessionStorage after a successful API call. */
  _setCurrentUser(user) {
    sessionStorage.setItem(KEYS.CURRENT_USER, JSON.stringify(user));
  },

  /**
   * Register a new account via POST /api/register.
   * Stores the returned user in sessionStorage on success.
   * Throws on validation error or duplicate email.
   * @returns {Promise<{user}>}
   */
  async register(name, email, password) {
    const data = await API.post('/register', { name, email, password });
    this._setCurrentUser(data.user);
    return data;
  },

  /**
   * Log in via POST /api/login.
   * Stores the returned user in sessionStorage on success.
   * Throws on wrong credentials.
   * @returns {Promise<{user}>}
   */
  async login(email, password) {
    const data = await API.post('/login', { email, password });
    this._setCurrentUser(data.user);
    return data;
  },

  /** Clear session from sessionStorage and redirect to the login page. */
  logout() {
    sessionStorage.removeItem(KEYS.CURRENT_USER);
    window.location.href = 'index.html';
  },

  /** Redirect to index.html if not authenticated. Returns false if guard triggered. */
  requireAuth() {
    if (!this.getCurrentUser()) {
      window.location.href = 'index.html';
      return false;
    }
    return true;
  },

  /** Redirect to events.html if the user is not an admin. Returns false if guard triggered. */
  requireAdmin() {
    const user = this.getCurrentUser();
    if (!user || user.role !== 'admin') {
      window.location.href = 'events.html';
      return false;
    }
    return true;
  },
};


/* ─── EVENTS — async API calls ──────────────────────────────── */
const EVENTS = {
  /** Fetch all events (sorted by date on the backend). */
  getAll()         { return API.get('/events'); },

  /** Fetch a single event by numeric ID. */
  getById(id)      { return API.get(`/events/${id}`); },

  /** Create a new event. Admin only (X-User-ID header is auto-added). */
  add(data)        { return API.post('/events', data); },

  /** Partial-update an event. Admin only. */
  update(id, data) { return API.put(`/events/${id}`, data); },

  /** Permanently delete an event and its associated bookings. Admin only. */
  delete(id)       { return API.delete(`/events/${id}`); },
};


/* ─── BOOKINGS — async API calls ────────────────────────────── */
const BOOKINGS = {
  /**
   * Create a booking. Throws if seats are insufficient (409).
   * @param {number} userId
   * @param {number} eventId
   * @param {number} quantity
   * @returns {Promise<{booking}>}
   */
  create(userId, eventId, quantity) {
    return API.post('/bookings', {
      user_id:  userId,
      event_id: eventId,
      quantity,
    });
  },

  /** Fetch all bookings for a given user, newest first. */
  getByUser(userId) {
    return API.get(`/bookings/user/${userId}`);
  },
};


/* ─── UI — shared interface utilities ───────────────────────── */
const UI = {
  /**
   * Show a transient toast notification.
   * @param {string} message
   * @param {'info'|'success'|'error'} type
   */
  toast(message, type = 'info') {
    const existing = document.getElementById('toast');
    if (existing) existing.remove();

    const icons  = { success: '✓', error: '✕', info: 'ℹ' };
    const toast  = document.createElement('div');
    toast.id        = 'toast';
    toast.className = `toast toast--${type}`;
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.innerHTML = `
      <span class="toast__icon">${icons[type] || icons.info}</span>
      <span class="toast__message">${message}</span>`;
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('toast--visible'));
    setTimeout(() => {
      toast.classList.remove('toast--visible');
      setTimeout(() => toast.remove(), 400);
    }, 3500);
  },

  initDarkMode() {
    if (localStorage.getItem(KEYS.DARK_MODE) === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
    this._syncDarkModeBtn();
  },

  toggleDarkMode() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (isDark) {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem(KEYS.DARK_MODE, 'light');
    } else {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem(KEYS.DARK_MODE, 'dark');
    }
    this._syncDarkModeBtn();
  },

  _syncDarkModeBtn() {
    const btn = document.getElementById('darkModeToggle');
    if (!btn) return;
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    btn.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
    btn.title    = isDark ? 'Light mode' : 'Dark mode';
    btn.innerHTML = isDark
      ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM11 1h2v3h-2V1zm0 19h2v3h-2v-3zM3.515 4.929l1.414-1.414L7.05 5.636 5.636 7.05 3.515 4.93zM16.95 18.364l1.414-1.414 2.121 2.121-1.414 1.414-2.121-2.121zm2.121-14.85 1.414 1.415-2.121 2.121-1.414-1.414 2.121-2.121zM5.636 16.95l1.414 1.414-2.121 2.121-1.414-1.414 2.121-2.121zM23 11v2h-3v-2h3zM1 11h3v2H1v-2z"/></svg>'
      : '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z"/></svg>';
  },

  initNavbar() {
    const burger   = document.getElementById('navBurger');
    const navLinks = document.getElementById('navLinks');

    if (burger && navLinks) {
      burger.addEventListener('click', () => {
        const open = navLinks.classList.toggle('nav__links--open');
        burger.setAttribute('aria-expanded', String(open));
        if (burger.querySelector('.burger-icon')) {
          burger.querySelector('.burger-icon').textContent = open ? '✕' : '☰';
        }
      });
      navLinks.querySelectorAll('a').forEach(a => {
        a.addEventListener('click', () => {
          navLinks.classList.remove('nav__links--open');
          if (burger.querySelector('.burger-icon')) {
            burger.querySelector('.burger-icon').textContent = '☰';
          }
        });
      });
    }

    // Highlight the current page link
    const page = window.location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.nav__link').forEach(link => {
      if (link.getAttribute('href') === page) link.classList.add('nav__link--active');
    });

    // Display the logged-in user's first name
    const user      = AUTH.getCurrentUser();
    const userBadge = document.getElementById('navUser');
    if (userBadge && user) userBadge.textContent = user.name.split(' ')[0];

    // Show Admin link only for admins
    const adminLink = document.getElementById('adminNavLink');
    if (adminLink && user && user.role === 'admin') adminLink.style.display = 'flex';

    // Logout button
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', e => { e.preventDefault(); AUTH.logout(); });

    // Dark mode toggle
    const dmToggle = document.getElementById('darkModeToggle');
    if (dmToggle) dmToggle.addEventListener('click', () => UI.toggleDarkMode());
  },

  /** Format an ISO date string for display. */
  formatDate(iso, opts = {}) {
    const defaults = {
      weekday: 'long', year: 'numeric', month: 'long',
      day: 'numeric', hour: '2-digit', minute: '2-digit',
    };
    return new Date(iso).toLocaleDateString('en-US', { ...defaults, ...opts });
  },

  formatCurrency(amount) {
    if (Number(amount) === 0) return 'Free';
    return '$' + Number(amount).toFixed(2);
  },

  categoryBadgeClass(category) {
    const map = {
      Music: 'badge--music', Conference: 'badge--conf', Food: 'badge--food',
      Art: 'badge--art', Sports: 'badge--sports', Workshop: 'badge--workshop',
      Film: 'badge--film', Business: 'badge--business',
    };
    return map[category] || 'badge--default';
  },

  /**
   * Disable a button and show a loading label.
   * Returns a restore function to re-enable.
   */
  setLoading(btn, loadingText = 'Please wait…') {
    const orig    = btn.innerHTML;
    btn.disabled  = true;
    btn.innerHTML = loadingText;
    return () => { btn.disabled = false; btn.innerHTML = orig; };
  },

  /** Loading spinner snippet for container elements. */
  loadingHTML(msg = 'Loading…') {
    return `<div class="empty-state" style="padding:var(--sp-10)">
      <div class="empty-state__icon" style="font-size:2rem">⏳</div>
      <p class="empty-state__text">${msg}</p>
    </div>`;
  },
};


/* ═══════════════════════════════════════════════════════════════
 * PAGE INITIALISERS — all async, dispatched at DOMContentLoaded
 * ═══════════════════════════════════════════════════════════════ */

/* ── index.html — Login / Register ──────────────────────────── */
async function initLoginPage() {
  // If already logged in, skip straight to the right page
  const existing = AUTH.getCurrentUser();
  if (existing) {
    window.location.href = existing.role === 'admin' ? 'admin.html' : 'events.html';
    return;
  }

  // Dark mode toggle (the login page has no full navbar)
  const dmToggle = document.getElementById('darkModeToggle');
  if (dmToggle) dmToggle.addEventListener('click', () => UI.toggleDarkMode());

  const tabLogin     = document.getElementById('tabLogin');
  const tabRegister  = document.getElementById('tabRegister');
  const loginForm    = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');

  /* Tab switcher */
  function switchTab(tab) {
    const isLogin = tab === 'login';
    tabLogin.classList.toggle('tab--active',    isLogin);
    tabRegister.classList.toggle('tab--active', !isLogin);
    loginForm.classList.toggle('form--hidden',    !isLogin);
    registerForm.classList.toggle('form--hidden',  isLogin);
    (isLogin ? loginForm : registerForm).querySelector('input')?.focus();
  }
  tabLogin.addEventListener('click',    () => switchTab('login'));
  tabRegister.addEventListener('click', () => switchTab('register'));

  /* Inline error helpers */
  function showError(fieldId, msg) {
    const el = document.getElementById(fieldId + 'Error');
    if (el) { el.textContent = msg; el.hidden = !msg; }
  }
  function clearFormErrors(form) {
    form.querySelectorAll('.field-error').forEach(el => {
      el.textContent = ''; el.hidden = true;
    });
  }

  /* ── Login form submit ── */
  loginForm.addEventListener('submit', async e => {
    e.preventDefault();
    clearFormErrors(loginForm);

    const email    = loginForm.loginEmail.value.trim();
    const password = loginForm.loginPassword.value;
    let valid = true;
    if (!email)    { showError('loginEmail',    'Email is required.');    valid = false; }
    if (!password) { showError('loginPassword', 'Password is required.'); valid = false; }
    if (!valid) return;

    const btn     = loginForm.querySelector('[type=submit]');
    const restore = UI.setLoading(btn, 'Signing in…');

    try {
      const result = await AUTH.login(email, password);
      window.location.href = result.user.role === 'admin' ? 'admin.html' : 'events.html';
    } catch (err) {
      showError('loginEmail', err.message || 'Login failed.');
      restore();
    }
  });

  /* ── Register form submit ── */
  registerForm.addEventListener('submit', async e => {
    e.preventDefault();
    clearFormErrors(registerForm);

    const name     = registerForm.regName.value.trim();
    const email    = registerForm.regEmail.value.trim();
    const password = registerForm.regPassword.value;
    const confirm  = registerForm.regConfirm.value;
    let valid = true;

    if (!name) {
      showError('regName', 'Full name is required.'); valid = false;
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showError('regEmail', 'Please enter a valid email address.'); valid = false;
    }
    if (password.length < 6) {
      showError('regPassword', 'Password must be at least 6 characters.'); valid = false;
    }
    if (password !== confirm) {
      showError('regConfirm', 'Passwords do not match.'); valid = false;
    }
    if (!valid) return;

    const btn     = registerForm.querySelector('[type=submit]');
    const restore = UI.setLoading(btn, 'Creating account…');

    try {
      const result = await AUTH.register(name, email, password);
      UI.toast('Welcome, ' + result.user.name + '! Redirecting…', 'success');
      setTimeout(() => { window.location.href = 'events.html'; }, 900);
    } catch (err) {
      showError('regEmail', err.message || 'Registration failed.');
      restore();
    }
  });
}


/* ── events.html — Browse Events ────────────────────────────── */
async function initEventsPage() {
  if (!AUTH.requireAuth()) return;
  UI.initNavbar();

  const grid         = document.getElementById('eventsGrid');
  const searchInput  = document.getElementById('searchInput');
  const categoryBtns = document.querySelectorAll('.filter-pill');
  const sortSelect   = document.getElementById('sortSelect');
  const resultCount  = document.getElementById('resultCount');

  let allEvents      = [];
  let activeCategory = 'All';

  /* Render event cards from a list of event objects */
  function renderCards(list) {
    if (resultCount) {
      resultCount.textContent = `${list.length} event${list.length !== 1 ? 's' : ''}`;
    }

    if (list.length === 0) {
      grid.innerHTML = `
        <div class="empty-state col-span-all">
          <div class="empty-state__icon">🔍</div>
          <p class="empty-state__title">No events found</p>
          <p class="empty-state__text">Try a different search term or category.</p>
        </div>`;
      return;
    }

    grid.innerHTML = list.map(evt => {
      const seatsPercent = Math.round((evt.seatsLeft / evt.seatsTotal) * 100);
      const seatsLow     = evt.seatsLeft > 0 && seatsPercent < 20;
      const bannerStyle  = evt.image
        ? `background-image:url('${evt.image}');background-size:cover;background-position:center;`
        : `background:${evt.color || '#C8521A'};`;

      return `
        <article class="event-card" tabindex="0" role="button" aria-label="View ${evt.title}">
          <div class="event-card__banner" style="${bannerStyle}">
            <span class="badge ${UI.categoryBadgeClass(evt.category)}">${evt.category}</span>
            ${evt.seatsLeft === 0 ? '<span class="sold-out-ribbon">Sold Out</span>' : ''}
          </div>
          <div class="event-card__body">
            <h3 class="event-card__title">${evt.title}</h3>
            <ul class="event-card__meta">
              <li>
                <svg viewBox="0 0 20 20" fill="currentColor" width="14"><path fill-rule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clip-rule="evenodd"/></svg>
                ${UI.formatDate(evt.date, { weekday: undefined, hour: undefined, minute: undefined, year: 'numeric', month: 'short', day: 'numeric' })}
              </li>
              <li>
                <svg viewBox="0 0 20 20" fill="currentColor" width="14"><path fill-rule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clip-rule="evenodd"/></svg>
                ${evt.location}
              </li>
              <li class="${seatsLow ? 'seats-low' : ''}">
                <svg viewBox="0 0 20 20" fill="currentColor" width="14"><path d="M2 6a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 100 4v2a2 2 0 01-2 2H4a2 2 0 01-2-2v-2a2 2 0 100-4V6z"/></svg>
                ${evt.seatsLeft === 0
                  ? 'Sold out'
                  : `${evt.seatsLeft} seats left${seatsLow ? ' — going fast!' : ''}`}
              </li>
            </ul>
            <p class="event-card__desc">${(evt.description || '').slice(0, 110)}…</p>
            <div class="event-card__footer">
              <span class="event-card__price">${UI.formatCurrency(evt.price)}</span>
              <button class="btn btn--accent btn--sm book-btn" data-id="${evt.id}"
                ${evt.seatsLeft === 0 ? 'disabled aria-disabled="true"' : ''}>
                ${evt.seatsLeft === 0 ? 'Sold Out' : 'Book Now →'}
              </button>
            </div>
          </div>
        </article>`;
    }).join('');

    // Wire up Book Now buttons after cards are in the DOM
    grid.querySelectorAll('.book-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        localStorage.setItem(KEYS.SELECTED_EVENT, btn.dataset.id);
        window.location.href = 'booking.html';
      });
    });
  }

  /* Client-side filter + sort pipeline (data already fetched) */
  function applyFilters() {
    const q  = searchInput ? searchInput.value.toLowerCase() : '';
    let list = allEvents.filter(e => {
      const matchCat = activeCategory === 'All' || e.category === activeCategory;
      const matchQ   = !q
        || (e.title       || '').toLowerCase().includes(q)
        || (e.location    || '').toLowerCase().includes(q)
        || (e.category    || '').toLowerCase().includes(q)
        || (e.description || '').toLowerCase().includes(q);
      return matchCat && matchQ;
    });

    if (sortSelect) {
      switch (sortSelect.value) {
        case 'date':       list.sort((a, b) => new Date(a.date) - new Date(b.date)); break;
        case 'price-asc':  list.sort((a, b) => a.price - b.price);                   break;
        case 'price-desc': list.sort((a, b) => b.price - a.price);                   break;
        case 'seats':      list.sort((a, b) => b.seatsLeft - a.seatsLeft);           break;
      }
    }
    renderCards(list);
  }

  // Show a loading placeholder while the API call is in flight
  grid.innerHTML = UI.loadingHTML('Loading events…');

  try {
    allEvents = await EVENTS.getAll();
  } catch (err) {
    grid.innerHTML = `
      <div class="empty-state col-span-all">
        <div class="empty-state__icon">⚠️</div>
        <p class="empty-state__title">Could not load events</p>
        <p class="empty-state__text">${err.message}</p>
      </div>`;
    return;
  }

  applyFilters();  // first render after data arrives

  // Wire up filter controls (done after initial render)
  if (searchInput) searchInput.addEventListener('input', applyFilters);
  if (sortSelect)  sortSelect.addEventListener('change', applyFilters);
  categoryBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      categoryBtns.forEach(b => b.classList.remove('filter-pill--active'));
      btn.classList.add('filter-pill--active');
      activeCategory = btn.dataset.cat;
      applyFilters();
    });
  });
}


/* ── booking.html — Ticket Booking Flow ─────────────────────── */
async function initBookingPage() {
  if (!AUTH.requireAuth()) return;
  UI.initNavbar();

  const eventId = localStorage.getItem(KEYS.SELECTED_EVENT);
  if (!eventId) { window.location.href = 'events.html'; return; }

  const user = AUTH.getCurrentUser();
  const $    = id => document.getElementById(id);

  // Show loading state in the panel while we fetch event details
  $('bookingFormSection').innerHTML = UI.loadingHTML('Loading event details…');

  let event;
  try {
    event = await EVENTS.getById(eventId);
  } catch (err) {
    UI.toast('Event not found. Redirecting…', 'error');
    setTimeout(() => { window.location.href = 'events.html'; }, 1500);
    return;
  }

  // Restore the booking panel markup (was replaced by the loader)
  $('bookingFormSection').innerHTML = `
    <div class="booking-panel animate-scale-in" aria-label="Book tickets">
      <h2 class="booking-panel__title">Reserve Your Tickets</h2>
      <form id="bookingForm" novalidate>
        <div class="form-group" style="margin-bottom:var(--sp-5)">
          <label class="form-label" for="qtyInput">Number of Tickets</label>
          <div class="qty-stepper" style="margin-top:var(--sp-2)" role="group" aria-label="Ticket quantity">
            <button type="button" class="qty-btn" id="qtyMinus" aria-label="Decrease">−</button>
            <input type="number" id="qtyInput" class="qty-input" value="1" min="1" max="10" aria-label="Ticket quantity"/>
            <button type="button" class="qty-btn" id="qtyPlus" aria-label="Increase">+</button>
          </div>
          <p class="text-muted" style="margin-top:var(--sp-2);font-size:0.8rem">
            Maximum 10 tickets per booking.
          </p>
        </div>
        <div class="booking-total" role="status" aria-live="polite">
          <span class="booking-total__label">Total Amount</span>
          <span class="booking-total__amount" id="totalDisplay">$0.00</span>
        </div>
        <p class="text-muted" style="font-size:0.82rem;margin-bottom:var(--sp-5);line-height:1.6">
          By confirming, you agree that tickets are non-refundable.
          Your booking reference is generated immediately.
        </p>
        <button type="submit" class="btn btn--accent btn--full btn--lg" id="confirmBookingBtn">
          <svg viewBox="0 0 20 20" fill="currentColor" width="18" aria-hidden="true">
            <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
          </svg>
          Confirm Booking
        </button>
      </form>
    </div>`;

  /* Populate event summary sidebar */
  if (event.image) {
    $('bookEventBanner').style.backgroundImage    = `url('${event.image}')`;
    $('bookEventBanner').style.backgroundSize     = 'cover';
    $('bookEventBanner').style.backgroundPosition = 'center';
  } else {
    $('bookEventBanner').style.background = event.color || '#C8521A';
  }
  $('bookEventCategory').textContent = event.category;
  $('bookEventTitle').textContent    = event.title;
  $('bookEventDate').textContent     = UI.formatDate(event.date);
  $('bookEventLocation').textContent = event.location;
  $('bookEventSeats').textContent    = `${event.seatsLeft} seats available`;
  $('bookEventPrice').textContent    = event.price === 0
    ? 'Free admission'
    : `${UI.formatCurrency(event.price)} per ticket`;
  $('bookEventDesc').textContent     = event.description;

  /* Quantity stepper */
  const qtyInput = $('qtyInput');
  const maxQty   = Math.min(10, event.seatsLeft);
  qtyInput.max   = maxQty;

  function updateTotal() {
    const qty      = Math.max(1, Math.min(parseInt(qtyInput.value) || 1, maxQty));
    qtyInput.value = qty;
    $('totalDisplay').textContent = event.price === 0
      ? 'Free'
      : `$${(event.price * qty).toFixed(2)}`;
  }

  $('qtyMinus').addEventListener('click', () => {
    if (parseInt(qtyInput.value) > 1) { qtyInput.value--; updateTotal(); }
  });
  $('qtyPlus').addEventListener('click', () => {
    if (parseInt(qtyInput.value) < maxQty) { qtyInput.value++; updateTotal(); }
  });
  qtyInput.addEventListener('input', updateTotal);
  updateTotal();

  /* Submit booking */
  $('bookingForm').addEventListener('submit', async e => {
    e.preventDefault();
    const qty     = parseInt(qtyInput.value);
    const btn     = $('confirmBookingBtn');
    const restore = UI.setLoading(btn, 'Confirming…');

    try {
      const result = await BOOKINGS.create(user.id, event.id, qty);
      const b      = result.booking;

      // Replace the form with the inline success state
      document.querySelector('.booking-panel').innerHTML = `
        <div class="success-state animate-scale-in">
          <div class="success-icon" aria-hidden="true">🎉</div>
          <h2>You're going!</h2>
          <p style="max-width:340px;margin:0 auto var(--sp-4)">
            Your tickets for <strong>${event.title}</strong> are confirmed. See you there!
          </p>
          <div class="success-details" role="region" aria-label="Booking confirmation">
            <div class="success-detail-row">
              <span>Booking Reference</span><span>${b.id}</span>
            </div>
            <div class="success-detail-row">
              <span>Tickets</span><span>${qty} ticket${qty > 1 ? 's' : ''}</span>
            </div>
            <div class="success-detail-row">
              <span>Total Charged</span><span>${UI.formatCurrency(b.totalPaid)}</span>
            </div>
          </div>
          <div class="success-actions">
            <a href="history.html" class="btn btn--accent btn--lg">View My Bookings</a>
            <a href="events.html"  class="btn btn--outline btn--lg">Browse More Events</a>
          </div>
        </div>`;

      localStorage.removeItem(KEYS.SELECTED_EVENT);
    } catch (err) {
      UI.toast(err.message, 'error');
      restore();
    }
  });
}


/* ── history.html — Booking History ─────────────────────────── */
async function initHistoryPage() {
  if (!AUTH.requireAuth()) return;
  UI.initNavbar();

  const user       = AUTH.getCurrentUser();
  const container  = document.getElementById('historyContainer');
  const emptyState = document.getElementById('historyEmpty');
  const statsBar   = document.getElementById('historyStats');

  container.innerHTML = UI.loadingHTML('Loading your bookings…');

  let bookings;
  try {
    bookings = await BOOKINGS.getByUser(user.id);
  } catch (err) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon">⚠️</div>
        <p class="empty-state__title">Could not load bookings</p>
        <p class="empty-state__text">${err.message}</p>
      </div>`;
    return;
  }

  if (bookings.length === 0) {
    container.innerHTML = '';
    if (emptyState) emptyState.hidden = false;
    if (statsBar)   statsBar.hidden   = true;
    return;
  }

  /* Stats bar */
  const totalSpent   = bookings.reduce((s, b) => s + b.totalPaid, 0);
  const totalTickets = bookings.reduce((s, b) => s + b.quantity,  0);
  document.getElementById('statTotalBookings').textContent = bookings.length;
  document.getElementById('statTotalTickets').textContent  = totalTickets;
  document.getElementById('statTotalSpent').textContent    = UI.formatCurrency(totalSpent);

  /* Booking cards */
  container.innerHTML = bookings.map(b => `
    <div class="history-card" style="--card-accent:${b.eventColor || '#C8521A'}">
      <div class="history-card__accent-bar"></div>
      <div class="history-card__content">
        <div class="history-card__header">
          <div class="history-card__info">
            <span class="badge ${UI.categoryBadgeClass(b.eventCategory)}">${b.eventCategory}</span>
            <h3 class="history-card__title">${b.eventTitle}</h3>
          </div>
          <span class="status-badge status--${(b.status || 'confirmed').toLowerCase()}">${b.status}</span>
        </div>
        <div class="history-card__meta">
          <span>
            <svg viewBox="0 0 20 20" fill="currentColor" width="14"><path fill-rule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clip-rule="evenodd"/></svg>
            ${UI.formatDate(b.eventDate, { weekday: undefined, hour: undefined, minute: undefined, year: 'numeric', month: 'long', day: 'numeric' })}
          </span>
          <span>
            <svg viewBox="0 0 20 20" fill="currentColor" width="14"><path fill-rule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clip-rule="evenodd"/></svg>
            ${b.eventLocation}
          </span>
          <span>
            <svg viewBox="0 0 20 20" fill="currentColor" width="14"><path d="M2 6a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 100 4v2a2 2 0 01-2 2H4a2 2 0 01-2-2v-2a2 2 0 100-4V6z"/></svg>
            ${b.quantity} ticket${b.quantity > 1 ? 's' : ''}
          </span>
          <span class="history-card__total">${UI.formatCurrency(b.totalPaid)}</span>
        </div>
        <div class="history-card__footer">
          <code class="booking-ref">${b.id}</code>
          <span class="history-card__date">Booked ${UI.formatDate(b.bookedAt, { weekday: undefined, hour: undefined, minute: undefined, year: 'numeric', month: 'short', day: 'numeric' })}</span>
        </div>
      </div>
    </div>`
  ).join('');
}


/* ── admin.html — Admin Dashboard ───────────────────────────── */
async function initAdminPage() {
  if (!AUTH.requireAdmin()) return;
  UI.initNavbar();

  /* ── Stats bar ─────────────────────────────────────────────── */
  async function renderStats() {
    try {
      const s = await API.get('/admin/stats');
      document.getElementById('statTotalEvents').textContent   = s.events_count;
      document.getElementById('statTotalBookings').textContent = s.bookings_count;
      document.getElementById('statTotalRevenue').textContent  = UI.formatCurrency(s.total_revenue);
      document.getElementById('statSeatsAvail').textContent    = s.seats_available;
    } catch (err) {
      UI.toast('Could not load stats: ' + err.message, 'error');
    }
  }

  /* ── Events table ──────────────────────────────────────────── */
  async function renderEventTable() {
    const tbody = document.getElementById('eventsTableBody');
    tbody.innerHTML = `<tr><td colspan="7" class="table-empty">Loading…</td></tr>`;

    let events;
    try {
      events = await EVENTS.getAll();
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7" class="table-empty" style="color:#D4361C">${err.message}</td></tr>`;
      return;
    }

    if (events.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="table-empty">No events yet. Add one above.</td></tr>`;
      return;
    }

    tbody.innerHTML = events.map(e => `
      <tr data-id="${e.id}">
        <td>
          <div class="table-event-name">
            <span class="table-color-dot" style="background:${e.color}"></span>
            <strong>${e.title}</strong>
          </div>
        </td>
        <td><span class="badge ${UI.categoryBadgeClass(e.category)}">${e.category}</span></td>
        <td>${UI.formatDate(e.date, { weekday: undefined, hour: undefined, minute: undefined, year: 'numeric', month: 'short', day: 'numeric' })}</td>
        <td class="td-location">${e.location}</td>
        <td>${UI.formatCurrency(e.price)}</td>
        <td>
          <span class="${e.seatsLeft < e.seatsTotal * 0.2 ? 'seats-low' : ''}">${e.seatsLeft}</span>
          <span class="td-muted"> / ${e.seatsTotal}</span>
        </td>
        <td class="table-actions">
          <button class="btn btn--sm btn--outline edit-btn"   data-id="${e.id}">Edit</button>
          <button class="btn btn--sm btn--danger  delete-btn" data-id="${e.id}">Delete</button>
        </td>
      </tr>`
    ).join('');

    /* Wire Edit buttons */
    tbody.querySelectorAll('.edit-btn').forEach(btn => {
      btn.addEventListener('click', () => openEditModal(btn.dataset.id, events));
    });

    /* Wire Delete buttons */
    tbody.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Permanently delete this event? This cannot be undone.')) return;
        const restore = UI.setLoading(btn, '…');
        try {
          await EVENTS.delete(btn.dataset.id);
          await Promise.all([renderEventTable(), renderStats()]);
          UI.toast('Event deleted.', 'info');
        } catch (err) {
          UI.toast(err.message, 'error');
          restore();
        }
      });
    });
  }

  /* ── Add Event form ────────────────────────────────────────── */
  const addForm        = document.getElementById('addEventForm');
  const addToggle      = document.getElementById('toggleAddForm');
  const addFormSection = document.getElementById('addEventSection');

  addToggle.addEventListener('click', () => {
    const isOpen = addFormSection.classList.toggle('section--open');
    addToggle.textContent = isOpen ? '✕  Cancel' : '+  Add New Event';
    addToggle.classList.toggle('btn--outline', isOpen);
    addToggle.classList.toggle('btn--accent',  !isOpen);
  });

  addForm.addEventListener('submit', async e => {
    e.preventDefault();
    const btn     = addForm.querySelector('[type=submit]');
    const restore = UI.setLoading(btn, 'Adding…');

    const data = {
      title:       addForm.evtTitle.value.trim(),
      category:    addForm.evtCategory.value,
      date:        addForm.evtDate.value,
      venue:       addForm.evtLocation.value.trim(),   // backend column name
      location:    addForm.evtLocation.value.trim(),   // frontend alias
      price:       parseFloat(addForm.evtPrice.value)  || 0,
      total_seats: parseInt(addForm.evtSeats.value)    || 0,
      seatsTotal:  parseInt(addForm.evtSeats.value)    || 0,
      description: addForm.evtDesc.value.trim(),
      color:       addForm.evtColor.value,
      image:       '',
    };

    try {
      await EVENTS.add(data);
      addForm.reset();
      addForm.evtColor.value = '#C8521A';
      addFormSection.classList.remove('section--open');
      addToggle.textContent = '+  Add New Event';
      addToggle.classList.add('btn--accent');
      addToggle.classList.remove('btn--outline');
      await Promise.all([renderEventTable(), renderStats()]);
      UI.toast('Event added successfully!', 'success');
    } catch (err) {
      UI.toast(err.message, 'error');
    } finally {
      restore();
    }
  });

  /* ── Edit Modal ────────────────────────────────────────────── */
  const modal      = document.getElementById('editModal');
  const editForm   = document.getElementById('editEventForm');
  const closeBtn   = document.getElementById('closeModal');
  let   editingId  = null;

  function openEditModal(id, eventsList) {
    // Find from the passed list so we avoid an extra API round-trip
    const evt = eventsList.find(e => String(e.id) === String(id));
    if (!evt) { UI.toast('Event not found.', 'error'); return; }
    editingId = id;

    editForm.editTitle.value     = evt.title;
    editForm.editCategory.value  = evt.category;
    editForm.editDate.value      = evt.date;
    editForm.editLocation.value  = evt.location;
    editForm.editPrice.value     = evt.price;
    editForm.editSeats.value     = evt.seatsTotal;
    editForm.editSeatsLeft.value = evt.seatsLeft;
    editForm.editDesc.value      = evt.description || '';
    editForm.editColor.value     = evt.color || '#C8521A';

    modal.classList.add('modal--open');
    document.body.classList.add('body--modal-open');
    closeBtn.focus();
  }

  function closeEditModal() {
    modal.classList.remove('modal--open');
    document.body.classList.remove('body--modal-open');
    editingId = null;
  }

  closeBtn.addEventListener('click', closeEditModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeEditModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeEditModal(); });

  editForm.addEventListener('submit', async e => {
    e.preventDefault();
    const btn     = editForm.querySelector('[type=submit]');
    const restore = UI.setLoading(btn, 'Saving…');

    const data = {
      title:       editForm.editTitle.value.trim(),
      category:    editForm.editCategory.value,
      date:        editForm.editDate.value,
      venue:       editForm.editLocation.value.trim(),
      location:    editForm.editLocation.value.trim(),
      price:       parseFloat(editForm.editPrice.value)     || 0,
      total_seats: parseInt(editForm.editSeats.value)       || 0,
      seatsTotal:  parseInt(editForm.editSeats.value)       || 0,
      seats_left:  parseInt(editForm.editSeatsLeft.value)   || 0,
      seatsLeft:   parseInt(editForm.editSeatsLeft.value)   || 0,
      description: editForm.editDesc.value.trim(),
      color:       editForm.editColor.value,
    };

    try {
      await EVENTS.update(editingId, data);
      closeEditModal();
      await Promise.all([renderEventTable(), renderStats()]);
      UI.toast('Event updated successfully!', 'success');
    } catch (err) {
      UI.toast(err.message, 'error');
    } finally {
      restore();
    }
  });

  // Initial load — stats and table in parallel for speed
  await Promise.all([renderStats(), renderEventTable()]);
}


/* ═══════════════════════════════════════════════════════════════
 * BOOT — apply theme + route to page init on DOM ready
 * ═══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  UI.initDarkMode();

  const page = window.location.pathname.split('/').pop() || 'index.html';
  if (page === 'index.html'  || page === '') initLoginPage();
  if (page === 'events.html')                initEventsPage();
  if (page === 'booking.html')               initBookingPage();
  if (page === 'history.html')               initHistoryPage();
  if (page === 'admin.html')                 initAdminPage();
});
