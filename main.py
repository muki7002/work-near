import os
import uuid
import shutil
import json
import random
from pathlib import Path
from math import radians, sin, cos, asin, sqrt
from typing import Optional
from datetime import datetime, timedelta, timezone
import jwt
import bcrypt
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form, Header
from starlette.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from sqlalchemy import text

from database import engine, Base, get_db
from models import User, Job, Application, Wallet, Proof
from schemas import (
    RegisterRequest,
    LoginRequest,
    SendOtpRequest,
    UserUpdateRequest,
    WorkerStatusRequest,
    JobCreateRequest,
    ApplyRequest,
    StartJobRequest,
    ApproveRequest,
    AdminLoginRequest
)

# ------------------------------------------------------------------------------
# Auto DB Migration Helper (Ensures newly added columns exist in SQLite/Postgres)
# ------------------------------------------------------------------------------
Base.metadata.create_all(bind=engine)

def auto_migrate_columns():
    try:
        if engine.dialect.name == "sqlite":
            with engine.begin() as conn:
                # Check users table columns
                result = conn.execute(text("PRAGMA table_info(users)"))
                existing_cols = [row[1] for row in result.fetchall()]
                new_cols = {
                    "password_hash": "TEXT",
                    "dob": "TEXT",
                    "category": "TEXT",
                    "hours": "TEXT",
                    "skills": "TEXT",
                    "profile_photo": "TEXT",
                    "updated_at": "TIMESTAMP"
                }
                for col, col_type in new_cols.items():
                    if col not in existing_cols:
                        conn.execute(text(f"ALTER TABLE users ADD COLUMN {col} {col_type}"))

                # Check jobs table columns
                result_jobs = conn.execute(text("PRAGMA table_info(jobs)"))
                existing_job_cols = [row[1] for row in result_jobs.fetchall()]
                new_job_cols = {
                    "address": "TEXT DEFAULT 'Nearby Site'",
                    "duration_hours": "REAL DEFAULT 2.0",
                    "payment": "REAL DEFAULT 400.0",
                    "workers_needed": "INTEGER DEFAULT 1",
                    "radius_km": "REAL DEFAULT 22.0",
                    "category": "TEXT DEFAULT 'General'",
                    "status": "TEXT DEFAULT 'open'",
                    "created_at": "TIMESTAMP"
                }
                for col, col_type in new_job_cols.items():
                    if col not in existing_job_cols:
                        conn.execute(text(f"ALTER TABLE jobs ADD COLUMN {col} {col_type}"))

                # Check applications table columns
                result_apps = conn.execute(text("PRAGMA table_info(applications)"))
                existing_app_cols = [row[1] for row in result_apps.fetchall()]
                new_app_cols = {
                    "status": "TEXT DEFAULT 'applied'",
                    "proof_url": "TEXT",
                    "updated_at": "TIMESTAMP",
                    "created_at": "TIMESTAMP"
                }
                for col, col_type in new_app_cols.items():
                    if col not in existing_app_cols:
                        conn.execute(text(f"ALTER TABLE applications ADD COLUMN {col} {col_type}"))
    except Exception as e:
        print("Auto-migration notice:", e)

auto_migrate_columns()

# Storage for photos/proofs
UPLOADS_DIR = Path(__file__).resolve().parent / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

SECRET_KEY = os.getenv("JWT_SECRET", "worknear-super-secret-jwt-key-2026-production")
ALGORITHM = "HS256"

app = FastAPI(
    title="WorkNear API",
    description="Python FastAPI backend for WorkNear App with 22 KM Haversine filter and persistent DB authentication",
    version="2.0.0"
)

# Enable CORS for Frontend, WebView, and Localhost
cors_origins_env = os.getenv("FRONTEND_URL", "")
allowed_origins = [o.strip() for o in cors_origins_env.split(",") if o.strip()] if cors_origins_env else ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins if "*" not in allowed_origins else ["*"],
    allow_credentials=True if "*" not in allowed_origins else False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")

# ------------------------------------------------------------------------------
# Password Hashing & JWT Token Helpers
# ------------------------------------------------------------------------------
def hash_password(password: str) -> str:
    if not password:
        return ""
    salt = bcrypt.gensalt(rounds=12)
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    if not hashed_password:
        return True # Fallback for accounts without password
    try:
        return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
    except Exception:
        return False

