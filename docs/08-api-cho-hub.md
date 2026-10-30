# 8. API cho Hub & gói quyền ký

> Trạng thái: **ĐÃ LÀM** phía Control Plane (4 endpoint + hàm kiểm + 24 test). **Phía Hub chưa nối** — đó là mốc M1/M4 (RBAC trong Hub). File mã Hub sẽ nhập: `src/lib/entitlement.ts` (định dạng + `verifyEntitlement`) và `src/lib/hub-permissions.ts` (danh mục quyền).

> **Cập nhật:** từ khi có SSO ([09](09-dang-nhap-sso-keycloak.md)), tenant **có IdP** đăng nhập bằng OIDC và gọi `GET /v1/entitlements` với **token của IdP** kèm header `X-Device-Id`. Token `nxh_…` (mục 8.4) chỉ còn cho dev / tenant chưa có IdP, và production mặc định tắt.

## 8.1 Tổng quan luồng

```
Hub                                           Control Plane
 │  POST /v1/discover {email}                  │  tra theo TÊN MIỀN → tổ chức + nơi đăng nhập
 │ ──────────────────────────────────────────► │
 │  POST /v1/auth/token {email,password,deviceId}   (thay IdP ở giai đoạn local)
 │ ──────────────────────────────────────────► │  → accessToken (12 giờ), gắn với thiết bị
 │  GET  /v1/entitlements   Authorization: Bearer <accessToken>
 │ ──────────────────────────────────────────► │  tính quyền của ĐÚNG người + máy → KÝ Ed25519
 │ ◄──────────────────────────────────────────  │
 │  verifyEntitlement(bundle, khoá nhúng sẵn, người, máy, policyVersion đã thấy)
 │  → áp quyền; làm mới định kỳ; quyền bị hạ → đóng tab / huỷ task
```

Khi có SSO thật, chỉ **bước 2 đổi**: token do IdP cấp (OIDC), Control Plane kiểm bằng JWKS của IdP. `discover` và `entitlements` giữ nguyên.

## 8.2 Quy ước chung

- Mọi phản hồi là JSON, kèm `Cache-Control: no-store`.
- Lỗi: `{ "error": { "code": "...", "message": "...", "fields"?: {…} } }`.

| `code` | HTTP | Khi nào |
|---|---|---|
| `invalid` | 400 | Sai định dạng (email, deviceId, JSON hỏng, body > 8 KB) |
| `unauthenticated` | 401 | Sai mật khẩu; thiếu / hết hạn / bị thu hồi token; người dùng bị vô hiệu hoá; tổ chức tạm ngưng |
| `forbidden` | 403 | Tài khoản không dùng Hub (quản trị nền tảng); **thiết bị đã bị thu hồi** |
| `rate_limited` | 429 | Quá giới hạn theo IP (xem 8.7) hoặc đăng nhập sai quá 5 lần / 15 phút |
| `unavailable` | 503 | Không kết nối được nhà cung cấp danh tính để kiểm token |
| `internal` | 500 | Lỗi hệ thống (chi tiết chỉ ghi log server) |

## 8.3 `POST /v1/discover`

Hub hỏi email thuộc tổ chức nào. **Chỉ tra theo tên miền**; kết quả **giống hệt** cho email có thật và không có thật (không dò được ai có tài khoản). Tổ chức tạm ngưng coi như không tìm thấy.

```http
POST /v1/discover
{ "email": "nv.nhansu@nexlab.tech" }
```
```json
{
  "apiVersion": 1,
  "found": true,
  "tenant": { "id": "ten_…", "name": "Nexlab", "slug": "nexlab", "productName": "Nexlab Hub", "accent": "#4f46e5" },
  "auth": { "method": "oidc", "issuer": "http://localhost:8081/realms/nexlab", "clientId": "nexlab-hub", "scopes": ["openid", "email", "profile"], "deviceHeader": "X-Device-Id" }
}
```
`auth.method` là `oidc` nếu tổ chức có IdP; `local-password` (kèm `tokenEndpoint`) chỉ khi chưa có IdP và máy chủ cho phép token cục bộ (dev); thiếu `auth` = tổ chức chưa cấu hình đăng nhập.

Không tìm thấy: `{ "apiVersion": 1, "found": false }`.

## 8.4 `POST /v1/auth/token` và `POST /v1/auth/revoke`

```http
POST /v1/auth/token
{ "email": "nv.nhansu@nexlab.tech", "password": "…", "deviceId": "7f3c9a1e-2b4d-4c6e-8a10-5d9e3b7c1f20", "deviceName": "Laptop của Hà" }
```
```json
{ "accessToken": "nxh_…", "tokenType": "Bearer", "expiresAt": "2026-10-31T04:00:00.000Z" }
```

