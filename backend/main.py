# ─────────────────────────────────────────────────────────────────────────────
# main.py — FastAPI application with all REST endpoints.
# Sections: People, Tags, Timeline, AI Interest Extraction, Interests,
#           Relationships, Layout, Export.
# All routes use SQLAlchemy sessions via the get_db() dependency.
# ─────────────────────────────────────────────────────────────────────────────

from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List
import uuid, os, json, urllib.request

import models, schemas
from database import engine, get_db

models.Base.metadata.create_all(bind=engine)

# ── Auto-migration ────────────────────────────────────────────────────────────
# Adds any new columns to existing tables without wiping data.
# Safe to run on every startup — skips columns that already exist.

def run_migrations():
    import sqlite3
    # Use the same DB_PATH logic as database.py
    db_path = os.environ.get("DB_PATH", "./relationship_graph.db")
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    cur.execute("PRAGMA table_info(people)")
    existing = {row[1] for row in cur.fetchall()}
    new_columns = [
        ("birthday",  "TEXT DEFAULT ''"),
        ("twitter",   "TEXT DEFAULT ''"),
        ("instagram", "TEXT DEFAULT ''"),
        ("github",    "TEXT DEFAULT ''"),
        ("website",   "TEXT DEFAULT ''"),
        ("skills",    "TEXT DEFAULT ''"),
    ]
    for col, coltype in new_columns:
        if col not in existing:
            cur.execute(f"ALTER TABLE people ADD COLUMN {col} {coltype}")
    conn.commit()
    conn.close()

run_migrations()

