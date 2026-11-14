# 404 notfound

Guess where a photo was taken. A close pin earns NOTF. Before this branch, the balance and the score lived in an Express process and sign-in was a Solana wallet. On this branch the token, the round, and the drop prize are NEAR testnet contracts. The static page can play the whole loop with no server and no Google Maps key.

## Problem

A server ledger can be restarted, edited, or paid out differently after the pin is visible. The player also had to connect a wallet before the first photo. The game needs a payout that was fixed before the guess, and a way to play without buying gas or opening a wallet.

## What NEAR does

Track: `games`.

- **NOTF** is a NEP-141 fungible token, 18 decimals, symbol `NOTF`. The game contract is a minter. A new player is minted 100 NOTF once.
- **Round settlement is commit-reveal, not a server signature.** Before the pin exists, the operator stores `sha256("notfound-v1|{location}|{lat_e6}|{lng_e6}|{salt}")`. The player then submits a guess. Reveal supplies the preimage. The contract checks the hash and measures the distance itself. A signature alone could attest any distance after seeing the pin. The preimage cannot be swapped for a closer place, because the commitment is already stored.
- **Rewards** are minted from that distance. `<= 1 km` pays 25 NOTF, `<= 10 km` pays 15, `<= 25 km` pays 8, `<= 50 km` pays 3, otherwise 0.
- **Entry.** Three rounds per UTC day are free. The next round burns 10 NOTF. The burn runs only because the player signed `submit_guess`.
- **Drop pool** is a separate contract. It escrows NOTF through `ft_transfer_call`. After the window, the closest guess inside 50 km is paid with `ft_transfer`. If nobody is close enough, the prize unlocks back into the pool.
- **Gasless play** is a NEP-366 meta-transaction. The page generates an ed25519 key, the relayer creates the implicit account, and the player signs a delegate action. The relayer account pays the gas. The play button does not open a wallet.

Distance math is integer and shared by `contracts/notfound-math` and `shared/rules.js`. Under a few hundred kilometres it stays within about 0.1% of haversine. The contract's number is the one that pays.

## Hackathon window

This repository's first commits are from 2026-06-14, before the hackathon window that starts 2026-10-19.

- Baseline tag: `pre-hackathon` (`a7c9c785f0a0df92f72494b78c9d3123a6620dd6`)
- Branch: `near-hackathon`
- Submission tag: `hackathon-submission` on the final commit of this branch
- Diff: https://github.com/Utkarsh1446/404/compare/pre-hackathon...hackathon-submission

What was already here: the React/Vite client, the Express API, Solana wallet sign-in, the server NOTF ledger, and Google Maps when a browser key is configured. That build is still available at `?legacy=1`. It is not the submitted path.

What was added in the window: the NOTF token, the game contract, the drop pool, the relayer, the static play screen, and the testnet deployment recorded in `docs/testnet-deploy.json`.

Libraries used for that work: `near-sdk` 5.30.2, `near-contract-standards` 5.30.1, `near-api-js` 7, `sha2`. The integration was written with AI assistance. It does not reuse code from the other independent entries by this team: Light Swarm, Dryrun, Intents Thesis, Instinct Router, Mutuals, Receipts, Crunch Oracle.

## Do this, see that

Demo, no Maps key, no relayer, no backend:

```bash
npm install
npm run build
npm run preview
```

Open http://127.0.0.1:4173

1. Click **Play**. A photo appears with a commitment hash. The place name is not shown.
2. Click the atlas and **Lock guess**. The distance in kilometres and a NOTF amount appear. The header balance changes. Three rounds are free; the fourth costs 10 from that balance.
3. Open **Drops**, pin inside 50 km, and the 25 NOTF prize is added. A pin outside 50 km leaves the prize in the pool.

The card on the home screen reads the live testnet supply and the sample round below. That round is 1.33 km and paid 15 NOTF.

Static build directory: `dist/`
Build command: `npm run build`
Cloudflare Pages can host `dist/` as-is. The demo loop does not need a server.

### Testnet transactions

Network: testnet. RPC: `https://rpc.testnet.near.org`

| Contract | Account | Explorer |
| --- | --- | --- |
| NOTF token | `notf-token-726a52e4.testnet` | https://testnet.nearblocks.io/address/notf-token-726a52e4.testnet |
| Game | `notf-game-38b8e817.testnet` | https://testnet.nearblocks.io/address/notf-game-38b8e817.testnet |
| Drop pool | `notf-pool-798fba54.testnet` | https://testnet.nearblocks.io/address/notf-pool-798fba54.testnet |
| Relayer | `notf-relay-87a84acb.testnet` | https://testnet.nearblocks.io/address/notf-relay-87a84acb.testnet |

These transactions were sent and the follow-up view calls matched the table. Hashes are also in `docs/testnet-deploy.json`.

