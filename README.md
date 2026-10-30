# Nexlab Control Plane

Bảng quản trị **tenant → phòng ban → danh mục app → người dùng** cho Nexlab Hub. Đây là dự án **riêng** (không nằm trong repo `Demo-Chromium-Smart-Hub`), chạy local trước, lên Google Cloud sau.

**Tài liệu đầy đủ: [docs/README.md](docs/README.md)** (khái niệm, vai trò & 20 quyền, luật chống leo quyền, hướng dẫn vận hành, chính sách thêm app, dữ liệu & mã nguồn, lộ trình & giới hạn).

Kế hoạch tổng thể: `Demo-Chromium-Smart-Hub/docs/superpowers/plans/2026-10-30-control-plane-phan-quyen-tenant-tasks.md` (mốc M2, M3, M5 là phần đã làm ở đây). Phần **RBAC trong Hub** (Hub đăng nhập + áp quyền) làm sau khi app này xong.

## Chạy

```bash
docker compose up -d     # Postgres 16 (127.0.0.1:5433) + Keycloak 26 (http://localhost:8081, ~40 giây lần đầu)
npm install
npm run dev              # http://localhost:4000
```

Lần đầu `npm run dev` tự tạo bảng (migration) và nạp dữ liệu mẫu (`.env.development` có `CP_AUTO_SEED=1`).
Trang đăng nhập ở dev có nút **«Đăng nhập nhanh»** cho từng tài khoản mẫu. Mật khẩu chung của tài khoản mẫu là hằng `DEV_PASSWORD` trong [src/server/seed.ts](src/server/seed.ts).

| Lệnh | Việc |
|---|---|
| `npm run db:reset` | Xoá sạch DB dev và nạp lại dữ liệu mẫu |
| `npm run db:seed` | Nạp mẫu nếu DB còn trống |
| `npm test` | 93 test: luật quản trị (28), API + chữ ký gói quyền (24), SSO (29 với IdP giả + 6 với Keycloak thật, tự bỏ qua nếu Keycloak không chạy), tài liệu (6). Cần Postgres; mỗi lần chạy dùng một schema tạm rồi xoá |
| `npm run hub:login -- --email nv.nhansu@nexlab.tech` | Mô phỏng Hub: mở trình duyệt đăng nhập Keycloak (PKCE) → nhận gói quyền ký → in kết quả |
| `npm run keycloak:gen` | Sinh lại `keycloak/realms/*.json` từ dữ liệu mẫu |
| `npm run typecheck` | `tsc --noEmit` |

Biến môi trường: `DATABASE_URL` (mặc định trỏ vào container ở trên), `CP_AUTO_SEED`, `CP_DEV_LOGIN`, `CP_ALLOW_DEV_ORIGINS` — cả ba chỉ bật ở `.env.development`, **không bao giờ bật ở production**.

## Tài khoản mẫu (tenant «Nexlab», email `@nexlab.tech`)

| Email | Vai trò | Thấy gì |
|---|---|---|
| `platform@nexlab.tech` | Quản trị nền tảng | Tổ chức (tenant), nhật ký vòng đời tenant. KHÔNG đọc được dữ liệu bên trong tenant |
| `admin@nexlab.tech` | Quản trị tổ chức | Toàn bộ: người dùng, phòng ban, danh mục app, ma trận quyền, xem trước, nhật ký, cài đặt |
| `truongphong.nhansu@` / `.ketoan@` / `.kinhdoanh@` | Trưởng phòng | CHỈ phòng của mình: chỉnh app của phòng (trong danh mục, ≤ trần), xem trước thành viên, nhật ký phòng |
| `nv.nhansu@` / `nv.ketoan@` / `nv.kinhdoanh@` | Nhân viên | «Tài khoản của tôi»: phòng và app mình được cấp |
| `kiemnhiem@` | Nhân viên 2 phòng (Kinh doanh + CNTT) | Hợp quyền: mức cao nhất của các phòng |
| `khach.xem@` | Chỉ đọc | Như nhân viên, vai trò Hub `viewer` |

