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
│   ├── main.py             # FastAPI routes
│   ├── models.py           # SQLAlchemy models
│   ├── schemas.py          # Pydantic schemas
│   ├── database.py         # DB setup
│   ├── server.py           # PyInstaller entry point
│   ├── backend.spec        # PyInstaller spec
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Graph.tsx           # SVG canvas, nodes, edges, zoom/pan
│   │   │   ├── ProfilePanel.tsx    # Sidebar profile editor
│   │   │   ├── Toolbar.tsx         # Search, add, sort, export
│   │   │   ├── AddPersonModal.tsx  # Add person dialog
│   │   │   └── MeSetupModal.tsx    # First-run setup
│   │   ├── types.ts
│   │   ├── api.ts
│   │   ├── App.tsx
│   │   └── index.tsx
│   └── public/
│       └── index.html
├── electron/
│   ├── main.js             # Electron main process
│   └── package.json
├── .github/workflows/
│   └── build.yml           # CI: builds Windows + Mac installers on tag
└── build-win.ps1           # Local Windows build script
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

The API runs at `http://localhost:8000`. Docs at `http://localhost:8000/docs`.

### Frontend

```powershell
cd frontend
npm install
npm start
```

The app opens at `http://localhost:3000`.

### Run both at once

```powershell
Start-Process powershell -ArgumentList '-NoExit','-Command','cd backend; .\venv\Scripts\Activate.ps1; uvicorn main:app --reload'
Start-Process powershell -ArgumentList '-NoExit','-Command','cd frontend; npm start'
```

### Database migrations

If you're upgrading from an older version and the DB schema has changed:

```powershell
cd backend
.\venv\Scripts\Activate.ps1
python migrate.py
```

## Features

**Graph**
- Interactive SVG canvas with zoom (scroll wheel or buttons) and pan (drag background)
- Drag nodes to arrange — positions saved automatically
- Bidirectional labeled arrows with sentiment colors (hates → loves)
- Parallel offset arrows so bidirectional connections don't overlap
- Collision resolution prevents nodes from stacking
- ⇌ Sort button runs a radial layout algorithm to untangle the graph

**People**
- Add people with name, occupation, company, location, phone, email, LinkedIn
- Upload a photo or paste a URL
- Tags with a primary tag that drives node color
- Freeform description for traits and notes
- "Me" node — gold colored anchor at the center of your graph

**Relationships**
- Each person independently labels and rates their connection to others
- Sentiment: Hates / Dislikes / Neutral / Likes / Loves
- Arrow color reflects sentiment
- Searchable relationship picker with arrow key navigation

**Timeline**
- Dated log entries per person
- "Generate suggestions" button — uses AI (Anthropic API) to extract likes/dislikes from notes
- Confirmed interests show as pills on the profile

**Search**
- Searches name, primary tag, occupation, and all tags
- Dropdown with arrow key navigation
- Enter selects single match automatically

**Data**
- All data stored locally in SQLite — no account, no cloud
- JSON export via the ↓ Export button

## Building Desktop App

### Windows (local)

```powershell
.\build-win.ps1
```

### CI (Windows + Mac)

Push a version tag to trigger GitHub Actions builds:

```powershell
git tag v1.0.0
git push origin v1.0.0
```

Both installers will be attached to a GitHub Release automatically.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /people | Get all people with full data |
| POST | /people | Create a person |
| PUT | /people/{id} | Update a person |
| DELETE | /people/{id} | Delete a person |
| POST | /people/{id}/tags | Add a tag |
| DELETE | /tags/{id} | Remove a tag |
| GET | /people/{id}/timeline | Get timeline entries |
| POST | /people/{id}/timeline | Add a timeline entry |
| DELETE | /timeline/{id} | Delete a timeline entry |
| POST | /timeline/{id}/analyze | AI extract likes/dislikes |
| GET | /people/{id}/interests | Get interests |
| PUT | /interests/{id}/confirm | Confirm/reject an interest |
| DELETE | /interests/{id} | Delete an interest |
| POST | /relationships | Create/update a relationship |
| PUT | /relationships/{id} | Update relationship |
| DELETE | /relationships/{id} | Delete a relationship |
| PUT | /layout | Batch save node positions |
| GET | /export | Export all data as JSON |

## Future Features

- **JSON import** — restore from an export file or merge two graphs
- **Local AI suggestions** — replace Anthropic API calls with a local Ollama model (Llama 3.1) fine-tuned on your confirmed likes/dislikes over time
- **Groups / circles** — cluster people into named groups (work, family, college) with visual grouping on the canvas
- **Relationship strength** — a numeric weight on connections that fades arrows for weak ties and thickens them for strong ones
- **Reminders** — set a "last contacted" date and get nudges when you haven't talked to someone in a while
- **Graph statistics** — show degree centrality, mutual connections, and cluster analysis
- **Mobile app** — React Native version backed by the same FastAPI backend
- **Multi-graph support** — maintain separate graphs (personal, professional) and switch between them
- **iCloud / Google Drive sync** — optional cloud backup of the SQLite database
