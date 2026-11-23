# Hoops Coach

A phone-first PWA for managing game time, positions and rolling subs for a junior
basketball team. Works fully offline — no backend, no accounts, no network calls.

It is a sibling of the soccer [coach-app](https://github.com/Mattiosco/coach-app): the same
event-log engine and fairness maths, adapted for the court. See [PLAN.md](PLAN.md).

## What is different from the soccer app

- **Court, not pitch.** Positions are PG, SG, SF, PF, C at 5 on 5 (3 on 3 and 4 on 4 for
  younger groups). There is no keeper, so every minute on court counts the same.
- **Halves or quarters.** Defaults to 2 × 20 min; switch to quarters and set the period
  length per team, per game, or mid-game. The clock stops itself at the end of each period
  and at full time, and overtime can be added.
- **Fixtures by hand.** PlayHQ has no open API, so games are copied in from the draw.
- **Its own storage.** Both apps are served from the same origin, so this one keeps its
  data in a separate IndexedDB database (`hoops-coach`) and its own export format
  (`.hoops.json`). Nothing is shared or overwritten between the two.

## Develop

```
npm install
npm run dev
```

Service workers only register over HTTPS or on `localhost`, so to exercise the real
offline behaviour use a production build:

```
npm run build
npm run preview
```

`npm run icons` redraws the app icons into `public/`.

## Deploy

Pushing to `main` builds and publishes to GitHub Pages via
[.github/workflows/deploy.yml](.github/workflows/deploy.yml), served at
`https://mattiosco.github.io/hoops-coach/`. In the repo settings, set
**Pages → Source** to **GitHub Actions** once, and it is hands-off after that.
