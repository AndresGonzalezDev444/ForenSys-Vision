from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from database import Base
import datetime

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    hashed_password = Column(String)
    role = Column(String, default="investigator")

class Suspect(Base):
    __tablename__ = "suspects"
    id = Column(Integer, primary_key=True, index=True)
    first_name = Column(String, index=True)
    last_name = Column(String, index=True)
    identification = Column(String, unique=True, index=True)
    photo_path = Column(String, nullable=True)
    fingerprint_path = Column(String, nullable=True)
    behavior_profile = Column(Text, nullable=True)
    alerts = relationship("Alert", back_populates="suspect")
    face_photos = relationship("FacePhoto", back_populates="suspect", cascade="all, delete-orphan")

class FacePhoto(Base):
    __tablename__ = "face_photos"
    id = Column(Integer, primary_key=True, index=True)
    suspect_id = Column(Integer, ForeignKey("suspects.id"))
    file_path = Column(String, nullable=False)
    angle = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    suspect = relationship("Suspect", back_populates="face_photos")

class Alert(Base):
    __tablename__ = "alerts"
    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow)
    suspect_id = Column(Integer, ForeignKey("suspects.id"))
    detection_type = Column(String)
    location = Column(String, nullable=True)
    details = Column(Text, nullable=True)
    suspect = relationship("Suspect", back_populates="alerts")