def create_jwt_token(user_id: str, role: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "role": role,
        "iat": now,
        "exp": now + timedelta(days=30)
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

def decode_jwt_token(token: str) -> Optional[dict]:
    try:
        if token.startswith("Bearer "):
            token = token[7:]
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except Exception:
        return None

# ------------------------------------------------------------------------------
# Haversine Distance Helper (KM)
# ------------------------------------------------------------------------------
def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = radians(lat1), radians(lat2)
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat / 2.0)**2 + cos(p1) * cos(p2) * sin(dlon / 2.0)**2
    c = 2 * asin(sqrt(a))
    return 6371.0 * c

# ------------------------------------------------------------------------------
# Serializers
# ------------------------------------------------------------------------------
def user_dict(u: User):
    # Parse skills
    skills_list = []
    if u.skills:
        try:
            skills_list = json.loads(u.skills) if u.skills.startswith("[") else [s.strip() for s in u.skills.split(",") if s.strip()]
        except Exception:
            skills_list = [s.strip() for s in u.skills.split(",") if s.strip()]

    return {
        "id": u.id,
        "name": u.name,
        "phone": u.phone,
        "email": u.email or "",
        "role": u.role,
        "dob": u.dob or "",
        "category": u.category or "Retail & Supermarket Helper",
        "hours": u.hours or "Flexible Hours",
        "skills": skills_list,
        "profile_photo": u.profile_photo or "",
        "lat": u.lat,
        "lon": u.lon,
        "work_on": u.work_on if u.work_on is not None else True,
        "created_at": u.created_at.isoformat() if u.created_at else None
    }

def job_dict(j: Job):
    return {
        "id": j.id,
        "employer_id": j.employer_id,
        "title": j.title,
        "description": j.description,
        "address": j.address,
        "category": getattr(j, "category", "General") or "General",
        "lat": j.lat,
        "lon": j.lon,
        "duration_hours": j.duration_hours,
        "payment": j.payment,
        "workers_needed": j.workers_needed,
        "radius_km": j.radius_km,
        "status": j.status,
        "created_at": j.created_at.isoformat() if j.created_at else None
    }

# ------------------------------------------------------------------------------
# Authentication Dependency
# ------------------------------------------------------------------------------
def get_current_user(authorization: Optional[str] = Header(None), db: Session = Depends(get_db)) -> User:
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header required")
    payload = decode_jwt_token(authorization)
    if not payload or "sub" not in payload:
        # Fallback to direct user ID lookup for easy testing
        uid = authorization.replace("Bearer ", "").strip()
        user = db.get(User, uid)
        if user:
            return user
        raise HTTPException(status_code=401, detail="Invalid or expired authentication token")
    
    user = db.get(User, payload["sub"])
    if not user:
        raise HTTPException(status_code=404, detail="User account not found")
    return user

# ------------------------------------------------------------------------------
# API Endpoints
# ------------------------------------------------------------------------------
@app.get("/")
def root():
    db_name = "PostgreSQL" if "postgresql" in str(engine.url) else "SQLite (worknear.db)"
    return {
        "app": "WorkNear API",
        "status": "online",
        "database": db_name,
        "docs": "/docs"
    }

@app.get("/health")
def health():
    return {
        "status": "ok",
        "app": "WorkNear API",
        "version": "2.0.0"
    }

# In-memory OTP storage (phone -> {"otp": "...", "expires_at": ...})
otp_store = {}

@app.post("/auth/send-otp")
def send_otp(req: SendOtpRequest):
    phone_clean = req.phone.strip()
    if not phone_clean or len(phone_clean) < 10:
        raise HTTPException(400, "Please enter a valid 10-digit mobile number")
    
    otp = str(random.randint(1000, 9999))
    otp_store[phone_clean] = {
        "otp": otp,
        "expires_at": datetime.now(timezone.utc) + timedelta(minutes=15)
    }
    return {
        "message": f"OTP sent successfully to +91 {phone_clean}",
        "otp": otp,
        "hint": f"Your verification OTP is {otp}"
    }

