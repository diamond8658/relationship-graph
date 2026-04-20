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
    # Ensure new tables exist
    conn.execute("""
        CREATE TABLE IF NOT EXISTS relationship_suggestions (
            id TEXT PRIMARY KEY,
            from_id TEXT REFERENCES people(id) ON DELETE CASCADE,
            to_id TEXT REFERENCES people(id) ON DELETE CASCADE,
            to_name TEXT DEFAULT '',
            label TEXT DEFAULT '',
            sentiment TEXT DEFAULT 'neutral',
            source TEXT DEFAULT '',
            confirmed INTEGER DEFAULT 0
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS profile_suggestions (
            id TEXT PRIMARY KEY,
            person_id TEXT REFERENCES people(id) ON DELETE CASCADE,
            field TEXT NOT NULL,
            value TEXT NOT NULL,
            confirmed INTEGER DEFAULT 0
        )
    """)
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

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_MODEL = "llama-3.1-8b-instant"
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"


def groq_call(prompt: str, max_tokens: int = 512) -> str:
    """
    Send a prompt to Groq and return the response text.
    Raises RuntimeError if AI is not configured or the call fails.
    """
    if not GROQ_API_KEY:
        raise RuntimeError("AI not configured. Set GROQ_API_KEY environment variable.")
    payload = json.dumps({
        "model": GROQ_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens,
        "temperature": 0.1,   # low temp for reliable structured JSON output
    }).encode()
    req = urllib.request.Request(
        GROQ_URL,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {GROQ_API_KEY}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        data = json.loads(res.read())
    text = data["choices"][0]["message"]["content"].strip()
    # Strip markdown fences if model wraps output in ```json ... ```
    if text.startswith("```"):
        text = "
".join(text.split("
")[1:])
        if text.endswith("```"):
            text = text[:-3].strip()
    return text


# ── AI Status ────────────────────────────────────────────────────────────────

@app.get("/ai/status", response_model=schemas.AIStatus)
def ai_status():
    """Returns whether AI features are available and which model is in use."""
    return schemas.AIStatus(
        enabled=bool(GROQ_API_KEY),
        model=GROQ_MODEL if GROQ_API_KEY else "",
    )


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


# ── AI Analysis ──────────────────────────────────────────────────────────────

@app.post("/timeline/{entry_id}/analyze")
def analyze_timeline_entry(entry_id: str, db: Session = Depends(get_db)):
    """
    Expanded timeline analysis — extracts:
    - likes/dislikes (stored as PersonInterest)
    - people mentioned (stored as RelationshipSuggestion if they exist in the graph)
    - locations and key sentiments (returned as metadata)
    """
    entry = db.query(models.TimelineEntry).filter(models.TimelineEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")

    if not GROQ_API_KEY:
        return {"suggestions": [], "count": 0, "ai_enabled": False,
                "message": "AI not configured. Set GROQ_API_KEY to enable."}

    # Build list of known people for relationship matching
    all_people = db.query(models.Person).all()
    person_names = {p.name.lower(): p for p in all_people}
    subject_person = db.query(models.Person).filter(
        models.Person.id == entry.person_id
    ).first()

    prompt = f"""Analyze this journal note about {subject_person.name if subject_person else "a person"}.

Return ONLY a JSON object with these keys:
- "likes": list of short labels (2-4 words) for things they like
- "dislikes": list of short labels (2-4 words) for things they dislike  
- "people_mentioned": list of objects with "name" and "relationship" (e.g. "Friend", "Colleague", "Partner") for any people mentioned
- "locations": list of locations mentioned
- "sentiment_notes": list of short observations about their emotional state or attitude

Return empty arrays if nothing is found. Labels should be concise.

Note: "{entry.note}"

Example output:
{{"likes": ["sushi", "hiking"], "dislikes": ["loud music"], "people_mentioned": [{{"name": "Alice", "relationship": "Friend"}}], "locations": ["NYC"], "sentiment_notes": ["seems happy about new job"]}}"""

    try:
        text = groq_call(prompt, max_tokens=512)
        extracted = json.loads(text)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI analysis failed: {str(e)}")

    created_interests = []
    created_rel_suggestions = []

    # Store likes/dislikes
    for label in extracted.get("likes", []):
        db.add(models.PersonInterest(
            id=str(uuid.uuid4()), person_id=entry.person_id,
            type="likes", label=label.strip(), confirmed=False,
            source_entry_id=entry_id,
        ))
        created_interests.append({"type": "likes", "label": label.strip()})

    for label in extracted.get("dislikes", []):
        db.add(models.PersonInterest(
            id=str(uuid.uuid4()), person_id=entry.person_id,
            type="dislikes", label=label.strip(), confirmed=False,
            source_entry_id=entry_id,
        ))
        created_interests.append({"type": "dislikes", "label": label.strip()})

    # Store relationship suggestions for people found in the graph
    for mention in extracted.get("people_mentioned", []):
        name = mention.get("name", "").strip()
        rel_label = mention.get("relationship", "Friend").strip()
        matched = person_names.get(name.lower())
        if matched and matched.id != entry.person_id:
            # Check we haven't already suggested this pair
            existing = db.query(models.RelationshipSuggestion).filter(
                models.RelationshipSuggestion.from_id == entry.person_id,
                models.RelationshipSuggestion.to_id == matched.id,
            ).first()
            if not existing:
                db.add(models.RelationshipSuggestion(
                    id=str(uuid.uuid4()),
                    from_id=entry.person_id,
                    to_id=matched.id,
                    to_name=matched.name,
                    label=rel_label,
                    sentiment="neutral",
                    source=entry.note[:120],
                    confirmed=False,
                ))
                created_rel_suggestions.append({"name": name, "label": rel_label})

    db.commit()
    return {
        "suggestions": created_interests,
        "count": len(created_interests),
        "relationship_suggestions": created_rel_suggestions,
        "locations": extracted.get("locations", []),
        "sentiment_notes": extracted.get("sentiment_notes", []),
        "ai_enabled": True,
    }


# ── Relationship Suggestions ──────────────────────────────────────────────────

@app.get("/people/{person_id}/relationship-suggestions",
         response_model=List[schemas.RelationshipSuggestionOut])
def get_relationship_suggestions(person_id: str, db: Session = Depends(get_db)):
    return db.query(models.RelationshipSuggestion).filter(
        models.RelationshipSuggestion.from_id == person_id,
        models.RelationshipSuggestion.confirmed == False,
    ).all()


@app.put("/relationship-suggestions/{suggestion_id}/confirm")
def confirm_relationship_suggestion(
    suggestion_id: str,
    body: schemas.RelationshipSuggestionConfirm,
    db: Session = Depends(get_db),
):
    sugg = db.query(models.RelationshipSuggestion).filter(
        models.RelationshipSuggestion.id == suggestion_id
    ).first()
    if not sugg:
        raise HTTPException(status_code=404, detail="Suggestion not found")

    if body.confirmed:
        # Promote to a real relationship
        existing = db.query(models.Relationship).filter(
            models.Relationship.from_id == sugg.from_id,
            models.Relationship.to_id == sugg.to_id,
        ).first()
        if not existing:
            db.add(models.Relationship(
                id=str(uuid.uuid4()),
                from_id=sugg.from_id,
                to_id=sugg.to_id,
                label=sugg.label,
                sentiment=sugg.sentiment,
            ))

    # Remove suggestion either way
    db.delete(sugg)
    db.commit()
    return {"ok": True, "confirmed": body.confirmed}


@app.delete("/relationship-suggestions/{suggestion_id}")
def delete_relationship_suggestion(suggestion_id: str, db: Session = Depends(get_db)):
    sugg = db.query(models.RelationshipSuggestion).filter(
        models.RelationshipSuggestion.id == suggestion_id
    ).first()
    if not sugg:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    db.delete(sugg)
    db.commit()
    return {"ok": True}


# ── Profile Enrichment ────────────────────────────────────────────────────────

@app.post("/people/{person_id}/enrich")
def enrich_profile(person_id: str, db: Session = Depends(get_db)):
    """
    Uses AI to suggest values for empty profile fields based on name,
    company, and any existing timeline/description context.
    Stores suggestions as ProfileSuggestion rows for user review.
    """
    person = db.query(models.Person).filter(models.Person.id == person_id).first()
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    if not GROQ_API_KEY:
        return {"suggestions": [], "count": 0, "ai_enabled": False,
                "message": "AI not configured. Set GROQ_API_KEY to enable."}

    # Build context from existing data
    timeline_notes = " | ".join([e.note for e in person.timeline[:5]])
    context = f"""Name: {person.name}
Company: {person.company or "unknown"}
Current occupation: {person.occupation or "unknown"}
Current location: {person.location or "unknown"}
Current description: {person.description or "none"}
Current skills: {person.skills or "none"}
Timeline notes: {timeline_notes or "none"}"""

    prompt = f"""Based on this information about a person, suggest values for their profile fields.
Only suggest fields where you have reasonable confidence. Leave fields empty if unsure.

{context}

Return ONLY a JSON object with these optional keys (omit any you're not confident about):
- "occupation": job title
- "location": city and country
- "description": 1-2 sentence personality/professional summary
- "skills": comma-separated list of skills

Example:
{{"occupation": "Software Engineer", "location": "San Francisco, CA", "skills": "Python, AWS, data pipelines"}}"""

    try:
        text = groq_call(prompt, max_tokens=300)
        suggested = json.loads(text)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI enrichment failed: {str(e)}")

    created = []
    enrichable_fields = ["occupation", "location", "description", "skills"]

    for field in enrichable_fields:
        value = suggested.get(field, "").strip()
        if not value:
            continue
        # Only suggest if field is currently empty
        if getattr(person, field, ""):
            continue
        # Remove existing pending suggestion for this field if any
        db.query(models.ProfileSuggestion).filter(
            models.ProfileSuggestion.person_id == person_id,
            models.ProfileSuggestion.field == field,
            models.ProfileSuggestion.confirmed == False,
        ).delete()
        db.add(models.ProfileSuggestion(
            id=str(uuid.uuid4()),
            person_id=person_id,
            field=field,
            value=value,
            confirmed=False,
        ))
        created.append({"field": field, "value": value})

    db.commit()
    return {"suggestions": created, "count": len(created), "ai_enabled": True}


@app.get("/people/{person_id}/profile-suggestions",
         response_model=List[schemas.ProfileSuggestionOut])
def get_profile_suggestions(person_id: str, db: Session = Depends(get_db)):
    return db.query(models.ProfileSuggestion).filter(
        models.ProfileSuggestion.person_id == person_id,
        models.ProfileSuggestion.confirmed == False,
    ).all()


@app.put("/profile-suggestions/{suggestion_id}/confirm")
def confirm_profile_suggestion(
    suggestion_id: str,
    body: schemas.ProfileSuggestionConfirm,
    db: Session = Depends(get_db),
):
    sugg = db.query(models.ProfileSuggestion).filter(
        models.ProfileSuggestion.id == suggestion_id
    ).first()
    if not sugg:
        raise HTTPException(status_code=404, detail="Suggestion not found")

    if body.confirmed:
        # Apply the suggested value to the person's profile
        person = db.query(models.Person).filter(
            models.Person.id == sugg.person_id
        ).first()
        if person:
            setattr(person, sugg.field, sugg.value)

    db.delete(sugg)
    db.commit()
    return {"ok": True, "confirmed": body.confirmed}


@app.delete("/profile-suggestions/{suggestion_id}")
def delete_profile_suggestion(suggestion_id: str, db: Session = Depends(get_db)):
    sugg = db.query(models.ProfileSuggestion).filter(
        models.ProfileSuggestion.id == suggestion_id
    ).first()
    if not sugg:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    db.delete(sugg)
    db.commit()
    return {"ok": True}


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
