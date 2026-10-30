# 3. Luật chống leo quyền

Mục tiêu: **trưởng phòng / quản trị không thể "lấy bừa"**, không thể tự cấp quyền cho mình, và dữ liệu giữa các tổ chức không lẫn nhau. Các luật được cưỡng chế **ở phía server** (`src/server/services`); giao diện chỉ ẩn nút cho gọn — Server Action gọi được trực tiếp bằng POST nên không bao giờ tin giao diện.

Test luật quản trị nằm ở `test/rules.test.ts` (28 test) luật API/gói quyền ở `test/entitlements.test.ts` (24 test) và luật SSO ở `test/sso.test.ts` (29 test) + `test/keycloak.integration.test.ts` (6 test, Keycloak thật); tất cả chạy trên Postgres thật.

## 3.1 Danh sách luật

| Mã | Luật | Cưỡng chế ở đâu | Test (mô tả) |
|---|---|---|---|
| **R1** | **Cô lập tenant.** Tenant lấy từ **phiên đăng nhập**, không từ form/URL. Mọi truy vấn ràng `tenant_id`. Biết id của tenant khác cũng không đọc/sửa được | Mọi service: `... WHERE id = $1 AND tenant_id = $2`; `Actor.tenantId` dựng từ phiên | "quản trị tenant A không đọc/sửa được gì của tenant B dù biết id" |
| R1b | **Lớp phòng thủ thứ hai ở DB.** Trigger chặn người dùng ↔ phòng khác tenant, phòng ↔ app khác tenant, trưởng phòng khác tenant | Trigger Postgres (`schema.ts`) | "DB chặn dữ liệu chéo tenant dù lớp dịch vụ bị bỏ qua" |
| **R2** | **Danh mục đóng.** Phòng chỉ được cấp app **đã có trong danh mục** của tenant; mức nằm trong thang cho phép (M3 chưa mở) và **không vượt trần** của app | `setDepartmentAppLevel`; trigger `department_apps_guard` | "mức vượt trần bị từ chối; mức không có trong thang bị từ chối" |
| R2b | **Trần kẹp ngược.** Hạ trần app thì mức đã cấp cho các phòng bị hạ theo, có nhật ký `access.clamp` | `updateApp` | "hạ trần app thì kẹp mức của các phòng xuống và ghi audit" |
| R2c | **App tắt không cấp thêm được**, nhưng thu hồi vẫn được | `setDepartmentAppLevel` | "app bị tắt không cấp thêm được, nhưng thu hồi vẫn được" |
| **R3** | **Trưởng phòng không chạm thành viên / danh mục / người dùng / phòng khác.** Chỉ quản trị tổ chức làm được. (Nếu trưởng phòng sửa được thành viên thì họ tự kéo người vào phòng để mở rộng quyền) | `requireTenantAdmin` ở mọi hàm quản trị; `canManageDept` ở ma trận | "mọi thao tác quản trị tổ chức đều bị từ chối với trưởng phòng", "trưởng phòng không sửa được phòng khác" |
| **R4** | **Không tự nâng quyền.** Không ai tự đổi vai trò / trạng thái / xoá chính mình. Luôn còn ≥ 1 quản trị đang hoạt động (khoá dòng quản trị để hai người hạ nhau cùng lúc không làm tổ chức hết quản trị) | `updateUser`, `deleteUser` | "quản trị không tự đổi vai trò / trạng thái / xoá chính mình", "quản trị thứ hai hạ quản trị gốc được…" |
| R5 | **Trần lồng nhau.** Quyền hiệu lực = `min(trần app, mức phòng, …)`; người nhiều phòng lấy **max** các phòng rồi mới kẹp trần | `computeEffective` (`src/lib/effective.ts`, hàm thuần) | "người thuộc hai phòng được hợp quyền (lấy mức cao nhất), kèm lý do" |
| **R6** | **Mọi thay đổi → nhật ký + tăng `policy_version`**, trong **cùng một giao dịch** với thay đổi. Nhật ký **chỉ-thêm** (trigger chặn UPDATE / DELETE / TRUNCATE) | `writeAudit`, `bumpPolicy` gọi trong `tx` | "nhật ký chỉ-thêm: UPDATE / DELETE / TRUNCATE đều bị chặn", "cấp / đổi / thu hồi … có audit và tăng policy_version" |
| R7 | **Trạng thái người dùng thắng.** Người bị vô hiệu hoá: mọi phiên bị thu hồi ngay, không đăng nhập được, quyền hiệu lực rỗng. Tenant tạm ngưng: tất cả người của tenant mất phiên | `updateUser`, `updateTenant`, `authenticate`, `loadActor` | "người dùng bị vô hiệu hoá: đá khỏi phiên…", "tenant bị tạm ngưng thì mọi người… mất phiên" |
| R8 | **Hub không ghi được cấu hình quyền.** API cho Hub chỉ **đọc** (`discover`, `auth/token`, `auth/revoke`, `entitlements`, `keys`); mọi API **ghi** cấu hình là của Admin Console và cần phiên Admin Console. (API nhận audit từ Hub chưa làm) | Route handler `src/app/v1/*` chỉ có đọc / cấp token | "token Hub KHÔNG dùng được làm phiên Admin Console và ngược lại" |
| R9 | **Gói quyền không giả mạo được.** Ký Ed25519; Hub kiểm chữ ký TRƯỚC khi tin bất kỳ trường nào; gắn với đúng người + thiết bị; có hạn; chống quay lui `policyVersion` | `signEntitlement` (server), `verifyEntitlement` (Hub) | "H1 sửa MỘT chữ…", "H2…", "H3…", "H4…" trong `test/entitlements.test.ts` |
| R10 | **Chỉ tin IdP đã khai báo, và chỉ quản trị nền tảng được khai báo.** Issuer trong token chỉ để tìm cấu hình; JWKS luôn tải từ địa chỉ cấu hình (chống SSRF / giả issuer); discovery phải khai đúng issuer; chỉ thuật toán bất đối xứng; token phải cấp cho client của Hub | `oidc.ts`, `identity-providers.ts` | "từ chối: chữ ký của khoá khác…", "discovery sai…", "quản trị tổ chức / trưởng phòng không khai báo được IdP" |
| R11 | **Không chiếm được tài khoản qua SSO.** Định danh là (issuer, sub); liên kết theo email chỉ khi IdP xác nhận email, chỉ trong đúng tenant, và chỉ nếu tài khoản chưa liên kết danh tính khác; người tạo qua JIT luôn là nhân viên, không quyền quản trị, mật khẩu không đoán được | `sso.ts` | nhóm test "liên kết tài khoản", "JIT — nhân viên mới" |
| R12 | **Ép SSO.** Tenant có IdP không còn token mật khẩu (kể cả token cũ); production mặc định tắt token mật khẩu | `entitlements.ts` | "tenant có IdP: không cấp token mật khẩu…", "production mặc định tắt…" |
| R13 | **Đồng bộ nhóm chỉ thu hẹp khi thiếu dữ liệu**: thiếu claim nhóm = không thuộc nhóm nào; chỉ đụng thành viên nguồn `idp`, không đụng thành viên thêm tay; người bị bỏ khỏi nhóm mất luôn chức trưởng phòng | `syncGroupMemberships` | nhóm test "đồng bộ nhóm IdP → phòng ban" |
| R9b | **Thu hồi có hiệu lực ngay ở API Hub:** đăng xuất, vô hiệu hoá người dùng, thu hồi thiết bị, tạm ngưng tổ chức → token Hub không còn dùng được | `resolveHubToken` | nhóm test "thu hồi" |

