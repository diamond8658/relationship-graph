# ─────────────────────────────────────────────────────────────────────────────
# main.py — FastAPI application, cloud multi-tenant variant.
# Every endpoint below (except /health, /ai/status, and the /auth/* routes
# themselves) depends on auth.get_current_user and scopes its query to that
# user's own data. Sub-resources that don't carry owner_id directly (tags,
# timeline entries, relationships, suggestions) verify ownership by joining
# through the Person they belong to. A 404 — never 403 — is returned for
# resources that exist but belong to someone else, so this API never leaks
# the existence of another user's data through status codes.
# ─────────────────────────────────────────────────────────────────────────────

from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from typing import List
import uuid, os, json, urllib.request
from datetime import datetime, timezone

import models, schemas
import auth
from database import engine, get_db

models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="Relationship Graph API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:8000",
        "tauri://localhost",
        "http://tauri.localhost",
        "file://", "null",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_MODEL = "llama-3.1-8b-instant"
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"


# ── Auth ─────────────────────────────────────────────────────────────────────

@app.post("/auth/register", response_model=schemas.TokenOut)
def register(payload: schemas.UserCreate, db: Session = Depends(get_db)):
    existing = db.query(models.User).filter(models.User.email == payload.email.lower()).first()
    if existing:
        raise HTTPException(400, "An account with this email already exists")
    user = models.User(
        email=payload.email.lower(),
        hashed_password=auth.hash_password(payload.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"access_token": auth.create_access_token(user.id), "token_type": "bearer"}


@app.post("/auth/login", response_model=schemas.TokenOut)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == form_data.username.lower()).first()
    if not user or not auth.verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=401,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return {"access_token": auth.create_access_token(user.id), "token_type": "bearer"}


@app.get("/auth/me", response_model=schemas.UserOut)
def get_me(current_user: models.User = Depends(auth.get_current_user)):
    return current_user


