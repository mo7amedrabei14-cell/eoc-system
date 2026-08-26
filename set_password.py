from getpass import getpass

from pwdlib import PasswordHash

from db import get_connection


password_hash = PasswordHash.recommended()

password = getpass("Enter new password: ")
confirm_password = getpass("Confirm password: ")

if password != confirm_password:
    print("Passwords do not match.")
    raise SystemExit(1)

hashed_password = password_hash.hash(password)

connection = get_connection()

try:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE users
            SET password_hash = %s
            WHERE username = %s;
            """,
            (hashed_password, "mrabea.x")
        )

        if cursor.rowcount != 1:
            print("User not found.")
            connection.rollback()
            raise SystemExit(1)

    connection.commit()

    print("Password saved successfully.")

finally:
    connection.close()