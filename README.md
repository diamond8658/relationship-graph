# Relationship Graph

An interactive personal relationship graph — map your connections, track how people relate to each other, log timeline entries, and understand your social network at a glance.

## Downloads

Head to the [Releases](https://github.com/diamond8658/relationship-graph/releases) page to download the latest version for Windows or Mac.

## Stack

- **Frontend:** React + TypeScript (Vite)
- **Backend:** FastAPI + SQLite (SQLAlchemy)
- **Desktop:** Tauri + PyInstaller

## Project Structure

```
relationship-graph/
├── backend/
│   ├── main.py             # FastAPI routes (People, Tags, Timeline, Interests, Relationships, Layout, Export/Import)
│   ├── models.py           # SQLAlchemy ORM models
│   ├── schemas.py          # Pydantic request/response schemas + export models
│   ├── database.py         # SQLAlchemy engine and session setup
│   ├── server.py           # PyInstaller entry point (production only)
│   ├── backend.spec        # PyInstaller build spec
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Graph.tsx           # SVG canvas — nodes, arrows, zoom/pan, drag-to-connect, sort
│   │   │   ├── ProfilePanel.tsx    # Sidebar editor with auto-save
│   │   │   ├── Toolbar.tsx         # Search, add, refresh, sort, export buttons
│   │   │   ├── AddPersonModal.tsx  # Add person dialog
│   │   │   └── MeSetupModal.tsx    # First-run "Me" node setup
│   │   ├── types.ts        # Shared TypeScript interfaces
│   │   ├── api.ts          # All HTTP calls to the FastAPI backend
│   │   ├── App.tsx         # Root component — owns global state and wiring
│   │   └── index.tsx
│   ├── public/
│   │   └── splash.html     # Startup splash screen shown by the Tauri shell
│   ├── index.html          # Vite entry point
│   └── vite.config.ts
├── src-tauri/
│   ├── src/main.rs         # Tauri shell — spawns the backend sidecar, splash/readiness handling
│   ├── tauri.conf.json     # Window config, sidecar binary name, splash + main window setup
│   └── capabilities/       # Tauri v2 permission manifest
├── .github/workflows/
│   └── build.yml           # CI: builds the backend sidecar, then bundles with Tauri, on tag push
```

## Getting Started (Development)

### Backend

```powershell
cd backend
py -3.11 -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload
```

API runs at `http://localhost:8000`. Interactive docs at `http://localhost:8000/docs`.

Note: this fixed port only applies when running the backend manually like
this. Inside the packaged Tauri app, the backend runs on a port chosen
dynamically at launch (see `src-tauri/src/main.rs`), and the frontend asks
for it via the `get_backend_port` Tauri command instead of assuming 8000.

Schema migrations run automatically on every backend startup (see
`run_migrations()` in `main.py`) — no separate migration script to run.

### Frontend

```powershell
cd frontend
npm install
npm run dev
```

App opens at `http://localhost:5173`.

### Desktop shell (Tauri)

```powershell
cd src-tauri
cargo tauri dev
```

This starts the Vite dev server, opens a native window pointed at it, and
runs the backend the normal way in a separate terminal is recommended for
faster iteration (rebuilding the PyInstaller sidecar binary on every change
is slow — see the sidecar naming note in `backend.spec` for production
builds).

### Run backend + frontend at once (browser, no Tauri)

```powershell
Start-Process powershell -ArgumentList '-NoExit','-Command','cd backend; .\venv\Scripts\Activate.ps1; uvicorn main:app --reload'
Start-Process powershell -ArgumentList '-NoExit','-Command','cd frontend; npm run dev'
```

## Features

### Graph Canvas
- Interactive SVG with zoom (scroll wheel or +/− buttons) and pan (drag background)
- Drag nodes to arrange — positions auto-saved to DB
- **Shift+drag** from one node to another to create a relationship via a quick modal
- Bidirectional labeled arrows with parallel offset so both directions stay readable
- Sentiment-colored arrows: hates (barn red) → dislikes (orange) → neutral (gray) → likes (green) → loves (indigo)
- Collision resolution prevents nodes from stacking
- **⇌ Sort** — hub-and-spoke layout algorithm:
  - Me node always at center
  - Nodes grouped by primary tag, each group forms a cluster
  - Clusters arranged evenly around Me in a radial pattern
  - Leaf nodes (single connection) placed near their neighbor outside the cluster
  - Untagged nodes form their own cluster

### People & Profiles
- Full contact card: name, occupation, company, location, phone, email, LinkedIn
- Photo upload or URL paste
- Freeform description for traits and notes (no date required)
- Multiple tags with a **primary tag** displayed as a colored badge — click to edit, drives node color and sort grouping
- **Auto-save** — all fields save automatically 800ms after you stop typing; "Saved ✓" indicator in panel header
- **"Me" node** — gold colored anchor, prompted on first launch, always placed at center during sort

### Relationships
- Each person independently labels and rates their connection
- Sentiment selector: Hates / Dislikes / Neutral / Likes / Loves
- Arrow color reflects sentiment
- Searchable relationship picker with arrow key navigation (↑↓)
- Auto-focuses label field after selecting a person; Enter submits
- **Shift+drag** on canvas as an alternative to the panel picker

### Timeline
- Dated log entries per person
- **Natural language dates** — type "today", "yesterday", "monday", "last week", "last month"
- Calendar picker alongside the text field — both stay in sync
- **Enter** in the note field submits immediately (Shift+Enter for newline)
- **Generate suggestions** button — uses AI (Groq API) to extract likes/dislikes from notes
- Confirmed interests show as color-coded pills (green = likes, red = dislikes)

### Search
- Searches name, primary tag, occupation, and all tags simultaneously
- Dropdown with arrow key navigation and Enter to select
- Single match auto-selects on Enter

### Data
- All data stored locally in SQLite — no account, no cloud required
- **↓ Export** button downloads a full JSON backup with all people, relationships, timelines, and interests (validated via Pydantic schemas)
- Works fully offline (AI suggestions require a Groq API key (GROQ_API_KEY))

## Building the Desktop App

### Local build (any platform)

```bash
cd src-tauri
cargo tauri build
```

Produces a native installer in `src-tauri/target/release/bundle/` — `.msi`
on Windows, `.dmg`/`.app` on Mac. Requires the Rust toolchain (`rustup.rs`)
and, on first run, `cargo tauri icon path/to/source-icon.png` if
`src-tauri/icons/` hasn't been populated yet.

### CI (Windows + Mac via GitHub Actions)

Push a version tag to trigger builds for both platforms:

```bash
git tag v1.0.0
git push origin v1.0.0
```

CI builds the PyInstaller backend sidecar per-OS, then bundles it with
Tauri; both installers are attached to a GitHub Release automatically.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /people | Get all people with full nested data |
| POST | /people | Create a person |
| PUT | /people/{id} | Partial update a person |
| DELETE | /people/{id} | Delete a person and all their data |
| POST | /people/{id}/tags | Add a tag |
| DELETE | /tags/{id} | Remove a tag |
| GET | /people/{id}/timeline | Get timeline entries |
| POST | /people/{id}/timeline | Add a timeline entry |
| DELETE | /timeline/{id} | Delete a timeline entry |
| POST | /timeline/{id}/analyze | AI-extract likes/dislikes from a note |
| GET | /people/{id}/interests | Get interests |
| PUT | /interests/{id}/confirm | Confirm or reject an AI suggestion |
| DELETE | /interests/{id} | Delete an interest |
| POST | /relationships | Create/update a relationship (upserts) |
| PUT | /relationships/{id} | Update label and sentiment |
| DELETE | /relationships/{id} | Delete a relationship |
| PUT | /layout | Batch save node positions |
| GET | /export | Export all data as JSON (Pydantic-validated) |
| POST | /import | Replace the entire graph from an export file (auto-backs up first) |
| GET | /health | Lightweight readiness probe (used by the Tauri shell on startup) |

## Future Features

- **JSON import** — restore from an export or merge two graphs
- **Edge routing** — arrows that snake around nodes for readability (requires A* pathfinding on a visibility graph)
- **Local AI suggestions** — swap the Groq API for a local Ollama model (Llama 3.1) fine-tuned on your confirmed interests over time
- **Relationship strength** — numeric weight that thickens strong ties and fades weak ones
- **Reminders** — track "last contacted" date and surface people you haven't reached out to recently
- **Graph statistics** — degree centrality, mutual connections, cluster analysis
- **Mobile app** — React Native version backed by the same FastAPI backend
- **Multi-graph support** — maintain separate graphs (personal, professional) and switch between them
- **iCloud / Google Drive sync** — optional cloud backup of the SQLite database
