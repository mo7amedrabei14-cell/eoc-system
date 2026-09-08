import os
import psycopg
from dotenv import load_dotenv

load_dotenv()

def get_connection():
    # Keepalives + connect timeout: prevents cold/startup stalls that surface as
    # Vercel gateway timeouts / HTML 504, which the frontend shows as "server connection error".
    # No pooling (Vercel serverless must not hold connections across invocations).
    return psycopg.connect(
        os.getenv("DATABASE_URL"),
        connect_timeout=10,
        keepalives=1,
        keepalives_idle=30,
        keepalives_interval=10,
        keepalives_count=5,
    )