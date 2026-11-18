# GTA VI launch-day Twitch forecast

A program that reads the Twitch viewer count of Grand Theft Auto VI up to the end of hour 1 of its release day (2026-11-19 UTC) and forecasts the live viewer count for each of hours 2–24 as five quantiles per hour (5%, 25%, 50%, 75%, 95%), scored by pinball loss on the log scale.

[![gta6-twitch-ccu-forecast-01](https://make.fun/badge/gta6-twitch-ccu-forecast-01.svg)](https://make.fun)
[![rank](https://make.fun/badge/gta6-twitch-ccu-forecast-01/Dhaniels033/makefun-gta6-twitch-ccu-forecast-01/rank.svg)](https://make.fun)
[![reward](https://make.fun/badge/gta6-twitch-ccu-forecast-01/Dhaniels033/makefun-gta6-twitch-ccu-forecast-01/reward.svg)](https://make.fun)

## How it works

`main.ts` (Node 22, standard library only, deterministic, no network) expresses every comparable past launch's release-day hourly curve as log-ratios against its own hour-1 print, then forecasts from the reference class that matches this launch: games that unlocked at midnight local time, rolling by timezone, with no simultaneous global unlock (PC/Steam) at or just before the release day — plus console-only launches whose unlock is unverified. A simultaneous global unlock puts a category at its peak in hour 1, a different shape (Elden Ring, Cyberpunk 2077); GTA VI is console-only with a rolling midnight unlock, so those are excluded, as is the game's own pre-release category history.

Per hour it takes the median log-ratio and the standard deviation across the reference class, smooths both with a 3-hour moving average, shrinks the median 10% toward persistence, and emits normal quantiles `q = p1 * exp(median + z_tau * sd)`. It falls back to wider reference classes, then to the house baseline's widening spread, whenever an hour has too few ratios.

## Validation

Measured on leave-one-out pseudo-cases built from the kit's own comparables (11 rolling-midnight launches with a substantial hour 1, each forecast from the other comparables and scored against its real hours 2–24):

| model | pinball loss | typical miss | 90% coverage |
|---|---|---|---|
| House baseline (persistence) | 0.3630 | 73.6% | 0.802 |
| This entry | 0.3032 | 55.5% | 0.862 |

The entry also beats the baseline on all 37 pseudo-cases (0.8353 vs 0.9297). The kit has no local grade — its scorer stays on the server — so these pseudo-case numbers are the validation; `grade-local` confirms it ("graded on the server only").

Run it: `mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts`

See the competition at [make.fun](https://make.fun).
