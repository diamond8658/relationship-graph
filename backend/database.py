# ─────────────────────────────────────────────────────────────────────────────
# database.py — SQLAlchemy engine and session setup.
# DB_PATH env var allows the packaged Electron app to store the database in the
# user's app data directory instead of next to the executable.
# ─────────────────────────────────────────────────────────────────────────────

import os
from sqlalchemy import create_engine, event
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# Use DB_PATH if set (Electron/Tauri sets this at startup), otherwise local file.
_db_path = os.environ.get("DB_PATH", "./relationship_graph.db")
SQLALCHEMY_DATABASE_URL = f"sqlite:///{_db_path}"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False}  # Required for SQLite with FastAPI
)


@event.listens_for(engine, "connect")
def _enable_sqlite_foreign_keys(dbapi_connection, connection_record):
    """
    SQLite ignores `ON DELETE CASCADE` in the schema unless foreign-key
    enforcement is explicitly turned on per-connection — it's off by default.
    Without this, deleting a Person leaves orphaned RelationshipSuggestion /
    ProfileSuggestion rows behind with dangling from_id/to_id/person_id
    references, since bulk/raw deletes don't go through SQLAlchemy's
    ORM-level cascade= handling.
    """
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# FastAPI dependency — yields a DB session and closes it after the request.
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
