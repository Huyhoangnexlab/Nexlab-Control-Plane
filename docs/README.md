# Tài liệu Nexlab Control Plane

Bộ tài liệu này là nguồn sự thật cho **ai được làm gì** trong Control Plane và trong Hub. Các tài liệu này cũng đọc được **ngay trong Admin Console** ở mục **Hướng dẫn** (nội dung lấy trực tiếp từ thư mục này). Mỗi trang có mục "Trạng thái": **ĐÃ LÀM** (có code + test), **THIẾT KẾ** (đã chốt, chưa làm), hoặc **CHƯA CHỐT**.

| # | Tài liệu | Đọc khi |
|---|---|---|
| 1 | [Tổng quan & khái niệm](01-tong-quan.md) | Mới vào dự án; cần hiểu tenant / phòng ban / danh mục / mức quyền là gì |
| 2 | [Vai trò & danh mục quyền](02-vai-tro-va-quyen.md) | Cần biết **có bao nhiêu quyền, mỗi quyền gồm gì, vai trò nào có** |
| 3 | [Luật chống leo quyền](03-luat-chong-leo-quyen.md) | Cần biết hệ thống ngăn "lấy bừa / tự nâng quyền" bằng cách nào, test ở đâu |
| 4 | [Hướng dẫn vận hành theo vai trò](04-huong-dan-van-hanh.md) | Làm việc hằng ngày: tạo tenant, thêm người, cấp app, người mới / chuyển phòng / nghỉ việc |
| 5 | [Chính sách thêm app trực tiếp trong Hub](05-chinh-sach-them-app-trong-hub.md) | Hiểu vì sao Hub mặc định **cấm tự thêm app** và cách mở theo quyền |
| 6 | [Dữ liệu, kiến trúc mã & mở rộng](06-du-lieu-va-ma-nguon.md) | Dev: bảng DB, thư mục mã, thêm quyền / màn hình / migration, chạy test |
| 7 | [Lộ trình & giới hạn đã biết](07-lo-trinh-va-gioi-han.md) | Biết cái gì chưa làm, rủi ro, bước kế tiếp |
| 8 | [API cho Hub & gói quyền ký](08-api-cho-hub.md) | Nối Hub vào: discover, token, entitlements, cách kiểm chữ ký Ed25519 |
| 9 | [Đăng nhập SSO (OIDC) với Keycloak](09-dang-nhap-sso-keycloak.md) | Luồng PKCE, cấu hình IdP cho tổ chức, liên kết người dùng, JIT, đồng bộ nhóm → phòng ban |

Tài liệu liên quan ở repo `Demo-Chromium-Smart-Hub` (đường dẫn tương đối từ thư mục `DEMO`):

- `docs/superpowers/plans/2026-10-30-control-plane-phan-quyen-tenant-tasks.md` — plan tổng thể (mốc M0–M8)
- `docs/rbac/rbac-easy-customization-design-2026-10-30.md` — thiết kế RBAC **bên trong Hub** (engine, `HubPolicyV1`, `CHANNEL_ACCESS`)
- `reports/Phân quyền phòng ban Nexlab Hub.md` — nghiên cứu nền (IdP, Notion OAuth, vòng đời quyền)
