# Sports Coach Booking System — CoachConnect Full Stack

A production-ready full-stack sports coach booking platform. The backend provides authentication & RBAC, coach profiles, availability/time-slot management, conflict-safe bookings, Stripe payments, reviews, notifications, and admin reporting. The Vite React frontend provides the public discovery experience, auth flows, booking journey, responsive dashboards, notifications, and admin command center.

## Tech Stack

- **Runtime:** Node.js 18+, Express.js
| POST | `/users/profile/image` | Authenticated | Upload profile image (multipart `image` field) |
- **Database:** MySQL 8+ via Sequelize ORM
- **Auth:** JWT (stateless), bcrypt password hashing
- **Payments:** Stripe
- **Validation:** express-validator
- **Security:** helmet, cors, hpp, xss-clean, rate limiting

## Folder Structure

```
backend/
├── config/          # DB connection + sequelize-cli config
├── controllers/      # Request handlers
├── middleware/        # auth, RBAC, error handling, rate limiting, uploads
├── models/            # Sequelize models + associations
├── routes/            # Express routers
├── services/           # Business logic (booking conflict handling, payments, email, notifications)
├── utils/              # ApiError, ApiResponse, logger, token helpers
├── validators/          # express-validator rule sets
├── database/
│   ├── migrations/       # Schema migrations (sequelize-cli)
│   └── seeders/           # Roles + sport category seed data
├── tests/                 # Jest + Supertest
├── uploads/coaches/        # Uploaded coach profile images
├── app.js                   # Express app (middleware + routes)
└── server.js                 # Entry point (DB connect + listen)
```

## 1. Installation

```bash
cd backend
npm install
```

In a second terminal, install and run the frontend:

```bash
cd frontend
npm install
copy .env.example .env
npm run dev
```

