# ─────────────────────────────────────────────────────────────────────────────
# models.py — SQLAlchemy ORM models (database schema).
# Each class maps to a SQLite table. Tables are created automatically on startup
# via Base.metadata.create_all() in main.py.
# ─────────────────────────────────────────────────────────────────────────────

from sqlalchemy import Column, String, Float, ForeignKey, Text, Boolean
from sqlalchemy.orm import relationship
from database import Base
import uuid

def gen_id():
    """Generate a UUID4 string for use as a primary key."""
    return str(uuid.uuid4())


class Person(Base):
    """
    Core node in the graph. Holds contact info, display settings, and canvas
    position. Related data (tags, timeline, interests, relationships) are in
    separate tables linked by person_id foreign keys.
    """
    __tablename__ = "people"

    id = Column(String, primary_key=True, default=gen_id)
    name = Column(String, nullable=False, unique=True)
    primary_tag = Column(String, default="")       # Drives node color on canvas
    occupation = Column(String, default="")
    company = Column(String, default="")
    location = Column(String, default="")
    phone = Column(String, default="")
    email = Column(String, default="")
    linkedin = Column(String, default="")
    photo = Column(Text, default="")               # Base64 or remote URL
    description = Column(Text, default="")         # Freeform traits/notes
    birthday = Column(String, default="")          # ISO date string YYYY-MM-DD
    twitter = Column(String, default="")           # Twitter/X handle or URL
    instagram = Column(String, default="")         # Instagram handle or URL
    github = Column(String, default="")            # GitHub handle or URL
    website = Column(String, default="")           # Personal website URL
    skills = Column(Text, default="")              # Comma-separated skill list
    x = Column(Float, default=0.0)                 # Canvas position
    y = Column(Float, default=0.0)

    tags = relationship("PersonTag", back_populates="person", cascade="all, delete-orphan")
    timeline = relationship("TimelineEntry", back_populates="person", cascade="all, delete-orphan", order_by="TimelineEntry.date")
    interests = relationship("PersonInterest", back_populates="person", cascade="all, delete-orphan")
    outgoing = relationship("Relationship", foreign_keys="Relationship.from_id", back_populates="from_person", cascade="all, delete-orphan")
    incoming = relationship("Relationship", foreign_keys="Relationship.to_id", back_populates="to_person", cascade="all, delete-orphan")


class PersonTag(Base):
    """Freeform label attached to a person. Many tags per person."""
    __tablename__ = "person_tags"

    id = Column(String, primary_key=True, default=gen_id)
    person_id = Column(String, ForeignKey("people.id", ondelete="CASCADE"), nullable=False)
    label = Column(String, nullable=False)

    person = relationship("Person", back_populates="tags")


class TimelineEntry(Base):
    """Dated log entry on a person's timeline."""
    __tablename__ = "timeline_entries"

    id = Column(String, primary_key=True, default=gen_id)
    person_id = Column(String, ForeignKey("people.id", ondelete="CASCADE"), nullable=False)
    date = Column(String, nullable=False)          # ISO date string YYYY-MM-DD
    note = Column(Text, nullable=False)

    person = relationship("Person", back_populates="timeline")


class PersonInterest(Base):
    """
    A like or dislike associated with a person.
    confirmed=False means it's an unreviewed AI suggestion.
    confirmed=True means the user has accepted it.
    source_entry_id links back to the timeline entry it was extracted from.
    """
    __tablename__ = "person_interests"

    id = Column(String, primary_key=True, default=gen_id)
    person_id = Column(String, ForeignKey("people.id", ondelete="CASCADE"), nullable=False)
    type = Column(String, nullable=False)          # "likes" or "dislikes"
    label = Column(String, nullable=False)         # e.g. "sushi", "loud music"
    confirmed = Column(Boolean, default=False)
    source_entry_id = Column(String, ForeignKey("timeline_entries.id", ondelete="SET NULL"), nullable=True)

    person = relationship("Person", back_populates="interests")


class Relationship(Base):
    """
    A directed, labeled connection from one person to another.
    Each direction is stored separately — A→B and B→A are different rows,
    allowing each person to independently define how they see the other.
    sentiment reflects the emotional tone (hates/dislikes/neutral/likes/loves).
    """
    __tablename__ = "relationships"

    id = Column(String, primary_key=True, default=gen_id)
    from_id = Column(String, ForeignKey("people.id", ondelete="CASCADE"), nullable=False)
    to_id = Column(String, ForeignKey("people.id", ondelete="CASCADE"), nullable=False)
    label = Column(String, default="")             # e.g. "Friend", "Colleague"
    sentiment = Column(String, default="neutral")  # hates/dislikes/neutral/likes/loves

    from_person = relationship("Person", foreign_keys=[from_id], back_populates="outgoing")
    to_person = relationship("Person", foreign_keys=[to_id], back_populates="incoming")