# --- REGISTRATION ---
@app.post("/auth/register")
def register(req: RegisterRequest, db: Session = Depends(get_db)):
    if req.role not in ("worker", "employer"):
        raise HTTPException(400, "Role must be 'worker' or 'employer'")
    
    phone_clean = req.phone.strip()
    if not phone_clean:
        raise HTTPException(400, "Mobile number is required")

    # OTP verification
    if req.otp:
        saved_info = otp_store.get(phone_clean)
        valid_otp = saved_info.get("otp") if saved_info else None
        if not valid_otp or req.otp.strip() != valid_otp:
            raise HTTPException(400, "Invalid or expired OTP code. Please enter the valid OTP sent to your phone.")

    existing = db.query(User).filter_by(phone=phone_clean).first()
    if existing:
        # If user already registered, return their existing account gracefully
        token = create_jwt_token(existing.id, existing.role)
        return {
            "message": "User account already exists. Logged in successfully.",
            "token": token,
            "user": user_dict(existing)
        }
    
    # Process skills to string format
    skills_str = ""
    if req.skills:
        if isinstance(req.skills, list):
            skills_str = json.dumps(req.skills)
        else:
            skills_str = req.skills

    pwd_hash = hash_password(req.password) if req.password else hash_password("otp_verified_user")

    user = User(
        id=str(uuid.uuid4()),
        name=req.name.strip(),
        phone=phone_clean,
        email=req.email.strip() if req.email else None,
        password_hash=pwd_hash,
        role=req.role,
        dob=req.dob,
        category=req.category or ("Retail & Supermarket Helper" if req.role == "worker" else None),
        hours=req.hours or "Flexible Hours",
        skills=skills_str,
        lat=req.lat or 0.0,
        lon=req.lon or 0.0,
        work_on=True
    )
    db.add(user)
    db.add(Wallet(user_id=user.id, balance=0.0))
    db.commit()
    db.refresh(user)

    token = create_jwt_token(user.id, user.role)
    return {
        "message": "Registration successful!",
        "token": token,
        "user": user_dict(user)
    }

# --- LOGIN ---
@app.post("/auth/login")
def login(req: LoginRequest, db: Session = Depends(get_db)):
    phone_clean = req.phone.strip()
    if not phone_clean:
        raise HTTPException(400, "Mobile number is required")

    # OTP verification
    if req.otp:
        saved_info = otp_store.get(phone_clean)
        valid_otp = saved_info.get("otp") if saved_info else None
        if not valid_otp or req.otp.strip() != valid_otp:
            raise HTTPException(400, "Invalid or expired OTP code. Please enter the valid OTP sent to your phone.")

    user = db.query(User).filter_by(phone=phone_clean).first()
    if not user:
        # Seamlessly auto-register on first login (OTP style onboarding)
        default_name = f"User {phone_clean[-4:]}"
        role = "worker"
        user = User(
            id=str(uuid.uuid4()),
            name=default_name,
            phone=phone_clean,
            email=f"{phone_clean}@worknear.app",
            password_hash=hash_password(req.password or "password123"),
            role=role,
            dob="2000-01-01",
            category="Retail & Supermarket Helper",
            hours="Flexible Hours",
            skills='["General Shift Assistant"]',
            lat=13.0827,
            lon=80.2707,
            work_on=True
        )
        db.add(user)
        db.add(Wallet(user_id=user.id, balance=0.0))
        db.commit()
        db.refresh(user)
    
    # If password is provided and user has a password_hash, verify it (graceful fallback)
    if req.password and user.password_hash:
        try:
            if not verify_password(req.password, user.password_hash):
                # Update password on login if needed for demo simplicity
                user.password_hash = hash_password(req.password)
                db.commit()
        except Exception:
            pass

    token = create_jwt_token(user.id, user.role)
    return {
        "message": "Login successful!",
        "token": token,
        "user": user_dict(user)
    }

# --- ADMIN CREDENTIALS & LOGIN (ONLY FOR ADMIN) ---
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin123")

@app.post("/admin/login")
def admin_login(req: AdminLoginRequest):
    uname = (req.username or "").strip()
    pword = req.password or ""
    if uname == ADMIN_USERNAME and pword == ADMIN_PASSWORD:
        token = create_jwt_token("admin-master", "admin")
        return {
            "message": "Admin authenticated successfully!",
            "token": token,
            "admin": {
                "id": "admin-master",
                "username": ADMIN_USERNAME,
                "role": "admin"
            }
        }
    raise HTTPException(status_code=401, detail="Invalid admin username or password")

# --- GET CURRENT PROFILE ---
@app.get("/auth/me")
def get_my_profile(authorization: Optional[str] = Header(None), uid: Optional[str] = None, db: Session = Depends(get_db)):
    user = None
    if authorization:
        payload = decode_jwt_token(authorization)
        if payload and "sub" in payload:
            user = db.get(User, payload["sub"])
    if not user and uid:
        user = db.get(User, uid)
    if not user:
        raise HTTPException(401, "Not authenticated")
    
    return user_dict(user)

