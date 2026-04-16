"""
Migration: add birthday, twitter, instagram, github, website, skills to people table.
Safe to run multiple times — skips columns that already exist.
"""
import sqlite3
import os

DB_PATH = os.environ.get("DB_PATH", "./relationship_graph.db")

NEW_COLUMNS = [
    ("birthday", "TEXT DEFAULT ''"),
    ("twitter",  "TEXT DEFAULT ''"),
    ("instagram","TEXT DEFAULT ''"),
    ("github",   "TEXT DEFAULT ''"),
    ("website",  "TEXT DEFAULT ''"),
    ("skills",   "TEXT DEFAULT ''"),
]

def migrate():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("PRAGMA table_info(people)")
    existing = {row[1] for row in cur.fetchall()}

    added = []
    for col, coltype in NEW_COLUMNS:
        if col not in existing:
            cur.execute(f"ALTER TABLE people ADD COLUMN {col} {coltype}")
            added.append(col)

    conn.commit()
    conn.close()

    if added:
        print(f"Added columns: {', '.join(added)}")
    else:
        print("All columns already exist — nothing to do.")

if __name__ == "__main__":
    migrate()
