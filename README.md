[![make.fun](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Ryan-zhi/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Ryan-zhi/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

# Token Launch Radar

Every major DeFi protocol that still has no token, ranked by what its launch
would be worth — with a farm plan for each one.

Built for make.fun's [token-radar-01](https://make.fun/bounty/token-radar-01)
bounty. The entry reads the sealed DefiLlama snapshot (758 protocols, frozen
2026-11-14), finds the 198 that are genuinely pre-token — no token recorded,
not a versioned re-release, not a wrapped/staked/bridged product of something
that already trades — and prices each one.

## The model

A protocol with no token has no market price, so the radar prices it off its
traded relatives:

**implied value = TVL × category peer multiple × growth tilt × freshness tilt**

- **Peer multiple** — the median market-cap/TVL of the protocol's category
  among the 128 token-bearing protocols in the snapshot. Thin categories
  fall back to their family (credit, exchange, yield, real-world, infra),
  then to the market-wide median (0.21×).
- **Growth tilt** — half the 7-day TVL change, clamped to 0.85×–1.30×.
- **Freshness tilt** — 1.15× for the newest protocols, easing to 0.85× at
  ten years, from the day DefiLlama first tracked each one.

Every number on the board can be recomputed from the snapshot alone; the
detail view of each protocol shows its own three lines of working.

## The dashboard

`dashboard/` is a static page (no framework, no network): the ranked board
with search, category/chain filters, a watchlist toggle and four sort orders;
a detail view per protocol with the pricing breakdown, the traded peers
behind its multiple, and a four-step farm plan. Views are URL hashes
(`#/`, `#/?category=Lending`, `#/protocol/<slug>`).

## Run it

```sh
node main.ts --input <snapshot.json>   # writes board.json, data.js,
                                       # dashboard/, screenshots/, dossier.json
                                       # to $MAKEFUN_OUTPUT_DIR (or /output)
```

Node 22, standard library only. `lib/model.ts` holds the model,
`vendor/makefun-board.ts` is the kit's dossier library, MIT licensed.
