import os
import shutil
import base64
import datetime
from typing import List
from fastapi import FastAPI, Depends, HTTPException, status, UploadFile, File, Body
import bcrypt
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse, FileResponse, HTMLResponse
from sqlalchemy.orm import Session

import models, schemas
from database import engine, get_db

# Cargar API key de forma segura
try:
    from config import ORS_API_KEY
except ImportError:
    ORS_API_KEY = ""
    print("⚠ config.py no encontrado. El módulo de rutas no funcionará.")

models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="ForenSys Vision API V2")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/login")

# ──────────────────────────────────────────────────────────
#  UTILIDADES DE AUTENTICACIÓN
# ──────────────────────────────────────────────────────────
def verify_password(plain_password, hashed_password):
    return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))

def get_password_hash(password):
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.username == token).first()
    if not user:
        raise HTTPException(status_code=401, detail="Token inválido")
    return user


# ──────────────────────────────────────────────────────────
#  UTILIDADES DE FOTOS
# ──────────────────────────────────────────────────────────
import time

def retrain_model(db):
    try:
        from ml_models.facial_recognition import train_model
        train_model(db)
    except Exception as e:
        print(f"Error entrenando modelo facial: {e}")

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


# ──────────────────────────────────────────────────────────
#  STARTUP
# ──────────────────────────────────────────────────────────
@app.on_event("startup")
def create_initial_admin():
    db = next(get_db())
    admin_user = db.query(models.User).filter(models.User.username == "admin").first()
    if not admin_user:
        hashed_password = get_password_hash("admin123")
        admin_user = models.User(username="admin", hashed_password=hashed_password, role="admin")
        db.add(admin_user)
        db.commit()
    # Migrar fotos legacy
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
        print(f"Migrados {len(suspects)} fotos legacy a face_photos.")
    db.close()


# ──────────────────────────────────────────────────────────
#  AUTENTICACIÓN
# ──────────────────────────────────────────────────────────
@app.post("/api/login", response_model=schemas.Token)
def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.username == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Credenciales incorrectas", headers={"WWW-Authenticate": "Bearer"})
    return {"access_token": user.username, "token_type": "bearer"}

@app.get("/api/users/me", response_model=schemas.UserResponse)
def read_users_me(current_user: models.User = Depends(get_current_user)):
    return current_user


