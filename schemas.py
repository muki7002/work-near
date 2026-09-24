from typing import Optional, List, Union
from pydantic import BaseModel

class RegisterRequest(BaseModel):
    name: str
    phone: str
    email: Optional[str] = None
    password: Optional[str] = None
    otp: Optional[str] = None
    role: str = "worker"  # "worker" or "employer"
    dob: Optional[str] = None
    category: Optional[str] = None
    hours: Optional[str] = None
    skills: Optional[Union[List[str], str]] = None
    lat: Optional[float] = 0.0
    lon: Optional[float] = 0.0

class LoginRequest(BaseModel):
    phone: str
    otp: Optional[str] = None
    password: Optional[str] = None

class SendOtpRequest(BaseModel):
    phone: str

class UserUpdateRequest(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    dob: Optional[str] = None
    category: Optional[str] = None
    hours: Optional[str] = None
    skills: Optional[Union[List[str], str]] = None
    lat: Optional[float] = None
    lon: Optional[float] = None
    work_on: Optional[bool] = None
    profile_photo: Optional[str] = None

class WorkerStatusRequest(BaseModel):
    work_on: Optional[bool] = None
    status: Optional[str] = None

class JobCreateRequest(BaseModel):
    employer_id: str
    title: str
    description: Optional[str] = ""
    address: Optional[str] = "Nearby Location"
    category: Optional[str] = "General"
    lat: float
    lon: float
    duration_hours: float = 2.0
    payment: float
    workers_needed: int = 1
    radius_km: float = 22.0

class ApplyRequest(BaseModel):
    worker_id: str

class StartJobRequest(BaseModel):
    worker_id: str
    lat: float
    lon: float

class ApproveRequest(BaseModel):
    worker_id: str

class AdminLoginRequest(BaseModel):
    username: str
    password: str
