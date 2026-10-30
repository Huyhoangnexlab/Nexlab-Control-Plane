# 7. Lộ trình & giới hạn đã biết

## 7.1 Đã làm / chưa làm (tính tới 30/10/2026)

| Hạng mục | Trạng thái | Ghi chú |
|---|---|---|
| Dữ liệu tenant → phòng → app → người, migration, trigger | **ĐÃ LÀM** | |
| Luật chống leo quyền R1–R4, R6, R7 (+ trần kẹp) | **ĐÃ LÀM** | 28 test |
| Admin Console CRUD (người dùng, phòng, danh mục, ma trận, xem trước, nhật ký, cài đặt, tổ chức) | **ĐÃ LÀM** | Tiếng Việt |
| Đăng nhập bằng email + mật khẩu cục bộ | **ĐÃ LÀM** | Tạm thời, thay bằng SSO |
| API cho Hub: `discover`, `auth/token`, `auth/revoke`, `entitlements` (**ký Ed25519**), `keys`; hàm kiểm `verifyEntitlement`; bảng thiết bị | **ĐÃ LÀM** | Mốc M3.1–M3.4, 24 test ([08](08-api-cho-hub.md)). Token Hub hiện do Control Plane cấp (thay IdP) |
| Trang **Hướng dẫn** trong Admin Console (render `docs/`, «Dành cho bạn» theo vai trò, bảng quyền sinh từ mã) | **ĐÃ LÀM** | 6 test kiểm link tài liệu |
| Hub đăng nhập (OIDC) + áp quyền (tầng 1, 20 quyền) | **ĐÃ LÀM** (30/10) | `CHANNEL_ACCESS` + `ipc.handle` ở Main, registry đồng bộ theo gói, chạy thật với Keycloak. Xem `docs/rbac/rbac-hub-trien-khai-2026-10-30.md` trong repo Hub; còn thiếu: dữ liệu theo người trên máy (M6), API nhận audit, UI xin quyền |
| Cấu hình chế độ thêm app theo tenant (5) | CHƯA LÀM | Cần khi Hub bắt đầu áp quyền |
| Màn tenant admin bật/tắt từng quyền cho từng vai trò Hub | CHƯA LÀM | Hiện `hub_role` chỉ là nhãn |
| Đăng nhập SSO với **Keycloak** (OIDC + PKCE): kiểm token JWKS, liên kết người dùng, JIT, đồng bộ nhóm → phòng ban, ép SSO | **ĐÃ LÀM** | 35 test (6 với Keycloak thật) + chạy thật bằng trình duyệt ([09](09-dang-nhap-sso-keycloak.md)). Chưa thử IdP khác (Entra, Google) |
| Hub: `IdentityService` (PKCE, refresh token, làm mới gói quyền) | **ĐÃ LÀM** (30/10) | `src/main/access/` trong repo Hub; 58 test + chạy thật (đăng nhập, khoá, thu hồi, đổi quyền ~12 s, đăng xuất) |
| Đăng nhập **Admin Console** bằng SSO | CHƯA LÀM | Hiện vẫn mật khẩu cục bộ |
| Triển khai Google Cloud | CHƯA LÀM | Mốc M7 — mọi lệnh tạo tài nguyên phải được duyệt từng lần |
| Luồng xin quyền → duyệt, hết hạn, rà soát định kỳ, SCIM, maker-checker | CHƯA LÀM | Mốc M8 |

## 7.2 Giới hạn & rủi ro đã biết (nói thẳng)

