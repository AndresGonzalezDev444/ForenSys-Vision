import os
import shutil
import base64
from typing import List
from fastapi import FastAPI, Depends, HTTPException, status, UploadFile, File, Body
import bcrypt
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

import models, schemas
from database import engine, get_db

models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="ForenSys Vision API")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/login")

def verify_password(plain_password, hashed_password):
    return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))

def get_password_hash(password):
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def retrain_model(db):
    try:
        from ml_models.facial_recognition import train_model
        train_model(db)
    except Exception as e:
        print(f"Error training model: {e}")

import time

def save_face_photo(suspect_id: int, file_data: bytes, filename: str, db: Session, angle: str = "front"):
    os.makedirs("static/faces", exist_ok=True)
    ext = os.path.splitext(filename)[1] or ".jpg"
    unique_id = int(time.time() * 1000)
    rel_path = f"faces/{suspect_id}_{unique_id}{ext}"
    abs_path = f"static/{rel_path}"
    with open(abs_path, "wb") as f:
        f.write(file_data)
    photo = models.FacePhoto(suspect_id=suspect_id, file_path=rel_path, angle=angle or "front")
    db.add(photo)
    # Also set legacy photo_path for backward compat
    suspect = db.query(models.Suspect).filter(models.Suspect.id == suspect_id).first()
    if suspect and not suspect.photo_path:
        suspect.photo_path = rel_path
    db.commit()
    db.refresh(photo)
    return photo

def delete_photo_file(photo: models.FacePhoto):
    abs_path = f"static/{photo.file_path}" if not photo.file_path.startswith("static/") else photo.file_path
    if os.path.exists(abs_path):
        os.remove(abs_path)

@app.on_event("startup")
def create_initial_admin():
    db = next(get_db())
    admin_user = db.query(models.User).filter(models.User.username == "admin").first()
    if not admin_user:
        hashed_password = get_password_hash("admin123")
        admin_user = models.User(username="admin", hashed_password=hashed_password, role="admin")
        db.add(admin_user)
        db.commit()
    # Migrate legacy single photos to face_photos table
    suspects = db.query(models.Suspect).filter(
        models.Suspect.photo_path != None,
        ~models.Suspect.face_photos.any()
    ).all()
    for suspect in suspects:
        old_path = suspect.photo_path
        rel_path = old_path.replace("static/", "", 1) if old_path.startswith("static/") else old_path
        if os.path.exists(old_path):
            photo = models.FacePhoto(suspect_id=suspect.id, file_path=rel_path, angle="front")
            db.add(photo)
    if suspects:
        db.commit()
        print(f"Migrated {len(suspects)} legacy photos to face_photos table.")
    db.close()

@app.post("/api/login", response_model=schemas.Token)
def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.username == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect username or password", headers={"WWW-Authenticate": "Bearer"})
    return {"access_token": user.username, "token_type": "bearer"}

def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.username == token).first()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid token")
    return user

@app.get("/api/users/me", response_model=schemas.UserResponse)
def read_users_me(current_user: models.User = Depends(get_current_user)):
    return current_user

