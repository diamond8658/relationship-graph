# ─────────────────────────────────────────────────────────────────────────────
# database.py — SQLAlchemy engine and session setup.
# DB_PATH env var allows the packaged Electron app to store the database in the
# user's app data directory instead of next to the executable.
# ─────────────────────────────────────────────────────────────────────────────

import os
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# Use DB_PATH if set (Electron sets this at startup), otherwise local file.
_db_path = os.environ.get("DB_PATH", "./relationship_graph.db")
SQLALCHEMY_DATABASE_URL = f"sqlite:///{_db_path}"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False}  # Required for SQLite with FastAPI
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# FastAPI dependency — yields a DB session and closes it after the request.
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