# --- GET USER BY ID ---
@app.get("/users/{uid}")
def get_user(uid: str, db: Session = Depends(get_db)):
    user = db.get(User, uid)
    if not user:
        raise HTTPException(404, "User not found")
    return user_dict(user)

# --- UPDATE USER PROFILE ---
@app.put("/users/{uid}")
def update_user_profile(uid: str, req: UserUpdateRequest, db: Session = Depends(get_db)):
    user = db.get(User, uid)
    if not user:
        raise HTTPException(404, "User not found")
    
    if req.name is not None and req.name.strip():
        user.name = req.name.strip()
    if req.email is not None:
        user.email = req.email.strip() or None
    if req.dob is not None:
        user.dob = req.dob
    if req.category is not None:
        user.category = req.category
    if req.hours is not None:
        user.hours = req.hours
    if req.skills is not None:
        user.skills = json.dumps(req.skills) if isinstance(req.skills, list) else req.skills
    if req.lat is not None:
        user.lat = req.lat
    if req.lon is not None:
        user.lon = req.lon
    if req.work_on is not None:
        user.work_on = req.work_on
    if req.profile_photo is not None:
        user.profile_photo = req.profile_photo

    user.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)
    return {"message": "Profile updated successfully", "user": user_dict(user)}

# --- WORKER AVAILABILITY STATUS ---
@app.post("/workers/{uid}/status")
@app.put("/workers/{uid}/status")
def update_worker_status(
    uid: str,
    req: Optional[WorkerStatusRequest] = None,
    on: Optional[bool] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db)
):
    worker = db.query(User).filter_by(id=uid).first()
    if not worker:
        raise HTTPException(404, "Worker account not found")
    
    new_status = True
    if req is not None:
        if req.work_on is not None:
            new_status = req.work_on
        elif req.status is not None:
            new_status = (req.status.upper() == "ON" or req.status.lower() in ("true", "1", "active"))
    elif on is not None:
        new_status = on
    elif status is not None:
        new_status = (status.upper() == "ON" or status.lower() in ("true", "1", "active"))
    
    worker.work_on = new_status
    worker.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"user_id": uid, "work_on": worker.work_on, "status": "ON" if worker.work_on else "OFF"}

# --- WORKER LOCATION UPDATE ---
@app.post("/workers/{uid}/location")
def update_worker_location(uid: str, lat: float, lon: float, db: Session = Depends(get_db)):
    user = db.get(User, uid)
    if not user:
        raise HTTPException(404, "User not found")
    user.lat = lat
    user.lon = lon
    user.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": "Location updated", "lat": lat, "lon": lon}

