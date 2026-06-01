# Koda Desktop (macOS + Windows)

Codex-style desktop agent for macOS and Windows. Open a project folder, chat with Koda, and run the full tool stack locally.

## Prerequisites

From the repo root:

```bash
pnpm install
pnpm build
```

## Run in development

```bash
pnpm app:desktop
```

Or:

```bash
cd apps/desktop
npm install
npm start
```

On first launch, click **Open project folder** and pick your git repo. Koda starts `koda serve` in the background and connects automatically.

## Build installers

Prepares a bundled Koda engine, then builds platform artifacts into `apps/desktop/release/`.

```bash
# macOS (.dmg + .zip)
pnpm app:desktop:mac

# Windows (.exe NSIS) — run on Windows or with Wine for CI
pnpm app:desktop:win
```

Manual steps:

```bash
pnpm build
cd apps/desktop
npm install
npm run pack:mac   # or pack:win
```

## Architecture

```
Koda.app / Koda.exe
  ├── Electron shell (ui/index.html)
  └── resources/koda/          ← bundled dist + bin + node_modules
        └── bin/koda.js serve
```

The app uses `ELECTRON_RUN_AS_NODE=1` in packaged mode so no separate Node install is required.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "Koda engine not found" | Run `pnpm build` at repo root |
| Engine fails to start | Ensure `koda login` is configured in the opened project |
| Port in use | Restart the app (it picks a random port) |