The frontend runs at `http://localhost:3000` and proxies `/api` and `/uploads` to the backend at `http://localhost:5001`. Set `VITE_API_URL` when the API is hosted elsewhere, and `VITE_STRIPE_PUBLISHABLE_KEY` (the `pk_test_...` counterpart to the backend's `STRIPE_SECRET_KEY`) to enable the in-app checkout — without it, the payment step shows a message instead of the Stripe form.

## 2. Configure environment

```bash
cp .env.example .env
```

Fill in `.env` with your MySQL credentials, JWT secrets (use long random strings — e.g. `openssl rand -hex 32`), Stripe test keys, and SMTP credentials.

## 3. Create & migrate the database

```bash
npm run db:create      # creates the database from DB_NAME in .env
npm run migrate        # runs all migrations
npm run seed           # seeds roles, sport categories, and one admin account
```

Registration (`POST /auth/register`) only accepts `role: "coach"` or `role: "client"` — there is no public signup path to an admin account. The seed step above creates exactly one admin user from `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env` (defaults to `admin@coachconnect.dev` / `ChangeMe123!` if unset). Log in with those credentials and change the password immediately in any shared environment.

## 4. Run the server

```bash
npm run dev     # nodemon, development
npm start       # production
```

Build the frontend for deployment with `cd frontend && npm run build`; serve the generated `frontend/dist` directory from your web host or CDN.

The API is served at `http://localhost:5001/api` (configurable via `PORT` / `API_PREFIX`). A health check is available at `GET /health`.

## 5. Run tests

Tests run against a separate `<DB_NAME>_test` database and rebuild the schema via `sequelize.sync()` — no migrations needed for tests.

```bash
NODE_ENV=test npm test
```

## 6. Stripe webhook (local development)

```bash
stripe listen --forward-to localhost:5000/api/payments/webhook
```

Copy the printed webhook signing secret into `STRIPE_WEBHOOK_SECRET` in `.env`.

---

## Roles

| Role   | Capabilities |
|--------|--------------|
| `admin`  | Full access: manage users, coaches, bookings, sport categories, reviews, payments, dashboard stats |
| `coach`  | Manage own coach profile, availability, specializations; view/confirm/complete own bookings |
| `client` | Browse coaches, book/cancel/reschedule sessions, pay, leave reviews |

## Authentication

All protected endpoints require:

```
Authorization: Bearer <jwt>
```

Obtain a token from `POST /api/auth/register` or `POST /api/auth/login`.

---

## API Reference

Base URL: `/api`

### Auth

| Method | Endpoint | Access | Description |
|---|---|---|---|
| POST | `/auth/register` | Public | Register as `coach` or `client` |
| POST | `/auth/login` | Public | Login, returns JWT |
| POST | `/auth/logout` | Public | Client discards the token (stateless) |
| POST | `/auth/forgot-password` | Public | Emails a password reset link |
| POST | `/auth/reset-password` | Public | Resets password using the emailed token |

**POST /auth/register**
```json
// Request
{ "name": "Jane Doe", "email": "jane@example.com", "password": "Passw0rd!", "role": "client" }

// 201 Response
{
  "success": true,
  "message": "Registration successful",
  "data": {
    "user": { "id": "uuid", "name": "Jane Doe", "email": "jane@example.com", "role": { "name": "client" } },
    "token": "eyJhbGciOi..."
  }
}
```

**POST /auth/login**
```json
// Request
{ "email": "jane@example.com", "password": "Passw0rd!" }
// 200 Response -> { "success": true, "data": { "user": {...}, "token": "..." } }
```

### Users

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | `/users/profile` | Authenticated | Get own profile |
| PUT | `/users/profile` | Authenticated | Update own profile |
| POST | `/users/profile/image` | Authenticated | Upload profile image (multipart `image` field) |

### Messages

Messages are available to athletes and coaches who share a booking. Use the booking id to keep each conversation scoped to the relevant session.

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | `/messages?bookingId=:id` | Athlete / Coach | List and mark conversation messages as read |
| POST | `/messages` | Athlete / Coach | Send a message with `{ "bookingId": "uuid", "content": "..." }` |

### Coaches

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | `/coaches?sport=&city=&minPrice=&maxPrice=&minRating=&date=&page=&limit=` | Public | Search/filter coaches |
| GET | `/coaches/:id` | Public | Coach details |
| GET | `/coaches/:id/availability?from=&to=` | Public | Recurring rules + open time slots |
| GET | `/coaches/:id/reviews` | Public | Approved reviews for a coach |
| POST | `/coaches` | Admin | Create a coach profile for an existing user |
| PUT | `/coaches/:id` | Coach (own) / Admin | Update bio, rate, specializations |
| DELETE | `/coaches/:id` | Admin | Delete a coach profile |
| POST | `/coaches/:id/image` | Coach (own) / Admin | Upload profile image (multipart `image` field) |

**GET /coaches?sport=Tennis&city=Austin&minPrice=20&maxPrice=100&minRating=4**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid", "hourlyRate": "45.00", "city": "Austin", "averageRating": "4.80",
      "user": { "name": "Coach Mike", "profileImage": "/uploads/coaches/xyz.jpg" },
      "specializations": [{ "sportCategory": { "name": "Tennis" } }]
    }
  ],
  "meta": { "total": 1, "page": 1, "limit": 20, "totalPages": 1 }
}
```

### Availability

| Method | Endpoint | Access | Description |
|---|---|---|---|
| POST | `/coaches/availability` | Coach (own) / Admin | Define a recurring or one-off window |
| PUT | `/coaches/availability/:id` | Coach (own) / Admin | Update a window |
| DELETE | `/coaches/availability/:id` | Coach (own) / Admin | Remove a window |
| POST | `/coaches/availability/:id/generate-slots` | Coach (own) / Admin | Materialize bookable `TimeSlot`s for a date range |

**POST /coaches/availability**
```json
{ "coachId": "uuid", "isRecurring": true, "dayOfWeek": 1, "startTime": "09:00", "endTime": "17:00" }
```

**POST /coaches/availability/:id/generate-slots**
```json
{ "from": "2026-09-01", "to": "2026-09-30", "slotDurationMinutes": 60 }
```

### Bookings

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | `/bookings?status=&timeframe=upcoming|past&page=&limit=` | Authenticated | Role-scoped list |
| GET | `/bookings/:id` | Owner (client/coach) / Admin | Booking detail |
| POST | `/bookings` | Client | Create a booking (status starts `pending`) |
| PUT | `/bookings/:id` | Coach (own) / Admin | Transition status (`confirmed`, `completed`, `cancelled`) |
| POST | `/bookings/:id/cancel` | Owner / Admin | Cancel and free the time slot |
| POST | `/bookings/:id/reschedule` | Owner / Admin | Move to a new time slot |

**POST /bookings**
```json
// Request
{ "coachId": "uuid", "timeSlotId": "uuid", "sportCategoryId": "uuid", "notes": "First session" }

