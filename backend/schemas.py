from pydantic import BaseModel
from typing import Optional, List, Dict

# ── Tags ─────────────────────────────────────────────────────────────────────

class TagOut(BaseModel):
    id: str
    label: str
    class Config:
        from_attributes = True

# ── Timeline ─────────────────────────────────────────────────────────────────

class TimelineEntryCreate(BaseModel):
    date: str
    note: str

class TimelineEntryOut(BaseModel):
    id: str
    date: str
    note: str
    class Config:
        from_attributes = True

# ── Interests ────────────────────────────────────────────────────────────────

class InterestOut(BaseModel):
    id: str
    type: str
    label: str
    confirmed: bool
    source_entry_id: Optional[str] = None
    class Config:
        from_attributes = True

class InterestConfirm(BaseModel):
    confirmed: bool

# ── Relationship Suggestions ──────────────────────────────────────────────────

class RelationshipSuggestionOut(BaseModel):
    id: str
    from_id: str
    to_id: str
    to_name: str
    label: str
    sentiment: str = "neutral"
    source: str = ""
    confirmed: bool
    class Config:
        from_attributes = True

class RelationshipSuggestionConfirm(BaseModel):
    confirmed: bool

# ── Profile Suggestions ───────────────────────────────────────────────────────

class ProfileSuggestionOut(BaseModel):
    id: str
    person_id: str
    field: str
    value: str
    confirmed: bool
    class Config:
        from_attributes = True

class ProfileSuggestionConfirm(BaseModel):
    confirmed: bool

# ── AI status ─────────────────────────────────────────────────────────────────

class AIStatus(BaseModel):
    enabled: bool
    model: str = ""

# ── Relationships ─────────────────────────────────────────────────────────────

class RelationshipOut(BaseModel):
    id: str
    from_id: str
    to_id: str
    label: str
    sentiment: str = "neutral"
    class Config:
        from_attributes = True

class RelationshipCreate(BaseModel):
    from_id: str
    to_id: str
    label: str
    sentiment: str = "neutral"

class RelationshipUpdate(BaseModel):
    label: str
    sentiment: str = "neutral"

# ── People ────────────────────────────────────────────────────────────────────

class PersonBase(BaseModel):
    name: str
    primary_tag: str = ""
    occupation: str = ""
    company: str = ""
    location: str = ""
    phone: str = ""
    email: str = ""
    linkedin: str = ""
    photo: str = ""
    description: str = ""
    birthday: str = ""
    twitter: str = ""
    instagram: str = ""
    github: str = ""
    website: str = ""
    skills: str = ""

class PersonCreate(PersonBase):
    x: float = 0.0
    y: float = 0.0

class PersonUpdate(BaseModel):
    name: Optional[str] = None
    primary_tag: Optional[str] = None
    occupation: Optional[str] = None
    company: Optional[str] = None
    location: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    linkedin: Optional[str] = None
    photo: Optional[str] = None
    birthday: Optional[str] = None
    twitter: Optional[str] = None
    instagram: Optional[str] = None
    github: Optional[str] = None
    website: Optional[str] = None
    skills: Optional[str] = None

class PersonOut(PersonBase):
    id: str
    x: float
    y: float
    tags: List[TagOut] = []
    timeline: List[TimelineEntryOut] = []
    interests: List[InterestOut] = []
    outgoing: List[RelationshipOut] = []
    incoming: List[RelationshipOut] = []
    class Config:
        from_attributes = True

# ── Layout ────────────────────────────────────────────────────────────────────

class LayoutUpdate(BaseModel):
    positions: Dict[str, Dict[str, float]]

# ── Export ────────────────────────────────────────────────────────────────────

class ExportRelationship(BaseModel):
    id: str
    to_id: str
    label: str
    sentiment: str

class ExportInterest(BaseModel):
    id: str
    type: str
    label: str
    confirmed: bool

class ExportTimelineEntry(BaseModel):
    id: str
    date: str
    note: str

class ExportTag(BaseModel):
    id: str
    label: str

class ExportPerson(BaseModel):
    id: str
    name: str
    primary_tag: str
    occupation: str
    company: str
    location: str
    phone: str
    email: str
    linkedin: str
    description: str
    photo: str
    birthday: str
    twitter: str
    instagram: str
    github: str
    website: str
    skills: str
    x: float
    y: float
    tags: List[ExportTag]
    timeline: List[ExportTimelineEntry]
    interests: List[ExportInterest]
    relationships: List[ExportRelationship]

class ExportData(BaseModel):
    version: int
    exported_at: str
    people: List[ExportPerson]