## 3.2 Các lớp bảo vệ khác (đã làm)

| Chủ đề | Cách làm |
|---|---|
| Mật khẩu | `scrypt` (N=16384, r=8, p=1) với muối ngẫu nhiên; định dạng tự mô tả để tăng độ khó sau này |
| Phiên | Cookie `httpOnly`, `sameSite=lax`, `secure` ở production; DB chỉ lưu **băm SHA-256** của token; hạn **8 giờ** |
| Chống dò mật khẩu | Khoá tạm **15 phút** sau **5 lần** sai theo email; thông báo lỗi giống hệt cho "email lạ" và "sai mật khẩu"; luôn tốn thời gian băm như nhau |
| Tạo người dùng | Email phải thuộc tên miền của tenant; mật khẩu ≥ 8 ký tự gồm chữ và số; mật khẩu tạm sinh ngẫu nhiên, **chỉ hiển thị một lần** |
| Origin của app | Chỉ `https://` (và `nexlab-app://`); chặn IP, `.local`, `.internal`, `localhost` (trừ chế độ lab); bỏ path/query; trùng origin bị từ chối |
| Chống mất dữ liệu | Xoá tenant phải gõ lại mã (slug); đổi nhãn "Vô hiệu hoá" thay vì xoá được gợi ý |
| CSRF | Server Action của Next.js kiểm `Origin` với `Host`; cookie `sameSite=lax` |

## 3.3 Quy tắc khi thêm tính năng mới

1. Hàm dịch vụ mới **phải** nhận `actor` làm đối số đầu và gọi `requireTenantAdmin` / `requirePlatform` / `canManageDept` **trước** khi chạm DB.
2. Mọi truy vấn trên bảng có `tenant_id` phải ràng `tenant_id = $actor.tenantId`.
3. Mọi ghi phải nằm trong `tx(...)`, gọi `writeAudit` và (nếu đổi quyền) `bumpPolicy`.
4. Server Action mới phải mở đầu bằng `requireActor()` bên trong `runAction`.
5. Viết **test âm** trong `test/rules.test.ts`: người không đủ quyền gọi → `forbidden`; người tenant khác → `not_found`.
