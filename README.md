# 404 notfound

Guess where a photo was taken. A closer pin is worth more NOTF. NOTF is a NEP-141 token on NEAR testnet. The static page plays that loop as a demo with no server. A new on-chain round needs the relayer.

## Problem

The balance and the round result used to live in an Express process. That ledger can be edited after the pin is visible. Sign-in was a Solana wallet, and the first photo required a Google Maps browser key. The payout has to be fixed before the guess. A visitor has to be able to finish a round without a wallet and without a Maps key.

## Tracks

`games` and `memecoins`.

The game loop is the photo, the pin, the distance, and the next photo. The memecoin loop is mint by distance and a burn on an extra round. On the static page both are visible. The transactions linked from that page are rounds that already settled. The pin on that page does not mint or burn.

## How NEAR is used

Network: testnet. RPC: `https://rpc.testnet.near.org`.

| Role | Account | Explorer |
| --- | --- | --- |
| NOTF token, NEP-141, 18 decimals, symbol `NOTF` | `notf-token-726a52e4.testnet` | https://testnet.nearblocks.io/address/notf-token-726a52e4.testnet |
| Game | `notf-game-38b8e817.testnet` | https://testnet.nearblocks.io/address/notf-game-38b8e817.testnet |
| Drop pool | `notf-pool-798fba54.testnet` | https://testnet.nearblocks.io/address/notf-pool-798fba54.testnet |
| Relayer | `notf-relay-87a84acb.testnet` | https://testnet.nearblocks.io/address/notf-relay-87a84acb.testnet |

The token, game, and pool accounts had their full-access keys removed after init. Those three deployments cannot be upgraded.

- Token `new` minted 1,000,000 NOTF. `mint` and `operator_burn` accept calls from the game contract.
- `claim_starter` mints 100 NOTF once per player.
- `commit_round` stores `sha256("notfound-v1|{location}|{lat_e6}|{lng_e6}|{salt}")` before a guess exists.
- `submit_guess` stores the pin. The first three rounds of a UTC day are free. The next calls `operator_burn` for 10 NOTF. No transaction on this deployment has called `operator_burn`.
- `reveal_and_settle` recomputes the hash, measures the distance in the contract, and mints. `<= 1 km` mints 25, `<= 10 km` mints 15, `<= 25 km` mints 8, `<= 50 km` mints 3, otherwise 0.
- The pool takes NOTF through `ft_transfer_call`. After the window, the closest guess inside 50 km is paid with `ft_transfer`. If nobody is close enough, the prize unlocks back into the pool.

Distance math is integer and shared by `contracts/notfound-math` and `shared/rules.js`. The contract's number is the one that pays.

View calls against the RPC on 2026-11-14 matched the table below.

- `get_round` `round-1794626565709`: status `settled`, location `paris`, `distance_m` 1329, reward 15 NOTF, fee 0. Player `f1f02b5b70c1afee052082bf8e0636f6f8b92011353d00bc07214a8a95250c2f` balance 115 NOTF (100 starter + 15).
- `get_drop` `drop-1794626860614`: status `settled`, location `nyc`, `winning_distance_m` 1115, prize 25 NOTF. Winner `51c40c7c8bcace78cc6ec5b8f4c8c3adc5ab00180afd95062e994d1f59850d64` balance 125 NOTF (100 starter + 25).
- `ft_total_supply`: 1000215.00 NOTF. That is the 1,000,000 minted at init, plus two 100 starter mints, plus one 15 reward mint. The drop prize was a transfer, not a mint.

| Step | Hash |
| --- | --- |
| Deploy token | https://testnet.nearblocks.io/txns/EHKTjes5dh7zFYrnU25UvPMFGQ7jgS34mxkmif1ojGr6 |
| Deploy game | https://testnet.nearblocks.io/txns/5QNfZnkLQN1eFhmVfHBV4HkMWVigHzWaBs1BXpod6NjT |
| Deploy pool | https://testnet.nearblocks.io/txns/BhfXdqS9MdA4njZNpvN1cgRMBwkFc7tg5kkkHesDxs3d |
| Init token | https://testnet.nearblocks.io/txns/EgCQzVbr1WcrfbSuLbauTjEbbRmjHESsLUPgJZ19r1S |
| Init game | https://testnet.nearblocks.io/txns/H7Jn9sgq4UZsickCq3aKMCPmgvPmR4gb1WHHfb3Qm57K |
| Init pool | https://testnet.nearblocks.io/txns/GFwdRCVMRdp779hb5RYzt9sJHC11VnsjzRd5HuDsWVGC |
| Fund pool with 1000 NOTF | https://testnet.nearblocks.io/txns/81echne13U5nMf3ejNo9XdncEytYz9kpWCPy7EdK5MqS |
| Starter mint, round player, +100 | https://testnet.nearblocks.io/txns/2TGyvwM7DnWq9ZrifQzTeRwhB3dh4FEVhe997RE2rSgx |
| Commit Paris round | https://testnet.nearblocks.io/txns/EcpeQcZ6rxaRUDaVoEKViHXX9BrWgQ3iePJWi1brpV4v |
| Gasless guess (NEP-366) | https://testnet.nearblocks.io/txns/8evrmdNe7CNS2vmjW2xyDGQMJNcyhQJanXZBFnnfb24k |
| Reveal round, 1329 m, mint 15 NOTF | https://testnet.nearblocks.io/txns/HQKG8AwbdcUcw2gcuAhN17TiPAZagmMVo7A4SYUeQXTK |
| Gasless drop guess | https://testnet.nearblocks.io/txns/6PLStsxhuABF4JcpDFAZtAATuzbcYU2WrdsfuEYhMdPs |
| Settle drop, 1115 m, pay 25 NOTF | https://testnet.nearblocks.io/txns/95ETWNvtsPfCD4PjBswgP9wgePzZkUw1hxrfCFAnwN7 |