def groq_call(prompt: str, max_tokens: int = 512) -> str:
    if not GROQ_API_KEY:
        raise RuntimeError("AI not configured. Set GROQ_API_KEY environment variable.")
    payload = json.dumps({
        "model": GROQ_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens,
        "temperature": 0.1,
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
    if text.startswith("```"):
        text = "\n".join(text.split("\n")[1:])
        if text.endswith("```"):
            text = text[:-3].strip()
    return text


# ── Status ───────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/ai/status", response_model=schemas.AIStatus)
def ai_status():
    return schemas.AIStatus(
        enabled=bool(GROQ_API_KEY),
        model=GROQ_MODEL if GROQ_API_KEY else "",
    )


# ── Ownership helper ─────────────────────────────────────────────────────────

def get_owned_person(person_id: str, current_user: models.User, db: Session) -> models.Person:
    person = db.query(models.Person).filter(
        models.Person.id == person_id, models.Person.owner_id == current_user.id,
        models.Person.deleted_at.is_(None),
    ).first()
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
    return person


# ── People ────────────────────────────────────────────────────────────────────

@app.get("/people", response_model=List[schemas.PersonOut])
def get_people(db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    return db.query(models.Person).filter(
        models.Person.owner_id == current_user.id, models.Person.deleted_at.is_(None),
    ).all()


@app.post("/people", response_model=schemas.PersonOut)
def create_person(person: schemas.PersonCreate, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    existing = db.query(models.Person).filter(
        models.Person.owner_id == current_user.id, models.Person.name == person.name,
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Person '{person.name}' already exists")
    db_person = models.Person(id=str(uuid.uuid4()), owner_id=current_user.id, **person.model_dump())
    db.add(db_person)
    db.commit()
    db.refresh(db_person)
    return db_person


@app.put("/people/{person_id}", response_model=schemas.PersonOut)
def update_person(person_id: str, updates: schemas.PersonUpdate, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    person = get_owned_person(person_id, current_user, db)
    for field, value in updates.model_dump(exclude_none=True).items():
        setattr(person, field, value)
    db.commit()
    db.refresh(person)
    return person


@app.delete("/people/{person_id}")
def delete_person(person_id: str, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    # Soft delete, not db.delete() — a hard delete would vanish with nothing
    # for another device's sync to notice. Note: this doesn't cascade the
    # tombstone to this person's tags/timeline/interests/relationships —
    # they're left as orphaned rows rather than individually tombstoned,
    # which is harmless since every read path filters through a
    # non-deleted Person first, but is worth knowing about if you're ever
    # inspecting the database directly.
    person = get_owned_person(person_id, current_user, db)
    person.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True}


# ── Tags ──────────────────────────────────────────────────────────────────────

@app.post("/people/{person_id}/tags", response_model=schemas.TagOut)
def add_tag(person_id: str, body: dict, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    get_owned_person(person_id, current_user, db)
    label = body.get("label", "").strip().lower()
    if not label:
        raise HTTPException(status_code=400, detail="Label required")
    existing = db.query(models.PersonTag).filter(
        models.PersonTag.person_id == person_id,
        models.PersonTag.label == label,
    ).first()
    if existing:
        if existing.deleted_at is not None:
            # Re-adding a tag that was previously deleted — revive it rather
            # than leaving a hidden soft-deleted duplicate row.
            existing.deleted_at = None
            db.commit()
            db.refresh(existing)
        return existing
    tag = models.PersonTag(id=str(uuid.uuid4()), person_id=person_id, label=label)
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return tag


@app.delete("/tags/{tag_id}")
def delete_tag(tag_id: str, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    tag = db.query(models.PersonTag).join(models.Person).filter(
        models.PersonTag.id == tag_id, models.Person.owner_id == current_user.id,
        models.PersonTag.deleted_at.is_(None),
    ).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    tag.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True}


# ── Timeline ──────────────────────────────────────────────────────────────────

@app.get("/people/{person_id}/timeline", response_model=List[schemas.TimelineEntryOut])
def get_timeline(person_id: str, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    get_owned_person(person_id, current_user, db)
    return db.query(models.TimelineEntry).filter(
        models.TimelineEntry.person_id == person_id, models.TimelineEntry.deleted_at.is_(None),
    ).order_by(models.TimelineEntry.date.desc()).all()


@app.post("/people/{person_id}/timeline", response_model=schemas.TimelineEntryOut)
def add_timeline_entry(person_id: str, entry: schemas.TimelineEntryCreate, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    get_owned_person(person_id, current_user, db)
    db_entry = models.TimelineEntry(
        id=str(uuid.uuid4()), person_id=person_id, date=entry.date, note=entry.note,
    )
    db.add(db_entry)
    db.commit()
    db.refresh(db_entry)
    return db_entry


@app.delete("/timeline/{entry_id}")
def delete_timeline_entry(entry_id: str, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    entry = db.query(models.TimelineEntry).join(models.Person).filter(
        models.TimelineEntry.id == entry_id, models.Person.owner_id == current_user.id,
        models.TimelineEntry.deleted_at.is_(None),
    ).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    entry.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True}


# ── AI Analysis ──────────────────────────────────────────────────────────────

@app.post("/timeline/{entry_id}/analyze")
def analyze_timeline_entry(entry_id: str, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    entry = db.query(models.TimelineEntry).join(models.Person).filter(
        models.TimelineEntry.id == entry_id, models.Person.owner_id == current_user.id,
    ).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")

    if not GROQ_API_KEY:
        return {"suggestions": [], "count": 0, "ai_enabled": False,
                "message": "AI not configured. Set GROQ_API_KEY to enable."}

    all_people = db.query(models.Person).filter(models.Person.owner_id == current_user.id).all()
    person_names = {p.name.lower(): p for p in all_people}
    subject_person = db.query(models.Person).filter(models.Person.id == entry.person_id).first()

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

    for label in extracted.get("likes", []):
        db.add(models.PersonInterest(
            id=str(uuid.uuid4()), person_id=entry.person_id,
            type="likes", label=label.strip(), confirmed=False, source_entry_id=entry_id,
        ))
        created_interests.append({"type": "likes", "label": label.strip()})

    for label in extracted.get("dislikes", []):
        db.add(models.PersonInterest(
            id=str(uuid.uuid4()), person_id=entry.person_id,
            type="dislikes", label=label.strip(), confirmed=False, source_entry_id=entry_id,
        ))
        created_interests.append({"type": "dislikes", "label": label.strip()})

    for mention in extracted.get("people_mentioned", []):
        name = mention.get("name", "").strip()
        rel_label = mention.get("relationship", "Friend").strip()
        matched = person_names.get(name.lower())
        if matched and matched.id != entry.person_id:
            existing = db.query(models.RelationshipSuggestion).filter(
                models.RelationshipSuggestion.from_id == entry.person_id,
                models.RelationshipSuggestion.to_id == matched.id,
            ).first()
            if not existing:
                db.add(models.RelationshipSuggestion(
                    id=str(uuid.uuid4()), from_id=entry.person_id, to_id=matched.id,
                    to_name=matched.name, label=rel_label, sentiment="neutral",
                    source=entry.note[:120], confirmed=False,
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

@app.get("/people/{person_id}/relationship-suggestions", response_model=List[schemas.RelationshipSuggestionOut])
def get_relationship_suggestions(person_id: str, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    get_owned_person(person_id, current_user, db)
    return db.query(models.RelationshipSuggestion).filter(
        models.RelationshipSuggestion.from_id == person_id,
        models.RelationshipSuggestion.confirmed == False,
    ).all()


@app.put("/relationship-suggestions/{suggestion_id}/confirm")
def confirm_relationship_suggestion(suggestion_id: str, body: schemas.RelationshipSuggestionConfirm, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    sugg = db.query(models.RelationshipSuggestion).join(
        models.Person, models.RelationshipSuggestion.from_id == models.Person.id
    ).filter(
        models.RelationshipSuggestion.id == suggestion_id, models.Person.owner_id == current_user.id,
    ).first()
    if not sugg:
        raise HTTPException(status_code=404, detail="Suggestion not found")

    if body.confirmed:
        existing = db.query(models.Relationship).filter(
            models.Relationship.from_id == sugg.from_id,
            models.Relationship.to_id == sugg.to_id,
        ).first()
        if not existing:
            db.add(models.Relationship(
                id=str(uuid.uuid4()), from_id=sugg.from_id, to_id=sugg.to_id,
                label=sugg.label, sentiment=sugg.sentiment,
            ))

    db.delete(sugg)
    db.commit()
    return {"ok": True, "confirmed": body.confirmed}


@app.delete("/relationship-suggestions/{suggestion_id}")
def delete_relationship_suggestion(suggestion_id: str, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    sugg = db.query(models.RelationshipSuggestion).join(
        models.Person, models.RelationshipSuggestion.from_id == models.Person.id
    ).filter(
        models.RelationshipSuggestion.id == suggestion_id, models.Person.owner_id == current_user.id,
    ).first()
    if not sugg:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    db.delete(sugg)
    db.commit()
    return {"ok": True}


# ── Profile Enrichment ────────────────────────────────────────────────────────

@app.post("/people/{person_id}/enrich")
def enrich_profile(person_id: str, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    person = get_owned_person(person_id, current_user, db)

    if not GROQ_API_KEY:
        return {"suggestions": [], "count": 0, "ai_enabled": False,
                "message": "AI not configured. Set GROQ_API_KEY to enable."}

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
        if getattr(person, field, ""):
            continue
        db.query(models.ProfileSuggestion).filter(
            models.ProfileSuggestion.person_id == person_id,
            models.ProfileSuggestion.field == field,
            models.ProfileSuggestion.confirmed == False,
        ).delete()
        db.add(models.ProfileSuggestion(
            id=str(uuid.uuid4()), person_id=person_id, field=field, value=value, confirmed=False,
        ))
        created.append({"field": field, "value": value})

    db.commit()
    return {"suggestions": created, "count": len(created), "ai_enabled": True}


@app.get("/people/{person_id}/profile-suggestions", response_model=List[schemas.ProfileSuggestionOut])
def get_profile_suggestions(person_id: str, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    get_owned_person(person_id, current_user, db)
    return db.query(models.ProfileSuggestion).filter(
        models.ProfileSuggestion.person_id == person_id,
        models.ProfileSuggestion.confirmed == False,
    ).all()


@app.put("/profile-suggestions/{suggestion_id}/confirm")
def confirm_profile_suggestion(suggestion_id: str, body: schemas.ProfileSuggestionConfirm, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    sugg = db.query(models.ProfileSuggestion).join(models.Person).filter(
        models.ProfileSuggestion.id == suggestion_id, models.Person.owner_id == current_user.id,
    ).first()
    if not sugg:
        raise HTTPException(status_code=404, detail="Suggestion not found")

    if body.confirmed:
        person = db.query(models.Person).filter(models.Person.id == sugg.person_id).first()
        if person:
            setattr(person, sugg.field, sugg.value)

    db.delete(sugg)
    db.commit()
    return {"ok": True, "confirmed": body.confirmed}


@app.delete("/profile-suggestions/{suggestion_id}")
def delete_profile_suggestion(suggestion_id: str, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    sugg = db.query(models.ProfileSuggestion).join(models.Person).filter(
        models.ProfileSuggestion.id == suggestion_id, models.Person.owner_id == current_user.id,
    ).first()
    if not sugg:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    db.delete(sugg)
    db.commit()
    return {"ok": True}


# ── Interests ─────────────────────────────────────────────────────────────────

@app.get("/people/{person_id}/interests", response_model=List[schemas.InterestOut])
def get_interests(person_id: str, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    get_owned_person(person_id, current_user, db)
    return db.query(models.PersonInterest).filter(
        models.PersonInterest.person_id == person_id, models.PersonInterest.deleted_at.is_(None),
    ).all()


@app.put("/interests/{interest_id}/confirm", response_model=schemas.InterestOut)
def confirm_interest(interest_id: str, body: schemas.InterestConfirm, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    interest = db.query(models.PersonInterest).join(models.Person).filter(
        models.PersonInterest.id == interest_id, models.Person.owner_id == current_user.id,
    ).first()
    if not interest:
        raise HTTPException(status_code=404, detail="Interest not found")
    interest.confirmed = body.confirmed
    db.commit()
    db.refresh(interest)
    return interest


@app.delete("/interests/{interest_id}")
def delete_interest(interest_id: str, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    interest = db.query(models.PersonInterest).join(models.Person).filter(
        models.PersonInterest.id == interest_id, models.Person.owner_id == current_user.id,
        models.PersonInterest.deleted_at.is_(None),
    ).first()
    if not interest:
        raise HTTPException(status_code=404, detail="Interest not found")
    interest.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True}


# ── Relationships ─────────────────────────────────────────────────────────────

@app.post("/relationships", response_model=schemas.RelationshipOut)
def create_relationship(rel: schemas.RelationshipCreate, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    get_owned_person(rel.from_id, current_user, db)
    get_owned_person(rel.to_id, current_user, db)

    existing = db.query(models.Relationship).filter(
        models.Relationship.from_id == rel.from_id,
        models.Relationship.to_id == rel.to_id,
    ).first()
    if existing:
        existing.label = rel.label
        existing.sentiment = rel.sentiment
        existing.deleted_at = None  # revive if this was previously deleted
        db.commit()
        db.refresh(existing)
        return existing
    db_rel = models.Relationship(id=str(uuid.uuid4()), **rel.model_dump())
    db.add(db_rel)
    db.commit()
    db.refresh(db_rel)
    return db_rel


@app.put("/relationships/{rel_id}", response_model=schemas.RelationshipOut)
def update_relationship(rel_id: str, updates: schemas.RelationshipUpdate, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    rel = db.query(models.Relationship).join(
        models.Person, models.Relationship.from_id == models.Person.id
    ).filter(
        models.Relationship.id == rel_id, models.Person.owner_id == current_user.id,
        models.Relationship.deleted_at.is_(None),
    ).first()
    if not rel:
        raise HTTPException(status_code=404, detail="Relationship not found")
    rel.label = updates.label
    rel.sentiment = updates.sentiment
    db.commit()
    db.refresh(rel)
    return rel


@app.delete("/relationships/{rel_id}")
def delete_relationship(rel_id: str, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    rel = db.query(models.Relationship).join(
        models.Person, models.Relationship.from_id == models.Person.id
    ).filter(
        models.Relationship.id == rel_id, models.Person.owner_id == current_user.id,
        models.Relationship.deleted_at.is_(None),
    ).first()
    if not rel:
        raise HTTPException(status_code=404, detail="Relationship not found")
    rel.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True}


# ── Export ───────────────────────────────────────────────────────────────────

@app.get("/export", response_model=schemas.ExportData)
def export_data(db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    people = db.query(models.Person).filter(
        models.Person.owner_id == current_user.id, models.Person.deleted_at.is_(None),
    ).all()
    return schemas.ExportData(
        version=1,
        exported_at=datetime.utcnow().isoformat(),
        people=[
            schemas.ExportPerson(
                id=p.id, name=p.name, primary_tag=p.primary_tag or "",
                occupation=p.occupation or "", company=p.company or "",
                location=p.location or "", phone=p.phone or "", email=p.email or "",
                linkedin=p.linkedin or "", description=p.description or "",
                photo=p.photo or "", birthday=p.birthday or "", twitter=p.twitter or "",
                instagram=p.instagram or "", github=p.github or "", website=p.website or "",
                skills=p.skills or "", x=p.x, y=p.y,
                tags=[schemas.ExportTag(id=t.id, label=t.label) for t in p.tags if not t.deleted_at],
                timeline=[schemas.ExportTimelineEntry(id=e.id, date=e.date, note=e.note) for e in p.timeline if not e.deleted_at],
                interests=[schemas.ExportInterest(id=i.id, type=i.type, label=i.label, confirmed=i.confirmed) for i in p.interests if not i.deleted_at],
                relationships=[
                    schemas.ExportRelationship(id=r.id, to_id=r.to_id, label=r.label, sentiment=r.sentiment)
                    for r in p.outgoing if not r.deleted_at
                ],
            )
            for p in people
        ],
    )


# ── Import ───────────────────────────────────────────────────────────────────

@app.post("/import")
def import_data(payload: schemas.ExportData, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    """
    Replace the current user's entire graph with data from an export file.
    Only ever touches rows owned by current_user — never another account's data.

    Note: unlike the local desktop app, this doesn't write a JSON backup to
    local disk before wiping — there's no persistent local filesystem in a
    containerized cloud deployment, and per-request backup files would grow
    unbounded on ephemeral container storage anyway. Durability here is
    Postgres's job (managed backups / PITR), not this endpoint's.
    """
    owned_person_ids = [
        row[0] for row in db.query(models.Person.id).filter(models.Person.owner_id == current_user.id)
    ]
    if owned_person_ids:
        db.query(models.ProfileSuggestion).filter(
            models.ProfileSuggestion.person_id.in_(owned_person_ids)
        ).delete(synchronize_session=False)
        db.query(models.RelationshipSuggestion).filter(
            (models.RelationshipSuggestion.from_id.in_(owned_person_ids)) |
            (models.RelationshipSuggestion.to_id.in_(owned_person_ids))
        ).delete(synchronize_session=False)
        db.query(models.PersonInterest).filter(
            models.PersonInterest.person_id.in_(owned_person_ids)
        ).delete(synchronize_session=False)
        db.query(models.TimelineEntry).filter(
            models.TimelineEntry.person_id.in_(owned_person_ids)
        ).delete(synchronize_session=False)
        db.query(models.PersonTag).filter(
            models.PersonTag.person_id.in_(owned_person_ids)
        ).delete(synchronize_session=False)
        db.query(models.Relationship).filter(
            (models.Relationship.from_id.in_(owned_person_ids)) |
            (models.Relationship.to_id.in_(owned_person_ids))
        ).delete(synchronize_session=False)
        db.query(models.Person).filter(models.Person.owner_id == current_user.id).delete(synchronize_session=False)
    db.commit()

    id_map: dict = {}

    for p in payload.people:
        new_id = str(uuid.uuid4())
        id_map[p.id] = new_id
        person = models.Person(
            id=new_id, owner_id=current_user.id, name=p.name, primary_tag=p.primary_tag,
            occupation=p.occupation, company=p.company, location=p.location,
            phone=p.phone, email=p.email, linkedin=p.linkedin,
            description=p.description, photo=p.photo, birthday=p.birthday,
            twitter=p.twitter, instagram=p.instagram, github=p.github,
            website=p.website, skills=p.skills, x=p.x, y=p.y,
        )
        db.add(person)

        for tag in p.tags:
            db.add(models.PersonTag(id=str(uuid.uuid4()), person_id=new_id, label=tag.label))

        for entry in p.timeline:
            db.add(models.TimelineEntry(id=str(uuid.uuid4()), person_id=new_id, date=entry.date, note=entry.note))

        for interest in p.interests:
            db.add(models.PersonInterest(
                id=str(uuid.uuid4()), person_id=new_id,
                type=interest.type, label=interest.label, confirmed=interest.confirmed,
            ))

    db.commit()

    for p in payload.people:
        from_id = id_map.get(p.id)
        if not from_id:
            continue
        for rel in p.relationships:
            to_id = id_map.get(rel.to_id)
            if not to_id:
                continue
            db.add(models.Relationship(
                id=str(uuid.uuid4()), from_id=from_id, to_id=to_id, label=rel.label, sentiment=rel.sentiment,
            ))

    db.commit()
    return {"ok": True, "people": len(payload.people)}


# ── Layout ────────────────────────────────────────────────────────────────────

@app.put("/layout")
def save_layout(layout: schemas.LayoutUpdate, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    owned_ids = {row[0] for row in db.query(models.Person.id).filter(models.Person.owner_id == current_user.id)}
    for person_id, pos in layout.positions.items():
        if person_id not in owned_ids:
            continue
        person = db.query(models.Person).filter(models.Person.id == person_id).first()
        if person:
            person.x = pos["x"]
            person.y = pos["y"]
    db.commit()
    return {"ok": True}


# ── Sync ─────────────────────────────────────────────────────────────────────
# See the design notes in the conversation this was built from: last-write-wins
# per row via updated_at, soft-delete tombstones via deleted_at, scoped to the
# 5 core graph tables (Person/PersonTag/TimelineEntry/PersonInterest/
# Relationship). RelationshipSuggestion/ProfileSuggestion are deliberately
# excluded — they're ephemeral pending-AI-review state, not graph data worth
# syncing across devices; each device can just regenerate its own via /enrich
# and /analyze.

def _row_to_dict(row, fields: list) -> dict:
    d = {f: getattr(row, f) for f in fields}
    d["updated_at"] = row.updated_at.isoformat() if row.updated_at else None
    d["deleted_at"] = row.deleted_at.isoformat() if row.deleted_at else None
    return d

PERSON_FIELDS = ["id", "name", "primary_tag", "occupation", "company", "location",
                 "phone", "email", "linkedin", "photo", "description", "birthday",
                 "twitter", "instagram", "github", "website", "skills", "x", "y"]
TAG_FIELDS = ["id", "person_id", "label"]
TIMELINE_FIELDS = ["id", "person_id", "date", "note"]
INTEREST_FIELDS = ["id", "person_id", "type", "label", "confirmed", "source_entry_id"]
RELATIONSHIP_FIELDS = ["id", "from_id", "to_id", "label", "sentiment"]


def _sync_pull_internal(since_dt: datetime, db: Session, current_user: models.User) -> schemas.SyncPullResponse:
    server_time = datetime.now(timezone.utc)
    owned_ids = [row[0] for row in db.query(models.Person.id).filter(models.Person.owner_id == current_user.id)]

    people = db.query(models.Person).filter(
        models.Person.owner_id == current_user.id, models.Person.updated_at > since_dt,
    ).all()
    tags = db.query(models.PersonTag).filter(
        models.PersonTag.person_id.in_(owned_ids), models.PersonTag.updated_at > since_dt,
    ).all() if owned_ids else []
    timeline = db.query(models.TimelineEntry).filter(
        models.TimelineEntry.person_id.in_(owned_ids), models.TimelineEntry.updated_at > since_dt,
    ).all() if owned_ids else []
    interests = db.query(models.PersonInterest).filter(
        models.PersonInterest.person_id.in_(owned_ids), models.PersonInterest.updated_at > since_dt,
    ).all() if owned_ids else []
    relationships = db.query(models.Relationship).filter(
        models.Relationship.from_id.in_(owned_ids), models.Relationship.updated_at > since_dt,
    ).all() if owned_ids else []

    return schemas.SyncPullResponse(
        people=[_row_to_dict(p, PERSON_FIELDS) for p in people],
        tags=[_row_to_dict(t, TAG_FIELDS) for t in tags],
        timeline=[_row_to_dict(e, TIMELINE_FIELDS) for e in timeline],
        interests=[_row_to_dict(i, INTEREST_FIELDS) for i in interests],
        relationships=[_row_to_dict(r, RELATIONSHIP_FIELDS) for r in relationships],
        server_time=server_time.isoformat(),
    )


@app.get("/sync", response_model=schemas.SyncPullResponse)
def sync_pull(since: float = 0, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    # `since` is a plain Unix timestamp (seconds), not an ISO string, quite
    # deliberately — ISO timestamps contain a `+` in their timezone offset
    # (e.g. "...+00:00"), which gets silently decoded as a literal space by
    # any client that doesn't properly URL-encode query parameters, breaking
    # datetime.fromisoformat() server-side. Plain digits never need escaping
    # in a URL at all, which sidesteps the whole footgun rather than relying
    # on every future caller remembering to encode correctly.
    since_dt = datetime.fromtimestamp(since, tz=timezone.utc)
    return _sync_pull_internal(since_dt, db, current_user)


def _upsert_synced_row(db: Session, model_cls, fields: list, incoming: dict, current_user: models.User, owned_ids: set):
    """
    Upserts a single row from a sync push, enforcing last-write-wins and
    ownership. Returns nothing — mutates the session directly. Silently
    no-ops (rather than raising) for rows that don't belong to the current
    user, so one bad/tampered row in a push doesn't fail the entire batch.
    """
    row_id = incoming.get("id")
    if not row_id:
        return

    # Ownership check: for Person rows, owner_id must match. For child rows
    # (tags/timeline/interests/relationships), person_id must be in the
    # caller's own set of person ids.
    if model_cls is models.Person:
        pass  # owner_id is set explicitly below for new rows, checked for existing ones after fetch
    else:
        person_id = incoming.get("person_id") or incoming.get("from_id")
        if person_id not in owned_ids:
            return

    incoming_updated_at = datetime.fromisoformat(incoming["updated_at"]) if incoming.get("updated_at") else datetime.now(timezone.utc)
    incoming_deleted_at = datetime.fromisoformat(incoming["deleted_at"]) if incoming.get("deleted_at") else None

    existing = db.query(model_cls).filter(model_cls.id == row_id).first()

    if existing:
        # Ownership re-check for existing rows (covers Person directly, and
        # is a redundant-but-cheap extra check for child rows already
        # filtered above).
        owner_id = getattr(existing, "owner_id", None)
        if model_cls is models.Person and owner_id != current_user.id:
            return
        if existing.updated_at is not None and existing.updated_at >= incoming_updated_at:
            return  # server's version is already newer or equal — it wins
        for f in fields:
            if f in incoming and f != "id":
                setattr(existing, f, incoming[f])
        existing.updated_at = incoming_updated_at
        existing.deleted_at = incoming_deleted_at
    else:
        kwargs = {f: incoming.get(f) for f in fields}
        kwargs["updated_at"] = incoming_updated_at
        kwargs["deleted_at"] = incoming_deleted_at
        if model_cls is models.Person:
            kwargs["owner_id"] = current_user.id
        db.add(model_cls(**kwargs))


@app.post("/sync", response_model=schemas.SyncPullResponse)
def sync_push(payload: schemas.SyncPushPayload, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    # People first — child rows below reference person_id/from_id and their
    # ownership check depends on the (possibly just-created) person existing.
    for p in payload.people:
        _upsert_synced_row(db, models.Person, PERSON_FIELDS, p, current_user, set())
    db.commit()

    owned_ids = {row[0] for row in db.query(models.Person.id).filter(models.Person.owner_id == current_user.id)}

    for t in payload.tags:
        _upsert_synced_row(db, models.PersonTag, TAG_FIELDS, t, current_user, owned_ids)
    for e in payload.timeline:
        _upsert_synced_row(db, models.TimelineEntry, TIMELINE_FIELDS, e, current_user, owned_ids)
    for i in payload.interests:
        _upsert_synced_row(db, models.PersonInterest, INTEREST_FIELDS, i, current_user, owned_ids)
    for r in payload.relationships:
        _upsert_synced_row(db, models.Relationship, RELATIONSHIP_FIELDS, r, current_user, owned_ids)
    db.commit()

    # Immediately hand back anything changed since the same watermark the
    # client pushed against — this is what lets the client catch both other
    # devices' changes AND anything the server just rejected as stale in one
    # combined push+pull round trip, instead of needing a second request.
    since_dt = datetime.fromisoformat(payload.since) if payload.since else datetime.fromtimestamp(0, tz=timezone.utc)
    return _sync_pull_internal(since_dt, db, current_user)