| Step | Hash |
| --- | --- |
| Deploy token | https://testnet.nearblocks.io/txns/EHKTjes5dh7zFYrnU25UvPMFGQ7jgS34mxkmif1ojGr6 |
| Deploy game | https://testnet.nearblocks.io/txns/5QNfZnkLQN1eFhmVfHBV4HkMWVigHzWaBs1BXpod6NjT |
| Deploy pool | https://testnet.nearblocks.io/txns/BhfXdqS9MdA4njZNpvN1cgRMBwkFc7tg5kkkHesDxs3d |
| Init token | https://testnet.nearblocks.io/txns/EgCQzVbr1WcrfbSuLbauTjEbbRmjHESsLUPgJZ19r1S |
| Init game | https://testnet.nearblocks.io/txns/H7Jn9sgq4UZsickCq3aKMCPmgvPmR4gb1WHHfb3Qm57K |
| Init pool | https://testnet.nearblocks.io/txns/GFwdRCVMRdp779hb5RYzt9sJHC11VnsjzRd5HuDsWVGC |
| Fund pool with 1000 NOTF | https://testnet.nearblocks.io/txns/81echne13U5nMf3ejNo9XdncEytYz9kpWCPy7EdK5MqS |
| Commit Paris round | https://testnet.nearblocks.io/txns/EcpeQcZ6rxaRUDaVoEKViHXX9BrWgQ3iePJWi1brpV4v |
| Gasless guess (NEP-366) | https://testnet.nearblocks.io/txns/8evrmdNe7CNS2vmjW2xyDGQMJNcyhQJanXZBFnnfb24k |
| Reveal round, 1329 m, 15 NOTF | https://testnet.nearblocks.io/txns/HQKG8AwbdcUcw2gcuAhN17TiPAZagmMVo7A4SYUeQXTK |
| Gasless drop guess | https://testnet.nearblocks.io/txns/6PLStsxhuABF4JcpDFAZtAATuzbcYU2WrdsfuEYhMdPs |
| Settle drop, 1115 m, 25 NOTF paid | https://testnet.nearblocks.io/txns/95ETWNvtsPfCD4PjBswgP9wgePzZkUw1hxrfCFAnwN7 |

The round player finished that round at 115 NOTF (100 starter + 15 reward). The drop player finished at 125 NOTF (100 starter + 25 prize). View `ft_balance_of` on the token for `51c40c7c8bcace78cc6ec5b8f4c8c3adc5ab00180afd95062e994d1f59850d64`.

To play another gasless round, run the relayer with the operator key in `.near/credentials.json` (gitignored; not in this repo) and open the site without `?demo=1`:

```bash
npm run relayer
npm run dev
```

`POST /session` funds an implicit account. `POST /rounds/start` commits the place. The browser signs `submit_guess` and `POST /relay` submits the delegate action. `POST /rounds/:id/reveal` opens the preimage. The relayer listens on `0.0.0.0:$RELAYER_PORT` (default 8788).

A new throwaway deployment, testnet faucet only:

```bash
npm run contracts:build
npm run deploy:testnet
```

## Tests

```bash
npm test
npm run contracts:test
npm run lint
```

`npm test` includes the previous API suite and the shared commitment, distance, and free-round vectors. `npm run contracts:test` checks reveal-after-commit, a swapped location being rejected, the fourth guess requiring a fee, and the drop paying the closer pin. CI is `.github/workflows/ci.yml`.

## Maps key

`VITE_GOOGLE_MAPS_API_KEY` is read from the environment only. `.env.example` leaves it empty. Nothing in git is a Maps key. With a key, the guess step uses the Google map. Without a key, bundled photos and the atlas still run the full guess, score, and payout loop. The verification screenshots were taken with no key.

## Limitations

- Demo mode includes the place list in the client so it can settle without a relayer. Someone can read those coordinates. Testnet salts are generated when the round is committed and are not stored in git. The photos are in git, so a person can still match a picture to the catalog. The contract stops the operator from changing the committed place. It does not stop someone from reading the catalog.
- The relayer key is required for a new gasless round and is not published. Guest funding is capped at 15 implicit accounts per process. Those transfers spend the relayer's testnet NEAR.
- The token, game, and pool accounts had their full-access keys removed after init. Those three deployments cannot be upgraded.
- One early drop guess, `EXv5LytXv1BmYamZBik9JVPM1d5f6APye9VKnRd5pjFx`, was included as its window was about to close and trapped. It paid nothing. The settle linked above is a later drop that did pay.
- No mainnet transactions and no real funds.
- `?legacy=1` is the old server game. Its NOTF balance is still the server ledger.

## Baseline server game

`npm run dev` still starts the Express API and the Vite client. The legacy UI is `http://127.0.0.1:5173/?legacy=1`. It expects `VITE_API_BASE_URL` and, for Street View, `VITE_GOOGLE_MAPS_API_KEY`. Persistence notes for that server are unchanged: Postgres via `DATABASE_URL` or `SUPABASE_CONNECTION_STRING`, or the local JSON file. That ledger is not the hackathon settlement path.
