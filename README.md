# SuperPumped Guess

GeoGuessr-style MVP with a React/Vite frontend, an Express API, Solana wallet sign-in, curated world drops, server-authoritative quota enforcement, and mocked payment/reward rails.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` from `.env.example`.

3. Add a Google Maps browser key to `VITE_GOOGLE_MAPS_API_KEY` to enable Street View and the guess map.

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
- `POST /api/attempts/:roundId/checkout-intent`

## Notes

- Three rounds are free each UTC day per wallet.
- The fourth and later rounds require a mocked `$1` checkout unlock.
- Reward eligibility defaults to guesses within `50 km`.
- Payments and SP transfers are mocked, but recorded through durable backend events.
