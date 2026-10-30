# 6. Dữ liệu, kiến trúc mã & mở rộng

## 6.1 Công nghệ

| Phần | Lựa chọn | Ghi chú |
|---|---|---|
| Khung | Next.js 16 (App Router, Turbopack), React 19, TypeScript strict | Đọc `node_modules/next/dist/docs/` — Next 16 có thay đổi so với bản cũ (`params` / `searchParams` / `cookies()` đều là Promise) |
| CSDL | Postgres 16 (Docker, cổng **5433**), driver `pg`, **không ORM** | SQL tường minh; migration bằng mảng trong `src/server/schema.ts` |
| Giao diện | Tailwind CSS v4, `lucide-react`, bộ component tự viết | Không dùng thư viện UI ngoài |
| Kiểm dữ liệu | `zod` v4 | |
| Test | Vitest, chạy trên **Postgres thật** (schema tạm) | |
| Mật khẩu | `scrypt` của Node (`node:crypto`) | |

## 6.2 Bảng dữ liệu

Mọi bảng nghiệp vụ có `tenant_id` (trực tiếp hoặc qua bảng cha). Khoá chính là chuỗi có tiền tố loại đối tượng (`ten_…`, `usr_…`, `dep_…`, `app_…`).

| Bảng | Cột chính | Ràng buộc đáng chú ý |
|---|---|---|
| `tenants` | `id, name, slug (UNIQUE), domain (UNIQUE), status (active/suspended), policy_version, entitlement_ttl_hours (1–168), product_name, accent` | `policy_version` tăng mỗi thay đổi ảnh hưởng quyền |
| `users` | `id, tenant_id, email, display_name, password_hash, admin_role (none/tenant_admin/platform_admin), hub_role (viewer/member/lead/admin), status (active/disabled), seeded, last_login_at` | Email duy nhất không phân biệt hoa thường. `CHECK`: `platform_admin` ⇔ `tenant_id` rỗng |
| `departments` | `id, tenant_id, name, description, manager_user_id` | `UNIQUE(tenant_id, name)`; trigger: trưởng phòng cùng tenant |
| `memberships` | `user_id, department_id, source (manual/idp)` | Trigger: người dùng và phòng **cùng tenant**. `source='idp'` dành cho đồng bộ SCIM sau này (không gỡ tay được) |
| `catalog_apps` | `id, tenant_id, name, origin, icon, color, tags[], max_level, status` | `UNIQUE(tenant_id, origin)` |
| `department_apps` | `department_id, app_id, level, updated_by, updated_at` | Trigger: cùng tenant, `level` ≤ `max_level` của app. **Không có hàng = `none`** |
| `sessions` | `id` (= băm SHA-256 của token), `user_id, kind (console/hub), device_id, expires_at` | `console` = cookie Admin Console; `hub` = bearer token của Hub. Hai loại **không dùng thay nhau**. Xoá khi vô hiệu hoá người dùng / tạm ngưng tenant / đặt lại mật khẩu |
| `identity_providers` | `tenant_id (PK), issuer (UNIQUE), client_id, groups_claim, sync_groups, jit_provisioning` | Tối đa **một** IdP mỗi tenant; chỉ quản trị nền tảng ghi |
| `devices` | `user_id, id, name, first_seen, last_seen, revoked_at` (khoá chính `(user_id, id)`) | Thiết bị do Hub tự khai (`deviceId`); `revoked_at` ≠ rỗng → không cấp token / gói quyền |
| `audit_log` | `id, ts, tenant_id, dept_id, actor_user_id, actor_email, action, target_type, target_id, summary, before, after (jsonb)` | **Không có khoá ngoại** (xoá tenant/người không làm mất dấu); trigger **chặn UPDATE / DELETE / TRUNCATE** |
| `schema_migrations` | `version, name, applied_at` | Quản lý migration |

### Mã hành động trong nhật ký (`audit_log.action`)

