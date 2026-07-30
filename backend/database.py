import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

_DEFAULT_URL = "postgresql://vetclinic:vetclinic_dev@localhost:5432/vetclinic"

# Load from .env if present, fall back to the local Docker default
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

DATABASE_URL = os.getenv("DATABASE_URL", _DEFAULT_URL)

engine = create_engine(DATABASE_URL, pool_pre_ping=True)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