@app.get("/api/suspects", response_model=List[schemas.SuspectResponse])
def get_suspects(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    suspects = db.query(models.Suspect).offset(skip).limit(limit).all()
    return suspects

@app.post("/api/suspects", response_model=schemas.SuspectResponse)
def create_suspect(suspect: schemas.SuspectCreate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    db_suspect = models.Suspect(**suspect.model_dump())
    db.add(db_suspect)
    db.commit()
    db.refresh(db_suspect)
    return db_suspect

@app.get("/api/suspects/{suspect_id}", response_model=schemas.SuspectResponse)
def get_suspect(suspect_id: int, db: Session = Depends(get_db)):
    suspect = db.query(models.Suspect).filter(models.Suspect.id == suspect_id).first()
    if not suspect:
        raise HTTPException(status_code=404, detail="Suspect not found")
    return suspect

@app.post("/api/suspects/{suspect_id}/photo", response_model=schemas.FacePhotoResponse)
def upload_suspect_photo(suspect_id: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    suspect = db.query(models.Suspect).filter(models.Suspect.id == suspect_id).first()
    if not suspect:
        raise HTTPException(status_code=404, detail="Suspect not found")
    file_data = file.file.read()
    photo = save_face_photo(suspect_id, file_data, file.filename or "photo.jpg", db)
    retrain_model(db)
    return photo

@app.post("/api/suspects/{suspect_id}/photo_base64", response_model=schemas.FacePhotoResponse)
def upload_photo_base64(suspect_id: int, data: dict = Body(...), db: Session = Depends(get_db)):
    suspect = db.query(models.Suspect).filter(models.Suspect.id == suspect_id).first()
    if not suspect:
        raise HTTPException(status_code=404, detail="Suspect not found")
    image_data = data.get("image_base64", "")
    angle = data.get("angle", "front")
    if "," in image_data:
        image_data = image_data.split(",", 1)[1]
    img_bytes = base64.b64decode(image_data)
    photo = save_face_photo(suspect_id, img_bytes, "webcam.jpg", db, angle=angle)
    retrain_model(db)
    return photo

@app.get("/api/suspects/{suspect_id}/photos", response_model=List[schemas.FacePhotoResponse])
def list_suspect_photos(suspect_id: int, db: Session = Depends(get_db)):
    suspect = db.query(models.Suspect).filter(models.Suspect.id == suspect_id).first()
    if not suspect:
        raise HTTPException(status_code=404, detail="Suspect not found")
    return suspect.face_photos

@app.delete("/api/photos/{photo_id}")
def delete_photo(photo_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    photo = db.query(models.FacePhoto).filter(models.FacePhoto.id == photo_id).first()
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")
    delete_photo_file(photo)
    db.delete(photo)
    db.commit()
    retrain_model(db)
    return {"ok": True, "id": photo_id}

@app.put("/api/suspects/{suspect_id}", response_model=schemas.SuspectResponse)
def update_suspect(suspect_id: int, data: dict = Body(...), db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    suspect = db.query(models.Suspect).filter(models.Suspect.id == suspect_id).first()
    if not suspect:
        raise HTTPException(status_code=404, detail="Suspect not found")
    allowed_fields = {"first_name", "last_name", "behavior_profile", "identification"}
    for field, value in data.items():
        if field in allowed_fields:
            setattr(suspect, field, value)
    db.commit()
    db.refresh(suspect)
    return suspect

@app.delete("/api/suspects/{suspect_id}")
def delete_suspect(suspect_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    suspect = db.query(models.Suspect).filter(models.Suspect.id == suspect_id).first()
    if not suspect:
        raise HTTPException(status_code=404, detail="Suspect not found")
    for photo in suspect.face_photos:
        delete_photo_file(photo)
    if suspect.photo_path:
        legacy_path = f"static/{suspect.photo_path}" if not suspect.photo_path.startswith("static/") else suspect.photo_path
        if os.path.exists(legacy_path):
            os.remove(legacy_path)
    db.delete(suspect)
    db.commit()
    retrain_model(db)
    return {"ok": True, "id": suspect_id}

from ml_models.facial_recognition import gen_frames, list_local_cameras, stop_stream
from fastapi.responses import StreamingResponse

@app.get("/api/cameras")
def get_cameras():
    return {"devices": list_local_cameras()}

@app.get("/api/video_feed")
def video_feed(source_type: str = "local", source: str = "0"):
    if source_type not in {"local", "url"}:
        raise HTTPException(status_code=400, detail="Invalid camera source type")
    if source_type == "url":
        cleaned_source = source.strip()
        if not cleaned_source.startswith(("rtsp://", "http://", "https://")):
            raise HTTPException(status_code=400, detail="Use a valid RTSP, HTTP or HTTPS camera URL")
        source = cleaned_source
    return StreamingResponse(gen_frames(source=source, source_type=source_type), media_type="multipart/x-mixed-replace; boundary=frame")

@app.post("/api/video_stop")
def video_stop():
    stop_stream()
    return {"ok": True}

from fastapi.responses import FileResponse
import shutil

@app.get("/api/database/export")
def export_database(current_user: models.User = Depends(get_current_user)):
    db_path = "ciberforense.db"
    if not os.path.exists(db_path):
        raise HTTPException(status_code=404, detail="Database not found")
    return FileResponse(db_path, media_type="application/octet-stream", filename="ciberforense.db")

@app.post("/api/database/import")
def import_database(file: UploadFile = File(...), current_user: models.User = Depends(get_current_user)):
    db_path = "ciberforense.db"
    engine.dispose()
    with open(db_path, "wb") as f:
        shutil.copyfileobj(file.file, f)
    return {"ok": True, "message": "Database imported successfully"}


if not os.path.exists("static"):
    os.makedirs("static")
app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