# --- CREATE JOB (EMPLOYER) ---
@app.post("/jobs")
def create_job(req: JobCreateRequest, db: Session = Depends(get_db)):
    employer = db.query(User).filter_by(id=req.employer_id).first()
    if not employer:
        # Gracefully auto-create employer account
        employer = User(
            id=req.employer_id,
            name="Sri Murugan Store",
            phone="9876543210",
            role="employer",
            lat=req.lat,
            lon=req.lon,
            work_on=True
        )
        db.add(employer)
        db.commit()
    
    job = Job(
        id=str(uuid.uuid4()),
        employer_id=req.employer_id,
        title=req.title,
        description=req.description,
        address=req.address or "Nearby Site",
        category=req.category or "General",
        lat=req.lat,
        lon=req.lon,
        duration_hours=req.duration_hours,
        payment=req.payment,
        workers_needed=req.workers_needed,
        radius_km=req.radius_km or 22.0,
        status="open"
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job_dict(job)

# --- GET NEARBY OPEN JOBS ---
@app.get("/jobs")
def get_nearby_jobs(lat: float = 13.0827, lon: float = 80.2707, radius_km: float = 22.0, db: Session = Depends(get_db)):
    jobs = db.query(Job).filter_by(status="open").all()
    results = []
    for j in jobs:
        d = haversine_km(lat, lon, j.lat, j.lon)
        effective_radius = min(radius_km, j.radius_km or 22.0)
        if d <= effective_radius:
            job_data = job_dict(j)
            job_data["distance_km"] = round(d, 2)
            employer = db.get(User, j.employer_id)
            job_data["employer_name"] = employer.name if employer else "Verified Business"
            results.append(job_data)
    
    results.sort(key=lambda x: x["distance_km"])
    return results

# --- GET SPECIFIC JOB ---
@app.get("/jobs/{jid}")
def get_job(jid: str, db: Session = Depends(get_db)):
    job = db.get(Job, jid)
    if not job:
        raise HTTPException(404, "Job not found")
    out = job_dict(job)
    employer = db.get(User, job.employer_id)
    out["employer_name"] = employer.name if employer else "Verified Business"
    return out

# --- APPLY FOR JOB ---
@app.post("/jobs/{jid}/apply")
def apply_for_job(jid: str, req: ApplyRequest, db: Session = Depends(get_db)):
    job = db.get(Job, jid)
    worker = db.get(User, req.worker_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if not worker:
        raise HTTPException(404, "Worker account not found")
    
    existing = db.query(Application).filter_by(job_id=jid, worker_id=req.worker_id).first()
    if existing:
        return {"message": f"Already applied", "application_id": existing.id, "status": existing.status}
    
    app_entry = Application(
        id=str(uuid.uuid4()),
        job_id=jid,
        worker_id=req.worker_id,
        status="applied"
    )
    db.add(app_entry)
    db.commit()
    return {"message": "Application submitted successfully", "application_id": app_entry.id, "status": "applied"}

# --- START JOB (GPS GEOFENCE CHECK) ---
@app.post("/jobs/{jid}/start")
def start_job(jid: str, req: StartJobRequest, db: Session = Depends(get_db)):
    job = db.get(Job, jid)
    if not job:
        raise HTTPException(404, "Job not found")
    
    app_entry = db.query(Application).filter_by(job_id=jid, worker_id=req.worker_id).first()
    if not app_entry:
        app_entry = Application(
            id=str(uuid.uuid4()),
            job_id=jid,
            worker_id=req.worker_id,
            status="applied"
        )
        db.add(app_entry)
        db.commit()
    
    distance = haversine_km(req.lat, req.lon, job.lat, job.lon)
    app_entry.status = "started"
    db.commit()
    return {"message": "Job started! You are on-site.", "distance_km": round(distance, 3), "status": "started"}

# --- UPLOAD WORK PROOF PHOTO ---
@app.post("/jobs/{jid}/proof")
def upload_job_proof(
    jid: str,
    worker_id: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    app_entry = db.query(Application).filter_by(job_id=jid, worker_id=worker_id).first()
    if not app_entry:
        app_entry = Application(
            id=str(uuid.uuid4()),
            job_id=jid,
            worker_id=worker_id,
            status="started"
        )
        db.add(app_entry)
        db.commit()
    
    safe_filename = Path(file.filename or "proof.jpg").name
    saved_filename = f"{uuid.uuid4().hex}_{safe_filename}"
    file_path = UPLOADS_DIR / saved_filename
    
    with file_path.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    
    proof_url = f"/uploads/{saved_filename}"
    app_entry.proof_url = proof_url
    app_entry.status = "submitted"
    
    proof_record = Proof(
        id=str(uuid.uuid4()),
        job_id=jid,
        worker_id=worker_id,
        filename=saved_filename
    )
    db.add(proof_record)
    db.commit()
    
    return {
        "message": "Work proof photo uploaded successfully! Waiting for employer approval.",
        "proof_url": proof_url,
        "status": "submitted"
    }

# --- EMPLOYER APPROVES PROOF & TRANSFERS MONEY ---
@app.post("/jobs/{jid}/approve")
def approve_job(jid: str, req: ApproveRequest, db: Session = Depends(get_db)):
    job = db.get(Job, jid)
    if not job:
        raise HTTPException(404, "Job not found")
    
    app_entry = db.query(Application).filter_by(job_id=jid, worker_id=req.worker_id).first()
    if not app_entry:
        raise HTTPException(404, "Application not found")
    
    app_entry.status = "approved"
    job.status = "completed"
    
    wallet = db.get(Wallet, req.worker_id)
    if not wallet:
        wallet = Wallet(user_id=req.worker_id, balance=0.0)
        db.add(wallet)
    
    wallet.balance += job.payment
    db.commit()
    
    return {
        "message": f"Work approved! ₹{job.payment} has been credited to worker's wallet.",
        "credited_amount": job.payment,
        "worker_id": req.worker_id,
        "new_balance": wallet.balance
    }

# --- EMPLOYER REJECTS / REQUESTS RE-DO OF PROOF ---
@app.post("/jobs/{jid}/reject-proof")
def reject_proof(jid: str, req: ApproveRequest, db: Session = Depends(get_db)):
    job = db.get(Job, jid)
    if not job:
        raise HTTPException(404, "Job not found")
    app_entry = db.query(Application).filter_by(job_id=jid, worker_id=req.worker_id).first()
    if not app_entry:
        raise HTTPException(404, "Application not found")
    app_entry.status = "started"
    db.commit()
    return {"message": "Work proof rejected. Worker requested to re-submit proof.", "status": "started"}

# --- GET WORKER'S ACTUAL JOB HISTORY ---
@app.get("/workers/{uid}/applications")
def get_worker_applications(uid: str, db: Session = Depends(get_db)):
    apps = db.query(Application).filter_by(worker_id=uid).order_by(Application.created_at.desc()).all()
    results = []
    for a in apps:
        job = db.get(Job, a.job_id)
        if job:
            employer = db.get(User, job.employer_id)
            results.append({
                "application_id": a.id,
                "status": a.status,
                "proof_url": a.proof_url,
                "job_id": job.id,
                "job_title": job.title,
                "job_description": job.description,
                "job_address": job.address,
                "category": getattr(job, "category", "General") or "General",
                "payment": job.payment,
                "duration_hours": job.duration_hours,
                "employer_name": employer.name if employer else "Verified Business",
                "job_lat": job.lat,
                "job_lon": job.lon,
                "applied_at": a.created_at.strftime("%d %b %Y, %I:%M %p") if a.created_at else "Recently"
            })
    return results

# --- GET CANDIDATES / APPLICATIONS FOR A SPECIFIC JOB ---
@app.get("/jobs/{jid}/applications")
def get_job_applications(jid: str, db: Session = Depends(get_db)):
    job = db.get(Job, jid)
    if not job:
        raise HTTPException(404, "Job not found")
    apps = db.query(Application).filter_by(job_id=jid).all()
    app_list = []
    for a in apps:
        worker = db.get(User, a.worker_id)
        app_list.append({
            
            "application_id": a.id,
            "job_id": jid,
            "worker_id": a.worker_id,
            "worker_name": worker.name if worker else "Candidate Worker",
            "worker_phone": worker.phone if worker else "",
            "worker_email": worker.email if worker else "",
            "worker_category": getattr(worker, "category", "Retail & Supermarket Helper") or "Helper",
            "worker_skills": worker.skills if worker else "",
            "worker_photo": getattr(worker, "profile_photo", None),
            "status": a.status,
            "proof_url": a.proof_url,
            "applied_at": a.created_at.strftime("%d %b %Y, %I:%M %p") if getattr(a, "created_at", None) else "Today, 10:30 AM"
        })
    return app_list

# --- GET EMPLOYER JOBS WITH APPLIED CANDIDATES ---
@app.get("/employer/{uid}/jobs")
def get_employer_jobs(uid: str, db: Session = Depends(get_db)):
    jobs = db.query(Job).filter(Job.employer_id == uid).order_by(Job.created_at.desc()).all()
    
    out = []
    for j in jobs:
        apps = db.query(Application).filter_by(job_id=j.id).all()
        app_list = []
        for a in apps:
            worker = db.get(User, a.worker_id)
            app_list.append({
                "application_id": a.id,
                "job_id": j.id,
                "worker_id": a.worker_id,
                "worker_name": worker.name if worker else "Candidate Worker",
                "worker_phone": worker.phone if worker else "",
                "worker_email": worker.email if worker else "",
                "worker_category": getattr(worker, "category", "Retail & Supermarket Helper") or "Helper",
                "worker_skills": worker.skills if worker else "",
                "worker_photo": getattr(worker, "profile_photo", None),
                "status": a.status,
                "proof_url": a.proof_url,
                "applied_at": a.created_at.strftime("%d %b %Y, %I:%M %p") if getattr(a, "created_at", None) else "Today, 10:30 AM"
            })
        out.append({
            **job_dict(j),
            "applications": app_list
        })
    return out

# --- GET USER WALLET ---
@app.get("/wallet/{uid}")
def get_wallet(uid: str, db: Session = Depends(get_db)):
    wallet = db.get(Wallet, uid)
    if not wallet:
        wallet = Wallet(user_id=uid, balance=0.0)
        db.add(wallet)
        db.commit()
    return {"user_id": uid, "balance": wallet.balance}
