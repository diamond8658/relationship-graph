from sqlalchemy import Column, String, Float, ForeignKey, Text, Boolean
from sqlalchemy.orm import relationship
from database import Base
import uuid

def gen_id():
    return str(uuid.uuid4())


class Person(Base):
    __tablename__ = "people"

    id = Column(String, primary_key=True, default=gen_id)
    name = Column(String, nullable=False, unique=True)
    primary_tag = Column(String, default="")
    occupation = Column(String, default="")
    company = Column(String, default="")
    location = Column(String, default="")
    phone = Column(String, default="")
    email = Column(String, default="")
    linkedin = Column(String, default="")
    photo = Column(Text, default="")
    description = Column(Text, default="")
    x = Column(Float, default=0.0)
    y = Column(Float, default=0.0)

    tags = relationship("PersonTag", back_populates="person", cascade="all, delete-orphan")
    timeline = relationship("TimelineEntry", back_populates="person", cascade="all, delete-orphan", order_by="TimelineEntry.date")
    interests = relationship("PersonInterest", back_populates="person", cascade="all, delete-orphan")
    outgoing = relationship("Relationship", foreign_keys="Relationship.from_id", back_populates="from_person", cascade="all, delete-orphan")
    incoming = relationship("Relationship", foreign_keys="Relationship.to_id", back_populates="to_person", cascade="all, delete-orphan")


class PersonTag(Base):
    __tablename__ = "person_tags"

    id = Column(String, primary_key=True, default=gen_id)
    person_id = Column(String, ForeignKey("people.id", ondelete="CASCADE"), nullable=False)
    label = Column(String, nullable=False)

    person = relationship("Person", back_populates="tags")


class TimelineEntry(Base):
    __tablename__ = "timeline_entries"

    id = Column(String, primary_key=True, default=gen_id)
    person_id = Column(String, ForeignKey("people.id", ondelete="CASCADE"), nullable=False)
    date = Column(String, nullable=False)
    note = Column(Text, nullable=False)

    person = relationship("Person", back_populates="timeline")


class PersonInterest(Base):
    __tablename__ = "person_interests"

    id = Column(String, primary_key=True, default=gen_id)
    person_id = Column(String, ForeignKey("people.id", ondelete="CASCADE"), nullable=False)
    type = Column(String, nullable=False)
    label = Column(String, nullable=False)
    confirmed = Column(Boolean, default=False)
    source_entry_id = Column(String, ForeignKey("timeline_entries.id", ondelete="SET NULL"), nullable=True)

    person = relationship("Person", back_populates="interests")


class Relationship(Base):
    __tablename__ = "relationships"

    id = Column(String, primary_key=True, default=gen_id)
    from_id = Column(String, ForeignKey("people.id", ondelete="CASCADE"), nullable=False)
    to_id = Column(String, ForeignKey("people.id", ondelete="CASCADE"), nullable=False)
    label = Column(String, default="")
    sentiment = Column(String, default="neutral")

    from_person = relationship("Person", foreign_keys=[from_id], back_populates="outgoing")
    to_person = relationship("Person", foreign_keys=[to_id], back_populates="incoming")