The same hashes are in `docs/testnet-deploy.json` and `src/chain/testnet.json`.

Gasless play is a NEP-366 meta-transaction. The page generates an ed25519 key, the relayer funds the implicit account, and the player signs `submit_guess`. The relayer account pays the gas. That path runs only when `VITE_RELAYER_URL` is set and `GET /health` returns `ok: true`. The play button does not open a wallet.

## Do this, see that

These steps are the static page with no relayer URL and no Maps key. They match `npm run preview` and a Pages upload of `dist/` from this branch. They do not match https://notf-404-near.pages.dev until that `dist/` is uploaded. The copy at that URL still requests `127.0.0.1:8788` and the reveal still says `minted by contract`.

```bash
npm ci
npm run build
npm run preview
```

Open http://127.0.0.1:4173

1. The red banner reads `DEMO · no relayer · this pin is scored in the browser and does not mint`. A photo is on the left. Its chip reads `Photo fallback · no Street View key`. The page does not request port 8788.
2. The strip under the banner reads `≤1 km mints 25`, `≤10 km mints 15`, `≤25 km mints 8`, `≤50 km mints 3`, `farther mints 0`, `rounds 1–3 free`, `round 4 burns 10`. It links starter mint +100 (`2TGyvwM7DnWq9ZrifQzTeRwhB3dh4FEVhe997RE2rSgx`), distance mint +15 (`HQKG8AwbdcUcw2gcuAhN17TiPAZagmMVo7A4SYUeQXTK`), and drop paid +25 (`95ETWNvtsPfCD4PjBswgP9wgePzZkUw1hxrfCFAnwN7`). The last item reads `no burn tx on this deployment`.
3. Click the atlas. Click `Lock guess`. The reveal shows the distance and `would mint +N NOTF on testnet`, where N is 25, 15, 8, 3, or 0. The link under it reads `settled example +15 NOTF` and opens the reveal transaction above. That transaction is not this pin. The header balance is prefixed `demo` and is stored in localStorage.
4. Under "How a round settles" the line reads `sample round · not this pin`. The three hashes are commit `EcpeQcZ6rxaRUDaVoEKViHXX9BrWgQ3iePJWi1brpV4v`, guess `8evrmdNe7CNS2vmjW2xyDGQMJNcyhQJanXZBFnnfb24k`, reveal `HQKG8AwbdcUcw2gcuAhN17TiPAZagmMVo7A4SYUeQXTK`.
5. Click `Skip`, then `Lock guess`, until the header reads `Free 0 / 3`. The next round shows `would burn 10 NOTF on testnet` before the lock and again in the reveal. The demo balance drops by 10, then adds the distance mint. Testnet is unchanged.
6. Click `Daily drop open`, pin the atlas, click `Lock guess`. Inside 50 km the card reads `would pay +25 NOTF from the pool`. Outside 50 km it reads `prize would stay in the pool`. The settle link stays `95ETWNvtsPfCD4PjBswgP9wgePzZkUw1hxrfCFAnwN7`. The demo balance does not change for a drop.

Static build directory: `dist/`
Build command: `npm run build`
Cloudflare Pages hosts `dist/`. Leave `VITE_RELAYER_URL` unset for that build.

## Relayer URL

`VITE_RELAYER_URL` is inlined at `npm run build` / `npm run dev:client`.

- Unset or empty: demo mode. The browser does not call a relayer.
- `http://127.0.0.1:8788` or `http://localhost:8788`: used only when the page itself is served from localhost. A public host ignores a loopback value, so a Pages bundle cannot call the visitor's machine.
- `https://<worker-host>`: the page calls that origin. `GET /health` must return `{ "ok": true, "ready": true }`.

`relayer-worker/` is a Worker with the same routes as `relayer/server.js`. It is not deployed. Setup, the KV binding, and the secret are in `relayer-worker/README.md`. The signing key is `RELAYER_PRIVATE_KEY`, set with `wrangler secret put`. It is not in `wrangler.toml`.

## On-chain loop, local

The operator key is `.near/credentials.json`. That file is gitignored. It is not in this checkout. Without it, `npm run relayer` exits. This change did not submit a new gasless round.

```bash
VITE_RELAYER_URL=http://127.0.0.1:8788 npm run dev:client
npm run relayer
```

