# conventional-changelog

A TypeScript CLI for generating changelogs from conventional commits. This repository currently contains the project scaffold; feature behavior will follow its technical specification.

## Requirements

- Node.js 20 or newer
- npm

## Setup, test, build, run

Run these commands in order from the repository root:

    npm ci
    npm test
    npm run build
    npm start

The scaffold CLI prints `conventional-changelog ready`.

## Other checks

    npm run lint

## Layout

- `src/` — library source
- `bin/` — CLI entry point
- `test/` — Node test runner tests