- `deviceId`: **Hub tự sinh một lần khi cài** (UUID), 8–64 ký tự `A–Z a–z 0–9 _ -`, lưu trong kho an toàn của Hub. Gói quyền sau này **chỉ dùng được trên đúng thiết bị này**.
- Token có hạn **12 giờ**, DB chỉ lưu **băm**. Token Hub **không** dùng được làm cookie Admin Console và ngược lại (có test).
- Quản trị nền tảng (không thuộc tổ chức) → `403`.
- Thiết bị bị thu hồi → `403`, không cấp token mới.
- `POST /v1/auth/revoke` (kèm `Authorization: Bearer`) = đăng xuất: thu hồi token hiện tại.

## 8.5 `GET /v1/entitlements`

Kèm `Authorization: Bearer <token>` và `X-Device-Id: <deviceId>` (bắt buộc với token SSO; token `nxh_…` mang sẵn thiết bị). Trả **gói quyền đã ký** của đúng người và đúng thiết bị của token:

```json
{
  "payload": {
    "schemaVersion": 1,
    "issuer": "control-plane",
    "policyVersion": 7,
    "issuedAt": "2026-10-30T16:00:00.000Z",
    "expiresAt": "2026-10-31T16:00:00.000Z",
    "tenant": { "id": "ten_…", "name": "Nexlab", "slug": "nexlab", "branding": { "productName": "Nexlab Hub", "accent": "#4f46e5" } },
    "audience": { "userId": "usr_…", "deviceId": "7f3c9a1e-…" },
    "subject": {
      "email": "nv.nhansu@nexlab.tech", "label": "Nguyễn Thu Hà", "hubRole": "member",
      "departments": [{ "id": "dep_…", "name": "Nhân sự", "isManager": false }]
    },
    "mode": "enforce",
    "allowUnlistedApps": false,
    "apps": [
      { "catalogAppId": "app_…", "origin": "nexlab-app://hr", "label": "Nhân sự (mô phỏng)", "tags": ["hr", "pii"], "icon": "Users", "color": "#0ea5e9" }
    ],
    "roles": { "effective": { "label": "Nhân viên", "autonomyMax": "M1",
      "can": ["skill.edit", "skill.enable", "memory.view", "memory.approve", "memory.wipe"] } },
    "access": { "effective": { "origin:nexlab-app://hr": "M1", "origin:nexlab-app://timesheet": "M1" } },
    "assign": [{ "who": { "subject": "usr_…" }, "role": "effective" }]
  },
  "signature": { "alg": "Ed25519", "keyId": "3fa9c1e07b2d44a8", "sig": "base64…" }
}
```

Ý nghĩa các trường quan trọng:

| Trường | Ý nghĩa |
|---|---|
| `policyVersion` | Số tăng đơn điệu của tổ chức. Hub **từ chối** gói có số **thấp hơn** số đã từng chấp nhận (chống đưa lại gói cũ để lấy lại quyền đã bị hạ) |
| `expiresAt` | `issuedAt` + *Thời hạn gói quyền* của tổ chức (mặc định 24 giờ). Hết hạn → Hub chỉ cho **mở app**, **tắt agent** |
| `audience` | Người **và** thiết bị được dùng gói này |
| `apps` | **Chỉ** app người này được cấp (đã hợp các phòng, đã kẹp trần). Hub không biết "phòng ban" |
| `access.effective` | `"origin:<origin>"` → mức (`open · ask · M0 · M1 · M2`). Không có = không thấy app |
| `roles.effective.can` | Quyền dùng Hub theo vai trò ([02 · B](02-vai-tro-va-quyen.md)) — **không** có `app.add` / `app.remove` ở bất kỳ vai nào |
| `roles.effective.autonomyMax` | Trần tự chủ theo vai trò. Hub lấy `min(trần vai trò, mức app, lựa chọn người dùng)` |
| `allowUnlistedApps` | Luôn `false`: Hub **không** mở origin ngoài `apps` |

> Lưu ý: mức app (ví dụ `M1`) **chưa** bị kẹp bởi `autonomyMax` trong gói — Hub làm phép `min()`. Màn "Xem trước quyền" của Control Plane hiện mức theo phòng, chưa áp trần vai trò Hub.

## 8.6 Chữ ký và cách Hub kiểm

**Cách ký:** Ed25519 trên các byte UTF-8 của `"nexlab-entitlement-v1\n" + canonicalize(payload)`.

- `canonicalize`: JSON **chuẩn hoá** — khoá sắp xếp theo thứ tự chữ ở mọi cấp, không khoảng trắng, mảng giữ nguyên thứ tự; từ chối `undefined` / số không hữu hạn. Hub dùng **đúng hàm** `canonicalize` trong `src/lib/entitlement.ts`, **không** tự viết lại.
- Tiền tố `nexlab-entitlement-v1\n` ngăn dùng chữ ký này cho mục đích khác (domain separation).

**Hub kiểm bằng `verifyEntitlement(bundle, options)`** theo đúng thứ tự (kiểm chữ ký **trước** khi tin bất kỳ trường nào):

