from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import psycopg

from db import get_connection
from auth import get_current_user_id, authorize

security = HTTPBearer()

def get_db():
    connection = get_connection()
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    user_id = get_current_user_id(token)
    
    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired token"
        )
    return user_id

class RequirePermission:
    def __init__(self, permission_code: str):
        self.permission_code = permission_code

    def __call__(self, user_id: int = Depends(get_current_user)):
        if not authorize(user_id, self.permission_code):
            raise HTTPException(
                status_code=403,
                detail=f"You do not have permission: {self.permission_code}"
            )
        return user_id