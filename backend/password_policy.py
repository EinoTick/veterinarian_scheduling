"""Shared password policy used by auth hashing helpers and Pydantic schemas."""


def validate_password_strength(password: str) -> str:
    """
    Return the password if it meets policy; raise ValueError otherwise.
    Policy: ≥8 chars, at least one letter and one digit.
    """
    if password is None or len(password) < 8:
        raise ValueError("Password must be at least 8 characters.")
    if not any(c.isalpha() for c in password):
        raise ValueError("Password must include at least one letter.")
    if not any(c.isdigit() for c in password):
        raise ValueError("Password must include at least one number.")
    return password
