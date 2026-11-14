# notf relayer worker

Prepared Cloudflare Worker for the same HTTP API as `relayer/server.js`. It is not deployed.

The Worker signs with `RELAYER_PRIVATE_KEY` from the environment. That value is a Wrangler secret, not a var in `wrangler.toml`, and it is not in git. Testnet RPC only: a URL that does not contain `testnet`, or that contains `mainnet`, is refused.

## Routes

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/health` | `{ ok, network: "testnet", ready }`. `ready` is true only when the key, the account id, and the `ROUNDS` KV binding are all set. |
| POST | `/session` | Body `{ publicKey }`. Funds a new implicit account with 0.03 testnet NEAR (15 new guests per KV list) and calls `claim_starter` if needed. |
| POST | `/rounds/start` | Body `{ accountId }`. `commit_round` on the game contract. The salt is stored in KV for two hours. |
| POST | `/relay` | Body `{ signedDelegate }`. Submits a NEP-366 delegate action whose only call is `submit_guess`, with no deposit and at most 150 TGas. |
| POST | `/rounds/:id/reveal` | `reveal_and_settle` using the salt from KV. |

## Before any deploy

1. `npx wrangler kv namespace create ROUNDS` and replace the placeholder ids in `wrangler.toml`.
2. `npx wrangler secret put RELAYER_PRIVATE_KEY` with the relayer account's `ed25519:` secret.
3. Confirm `[vars]` still point at the testnet contracts in `src/chain/testnet.json`.
4. `npx wrangler deploy` from this directory. This repository does not run that command.

Point a Pages build at the worker with `VITE_RELAYER_URL=https://<worker-host>`. Leave that variable empty to keep the static site in demo mode. A `http://127.0.0.1` value is ignored when the page itself is not served from localhost, so a Pages build cannot call the visitor's machine.

`/health` can be checked without a key. The other routes return 503 until the secret and the KV binding exist. Signing was not executed from this checkout: there is no relayer key here.