`tenant.create|update|delete|settings|idp_set|idp_remove` · `user.create|update|delete|reset_password|change_password|sso_link|sso_create` · `department.create|update|delete|manager_cleared` · `membership.add|remove|sso_sync` · `app.create|update|delete` · `access.set|clamp` · `seed`.

## 6.3 Cấu trúc thư mục

```
docs/                 tài liệu này
scripts/              seed.ts, reset.ts
test/                 rules.test.ts, entitlements.test.ts (Postgres thật), docs.test.ts (kiểm link tài liệu)
src/lib/              HÀM THUẦN, dùng chung được với Hub về sau
  entitlement.ts        định dạng gói quyền, canonicalize, verifyEntitlement (Hub sẽ nhập file này)
  hub-permissions.ts    danh mục 15 quyền Hub, mặc định theo 4 vai trò, trần tự chủ
  levels.ts             thang mức, nhãn, kẹp trần, hợp mức
  effective.ts          computeEffective — quyền hiệu lực của MỘT người (lõi của gói quyền gửi Hub)
  origin.ts             chuẩn hoá origin app
  validators.ts         schema zod, danh sách vai trò, biểu tượng
  use-submit-action.ts  gửi form tới Server Action mà không bị React 19 xoá ô đã nhập
src/server/           MỌI LUẬT NẰM Ở ĐÂY (không import UI)
  db.ts schema.ts       kết nối, giao dịch `tx`, migration + khoá tư vấn
  actor.ts              Actor + requirePlatform / requireTenantAdmin / canManageDept
  auth.ts session.ts    đăng nhập, phiên, cookie, `runAction`, `guard`
  audit.ts              writeAudit, bumpPolicy
  services/*            tenants, users, departments, apps, access, audit-read, dashboard
  signer.ts             ký Ed25519 (LocalKeySigner; chỗ cắm Cloud KMS)
  http.ts rate-limit.ts helper route handler, giới hạn tần suất theo IP
  docs.ts               đọc + render docs/*.md cho trang Hướng dẫn
  oidc.ts devices.ts    kiểm token OIDC (JWKS, discovery), đăng ký thiết bị
  services/sso.ts       liên kết người dùng, JIT, đồng bộ nhóm; identity-providers.ts: cấu hình IdP
  seed-data.ts seed.ts  dữ liệu mẫu dev (dùng chung với sinh realm Keycloak)
src/app/              TRANG + Server Action (mỏng: gọi service)
  actions/*             Server Action (mỗi cái mở đầu bằng requireActor)
  (console)/*           các màn quản trị (gồm help/ — trang Hướng dẫn)
  v1/*                  API cho Hub: discover, auth/token, auth/revoke, entitlements, keys
  login/                đăng nhập
src/components/ui/    bộ component (primitives, form, toast)
```

**Quy ước:** `src/lib` không phụ thuộc server hay UI. `src/server` không biết gì về React. `src/app` không chứa luật quyền — chỉ gọi service và hiển thị.

## 6.4 Chạy & kiểm thử

```bash
docker compose up -d     # Postgres
npm install
npm run dev              # http://localhost:4000 (tự migrate + seed)
npm run keycloak:gen      # sinh keycloak/realms/*.json từ dữ liệu mẫu
npm run hub:login -- --email nv.nhansu@nexlab.tech   # mô phỏng Hub: SSO + PKCE + nhận gói quyền
npm test                 # 93 test: luật (28), API+chữ ký (24), SSO (29 + 6 Keycloak thật), tài liệu (6)
npm run typecheck
npm run build            # kiểm bản production
npm run db:reset         # xoá sạch DB dev + nạp lại mẫu
```

