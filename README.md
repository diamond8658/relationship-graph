# Relationship Graph

An interactive personal relationship graph — map your connections, track how people relate to each other, log timeline entries, and understand your social network at a glance.

## Downloads

Head to the [Releases](https://github.com/diamond8658/relationship-graph/releases) page to download the latest version for Windows or Mac.

## Stack

- **Frontend:** React + TypeScript (Create React App)
- **Backend:** FastAPI + SQLite (SQLAlchemy)
- **Desktop:** Electron + PyInstaller

## Project Structure

```
relationship-graph/
├── backend/
│   ├── main.py             # FastAPI routes (People, Tags, Timeline, Interests, Relationships, Layout, Export)
│   ├── models.py           # SQLAlchemy ORM models
│   ├── schemas.py          # Pydantic request/response schemas + export models
│   ├── database.py         # SQLAlchemy engine and session setup
│   ├── server.py           # PyInstaller entry point (production only)
│   ├── backend.spec        # PyInstaller build spec
│   ├── migrate.py          # DB migration script for schema changes
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Graph.tsx           # SVG canvas — nodes, arrows, zoom/pan, drag-to-connect, sort
│   │   │   ├── ProfilePanel.tsx    # Sidebar editor with auto-save
│   │   │   ├── Toolbar.tsx         # Search, add, refresh, sort, export buttons
│   │   │   ├── AddPersonModal.tsx  # Add person dialog
│   │   │   └── MeSetupModal.tsx    # First-run "Me" node setup
│   │   ├── colors.ts       # Shared color palette and group color assignment (imported by Graph and ProfilePanel)
│   ├── types.ts        # Shared TypeScript interfaces
│   │   ├── api.ts          # All HTTP calls to the FastAPI backend
│   │   ├── App.tsx         # Root component — owns global state and wiring
│   │   └── index.tsx
│   └── public/
│       └── index.html
├── electron/
│   ├── main.js             # Electron main process — starts backend, creates window
│   └── package.json        # Electron + electron-builder config
├── .github/workflows/
│   └── build.yml           # CI: builds Windows + Mac installers on tag push
└── build-win.ps1           # One-command local Windows build script
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

### Frontend

```powershell
cd frontend
npm install
npm start
```

App opens at `http://localhost:3000`.

### Run both at once

```powershell
Start-Process powershell -ArgumentList '-NoExit','-Command','cd backend; .\venv\Scripts\Activate.ps1; uvicorn main:app --reload'
Start-Process powershell -ArgumentList '-NoExit','-Command','cd frontend; npm start'
```

### Database migrations

If upgrading from an older version with schema changes:

```powershell
cd backend
.\venv\Scripts\Activate.ps1
python migrate.py
```

## Features

### Graph Canvas
- Interactive SVG with zoom (scroll wheel or +/− buttons) and pan (drag background)
- Drag nodes to arrange — positions auto-saved to DB
- **Shift+drag** from one node to another to create a relationship via a quick modal
- Bidirectional labeled arrows with parallel offset so both directions stay readable
- Sentiment-colored arrows: hates (red) → dislikes (orange) → neutral (gray) → likes (green) → loves (indigo)
- **⊟ Simple / ⊞ Detail** toggle — simplified view collapses bidirectional arrows into a single blended-color line with no labels
- Collision resolution prevents nodes from stacking
- **⇌ Sort** — hub-and-spoke layout algorithm:
  - Me node always at center
  - Nodes grouped by primary tag, each group forms a cluster
  - Clusters arranged evenly around Me in a radial pattern
  - Leaf nodes (single connection) placed near their neighbor outside the cluster
  - Untagged nodes form their own cluster

### People & Profiles
- Full contact card: name, occupation, company, location, phone, email, LinkedIn, website, birthday
- Social handles: Twitter/X, Instagram, GitHub
- Skills field (comma-separated)
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
- **Generate suggestions** button — uses AI (Anthropic API) to extract likes/dislikes from notes
- Confirmed interests show as color-coded pills (green = likes, red = dislikes)

### Search
- Searches name, primary tag, occupation, and all tags simultaneously
- **Live highlighting** — non-matching nodes fade to grayscale as you type; matching nodes glow
- Dropdown with arrow key navigation and Enter to select
- Single match auto-selects on Enter

### Data
- All data stored locally in SQLite — no account, no cloud required
- **↓ Export** button downloads a full JSON backup with all people, relationships, timelines, and interests (validated via Pydantic schemas)
- Works fully offline (AI suggestions require an Anthropic API key)

## Building the Desktop App

### Windows (local build)

```powershell
.\build-win.ps1
```

### CI (Windows + Mac via GitHub Actions)

Push a version tag to trigger builds for both platforms:

```powershell
git tag v1.0.0
git push origin v1.0.0
```

Both installers will be built by GitHub Actions and attached to a GitHub Release automatically. The installer version is set from the git tag automatically — no manual version bump needed.

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

## Future Features

- **JSON import** — restore from an export or merge two graphs
- **Edge routing** — arrows that snake around nodes for readability (requires A* pathfinding on a visibility graph)
- **Local AI suggestions** — swap Anthropic API for a local Ollama model (Llama 3.1) fine-tuned on your confirmed interests over time
- **Relationship strength** — numeric weight that thickens strong ties and fades weak ones
- **Reminders** — track "last contacted" date and surface people you haven't reached out to recently
- **Graph statistics** — degree centrality, mutual connections, cluster analysis
- **Mobile app** — React Native + Expo client backed by the same FastAPI backend. The existing REST API is already mobile-ready (all JSON, no desktop-specific dependencies). Planned approach: host the FastAPI backend on a lightweight cloud provider (Railway or Fly.io) and build a React Native frontend using `react-native-svg` for the graph canvas. The graph canvas and profile panel would be rebuilt natively; the API layer (`api.ts`) ports verbatim.
- **Multi-graph support** — maintain separate graphs (personal, professional) and switch between them
- **iCloud / Google Drive sync** — optional cloud backup of the SQLite database