// 201 Response
{ "success": true, "message": "Booking created, awaiting payment confirmation",
  "data": { "id": "uuid", "status": "pending", "price": "45.00", "timeSlot": {...} } }

// 409 Response if the slot was just taken by someone else
{ "success": false, "message": "This time slot is no longer available" }
```

#### Double-booking prevention

`POST /bookings` locks the target `TimeSlot` row with `SELECT ... FOR UPDATE` inside a database transaction (see [services/booking.service.js](services/booking.service.js)). A concurrent request for the same slot blocks on that row lock until the first transaction commits, then re-reads the now-`booked` status and is rejected with `409 Conflict`. A unique index on `(coach_id, date, start_time)` backs this up at the schema level. `tests/booking.test.js` exercises this with two simultaneous requests.

### Payments

| Method | Endpoint | Access | Description |
|---|---|---|---|
| POST | `/payments` | Client (own booking) / Admin | Create a Stripe PaymentIntent |
| GET | `/payments` | Authenticated | Role-scoped list |
| GET | `/payments/:id` | Owner / Admin | Payment detail |
| POST | `/payments/webhook` | Stripe only (signature-verified) | Marks payment `paid`/`failed` and confirms/notifies |

**POST /payments**
```json
// Request
{ "bookingId": "uuid" }
// 201 Response
{ "success": true, "data": { "payment": { "status": "pending", "amount": "45.00" }, "clientSecret": "pi_..._secret_..." } }
```

The `clientSecret` is passed to Stripe.js/Elements on the frontend to complete the charge. The webhook is the single source of truth for marking a payment `paid` and the booking `confirmed` — never trust a client-reported success.

### Reviews

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | `/coaches/:id/reviews` | Public | List approved reviews |
| POST | `/reviews` | Client | Review a `completed` booking (one per booking) |
| PUT | `/reviews/:id` | Owner (rating/comment) / Admin (moderation fields) | Edit or moderate |
| DELETE | `/reviews/:id` | Owner / Admin | Delete (recalculates coach rating) |

### Notifications

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | `/notifications?unreadOnly=true` | Authenticated | List own notifications |
| PUT | `/notifications/:id/read` | Owner | Mark as read |

### Sport Categories

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | `/sport-categories` | Public | List active categories |
| POST | `/sport-categories` | Admin | Create |
| PUT | `/sport-categories/:id` | Admin | Update |
| DELETE | `/sport-categories/:id` | Admin | Delete |

### Admin

| Method | Endpoint | Description |
|---|---|---|
| GET | `/admin/dashboard/stats` | User/coach/client counts, bookings by status, total revenue, flagged review count, recent bookings |
| GET | `/admin/reviews?flagged=&approved=` | Moderation queue — all reviews (not just approved ones), with client/coach details |
| GET | `/admin/users?role=&isActive=&search=` | List users |
| POST | `/admin/users` | Admin | Create a user and assign `admin`, `coach`, or `client` role |
| GET | `/admin/users/:id` | User detail |
| PUT | `/admin/users/:id` | Update / activate / deactivate |
| DELETE | `/admin/users/:id` | Delete user |
| PUT | `/admin/coaches/:id/verify` | Toggle coach verification badge |

---

## Error format

```json
{ "success": false, "message": "This time slot is no longer available", "errors": ["optional detail array"] }
```

## Response envelope

```json
{ "success": true, "message": "...", "data": {}, "meta": { "total": 0, "page": 1, "limit": 20, "totalPages": 0 } }
```

## Security notes

- All queries go through Sequelize's parameterized query builder — no raw string interpolation, which rules out SQL injection.
- Passwords are hashed with bcrypt (`BCRYPT_SALT_ROUNDS`, default 12) and never returned in API responses (`User`'s `defaultScope` excludes them).
- `authenticate` + `authorize(...)` middleware enforce RBAC on every non-public route.
- Global + auth-specific rate limiting (`express-rate-limit`) mitigate brute force.
- `helmet`, `hpp`, `xss-clean`, and a strict CORS allowlist harden HTTP headers and inputs.
- All secrets live in `.env` (see `.env.example`), never committed.