| Bước | Lỗi trả về | Ý nghĩa |
|---|---|---|
| 1. Cấu trúc bó | `malformed` | Thiếu `payload` / `signature`, hoặc `alg` khác Ed25519 |
| 2. Tìm khoá theo `keyId` | `unknown_key` | Khoá không nằm trong danh sách Hub tin cậy |
| 3. **Kiểm chữ ký** | `bad_signature` | Bị sửa dù một chữ, hoặc do khoá khác ký |
| 4. Kiểm nội dung bằng schema | `malformed` | Payload sai cấu trúc |
| 5. Người / máy / tổ chức | `wrong_audience`, `wrong_tenant` | Gói của người khác, máy khác, tổ chức khác |
| 6. Thời hạn | `expired`, `not_yet_valid` | Quá `expiresAt`; hoặc đồng hồ lệch hơn **5 phút** so với `issuedAt` |
| 7. Quay lui | `rollback` | `policyVersion` thấp hơn số Hub đã thấy |

```ts
import { verifyEntitlement } from "<đường dẫn>/entitlement";

const r = verifyEntitlement(bundle, {
  trustedKeys: [{ keyId: "3fa9c1e07b2d44a8", publicKey: "<SPKI DER base64 nhúng trong bản build>" }],
  expect: { userId, deviceId, tenantId },
  lastSeenPolicyVersion,            // lưu ở Hub, chỉ tăng
});
if (!r.ok) /* từ chối, giữ gói cũ còn hạn, ghi audit entitlement.rejected */;
else /* r.payload đã tin cậy: áp quyền */;
```

**Khi không kiểm được / hết hạn / mất mạng:** Hub **thu hẹp, không mở rộng**: dùng bản hợp lệ gần nhất còn hạn; không có thì chỉ mở app, tắt agent ([01 · 1.5](01-tong-quan.md)).

## 8.7 `GET /v1/keys` và quản lý khoá

`GET /v1/keys` → `{ "keys": [{ "keyId", "alg": "Ed25519", "publicKey": "<SPKI DER base64>" }] }`. **Chỉ tiện cho dev.** Ở production, Hub **nhúng** khoá công khai trong bản build; không tin khoá tải qua mạng (nếu không, kẻ chặn đường truyền thay khoá thì ký gói tuỳ ý).

| Môi trường | Nguồn khoá ký |
|---|---|
| Dev | Tự sinh ở `.data/dev-signing-key.pem` (đã `.gitignore`) khi chạy lần đầu |
| Production | Biến `CP_SIGNING_KEY_PEM` (PKCS#8 PEM, từ Secret Manager). **Thiếu → từ chối khởi động**, không tự sinh |
| Sau này | Cloud KMS (khoá không rời KMS) — giao diện `Signer` đã sẵn |

**Xoay khoá:** bản Hub mới nhúng **cả khoá cũ và mới**; Control Plane chuyển sang ký bằng khoá mới (`keyId` đổi); sau khi mọi Hub đã cập nhật thì bỏ khoá cũ. Hiện `trustedKeys()` chỉ trả khoá đang ký — mở rộng khi thực hiện xoay khoá đầu tiên.

**Giới hạn tần suất (theo IP, trong bộ nhớ một tiến trình):** `discover` 30/phút · `token` 20/phút · `entitlements` 60/phút · `revoke` 30/phút · `keys` 60/phút. Khi chạy nhiều instance phải chuyển sang kho dùng chung ([07](07-lo-trinh-va-gioi-han.md), giới hạn #4). Sau proxy / load balancer, IP lấy từ `X-Forwarded-For` — chỉ tin khi đứng sau proxy của bạn.

## 8.8 Thử bằng tay

```bash
# 1) tổ chức của email
curl -s localhost:4000/v1/discover -H 'content-type: application/json' -d '{"email":"nv.nhansu@nexlab.tech"}'

# 2) lấy token (mật khẩu tài khoản mẫu: hằng DEV_PASSWORD trong src/server/seed.ts)
curl -s localhost:4000/v1/auth/token -H 'content-type: application/json' \
  -d '{"email":"nv.nhansu@nexlab.tech","password":"<DEV_PASSWORD>","deviceId":"my-laptop-0001"}'

# 3) lấy gói quyền đã ký
curl -s localhost:4000/v1/entitlements -H 'authorization: Bearer <accessToken>'

# 4) khoá công khai (dev)
curl -s localhost:4000/v1/keys
```

## 8.9 Test

`test/entitlements.test.ts` (24 test): discover (không lộ email có thật; tạm ngưng), token (sai mật khẩu, deviceId, quản trị nền tảng, **token Hub ≠ cookie console**), nội dung gói (đúng app/mức/quyền/người/máy; hợp hai phòng; **không lọt dữ liệu tenant khác**; `policyVersion` tăng), **chữ ký** (sửa 1 chữ, nâng mức, thêm `app.add`, đổi chữ ký, khoá lạ), người/máy/tổ chức sai, quay lui, hết hạn / lệch đồng hồ, cấu trúc sai, thu hồi (đăng xuất, vô hiệu hoá người dùng, thu hồi thiết bị, tạm ngưng tổ chức), giới hạn tần suất.