app = FastAPI(title="Relationship Graph API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:8000", "file://", "null"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")


# ── People ────────────────────────────────────────────────────────────────────

@app.get("/people", response_model=List[schemas.PersonOut])
def get_people(db: Session = Depends(get_db)):
    return db.query(models.Person).all()


@app.post("/people", response_model=schemas.PersonOut)
def create_person(person: schemas.PersonCreate, db: Session = Depends(get_db)):
    existing = db.query(models.Person).filter(models.Person.name == person.name).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Person '{person.name}' already exists")
    db_person = models.Person(id=str(uuid.uuid4()), **person.model_dump())
    db.add(db_person)
    db.commit()
    db.refresh(db_person)
    return db_person


@app.put("/people/{person_id}", response_model=schemas.PersonOut)
def update_person(person_id: str, updates: schemas.PersonUpdate, db: Session = Depends(get_db)):
    person = db.query(models.Person).filter(models.Person.id == person_id).first()
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
    for field, value in updates.model_dump(exclude_none=True).items():
        setattr(person, field, value)
    db.commit()
    db.refresh(person)
    return person


@app.delete("/people/{person_id}")
def delete_person(person_id: str, db: Session = Depends(get_db)):
    person = db.query(models.Person).filter(models.Person.id == person_id).first()
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
    db.delete(person)
    db.commit()
    return {"ok": True}


# ── Tags ──────────────────────────────────────────────────────────────────────

@app.post("/people/{person_id}/tags", response_model=schemas.TagOut)
def add_tag(person_id: str, body: dict, db: Session = Depends(get_db)):
    label = body.get("label", "").strip().lower()
    if not label:
        raise HTTPException(status_code=400, detail="Label required")
    existing = db.query(models.PersonTag).filter(
        models.PersonTag.person_id == person_id,
        models.PersonTag.label == label,
    ).first()
    if existing:
        return existing
    tag = models.PersonTag(id=str(uuid.uuid4()), person_id=person_id, label=label)
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return tag


@app.delete("/tags/{tag_id}")
def delete_tag(tag_id: str, db: Session = Depends(get_db)):
    tag = db.query(models.PersonTag).filter(models.PersonTag.id == tag_id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    db.delete(tag)
    db.commit()
    return {"ok": True}


# ── Timeline ──────────────────────────────────────────────────────────────────

@app.get("/people/{person_id}/timeline", response_model=List[schemas.TimelineEntryOut])
def get_timeline(person_id: str, db: Session = Depends(get_db)):
    return db.query(models.TimelineEntry).filter(
        models.TimelineEntry.person_id == person_id
    ).order_by(models.TimelineEntry.date.desc()).all()


@app.post("/people/{person_id}/timeline", response_model=schemas.TimelineEntryOut)
def add_timeline_entry(person_id: str, entry: schemas.TimelineEntryCreate, db: Session = Depends(get_db)):
    db_entry = models.TimelineEntry(
        id=str(uuid.uuid4()),
        person_id=person_id,
        date=entry.date,
        note=entry.note,
    )
    db.add(db_entry)
    db.commit()
    db.refresh(db_entry)
    return db_entry


@app.delete("/timeline/{entry_id}")
def delete_timeline_entry(entry_id: str, db: Session = Depends(get_db)):
    entry = db.query(models.TimelineEntry).filter(models.TimelineEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    db.delete(entry)
    db.commit()
    return {"ok": True}


# ── AI Interest Extraction ────────────────────────────────────────────────────

@app.post("/timeline/{entry_id}/analyze")
def analyze_timeline_entry(entry_id: str, db: Session = Depends(get_db)):
    entry = db.query(models.TimelineEntry).filter(models.TimelineEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")

    if not ANTHROPIC_API_KEY:
        return {"suggestions": [], "count": 0, "message": "AI suggestions not enabled. Set ANTHROPIC_API_KEY to enable this feature."}

    prompt = f"""Extract any likes and dislikes mentioned in this note about a person.
Return ONLY a JSON object with two arrays: "likes" and "dislikes".
Each item should be a short label (2-4 words max).
If none are found, return empty arrays.

Note: "{entry.note}"

Example output:
{{"likes": ["sushi", "hiking", "sci-fi movies"], "dislikes": ["loud music", "mornings"]}}"""

    payload = json.dumps({
        "model": "claude-sonnet-4-20250514",
        "max_tokens": 256,
        "messages": [{"role": "user", "content": prompt}]
    }).encode()

    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req) as res:
            data = json.loads(res.read())
        text = data["content"][0]["text"].strip()
        # Strip markdown fences if present
        if text.startswith("```"):
            text = "\n".join(text.split("\n")[1:-1])
        extracted = json.loads(text)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI extraction failed: {str(e)}")

    created = []
    for label in extracted.get("likes", []):
        interest = models.PersonInterest(
            id=str(uuid.uuid4()),
            person_id=entry.person_id,
            type="likes",
            label=label.strip(),
            confirmed=False,
            source_entry_id=entry_id,
        )
        db.add(interest)
        created.append({"type": "likes", "label": label.strip()})

    for label in extracted.get("dislikes", []):
        interest = models.PersonInterest(
            id=str(uuid.uuid4()),
            person_id=entry.person_id,
            type="dislikes",
            label=label.strip(),
            confirmed=False,
            source_entry_id=entry_id,
        )
        db.add(interest)
        created.append({"type": "dislikes", "label": label.strip()})

    db.commit()
    return {"suggestions": created, "count": len(created)}


# ── Interests ─────────────────────────────────────────────────────────────────

@app.get("/people/{person_id}/interests", response_model=List[schemas.InterestOut])
def get_interests(person_id: str, db: Session = Depends(get_db)):
    return db.query(models.PersonInterest).filter(
        models.PersonInterest.person_id == person_id
    ).all()


@app.put("/interests/{interest_id}/confirm", response_model=schemas.InterestOut)
def confirm_interest(interest_id: str, body: schemas.InterestConfirm, db: Session = Depends(get_db)):
    interest = db.query(models.PersonInterest).filter(models.PersonInterest.id == interest_id).first()
    if not interest:
        raise HTTPException(status_code=404, detail="Interest not found")
    interest.confirmed = body.confirmed
    db.commit()
    db.refresh(interest)
    return interest


@app.delete("/interests/{interest_id}")
def delete_interest(interest_id: str, db: Session = Depends(get_db)):
    interest = db.query(models.PersonInterest).filter(models.PersonInterest.id == interest_id).first()
    if not interest:
        raise HTTPException(status_code=404, detail="Interest not found")
    db.delete(interest)
    db.commit()
    return {"ok": True}


# ── Relationships ─────────────────────────────────────────────────────────────

@app.post("/relationships", response_model=schemas.RelationshipOut)
def create_relationship(rel: schemas.RelationshipCreate, db: Session = Depends(get_db)):
    existing = db.query(models.Relationship).filter(
        models.Relationship.from_id == rel.from_id,
        models.Relationship.to_id == rel.to_id,
    ).first()
    if existing:
        existing.label = rel.label
        existing.sentiment = rel.sentiment
        db.commit()
        db.refresh(existing)
        return existing
    db_rel = models.Relationship(id=str(uuid.uuid4()), **rel.model_dump())
    db.add(db_rel)
    db.commit()
    db.refresh(db_rel)
    return db_rel


@app.put("/relationships/{rel_id}", response_model=schemas.RelationshipOut)
def update_relationship(rel_id: str, updates: schemas.RelationshipUpdate, db: Session = Depends(get_db)):
    rel = db.query(models.Relationship).filter(models.Relationship.id == rel_id).first()
    if not rel:
        raise HTTPException(status_code=404, detail="Relationship not found")
    rel.label = updates.label
    rel.sentiment = updates.sentiment
    db.commit()
    db.refresh(rel)
    return rel


@app.delete("/relationships/{rel_id}")
def delete_relationship(rel_id: str, db: Session = Depends(get_db)):
    rel = db.query(models.Relationship).filter(models.Relationship.id == rel_id).first()
    if not rel:
        raise HTTPException(status_code=404, detail="Relationship not found")
    db.delete(rel)
    db.commit()
    return {"ok": True}


# ── Export ───────────────────────────────────────────────────────────────────

@app.get("/export", response_model=schemas.ExportData)
def export_data(db: Session = Depends(get_db)):
    from datetime import datetime
    people = db.query(models.Person).all()
    return schemas.ExportData(
        version=1,
        exported_at=datetime.utcnow().isoformat(),
        people=[
            schemas.ExportPerson(
                id=p.id,
                name=p.name,
                primary_tag=p.primary_tag or "",
                occupation=p.occupation or "",
                company=p.company or "",
                location=p.location or "",
                phone=p.phone or "",
                email=p.email or "",
                linkedin=p.linkedin or "",
                description=p.description or "",
                photo=p.photo or "",
                birthday=p.birthday or "",
                twitter=p.twitter or "",
                instagram=p.instagram or "",
                github=p.github or "",
                website=p.website or "",
                skills=p.skills or "",
                x=p.x,
                y=p.y,
                tags=[schemas.ExportTag(id=t.id, label=t.label) for t in p.tags],
                timeline=[schemas.ExportTimelineEntry(id=e.id, date=e.date, note=e.note) for e in p.timeline],
                interests=[schemas.ExportInterest(id=i.id, type=i.type, label=i.label, confirmed=i.confirmed) for i in p.interests],
                relationships=[
                    schemas.ExportRelationship(id=r.id, to_id=r.to_id, label=r.label, sentiment=r.sentiment)
                    for r in p.outgoing
                ],
            )
            for p in people
        ],
    )

# ── Import ───────────────────────────────────────────────────────────────────

@app.post("/import")
def import_data(payload: schemas.ExportData, db: Session = Depends(get_db)):
    """
    Replace the entire graph with data from an export file.
    Wipes all existing data first, then restores people, tags, timeline,
    interests, and relationships from the import payload.
    ID remapping is handled so relationships resolve correctly even if the
    imported IDs collide with existing ones.
    """
    # ── Wipe existing data ────────────────────────────────────────────────────
    # Delete in dependency order to avoid FK constraint violations
    db.query(models.PersonInterest).delete()
    db.query(models.TimelineEntry).delete()
    db.query(models.PersonTag).delete()
    db.query(models.Relationship).delete()
    db.query(models.Person).delete()
    db.commit()

    # ── Restore people ────────────────────────────────────────────────────────
    # Build an ID map in case imported IDs need to be remapped
    id_map: dict[str, str] = {}

    for p in payload.people:
        new_id = str(uuid.uuid4())
        id_map[p.id] = new_id
        person = models.Person(
            id=new_id,
            name=p.name,
            primary_tag=p.primary_tag,
            occupation=p.occupation,
            company=p.company,
            location=p.location,
            phone=p.phone,
            email=p.email,
            linkedin=p.linkedin,
            description=p.description,
            photo=p.photo,
            birthday=p.birthday,
            twitter=p.twitter,
            instagram=p.instagram,
            github=p.github,
            website=p.website,
            skills=p.skills,
            x=p.x,
            y=p.y,
        )
        db.add(person)

        for tag in p.tags:
            db.add(models.PersonTag(
                id=str(uuid.uuid4()),
                person_id=new_id,
                label=tag.label,
            ))

        for entry in p.timeline:
            db.add(models.TimelineEntry(
                id=str(uuid.uuid4()),
                person_id=new_id,
                date=entry.date,
                note=entry.note,
            ))

        for interest in p.interests:
            db.add(models.PersonInterest(
                id=str(uuid.uuid4()),
                person_id=new_id,
                type=interest.type,
                label=interest.label,
                confirmed=interest.confirmed,
            ))

    db.commit()

    # ── Restore relationships (after all people exist) ────────────────────────
    for p in payload.people:
        from_id = id_map.get(p.id)
        if not from_id:
            continue
        for rel in p.relationships:
            to_id = id_map.get(rel.to_id)
            if not to_id:
                continue  # Skip if target person wasn't in the import
            db.add(models.Relationship(
                id=str(uuid.uuid4()),
                from_id=from_id,
                to_id=to_id,
                label=rel.label,
                sentiment=rel.sentiment,
            ))

    db.commit()
    return {"ok": True, "people": len(payload.people)}


# ── Layout ────────────────────────────────────────────────────────────────────

@app.put("/layout")
def save_layout(layout: schemas.LayoutUpdate, db: Session = Depends(get_db)):
    for person_id, pos in layout.positions.items():
        person = db.query(models.Person).filter(models.Person.id == person_id).first()
        if person:
            person.x = pos["x"]
            person.y = pos["y"]
    db.commit()
    return {"ok": True}
