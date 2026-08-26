from db import get_connection

try:
    connection = get_connection()

    print("Database connection: OK")

    connection.close()

except Exception as e:
    print("Database connection: FAILED")
    print(e)