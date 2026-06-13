from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

class UserBase(BaseModel):
    username: str
    role: str = "investigator"

class UserCreate(UserBase):
    password: str

class UserResponse(UserBase):
    id: int
    class Config:
        from_attributes = True

class FacePhotoResponse(BaseModel):
    id: int
    suspect_id: int
    file_path: str
    angle: Optional[str] = None
    created_at: Optional[datetime] = None
    class Config:
        from_attributes = True

class SuspectBase(BaseModel):
    first_name: str
    last_name: str
    identification: str
    behavior_profile: Optional[str] = None

class SuspectCreate(SuspectBase):
    pass

class SuspectResponse(SuspectBase):
    id: int
    photo_path: Optional[str] = None
    fingerprint_path: Optional[str] = None
    face_photos: List[FacePhotoResponse] = []
    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str