Tenant thứ hai **«Bệnh viện Demo B»** (`admin@benhvien-b.test`, `bacsi@benhvien-b.test`) dùng để thử cô lập chéo tenant.

## Luật cốt lõi (đều có test trong `test/rules.test.ts`)

- **R1 Cô lập tenant**: tenant luôn lấy từ phiên đăng nhập, không từ dữ liệu form/URL. Mọi truy vấn ràng `tenant_id`; DB còn có trigger chặn dữ liệu chéo tenant.
- **R2 Danh mục đóng**: trưởng phòng chỉ chọn app *đã có trong danh mục* của tổ chức, mức ≤ trần của app, trong thang `none · open · ask · M0 · M1 · M2` (M3 chưa mở).
- **R3 Trưởng phòng không chạm thành viên / danh mục / người dùng**: chỉ quản trị tổ chức làm được.
- **R4 Không tự nâng quyền**: không ai tự đổi vai trò/trạng thái/xoá chính mình; luôn còn ít nhất một quản trị.
- **R6 Mọi thay đổi → nhật ký chỉ-thêm (trigger chặn sửa/xoá) và tăng `policy_version`** của tenant.
- Hạ trần app sẽ tự **kẹp** mức đã cấp xuống (lớp dưới chỉ thu hẹp). Người thuộc nhiều phòng được **hợp quyền** (mức cao nhất, vẫn ≤ trần).

## Cấu trúc

```
src/lib/        levels, effective (computeEffective — lõi PolicyCompiler sau này), origin, validators   (hàm thuần)
src/server/     db (Postgres + migration), schema, auth/session, actor, audit, services/*               (mọi luật nằm ở đây)
src/app/        trang Next.js 16 + Server Actions (mỏng: gọi service)
test/           rules.test.ts  (Postgres thật)
```

Mọi Server Action tự gọi `requireActor()` — Server Action gọi được trực tiếp bằng POST nên không tin giao diện. Trang chỉ ẩn nút; quyền thật nằm trong `src/server/services`.

## API cho Hub (đã làm)

`POST /v1/discover` · `POST /v1/auth/token` · `POST /v1/auth/revoke` · `GET /v1/entitlements` (gói quyền **ký Ed25519**) · `GET /v1/keys`. Xem [docs/08-api-cho-hub.md](docs/08-api-cho-hub.md). Trang **Hướng dẫn** trong Admin Console hiển thị toàn bộ `docs/` theo vai trò.

## Đăng nhập SSO với Keycloak (đã làm)

Mỗi tenant một realm Keycloak (`nexlab`, `benhvien-b`). Hub đăng nhập qua OIDC + PKCE; Control Plane kiểm token bằng JWKS, liên kết người dùng, tự tạo tài khoản lần đầu (JIT) và đồng bộ **nhóm IdP → phòng ban**. Tenant đã có IdP bị **ép SSO** (không còn token mật khẩu cho Hub). Chi tiết: [docs/09-dang-nhap-sso-keycloak.md](docs/09-dang-nhap-sso-keycloak.md). Tài khoản `nguoimoi@nexlab.tech` chỉ có ở Keycloak để thử luồng nhân viên mới.

## Còn thiếu so với kế hoạch

- Hub nối vào API trên và cưỡng chế quyền (RBAC trong Hub — làm sau). `npm run hub:login` là mẫu cho phần đăng nhập.
- Đăng nhập **Admin Console** bằng SSO (hiện vẫn email + mật khẩu cục bộ, scrypt). Phía **Hub** đã có SSO với Keycloak.
- Triển khai Google Cloud (Cloud Run + Cloud SQL + KMS) — plan M7.
- Luồng xin quyền → duyệt, SCIM, maker-checker — plan M8.
