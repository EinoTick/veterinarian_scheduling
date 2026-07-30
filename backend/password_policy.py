"""Shared password policy used by auth hashing helpers and Pydantic schemas."""

_SYMBOLS = set("!@#$%^&*()-_=+[]{};:'\",.<>/?\\|`~")


def validate_password_strength(password: str) -> str:
    """
    Return the password if it meets policy; raise ValueError otherwise.
    Policy: >=10 chars, at least one letter, one digit, and one uppercase
    letter or symbol (raised from the prior 8-char/letter+digit-only policy).

    Note: seed/demo accounts (created in main.py's seed_db) are constructed
    directly via the ORM and intentionally bypass this schema-level policy —
    seeding only ever runs outside production (see ENVIRONMENT gating).
    """
    if password is None or len(password) < 10:
        raise ValueError("Password must be at least 10 characters.")
    if not any(c.isalpha() for c in password):
        raise ValueError("Password must include at least one letter.")
    if not any(c.isdigit() for c in password):
        raise ValueError("Password must include at least one number.")
    if not any(c.isupper() for c in password) and not any(c in _SYMBOLS for c in password):
        raise ValueError("Password must include at least one uppercase letter or symbol.")
    return password
