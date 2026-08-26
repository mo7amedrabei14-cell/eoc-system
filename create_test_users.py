from pwdlib import PasswordHash

password_hash = PasswordHash.recommended()

passwords = {
    "operation.upper": "OperationUpper@123",
    "operation.canal": "OperationCanal@123",
    "operation.delta": "OperationDelta@123",
}

for username, password in passwords.items():
    print(username)
    print(password_hash.hash(password))
    print()