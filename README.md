# Relationship Graph

An interactive relationship diagram app with bidirectional labeled connections, profile panels, search, and SQLite persistence.

## Stack

- **Frontend:** React + TypeScript (Create React App)
- **Backend:** FastAPI + SQLite (SQLAlchemy)

## Project Structure

```
relationship-graph/
├── backend/
│   ├── main.py         # FastAPI routes
│   ├── models.py       # SQLAlchemy models
│   ├── schemas.py      # Pydantic schemas
│   ├── database.py     # DB setup
│   └── requirements.txt
└── frontend/
    ├── src/
    │   ├── components/
    │   │   ├── Graph.tsx
    │   │   ├── ProfilePanel.tsx
    │   │   ├── AddPersonModal.tsx
    │   │   └── Toolbar.tsx
    │   ├── types.ts
    │   ├── api.ts
    │   ├── App.tsx
    │   └── index.tsx
    └── public/
        └── index.html
```

## Getting Started

### Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```

The API will be running at `http://localhost:8000`.
API docs available at `http://localhost:8000/docs`.

### Frontend

```bash
cd frontend
npm install
npm start
```

The app will open at `http://localhost:3000`.

## Features

- **Interactive SVG graph** — drag nodes to arrange, positions saved to DB
- **Bidirectional labeled arrows** — each person independently defines how they see the other
- **Profile panel** — click any node to view/edit name, group, bio, photo, and relationships
- **Add/delete people** — directly from the UI
- **Add/edit/remove relationships** — from the profile panel
- **Search/filter** — highlights matching nodes, dims the rest
- **Photo support** — upload a file or paste a URL
- **Persistent** — all data stored in SQLite via FastAPI backend

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /people | Get all people |
| POST | /people | Create a person |
| PUT | /people/{id} | Update a person |
| DELETE | /people/{id} | Delete a person |
| POST | /relationships | Create/update a relationship |
| PUT | /relationships/{id} | Update relationship label |
| DELETE | /relationships/{id} | Delete a relationship |
| PUT | /layout | Save node positions |
