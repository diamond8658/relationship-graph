# ─────────────────────────────────────────────────────────────────────────────
# models.py — SQLAlchemy ORM models (database schema).
# Each class maps to a SQLite table. Tables are created automatically on startup
# via Base.metadata.create_all() in main.py.
# ─────────────────────────────────────────────────────────────────────────────

from sqlalchemy import Column, String, Float, ForeignKey, Text, Boolean, DateTime, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base
import uuid

def gen_id():
    """Generate a UUID4 string for use as a primary key."""
    return str(uuid.uuid4())


class User(Base):
    """
    A cloud account. Each user owns an entirely separate graph — there is no
    cross-user visibility anywhere in this service; every query in main.py
    is scoped by owner_id via the get_current_user dependency.
    """
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=gen_id)
    email = Column(String, nullable=False, unique=True, index=True)
    hashed_password = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    people = relationship("Person", back_populates="owner", cascade="all, delete-orphan")


class Person(Base):
    """
    Core node in the graph. Holds contact info, display settings, and canvas
    position. Related data (tags, timeline, interests, relationships) are in
    separate tables linked by person_id foreign keys.
    """
    __tablename__ = "people"
    # Was previously `name = Column(String, unique=True)` — globally unique
    # across ALL users, which would have made it impossible for two different
    # accounts to each have someone named the same thing in their own graph.
    # Scoped to per-owner uniqueness instead.
    __table_args__ = (UniqueConstraint("owner_id", "name", name="uq_person_owner_name"),)

    id = Column(String, primary_key=True, default=gen_id)
    owner_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String, nullable=False)
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
    # Sync tracking (see main.py's /sync endpoints). updated_at drives
    # last-write-wins conflict resolution; deleted_at is a tombstone so a
    # deletion on one device is itself a visible "change since X" the other
    # device's sync can see and apply, instead of just silently vanishing.
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False, index=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True, index=True)

    owner = relationship("User", back_populates="people")
    tags = relationship("PersonTag", back_populates="person", cascade="all, delete-orphan")
    timeline = relationship("TimelineEntry", back_populates="person", cascade="all, delete-orphan", order_by="TimelineEntry.date")
    interests = relationship("PersonInterest", back_populates="person", cascade="all, delete-orphan")
    outgoing = relationship("Relationship", foreign_keys="Relationship.from_id", back_populates="from_person", cascade="all, delete-orphan")
    incoming = relationship("Relationship", foreign_keys="Relationship.to_id", back_populates="to_person", cascade="all, delete-orphan")
    # Previously missing — these two were the source of orphaned rows when a
    # Person was deleted while they had pending AI suggestions.
    outgoing_relationship_suggestions = relationship(
        "RelationshipSuggestion", foreign_keys="RelationshipSuggestion.from_id",
        back_populates="from_person", cascade="all, delete-orphan",
    )
    incoming_relationship_suggestions = relationship(
        "RelationshipSuggestion", foreign_keys="RelationshipSuggestion.to_id",
        back_populates="to_person", cascade="all, delete-orphan",
    )
    profile_suggestions = relationship(
        "ProfileSuggestion", back_populates="person", cascade="all, delete-orphan",
    )


class PersonTag(Base):
    """Freeform label attached to a person. Many tags per person."""
    __tablename__ = "person_tags"

    id = Column(String, primary_key=True, default=gen_id)
    person_id = Column(String, ForeignKey("people.id", ondelete="CASCADE"), nullable=False)
    label = Column(String, nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False, index=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True, index=True)

    person = relationship("Person", back_populates="tags")


class TimelineEntry(Base):
    """Dated log entry on a person's timeline."""
    __tablename__ = "timeline_entries"

    id = Column(String, primary_key=True, default=gen_id)
    person_id = Column(String, ForeignKey("people.id", ondelete="CASCADE"), nullable=False)
    date = Column(String, nullable=False)          # ISO date string YYYY-MM-DD
    note = Column(Text, nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False, index=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True, index=True)

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
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False, index=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True, index=True)

    person = relationship("Person", back_populates="interests")


class RelationshipSuggestion(Base):
    """
    AI-suggested relationship between two people, pending user review.
    Confirmed=True promotes it to the real Relationship table.
    """
    __tablename__ = "relationship_suggestions"

    id = Column(String, primary_key=True, default=gen_id)
    from_id = Column(String, ForeignKey("people.id", ondelete="CASCADE"), nullable=False)
    to_id = Column(String, ForeignKey("people.id", ondelete="CASCADE"), nullable=False)
    to_name = Column(String, default="")           # Denormalized for display
    label = Column(String, default="")
    sentiment = Column(String, default="neutral")
    source = Column(Text, default="")              # Excerpt that triggered suggestion
    confirmed = Column(Boolean, default=False)

    from_person = relationship(
        "Person", foreign_keys="RelationshipSuggestion.from_id",
        back_populates="outgoing_relationship_suggestions",
    )
    to_person = relationship(
        "Person", foreign_keys="RelationshipSuggestion.to_id",
        back_populates="incoming_relationship_suggestions",
    )


class ProfileSuggestion(Base):
    """
    AI-suggested value for a single profile field, pending user review.
    field is the Person column name (e.g. 'occupation', 'skills').
    """
    __tablename__ = "profile_suggestions"

    id = Column(String, primary_key=True, default=gen_id)
    person_id = Column(String, ForeignKey("people.id", ondelete="CASCADE"), nullable=False)
    field = Column(String, nullable=False)         # Person column name
    value = Column(Text, nullable=False)           # Suggested value
    confirmed = Column(Boolean, default=False)

    person = relationship(
        "Person", foreign_keys="ProfileSuggestion.person_id",
        back_populates="profile_suggestions",
    )


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
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False, index=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True, index=True)

    from_person = relationship("Person", foreign_keys=[from_id], back_populates="outgoing")
    to_person = relationship("Person", foreign_keys=[to_id], back_populates="incoming")