| # | Giới hạn | Hệ quả | Hướng xử lý |
|---|---|---|---|
| 1 | **Quản trị nền tảng không đặt lại mật khẩu / tạo thêm quản trị cho tenant đã tạo** | Quản trị viên duy nhất của tenant mất mật khẩu → bị khoá, phải sửa DB | Tài khoản khẩn cấp (break-glass) có nhật ký riêng và cảnh báo (M8) |
| 2 | Không gửi email | Mật khẩu tạm phải chuyển tay | Luồng "đặt mật khẩu qua liên kết" hoặc SSO |
| 3 | Admin Console vẫn đăng nhập mật khẩu cục bộ, **chưa MFA** (Hub thì đã có đường SSO) | Quản trị viên chưa hưởng MFA / chính sách của IdP | Đăng nhập Admin Console bằng OIDC |
| 4 | Khoá chống dò mật khẩu lưu **trong bộ nhớ từng tiến trình** | Nhiều instance (Cloud Run) không chia sẻ bộ đếm | Chuyển sang DB / Redis khi lên cloud |
| 5 | Chưa bật **Postgres Row-Level Security** | Cô lập tenant dựa vào lớp dịch vụ + trigger, chưa có lớp thứ ba ở DB | Quyết định K9 trong plan: bật khi lên staging |
| 6 | **Trưởng phòng không thêm / bỏ thành viên** (cố ý) | Chuyển người giữa phòng luôn phải qua quản trị tổ chức — có thể thành nút thắt | Luồng đề xuất & duyệt (M8), không nới quyền trưởng phòng |
| 7 | **Chuyển phòng không có thời gian ân hạn** | Đổi phòng là mất app cũ ngay | Ân hạn 7 ngày + thông báo khi có luồng vòng đời (M8) |
| 8 | `hub_role` và 20 quyền tầng 1 **Hub đã cưỡng chế ở tầng IPC (Main)**; UI chỉ ẩn cho gọn. Dữ liệu cá nhân (bộ nhớ agent, chat, skill, cookie app) **đã tách theo người** (30/10, M6): thư mục `users/<key>/` + partition riêng, đổi người thì Hub khởi động lại | Cách ly **cấp ứng dụng**: cùng một tài khoản Windows, khoá DB bọc DPAPI chung → người đọc được hồ sơ Windows vẫn đọc được | Mỗi người một tài khoản Windows, hoặc khoá dữ liệu dẫn xuất từ bí mật phía máy chủ |
| 14 | Vô hiệu hoá ở **IdP** không tự báo cho Control Plane; token đã cấp sống thêm tới 5 phút (Keycloak dev) và tới khi Hub đăng nhập lại | Cửa sổ thu hồi ngắn | SCIM / sự kiện thu hồi (CAEP) ở M8; cho tới đó nghỉ việc nên vô hiệu hoá cả hai phía |
| 15 | Bộ nhớ đệm discovery / JWKS theo từng tiến trình (10 phút) | Xoay khoá ở IdP có độ trễ ngắn | Chuyển sang kho dùng chung khi nhiều instance |
| 13 | Token Hub hiện do Control Plane tự cấp bằng email + mật khẩu cục bộ, chưa MFA; chưa có API nhận audit từ Hub; chưa có màn quản lý / thu hồi thiết bị (chỉ cột `revoked_at` trong DB) | Chỉ phù hợp dev / thử nghiệm | SSO (M4); màn "Thiết bị" + API audit (M8) |
| 9 | Hub sửa được dữ liệu cục bộ → **không phải bức tường bảo mật chống người có quyền hệ điều hành** | Người có quyền admin Windows có thể chạy Hub đã sửa | Bức tường thật: "assignment required" ở IdP của app nghiệp vụ + gói quyền ký + token do server cấp cho thao tác ghi |
| 10 | Thẻ (`tags`) của app hiện chỉ để phân nhóm | Chưa dùng cho chính sách theo nhóm | Dùng khi có chính sách theo thẻ |
| 11 | Xoá tenant / người dùng / app là **vĩnh viễn** | Mất cấu hình | Có xác nhận; cân nhắc "thùng rác" sau |
| 12 | Nhóm app 3b (desktop Win32/MFC) chưa có đường thực thi | Phân quyền chỉ phủ app **web** | Ngoài phạm vi, theo TSD-v2 Quyết định #5 |

## 7.3 Bước kế tiếp đề xuất

1. ~~M3.1–M3.4 API cho Hub~~ — **xong** (xem [08](08-api-cho-hub.md)).
2. ~~Keycloak local~~ — **xong** (xem [09](09-dang-nhap-sso-keycloak.md)).
3. **Cấu hình chế độ thêm app theo tenant** (5.3) và màn bật/tắt quyền theo vai trò.
4. ~~Làm RBAC trong Hub~~ — **xong** (30/10, xem `docs/rbac/rbac-hub-trien-khai-2026-10-30.md` ở repo Hub). Dữ liệu theo người (M6) cũng đã xong. Việc kế: API nhận audit từ Hub, UI xin quyền.
5. **Đưa lên GCP** (M7) sau khi có SSO thật.

## 7.4 Quyết định còn mở

Xem K1–K10 trong plan `2026-10-30-control-plane-phan-quyen-tenant-tasks.md` (mô hình bán SaaS/on-prem, IdP, thời hạn gói quyền, người thuộc hai phòng, region GCP, RLS…). Một số đã ngầm chốt khi làm: người nhiều phòng **hợp quyền** (K6), thành viên phòng **không bao giờ do trưởng phòng sửa** (K7), cô lập tenant có **thêm trigger DB** (một phần K9).
