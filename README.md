# Queue token system

A virtual queue for clinics, salons, and small shops. A customer opens a link or scans a QR code on their phone, enters a name, and gets a number. They see how many people are ahead of them, get a "your turn is near" notification, and watch estimated waits update live. The owner runs the line from any browser by calling, skipping, or pausing numbers, and tracking service stats in a visual chart.

## Features

- **Customer view**: join by link or QR code, get a number, see people ahead, live wait estimates, a prominent **"your turn is near"** alert + optional browser notification, and a clear "it is your turn" or "you have been served" status.
- **Owner dashboard**: real-time QR code generator for customer scanning, shareable customer link, call next, **skip no-shows**, pause and resume, waiting list with names, and **Today's Stats** with a visual service times chart (served, skipped, avg wait).
- **Live updates** over WebSockets (Socket.io), with no page refresh.
- **Offline tolerance**: the app shell is cached by a Service Worker, and the customer's number and the last queue status are kept in IndexedDB. A banner shows when the connection is lost and when the last update arrived.
- **Privacy by design**: customers only see queue numbers, never other people's names. A name is erased when that person is served or skipped.
- **Accessible by default**: semantic HTML, labelled inputs, visible keyboard focus, live-region announcements for status changes, light and dark themes, and reduced-motion support.

## Architecture

```
Browser (client side)
[Customer PWA: React + TS]  [Owner dashboard: React + TS]  [Offline layer: Cache + IDB]
        | loads app                                     | HTTPS + WebSocket
        v                                               v
 CloudFront + S3 (static files)                 Node.js backend (Express + Socket.io)
                                                        | read / write
                                                        v
                                                MongoDB (queues, tickets, stats)
```

1. Staff create a queue and get a 6-character code and a secret owner key. The server stores only a hash of the key. The key itself stays in the browser that created the queue.
2. Customers scan the QR code displayed on the owner dashboard or open `/#/q/<CODE>` to join.
3. When the owner calls the next number, the current ticket is marked served, the next waiting ticket is called, and the new state is broadcast to everyone watching that queue.
4. If a customer is absent, the owner can click **Skip number** to advance the line without falsely marking them as served.
5. Wait estimate = (your position in line) x (average of recent service times).

## Tech stack

- Client: React 18, TypeScript, Vite, socket.io-client, qrcode, plain CSS, IndexedDB, Service Worker
- Server: Node.js 18+ (ES modules), Express, Socket.io, MongoDB native driver
- Database: MongoDB (version 5.0 or newer). Collections and indexes are created automatically on startup.
- Hosting target: S3 + CloudFront for the client, any Node host for the server, MongoDB Atlas for managed data.

## Project structure

```
server/
  index.js                 HTTP routes, WebSocket server, startup
  db.js                    Schema, queries, atomic operations, cleanup
  test/e2e.mjs             End-to-end test (starts server, uses real MongoDB)
  test/smoke.mjs           Workflow check to run against a deployed backend
  .env.example
client/
  index.html
  public/
    favicon.svg
    manifest.webmanifest
    sw.js                  Service Worker (app shell caching)
    privacy.html           Privacy policy
    terms.html             Terms and conditions
  src/
    main.tsx               Entry point, registers Service Worker
    App.tsx                Home, customer view (with QR & near notifications), owner dashboard (with QR & stats chart)
    status.ts              Determines ticket state (waiting, called, served)
    status.test.ts         Unit tests for status.ts
    useQueue.ts            Live updates, state synchronization, offline caching
    api.ts                 API types, endpoints, and helpers
    idb.ts                 IndexedDB promise wrapper
    config.ts              Brand name and contact email
    styles.css             Responsive, accessible CSS
```

## Run locally

Requires Node.js 18 or newer and a MongoDB instance. You can start MongoDB with Docker:

```bash
docker run --name mongo -p 27017:27017 -d mongo:latest
```

Then:

```bash
# terminal 1
cd server
npm install
npm start                                                                # http://localhost:4000

# terminal 2
cd client
npm install
npm run dev                                                              # http://localhost:5173
```

Open `http://localhost:5173`, create a queue, then scan the on-screen QR code from your phone or open the customer link in another tab.

## Tests

```bash
# Server: end-to-end test against MongoDB
cd server
npm test

# Client: unit tests for ticket status, plus a type-check and build
cd client
npm test
npm run build
```

The server test validates:
- Owner queue creation & secret hash protection
- Input validation & bounds
- Real-time WebSocket broadcasts on join
- Owner key authorization
- Queue pause & resume blocking
- Calling next ticket
- Skipping no-show customers
- Served status, service duration calculation, and customer name erasure
- 25 simultaneous atomic joins with zero gaps or duplicates
- Data persistence across server restart
- Automatic 7-day inactivity purge

## Configuration

| Variable | Where | Default | Purpose |
| --- | --- | --- | --- |
| `MONGODB_URI` | server | `mongodb://localhost:27017/queue` | MongoDB connection string. Atlas strings usually include `+srv://`. |
| `CLIENT_ORIGIN` | server | any origin | Site URL allowed to call the API (e.g. `https://yourdomain.com`). |
| `PORT` | server | `4000` | Port to listen on. |
| `VITE_API_URL` | client (build time) | `http://localhost:4000` | Backend URL |

## API

All bodies are JSON. Owner routes require `x-owner-key: <key>`.

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/health` | none | Health check reaching MongoDB. |
| POST | `/api/queues` | none | Create a queue. Body: `{ "name": "..." }`. Returns `{ id, ownerKey }`. |
| GET | `/api/queues/:id` | none | Public state: name, paused, nowServing, avgMinutes, servedCount, skippedCount, waiting numbers, history. |
| POST | `/api/queues/:id/join` | none | Join line. Body: `{ "name": "..." }`. Returns `{ number, state }`. |
| GET | `/api/queues/:id/owner` | owner | Names of people waiting and being served. |
| POST | `/api/queues/:id/next` | owner | Mark current served and call next. |
| POST | `/api/queues/:id/skip` | owner | Mark current skipped (no-show) and call next. |
| POST | `/api/queues/:id/pause` | owner | Toggle queue pause. |