Open http://127.0.0.1:5173 with no `?demo=1`.

The relayer listens on `0.0.0.0:$RELAYER_PORT` (default 8788).

1. `POST /session` funds an implicit account with 0.03 testnet NEAR, at most 15 new guests per process, and calls `claim_starter` when that account has not claimed.
2. `POST /rounds/start` calls `commit_round`. The salt stays in the relayer process.
3. The browser signs `submit_guess`. `POST /relay` submits the delegate action. The relayer pays the gas.
4. `POST /rounds/:id/reveal` calls `reveal_and_settle`. The reveal then reads `minted on testnet` and links the new transaction. A guess that burned the fee reads `burned 10 NOTF on testnet`. The burn is the `operator_burn` call inside that guess transaction.

`?demo=1` stays in demo mode even when the relayer is up.

A new throwaway deployment, testnet faucet only:

```bash
npm run contracts:build
npm run deploy:testnet
```

## Photos

No Maps key is required for the static page. The six round photos are CC BY-SA crops. Creators, licenses, source files, and the crop are in `docs/PHOTO_LICENSES.md`. The built site serves the same text at `/photo-licenses.txt`. The footer links to it. The MIT license does not cover those six files.

`?legacy=1` is the old server game. Without `VITE_GOOGLE_MAPS_API_KEY`, its Street View panel shows one of those photos and says the picture is not the round panorama.

## Hackathon window

The first commits in this repository are from 2026-06-14, before the window that starts 2026-10-19.

- Baseline tag `pre-hackathon`: `a7c9c785f0a0df92f72494b78c9d3123a6620dd6`
- Branch: `near-hackathon`
- Remote tag `hackathon-submission`: `0aa56b17ce0a7bb8af406015d1bf42b85e6b5d2e`. This change does not move that tag. Moving it onto a later commit would be a force-push.
- Diff: https://github.com/Utkarsh1446/404/compare/pre-hackathon...near-hackathon

Already in the baseline: the React/Vite client, the Express API, Solana wallet sign-in, the server NOTF ledger, and Google Maps when a browser key is set. That UI is `?legacy=1`.

Added on this branch: the NOTF token, the game contract, the drop pool, the Node relayer, the static play screen, the testnet deployment recorded in `docs/testnet-deploy.json`, demo mode that does not call a loopback relayer, the CC photo fallback, the build-time relayer URL, and the un-deployed Worker under `relayer-worker/`.

Libraries used for the contracts and the NEAR client: `near-sdk` 5.30.2, `near-contract-standards` 5.30.1, `near-api-js` 7, `sha2`. The integration was written with AI assistance.

<!-- PAIRED PROJECT: lead's one other entry, if any -->

## Tests

```bash
npm ci
npm test
npm run lint
npm run build
```

`npm test` includes the previous API suite, the shared commitment and distance vectors, the demo rule that the fourth round of a day costs 10 NOTF, the demo label strings, the relayer URL rule, and the Worker refusing mainnet and a missing key.

`npm run contracts:test` runs the contract tests offline and needs the stable Rust toolchain plus the cached crates. CI (`.github/workflows/ci.yml`) runs `npm ci`, `npm test`, `npm run lint`, `npm run build`, and the contract tests with a network-enabled toolchain.

`npm ci` matches this `package-lock.json` with npm 10.9.9. The GitHub Actions `node` job on `0aa56b17ce0a7bb8af406015d1bf42b85e6b5d2e` also completed `npm ci`.

## Limitations

- Demo mode includes the place list in the client. The coordinates can be read, and the photos can be matched to that list. The contract stops the operator from swapping a committed place. It does not hide the catalog.
- The `demo` balance is localStorage. It is not `ft_balance_of`. The banner says the pin does not mint.
- No `operator_burn` receipt exists for these accounts. The burn is implemented in `submit_guess` and covered by the contract test `fourth_guess_requires_a_fee`. It has not been sent on testnet.
- A new gasless round needs the relayer key, which is not in git. Funding a guest spends testnet NEAR. The cap is 15 new implicit accounts.
- Token, game, and pool cannot be upgraded. See the key-removal transactions in `docs/testnet-deploy.json`.
- One early drop guess, `EXv5LytXv1BmYamZBik9JVPM1d5f6APye9VKnRd5pjFx`, was included as its window was about to close and trapped. It paid nothing. The settle linked above is a later drop that did pay.
- `relayer-worker/` has not been deployed. Its signing path has not been run against testnet from this checkout.
- https://notf-404-near.pages.dev keeps serving the previous build until `dist/` from this branch is uploaded.
- No mainnet transactions and no real funds.
- `?legacy=1` still uses the server ledger.

## Baseline server game

`npm run dev` starts the Express API and the Vite client. The legacy UI is `http://127.0.0.1:5173/?legacy=1`. It expects `VITE_API_BASE_URL` and, for Street View, `VITE_GOOGLE_MAPS_API_KEY`. Persistence is Postgres via `DATABASE_URL` or `SUPABASE_CONNECTION_STRING`, or the local JSON file `server/data/runtime-store.json`. That ledger is not the settlement path above.
