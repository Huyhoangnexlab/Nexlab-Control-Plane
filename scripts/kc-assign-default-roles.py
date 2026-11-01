#!/usr/bin/env python3
"""
Gán vai trò mặc định của realm (`default-roles-<realm>`) cho MỌI người dùng của các realm đã import — chạy trên máy có thể tới Keycloak
(vd. trên VM: KC_URL=http://<IP container keycloak>:8080 KC_ADMIN_USER=kcadmin KC_ADMIN_PASSWORD=... python3 kc-assign-default-roles.py nexlab benhvien-b).

Vì sao cần: người dùng nạp bằng `--import-realm` từ JSON KHÔNG có vai trò nào nếu JSON không ghi `realmRoles`, nên «Account console»
(trang đổi mật khẩu của người dùng) báo «Something went wrong / HTTP 401» — thiếu quyền `account` (view-profile, manage-account). Đăng nhập Hub không bị ảnh hưởng.
Bản sinh realm mới (gen-keycloak-realms.ts) đã ghi sẵn `realmRoles`; script này dành cho realm ĐÃ import. Chạy nhiều lần vẫn an toàn.
"""
import json
import os
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass
import urllib.parse
import urllib.request

KC = os.environ.get("KC_URL", "http://localhost:8081").rstrip("/")
USER = os.environ.get("KC_ADMIN_USER", "admin")
PASSWORD = os.environ.get("KC_ADMIN_PASSWORD", "")
if not PASSWORD:
    sys.exit("Thiếu KC_ADMIN_PASSWORD")


def call(method, path, token=None, body=None, form=None):
    data = None
    headers = {}
    if form is not None:
        data = urllib.parse.urlencode(form).encode()
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    elif body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(KC + path, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read()
        return json.loads(raw) if raw else None


token = call("POST", "/realms/master/protocol/openid-connect/token", form={"grant_type": "password", "client_id": "admin-cli", "username": USER, "password": PASSWORD})["access_token"]
for realm in sys.argv[1:] or ["nexlab"]:
    role = call("GET", f"/admin/realms/{realm}/roles/default-roles-{realm}", token)
    users = call("GET", f"/admin/realms/{realm}/users?max=500", token)
    fixed = 0
    for u in users:
        have = call("GET", f"/admin/realms/{realm}/users/{u['id']}/role-mappings/realm", token)
        if any(r["name"] == role["name"] for r in have):
            continue
        call("POST", f"/admin/realms/{realm}/users/{u['id']}/role-mappings/realm", token, body=[role])
        fixed += 1
    print(f"{realm}: {len(users)} người dùng, đã gán vai mặc định cho {fixed}")