Biến môi trường:

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `DATABASE_URL` | `postgres://nexlab:nexlab_dev@localhost:5433/nexlab_cp` | Kết nối DB (production lấy từ Secret Manager) |
| `CP_DB_SCHEMA` | (không) | Dùng schema riêng — test dùng để cô lập, rồi xoá |
| `KEYCLOAK_URL` | `http://localhost:8081` | Địa chỉ Keycloak dùng khi sinh realm và seed IdP |
| `CP_SEED_IDP` | (bật; Vitest đặt `0`) | `0` = seed không khai báo IdP (test không cần Keycloak) |
| `CP_LOCAL_HUB_TOKENS` | dev: bật; production: tắt | Cho phép token mật khẩu cục bộ cho Hub (chỉ dev / tenant chưa có IdP) |
| `CP_SIGNING_KEY_PEM` | (dev: tự sinh `.data/dev-signing-key.pem`) | Khoá ký Ed25519 PKCS#8 PEM. **Bắt buộc ở production**; thiếu thì không khởi động |
| `CP_AUTO_SEED` | (tắt; bật ở `.env.development`) | Tự nạp dữ liệu mẫu khi DB trống |
| `CP_DEV_LOGIN` | (tắt; bật ở `.env.development`) | Nút "Đăng nhập nhanh" cho tài khoản `seeded` |
| `CP_ALLOW_DEV_ORIGINS` | (tắt; bật ở `.env.development`) | Cho phép `http://localhost` trong danh mục (lab) |

**Ba biến cuối KHÔNG được bật ở production.** Next chỉ nạp `.env.development` khi chạy `npm run dev`.

## 6.5 Cách mở rộng

### Thêm một migration
Thêm một phần tử **cuối mảng** `MIGRATIONS` trong `src/server/schema.ts` (`version` tăng dần, **không sửa migration cũ**). Tự chạy khi server khởi động, có khoá tư vấn nên nhiều instance không đua nhau.

### Thêm một thao tác quản trị mới (ví dụ "đổi tên tag hàng loạt")
1. Viết hàm trong `src/server/services/…`: nhận `actor` đầu tiên → kiểm quyền → `tx(...)` → ghi → `writeAudit` (+ `bumpPolicy`).
2. Thêm test **âm** vào `test/rules.test.ts` (không đủ quyền → `forbidden`; tenant khác → `not_found`).
3. Thêm Server Action trong `src/app/actions/…` (`requireActor` trong `runAction`).
4. Thêm UI (dùng `FormDialog` + các `*Field`) và mục menu nếu cần.
5. Cập nhật [02](02-vai-tro-va-quyen.md) (ma trận) và [03](03-luat-chong-leo-quyen.md) (nếu thêm luật).

### Thêm một quyền Hub (tầng 1)
Danh mục quyền là **đóng**: thêm quyền = đổi mã + test. Cập nhật bảng ở [02 · B.2](02-vai-tro-va-quyen.md) cùng với `PERMS` trong Hub và bản đồ kênh IPC → quyền (`CHANNEL_ACCESS`).

### Thêm màn hình
Tạo `src/app/(console)/<tên>/page.tsx`; dùng `requireActor()` + `guard(...)` (đưa người không đủ quyền về trang chủ kèm thông báo); thêm mục vào `src/app/(console)/layout.tsx`.

## 6.6 Quyết định kỹ thuật đáng nhớ

| Quyết định | Lý do |
|---|---|
| Không dùng ORM, SQL tường minh | Luật phân quyền phải đọc được từng câu truy vấn; dễ rà soát tenant |
| Trigger DB ngoài lớp dịch vụ | Phòng thủ chiều sâu: lỗi một chỗ trong mã không làm lẫn dữ liệu tenant |
| Nhật ký không có khoá ngoại + chặn sửa/xoá | Xoá người / tenant không được làm mất dấu vết |
| Actor dựng lại từ DB **mỗi request** | Đổi vai trò / vô hiệu hoá có hiệu lực ngay, không phải chờ hết phiên |
| `useSubmitAction` thay `<form action>` | React 19 tự reset form sau action → mất dữ liệu khi báo lỗi |
| Ma trận quyền gọi Server Action trực tiếp (không `<form>`) | Đổi ô là lưu ngay; vẫn tự kiểm quyền bên trong |
| `computeEffective` là hàm thuần ở `src/lib` | Màn "Xem trước" và gói quyền gửi Hub dùng **cùng một phép tính**, không thể lệch nhau |
