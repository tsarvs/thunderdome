# Getting Started (for absolute beginners)

If you've never set up a project like this before, or terms like "Docker," "Node," "monorepo," or
"dev environment" are more jargon than meaning, this guide is for you. It explains what you're
actually installing and why, in plain language, before you type a single command. Everyone else
can go straight to the root [`README.md`](../../README.md#forging-your-arms-local-development).

Nothing here is Thunderdome-specific trivia to memorize — these are the same concepts you'll run
into on almost any modern software project. Learning them once here pays off everywhere else.

## 1. What even is this repository?

A **repository** ("repo") is just a folder of files — code, docs, config — tracked by
[Git](https://git-scm.com/), a tool that records every change ever made to those files so nothing
is ever truly lost and everyone working on the project can merge their changes together safely.
"Cloning" a repo means downloading your own copy of it, history and all.

This particular repo is a **monorepo**: instead of one project living in one repo, it's _many_
related projects (the game engine, the CLI, each individual game, each individual bot) living
together in one repo, so they can share code and be tested together. `packages/README.md`,
`games/README.md`, and `bots/README.md` each describe one slice of it.

## 2. What is Node.js, and why do I need a specific version?

Almost all the code in this repo is [TypeScript](https://www.typescriptlang.org/) or JavaScript.
Your web browser can run JavaScript, but it can't run it as a standalone program on your computer
outside a browser tab — that's what [**Node.js**](https://nodejs.org/) is: a program that lets
JavaScript (and TypeScript, once compiled) run directly on your machine, the same way `python` or
`ruby` let you run programs written in those languages.

Different projects are sometimes written against different Node versions, and a feature that works
on one version can break on another. This repo pins an exact version (`.node-version`, currently
`25`) so that "works on my machine" actually means "works on everyone's machine." A **version
manager** like [`fnm`](https://github.com/Schniz/fnm) lets you have several Node versions
installed side by side and switch between them per-project automatically — that's why the root
README recommends installing Node _through_ fnm rather than downloading it directly from
nodejs.org.

## 3. What is Yarn, and how is it different from `npm`?

JavaScript code is built out of reusable building blocks called **packages** (or "dependencies") —
rather than writing everything from scratch, you pull in code other people already wrote and
tested. [`npm`](https://www.npmjs.com/) (Node Package Manager) is the tool that comes bundled with
Node for downloading and managing those packages, listed in a project's `package.json` file.
[**Yarn**](https://classic.yarnpkg.com/) does the same job as `npm` — a different tool, same idea
— and this repo standardizes on one specific version of it (Yarn "Classic," `1.22.22`) so that
everyone resolves the exact same set of package versions. You'll only ever need `npm` once, to
install that specific Yarn version (`npm install -g yarn@1.22.22`); every other command in this
repo uses `yarn`.

`yarn install` reads every `package.json` in the repo and downloads everything listed into a
`node_modules/` folder. You'll do this once after cloning, and again any time a dependency changes.

## 4. What is a "workspace," and why are there so many `package.json` files?

Since this is a monorepo (§1), it isn't one `package.json` — it's dozens, one per package
(`packages/engine/package.json`, `games/connect-four/package.json`, and so on). Yarn's
**workspaces** feature understands that these are all part of one project: it links them together
so `packages/engine` can depend on `packages/rng` by name, without publishing `rng` anywhere or
copying its code around, and `yarn install` only needs to run once at the repo root to set
everything up. `bots/*` is deliberately **not** a workspace member — see
[`docs/adr/0001-monorepo-and-boundary.md`](../adr/0001-monorepo-and-boundary.md) for why bots are
kept at arm's length from the rest of the code.

## 5. What is Docker, and why is it required here?

Bots submitted to this platform are, by design, code from someone else that you haven't reviewed
— potentially written in a language you don't even have installed, and potentially buggy or
actively malicious. [**Docker**](https://www.docker.com/) lets you package a program together with
everything it needs to run (its language runtime, its own dependencies) into a self-contained unit
called a **container**, and then run that container in a sandbox that can't see or touch your real
computer's files, network, or other processes unless you explicitly allow it.

That sandboxing is exactly why this repo needs it: every bot match actually runs inside a real
Docker container, with no exceptions and no "trust me, it's fine" shortcut — see
[`docs/adr/0003-docker-bot-isolation.md`](../adr/0003-docker-bot-isolation.md) for the full
reasoning. This also means Docker isn't optional tooling you can skip — anything that runs a real
match (`yarn thunderdome match run`, the runtime's own tests) needs Docker actually _running_
(not just installed) in the background, the same way a database needs to be running before an app
that talks to it will work. `docker ps` (root README §3) is how you check that it is.

## 6. What is a "dev environment," concretely?

Your **development environment** ("dev env") is just the specific combination of tools, versions,
and configuration your computer needs so that this project's code runs the same way it does for
everyone else on the team. For this repo, that's: the right Node version (§2), the right Yarn
version (§3), and Docker running (§5). The root README's
["Forging your arms"](../../README.md#forging-your-arms-local-development) section is the exact,
step-by-step checklist for getting all three in place — follow it top to bottom now if you haven't
already; the rest of this guide assumes you have.

Once you're set up, `yarn build`, `yarn lint`, `yarn typecheck`, and `yarn test` (all four are run
in the root README's own setup checklist) are how you confirm your environment actually works, not
just that the install commands didn't print an error:

- `yarn build` compiles every package's TypeScript into plain JavaScript (`dist/` folders).
- `yarn typecheck` checks that the TypeScript type annotations throughout the repo are internally
  consistent, without producing any output files — a fast way to catch a whole class of bugs
  before ever running the code.
- `yarn lint` checks the code follows the project's style and catches common mistakes
  ([ESLint](https://eslint.org/)).
- `yarn test` runs the automated test suite — see
  [`testing-guide.md`](testing-guide.md) if you don't yet know what that means or how to write one
  yourself; it's written for exactly that.

If any of these four fail right after a fresh `yarn install`, something about your dev environment
setup is off — re-check the Node/Yarn versions (`node -v`, `yarn -v`) before assuming the code
itself is broken.

## 7. Where to go next

Once your dev environment is working (`yarn build && yarn lint && yarn typecheck && yarn test` all
pass, and `yarn thunderdome --help` prints usage), pick the guide that matches what you actually
want to build:

| I want to...                                                               | Start here                                                                     |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Write a bot that plays an existing game                                    | [`bot-author-guide.md`](bot-author-guide.md)                                   |
| Understand automated testing, or write my first test                       | [`testing-guide.md`](testing-guide.md)                                         |
| Build a brand new game from scratch                                        | [`game-authoring-guide.md`](game-authoring-guide.md)                           |
| Make a game nice to actually play as a human, or improve one already built | [`human-friendly-games-guide.md`](human-friendly-games-guide.md)               |
| Build a brand new tournament format (like Swiss)                           | [`tournament-format-authoring-guide.md`](tournament-format-authoring-guide.md) |
| Configure and run an existing tournament                                   | [`tournament-author-guide.md`](tournament-author-guide.md)                     |

Every one of those guides assumes you've read this page (or already know its contents) — none of
them re-explain what Node, Docker, or a dev environment are.

You don't need to understand the whole codebase before starting. Each guide above is meant to
stand on its own, and every real piece it describes has working code in this repo you can read
alongside it — file paths are called out throughout, precisely so you're never asked to take
something on faith.
