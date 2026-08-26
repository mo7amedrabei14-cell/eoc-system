from auth import get_effective_permissions


permissions = get_effective_permissions(2)

print("Joker effective permissions:")

for permission in permissions:
    print("-", permission)