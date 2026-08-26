import os
import psycopg
from dotenv import load_dotenv

load_dotenv()

def get_connection():
    # 💡 بنسحب الرابط السحابي الكامل من ملف الـ .env
    return psycopg.connect(os.getenv("DATABASE_URL"))