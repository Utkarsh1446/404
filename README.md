# 404 notfound

Guess locations and earn NOTF with a React/Vite frontend, an Express API, Solana wallet sign-in, regular two-location rounds, separate scheduled Drops, server-authoritative quota enforcement, and in-game wallet accounting.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` from `.env.example`.

3. Add a Google Maps browser key to `VITE_GOOGLE_MAPS_API_KEY` to enable Street View and the guess map.

4. For any deployed backend, set `STORAGE_FILE` to a persistent path. Local development can use the default `server/data/runtime-store.json`.

## Scripts

- `npm run dev` starts both the API and Vite client.
- `npm run dev:client` starts only the frontend.
- `npm run dev:server` starts only the API.
- `npm run build` builds the frontend.
- `npm run lint` runs ESLint.
- `npm run test` runs the API tests.

## API

- `POST /api/auth/wallet/challenge`
- `POST /api/auth/wallet/verify`
- `GET /api/me/quota`
- `POST /api/rounds/start`
- `POST /api/rounds/:roundId/guess`
- `GET /api/rounds/:roundId/result`
- `GET /api/health`

## Render backend persistence

The backend stores wallet balances, usernames, daily free-game usage, drop participations, winners, rooms, and reward events in the JSON file configured by `STORAGE_FILE`.

On Render, the normal app filesystem is replaced on deploy. If `STORAGE_FILE` points inside the repo, quota and balances will reset after redeploy. Add a Render Disk and use that disk path instead:

1. In the backend service, add a persistent disk mounted at `/var/data`.
2. Set backend env var `STORAGE_FILE=/var/data/runtime-store.json`.
3. Redeploy the backend.
4. Open `/api/health` and confirm:

```json
{
  "storage": {
    "configured": true,
    "usingRenderDisk": true
  }
}
```

If `usingRenderDisk` is `false` on Render, daily limits and NOTF balances are not durable.

## Notes

- Three rounds are free each UTC day per wallet.
- The fourth and later regular games cost `10 NOTF` from the wallet balance.
- New wallets receive `100 NOTF`; existing wallets get a one-time `+100 NOTF` migration when touched by the backend.
- Regular rounds use two locations with 90 seconds per location.
- Drops are a separate scheduled landing experience and do not change regular round timing.
- Reward eligibility defaults to guesses within `50 km`.
- NOTF rewards and spend are server-authoritative, but only durable when the backend storage file is on persistent storage.