# ──────────────────────────────────────────────────────────
#  SOSPECHOSOS (CRUD)
# ──────────────────────────────────────────────────────────
@app.get("/api/suspects", response_model=List[schemas.SuspectResponse])
def get_suspects(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    return db.query(models.Suspect).offset(skip).limit(limit).all()

@app.post("/api/suspects", response_model=schemas.SuspectResponse)
def create_suspect(suspect: schemas.SuspectCreate, db: Session = Depends(get_db),
                   current_user: models.User = Depends(get_current_user)):
    db_suspect = models.Suspect(**suspect.model_dump())
    db.add(db_suspect)
    db.commit()
    db.refresh(db_suspect)
    return db_suspect

@app.get("/api/suspects/{suspect_id}", response_model=schemas.SuspectResponse)
def get_suspect(suspect_id: int, db: Session = Depends(get_db)):
    suspect = db.query(models.Suspect).filter(models.Suspect.id == suspect_id).first()
    if not suspect:
        raise HTTPException(status_code=404, detail="Sospechoso no encontrado")
    return suspect

@app.put("/api/suspects/{suspect_id}", response_model=schemas.SuspectResponse)
def update_suspect(suspect_id: int, data: dict = Body(...), db: Session = Depends(get_db),
                   current_user: models.User = Depends(get_current_user)):
    suspect = db.query(models.Suspect).filter(models.Suspect.id == suspect_id).first()
    if not suspect:
        raise HTTPException(status_code=404, detail="Sospechoso no encontrado")
    allowed_fields = {"first_name", "last_name", "behavior_profile", "identification"}
    for field, value in data.items():
        if field in allowed_fields:
            setattr(suspect, field, value)
    db.commit()
    db.refresh(suspect)
    return suspect

@app.delete("/api/suspects/{suspect_id}")
def delete_suspect(suspect_id: int, db: Session = Depends(get_db),
                   current_user: models.User = Depends(get_current_user)):
    suspect = db.query(models.Suspect).filter(models.Suspect.id == suspect_id).first()
    if not suspect:
        raise HTTPException(status_code=404, detail="Sospechoso no encontrado")
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


# ──────────────────────────────────────────────────────────
#  FOTOS FACIALES
# ──────────────────────────────────────────────────────────
@app.post("/api/suspects/{suspect_id}/photo", response_model=schemas.FacePhotoResponse)
def upload_suspect_photo(suspect_id: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    suspect = db.query(models.Suspect).filter(models.Suspect.id == suspect_id).first()
    if not suspect:
        raise HTTPException(status_code=404, detail="Sospechoso no encontrado")
    file_data = file.file.read()
    photo = save_face_photo(suspect_id, file_data, file.filename or "photo.jpg", db)
    retrain_model(db)
    return photo

@app.post("/api/suspects/{suspect_id}/photo_base64", response_model=schemas.FacePhotoResponse)
def upload_photo_base64(suspect_id: int, data: dict = Body(...), db: Session = Depends(get_db)):
    suspect = db.query(models.Suspect).filter(models.Suspect.id == suspect_id).first()
    if not suspect:
        raise HTTPException(status_code=404, detail="Sospechoso no encontrado")
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
        raise HTTPException(status_code=404, detail="Sospechoso no encontrado")
    return suspect.face_photos

@app.delete("/api/photos/{photo_id}")
def delete_photo(photo_id: int, db: Session = Depends(get_db),
                 current_user: models.User = Depends(get_current_user)):
    photo = db.query(models.FacePhoto).filter(models.FacePhoto.id == photo_id).first()
    if not photo:
        raise HTTPException(status_code=404, detail="Foto no encontrada")
    delete_photo_file(photo)
    db.delete(photo)
    db.commit()
    retrain_model(db)
    return {"ok": True, "id": photo_id}


# ──────────────────────────────────────────────────────────
#  CÁMARAS Y STREAMING FACIAL
# ──────────────────────────────────────────────────────────
from ml_models.facial_recognition import gen_frames, list_local_cameras, stop_stream

@app.get("/api/cameras")
def get_cameras():
    return {"devices": list_local_cameras()}

@app.get("/api/video_feed")
def video_feed(source_type: str = "local", source: str = "0"):
    if source_type not in {"local", "url"}:
        raise HTTPException(status_code=400, detail="Tipo de fuente inválido")
    if source_type == "url":
        cleaned = source.strip()
        if not cleaned.startswith(("rtsp://", "http://", "https://")):
            raise HTTPException(status_code=400, detail="URL inválida. Use rtsp://, http:// o https://")
        source = cleaned
    return StreamingResponse(gen_frames(source=source, source_type=source_type),
                             media_type="multipart/x-mixed-replace; boundary=frame")

@app.post("/api/video_stop")
def video_stop():
    stop_stream()
    return {"ok": True}


# ──────────────────────────────────────────────────────────
#  STREAMING DE PLACAS (nuevo módulo)
# ──────────────────────────────────────────────────────────
from ml_models.plate_recognition import gen_plate_frames, stop_plate_stream

@app.get("/api/plate_video_feed")
def plate_video_feed(source_type: str = "local", source: str = "0"):
    if source_type not in {"local", "url"}:
        raise HTTPException(status_code=400, detail="Tipo de fuente inválido")
    if source_type == "url":
        cleaned = source.strip()
        if not cleaned.startswith(("rtsp://", "http://", "https://")):
            raise HTTPException(status_code=400, detail="URL inválida")
        source = cleaned
    return StreamingResponse(gen_plate_frames(source=source, source_type=source_type),
                             media_type="multipart/x-mixed-replace; boundary=frame")

@app.post("/api/plate_video_stop")
def plate_video_stop():
    stop_plate_stream()
    return {"ok": True}


# ──────────────────────────────────────────────────────────
#  STREAMING DE PLACAS YOLO (ROBOFLOW)
# ──────────────────────────────────────────────────────────
from ml_models.plate_roboflow import gen_rf_frames, stop_rf_stream

@app.get("/api/plate_roboflow_feed")
def plate_roboflow_feed(source_type: str = "local", source: str = "0"):
    if source_type not in {"local", "url"}:
        raise HTTPException(status_code=400, detail="Tipo de fuente inválido")
    if source_type == "url":
        cleaned = source.strip()
        if not cleaned.startswith(("rtsp://", "http://", "https://")):
            raise HTTPException(status_code=400, detail="URL inválida")
        source = cleaned
    return StreamingResponse(gen_rf_frames(source=source, source_type=source_type),
                             media_type="multipart/x-mixed-replace; boundary=frame")

@app.post("/api/plate_roboflow_stop")
def plate_roboflow_stop_ep():
    stop_rf_stream()
    return {"ok": True}


# ──────────────────────────────────────────────────────────
#  TRAZADO DE RUTAS — Proxy a OpenRouteService
# ──────────────────────────────────────────────────────────
import httpx

@app.post("/api/routes/calculate")
async def calculate_routes(data: dict = Body(...)):
    """
    Proxy seguro a OpenRouteService.
    Recibe: { "waypoints": [[lat,lng], ...], "alternatives": N (1-5) }
    Retorna: GeoJSON con rutas calculadas
    """
    if not ORS_API_KEY:
        raise HTTPException(status_code=503, detail="API de rutas no configurada. Revisa config.py")

    waypoints = data.get("waypoints", [])
    alternatives = min(int(data.get("alternatives", 1)), 5)  # Máximo 5

    if len(waypoints) < 2:
        raise HTTPException(status_code=400, detail="Se necesitan al menos 2 puntos para calcular la ruta")

    # ORS usa formato [lng, lat] (longitud primero)
    coordinates = [[float(p[1]), float(p[0])] for p in waypoints]

    ors_url = "https://api.openrouteservice.org/v2/directions/driving-car/geojson"
    headers = {
        "Authorization": ORS_API_KEY,
        "Content-Type": "application/json"
    }
    payload = {
        "coordinates": coordinates,
        "alternative_routes": {
            "target_count": alternatives,
            "weight_factor": 1.6,
            "share_factor": 0.6
        },
        "instructions": False,
        "geometry_simplify": False
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(ors_url, json=payload, headers=headers)
            if resp.status_code == 200:
                return resp.json()
            else:
                detail = resp.json().get("error", {}).get("message", "Error al calcular rutas") if resp.headers.get("content-type", "").startswith("application/json") else "Error en servidor de rutas"
                raise HTTPException(status_code=resp.status_code, detail=detail)
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Tiempo de espera agotado al conectar con servidor de rutas")
    except httpx.RequestError as e:
        raise HTTPException(status_code=503, detail=f"Error de conexión: {str(e)}")


# ──────────────────────────────────────────────────────────
#  REPORTE PERICIAL
# ──────────────────────────────────────────────────────────
@app.post("/api/report/generate")
async def generate_report(data: dict = Body(...), db: Session = Depends(get_db),
                          current_user: models.User = Depends(get_current_user)):
    """Genera un reporte pericial forense en formato HTML."""
    case_number = data.get("case_number", "SIN NÚMERO")
    investigator = data.get("investigator", current_user.username)
    observations = data.get("observations", "")
    location_str = data.get("location", "No disponible")
    suspect_ids = data.get("suspect_ids", [])
    generated_at = datetime.datetime.now().strftime("%d/%m/%Y %H:%M:%S")

    # Obtener sospechosos seleccionados
    suspects_data = []
    if suspect_ids:
        suspects_data = db.query(models.Suspect).filter(models.Suspect.id.in_(suspect_ids)).all()
    else:
        suspects_data = db.query(models.Suspect).limit(50).all()

    # Obtener alertas recientes
    alerts_data = db.query(models.Alert).order_by(models.Alert.timestamp.desc()).limit(20).all()

    # Construir tabla de sospechosos
    suspects_rows = ""
    for i, s in enumerate(suspects_data, 1):
        photo_count = len(s.face_photos) if s.face_photos else 0
        suspects_rows += f"""
        <tr>
            <td>{i}</td>
            <td>{s.first_name} {s.last_name}</td>
            <td class="mono">{s.identification}</td>
            <td>{s.behavior_profile or 'Sin registros'}</td>
            <td class="center">{photo_count} foto(s)</td>
        </tr>"""

    # Construir tabla de alertas
    alerts_rows = ""
    for a in alerts_data:
        ts = a.timestamp.strftime("%d/%m/%Y %H:%M") if a.timestamp else "N/A"
        suspect_name = f"{a.suspect.first_name} {a.suspect.last_name}" if a.suspect else "Desconocido"
        alerts_rows += f"""
        <tr>
            <td class="mono">{ts}</td>
            <td>{suspect_name}</td>
            <td>{a.detection_type or 'N/A'}</td>
            <td>{a.location or 'N/A'}</td>
            <td>{a.details or '—'}</td>
        </tr>"""

    no_suspects_msg = "" if suspects_rows else "<tr><td colspan='5' class='center muted'>Sin sospechosos registrados</td></tr>"
    no_alerts_msg = "" if alerts_rows else "<tr><td colspan='5' class='center muted'>Sin alertas registradas</td></tr>"

    html = f"""<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Reporte Pericial — Caso {case_number}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
  :root {{
    --primary: #1e3a5f; --accent: #2563eb; --text: #1a1a2e;
    --muted: #64748b; --border: #d1d5db; --bg: #f8fafc; --card: #ffffff;
    --danger: #dc2626; --success: #16a34a;
  }}
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{ font-family: 'Inter', sans-serif; background: var(--bg); color: var(--text); font-size: 13px; }}
  .page {{ max-width: 900px; margin: 0 auto; padding: 40px 30px; }}
  /* Header */
  .report-header {{ background: var(--primary); color: white; padding: 30px; border-radius: 12px 12px 0 0; margin-bottom: 0; }}
  .report-header-top {{ display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }}
  .report-logo {{ font-size: 22px; font-weight: 800; letter-spacing: -0.5px; }}
  .report-logo span {{ color: #60a5fa; }}
  .report-badge {{ background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.25); border-radius: 6px; padding: 6px 14px; font-size: 11px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; }}
  .report-title {{ font-size: 28px; font-weight: 700; margin-bottom: 6px; }}
  .report-subtitle {{ font-size: 13px; opacity: 0.75; }}
  /* Meta info bar */
  .meta-bar {{ background: var(--card); border: 1px solid var(--border); border-top: 3px solid var(--accent); padding: 20px 30px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin-bottom: 24px; }}
  .meta-item label {{ display: block; font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: var(--muted); margin-bottom: 4px; font-weight: 600; }}
  .meta-item span {{ font-size: 13px; font-weight: 600; color: var(--text); }}
  .mono {{ font-family: 'JetBrains Mono', monospace; }}
  /* Sections */
  .section {{ background: var(--card); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 20px; overflow: hidden; }}
  .section-title {{ background: #f1f5f9; border-bottom: 1px solid var(--border); padding: 12px 20px; display: flex; align-items: center; gap: 10px; }}
  .section-title h2 {{ font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--primary); }}
  .section-title .num {{ background: var(--accent); color: white; border-radius: 50%; width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; }}
  .section-body {{ padding: 20px; }}
  /* Tables */
  table {{ width: 100%; border-collapse: collapse; font-size: 12px; }}
  th {{ background: #f8fafc; border: 1px solid var(--border); padding: 10px 12px; text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); font-weight: 600; }}
  td {{ border: 1px solid var(--border); padding: 10px 12px; color: var(--text); vertical-align: top; }}
  tr:nth-child(even) td {{ background: #fafafa; }}
  .center {{ text-align: center; }}
  .muted {{ color: var(--muted); font-style: italic; }}
  /* Observations */
  .obs-box {{ background: #fffbeb; border: 1px solid #fde68a; border-left: 4px solid #f59e0b; border-radius: 6px; padding: 16px; white-space: pre-wrap; line-height: 1.7; }}
  /* Footer */
  .report-footer {{ margin-top: 30px; padding-top: 20px; border-top: 2px solid var(--border); display: flex; justify-content: space-between; align-items: center; color: var(--muted); font-size: 10px; }}
  .stamp {{ border: 2px solid var(--primary); color: var(--primary); padding: 8px 16px; border-radius: 6px; font-weight: 700; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; opacity: 0.7; transform: rotate(-2deg); display: inline-block; }}
  .watermark {{ position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%) rotate(-45deg); font-size: 80px; font-weight: 900; color: rgba(37,99,235,0.04); pointer-events: none; user-select: none; white-space: nowrap; }}
  .geo-info {{ background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 12px 16px; font-size: 12px; }}
  .geo-info strong {{ color: var(--success); }}
  @media print {{
    body {{ background: white; }}
    .page {{ padding: 20px; }}
    .watermark {{ opacity: 0.03; }}
  }}
</style>
</head>
<body>
<div class="watermark">FORENSYS VISION</div>
<div class="page">

  <!-- Header -->
  <div class="report-header">
    <div class="report-header-top">
      <div class="report-logo">Foren<span>Sys</span> Vision</div>
      <div class="report-badge">Confidencial</div>
    </div>
    <div class="report-title">Reporte Pericial Forense</div>
    <div class="report-subtitle">Sistema de Inteligencia Forense Digital — Documento oficial de investigación</div>
  </div>

  <!-- Meta Bar -->
  <div class="meta-bar">
    <div class="meta-item">
      <label>Número de Caso</label>
      <span class="mono">{case_number}</span>
    </div>
    <div class="meta-item">
      <label>Investigador</label>
      <span>{investigator}</span>
    </div>
    <div class="meta-item">
      <label>Fecha y Hora</label>
      <span class="mono">{generated_at}</span>
    </div>
    <div class="meta-item">
      <label>Sujetos analizados</label>
      <span class="mono">{len(suspects_data)}</span>
    </div>
  </div>

  <!-- Geolocalización -->
  <div class="section">
    <div class="section-title">
      <span class="num">1</span>
      <h2>Geolocalización del Dispositivo</h2>
    </div>
    <div class="section-body">
      <div class="geo-info">
        <strong>📍 Ubicación registrada:</strong> {location_str}
        <br><small style="color:var(--muted);margin-top:4px;display:block;">Coordenadas capturadas al momento de generar el reporte. Hora: {generated_at}</small>
      </div>
    </div>
  </div>

  <!-- Sospechosos -->
  <div class="section">
    <div class="section-title">
      <span class="num">2</span>
      <h2>Base de Datos de Sujetos Investigados</h2>
    </div>
    <div class="section-body">
      <table>
        <thead>
          <tr>
            <th>#</th><th>Nombre Completo</th><th>Identificación</th><th>Antecedentes / Conductas</th><th>Biometría</th>
          </tr>
        </thead>
        <tbody>
          {suspects_rows}
          {no_suspects_msg}
        </tbody>
      </table>
    </div>
  </div>

  <!-- Alertas -->
  <div class="section">
    <div class="section-title">
      <span class="num">3</span>
      <h2>Historial de Alertas de Detección</h2>
    </div>
    <div class="section-body">
      <table>
        <thead>
          <tr>
            <th>Timestamp</th><th>Sujeto</th><th>Tipo</th><th>Ubicación</th><th>Detalles</th>
          </tr>
        </thead>
        <tbody>
          {alerts_rows}
          {no_alerts_msg}
        </tbody>
      </table>
    </div>
  </div>

  <!-- Observaciones -->
  <div class="section">
    <div class="section-title">
      <span class="num">4</span>
      <h2>Observaciones del Investigador</h2>
    </div>
    <div class="section-body">
      <div class="obs-box">{observations if observations else 'Sin observaciones adicionales.'}</div>
    </div>
  </div>

  <!-- Footer -->
  <div class="report-footer">
    <div>
      <div><strong>ForenSys Vision V2</strong> — Sistema de Inteligencia Forense Digital</div>
      <div style="margin-top:4px;">Documento generado automáticamente el {generated_at} · Para uso académico e investigativo</div>
    </div>
    <div class="stamp">Documento Oficial</div>
  </div>

</div>
</body>
</html>"""

    return HTMLResponse(content=html, media_type="text/html; charset=utf-8",
                        headers={"Content-Disposition": f'attachment; filename="reporte_caso_{case_number}_{datetime.datetime.now().strftime("%Y%m%d_%H%M%S")}.html"'})


# ──────────────────────────────────────────────────────────
#  BASE DE DATOS — Exportar / Importar
# ──────────────────────────────────────────────────────────
@app.get("/api/database/export")
def export_database(current_user: models.User = Depends(get_current_user)):
    db_path = "ciberforense.db"
    if not os.path.exists(db_path):
        raise HTTPException(status_code=404, detail="Base de datos no encontrada")
    return FileResponse(db_path, media_type="application/octet-stream", filename="ciberforense.db")

@app.post("/api/database/import")
def import_database(file: UploadFile = File(...), current_user: models.User = Depends(get_current_user)):
    db_path = "ciberforense.db"
    engine.dispose()
    with open(db_path, "wb") as f:
        shutil.copyfileobj(file.file, f)
    return {"ok": True, "message": "Base de datos importada correctamente"}


# ──────────────────────────────────────────────────────────
#  ARCHIVOS ESTÁTICOS
# ──────────────────────────────────────────────────────────
if not os.path.exists("static"):
    os.makedirs("static")
app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
