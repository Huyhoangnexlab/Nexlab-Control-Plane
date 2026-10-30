# 1. Tổng quan & khái niệm

## 1.1 Control Plane là gì và để làm gì

**Hub** (Electron) là cái vỏ cài giống hệt nhau cho mọi người, không chứa dữ liệu tổ chức nào. **Control Plane** là máy chủ riêng nắm "ai thuộc tổ chức nào, phòng nào, được dùng app nào, ở mức nào". Hub hỏi Control Plane rồi áp đúng phần quyền của người đang đăng nhập.

```
 Admin Console (web, tài liệu này)         Hub (Electron, trên máy từng người)
   quản trị viên / trưởng phòng                ▲
        │ sửa cấu hình                         │ gói quyền của ĐÚNG người này
        ▼                                      │ (ký, có hạn)     ← THIẾT KẾ, chưa làm
   ┌──────────────────────────────────────────┴──┐
   │ Control Plane: tenant → phòng → app → người │  ← ĐÃ LÀM (phần quản trị + luật)
   │ Postgres + nhật ký chỉ-thêm                 │
   └─────────────────────────────────────────────┘
```

Control Plane **không** thay Hub làm việc thật. Nó quyết định **danh sách app và mức quyền**; Hub cưỡng chế trên máy người dùng; app nghiệp vụ (CRM, HR…) tự kiểm đăng nhập của chúng.

## 1.2 Thuật ngữ

| Thuật ngữ | Nghĩa |
|---|---|
| **Nền tảng (platform)** | Phía Nexlab vận hành. Một tài khoản `platform_admin`, không thuộc tổ chức nào |
| **Tenant / Tổ chức** | Một khách hàng. Dữ liệu tách biệt hoàn toàn: người dùng, phòng ban, danh mục, nhật ký. Có **tên miền email** riêng (ví dụ `nexlab.tech`) |
| **Quản trị tổ chức** (`tenant_admin`) | Người quản trị **một** tenant. Một tenant có thể có **nhiều** quản trị |
| **Phòng ban** | Nhóm người dùng chung bộ app. Có tối đa **một** trưởng phòng |
| **Trưởng phòng** | Không phải vai trò lưu riêng: là người được gán vào `departments.manager_user_id`. Chỉ sửa app của phòng mình |
| **Danh mục app** | Danh sách **duy nhất** các app của tenant mà phòng ban được chọn. Chỉ quản trị tổ chức thêm vào |
| **Origin** | Địa chỉ app đã chuẩn hoá (`https://crm.congty.vn`), so khớp **chính xác**, không ký tự đại diện |
| **Trần của app** (`max_level`) | Mức cao nhất bất kỳ phòng nào được cấp cho app đó |
| **Mức quyền** (level) | Thang `none · open · ask · M0 · M1 · M2` (M3 chưa mở) — xem 1.4 |
| **Vai trò dùng Hub** (`hub_role`) | `viewer / member / lead / admin` — quyết định các thao tác **trong Hub** (tầng 1, xem [02](02-vai-tro-va-quyen.md)) |
| **policy_version** | Số nguyên của tenant, tăng mỗi khi có thay đổi ảnh hưởng quyền. Hub dùng để chống nhận lại gói quyền cũ |

## 1.3 Quan hệ dữ liệu

```
Tenant 1──n Phòng ban 1──n Thành viên n──1 Người dùng
   │              │
   │              └──n Cấp app (mức) n──1 App trong danh mục ──n──1 Tenant
   └──n Người dùng (mỗi người thuộc đúng 1 tenant; platform_admin thì không có tenant)
```

- Một người thuộc **nhiều** phòng; quyền = **hợp** các phòng (mức cao nhất), rồi bị kẹp bởi trần của app.
- Một app có thể cấp cho nhiều phòng với mức khác nhau.
- Xoá app / phòng / người dùng sẽ gỡ các liên kết liên quan; **nhật ký giữ nguyên**.

## 1.4 Thang mức quyền (áp cho mỗi cặp phòng × app)

| Mức | Nhãn trong UI | Người dùng làm được | Agent làm được |
|---|---|---|---|
| `none` | Không cấp / Ẩn | Không thấy app | — |
| `open` | Chỉ mở app | Mở app; tab luôn riêng tư | Không đọc gì |
| `ask` | Hỏi agent | Chia sẻ tab để hỏi | Trả lời theo ngữ cảnh, không thao tác |
| `M0` | Agent đọc | + | Thao tác trang nhưng **chỉ đọc** |
| `M1` | Agent ghi · duyệt từng lần | + | Ghi, **mỗi lần cần người duyệt** (hành vi hiện tại của Hub) |
| `M2` | Agent ghi · duyệt kế hoạch | + | Duyệt một lần cả kế hoạch; thao tác khớp kế hoạch tự cấp |
| `M3` | Tự duyệt | — | **Chưa mở** (chờ skill đã chứng nhận qua cổng P6). Có trong lược đồ nhưng không gán được |

Mức này **trùng** với chế độ tự chủ `M0–M3` đã có trong Hub (`autonomyPolicy.ts`), nên Hub không cần engine thứ hai: mức của app chính là một cấp trong phép `min()` của chế độ tự chủ.

Nguyên tắc: **lớp dưới chỉ được thu hẹp**. Hiệu lực = `min(trần nền tảng, trần app, mức phòng, vai trò)`. Hạ trần app sẽ tự hạ mức đã cấp xuống bằng trần mới (có ghi nhật ký `access.clamp`).

## 1.5 Luồng đầy đủ khi Hub nối vào

1. Mở Hub → nhập email công ty. Hub hỏi `POST /v1/discover` → biết tenant và nơi đăng nhập.
2. Đăng nhập SSO (OIDC + PKCE) qua trình duyệt hệ thống → Hub có token của IdP.
3. Hub gọi `GET /v1/entitlements` → Control Plane kiểm token, tính quyền (`computeEffective`), **ký** gói quyền, trả về.
4. Hub kiểm chữ ký, hạn dùng, `policy_version` không lùi → áp quyền; App Rail chỉ hiện app được cấp.
5. Hub làm mới gói định kỳ. Quyền bị hạ → Hub đóng tab / huỷ task tương ứng ngay.

**Trạng thái:** phía **Control Plane đã làm** các bước 1–3 (`/v1/discover`, `/v1/auth/token` thay IdP, `/v1/entitlements` ký Ed25519, hàm kiểm `verifyEntitlement`) — chi tiết ở [08](08-api-cho-hub.md). Phía **Hub chưa nối** (bước 4–5): đó là phần RBAC trong Hub, làm sau. Bước 2 (đăng nhập SSO với **Keycloak**, OIDC + PKCE) **đã làm** — xem [09](09-dang-nhap-sso-keycloak.md); đăng nhập Admin Console vẫn bằng mật khẩu cục bộ. Các giới hạn còn lại ở [07](07-lo-trinh-va-gioi-han.md).

## 1.6 Hai tầng quyền — đừng nhầm

| Tầng | Trả lời câu hỏi | Nơi thực thi | Trạng thái |
|---|---|---|---|
| **Tầng 2 — Quyền quản trị Control Plane** | Ai được **sửa cấu hình** (tạo người, cấp app…) | Dịch vụ phía server (`src/server/services`) | **ĐÃ LÀM** |
| **Tầng 1 — Quyền dùng Hub** | Một người trong Hub được **làm gì** (thêm app, sửa khoá API, bật tự học…) | Main process của Hub (`requirePermission`) | **THIẾT KẾ** |

Hai tầng độc lập: một trưởng phòng có thể sửa app của phòng trên Control Plane (tầng 2) nhưng trong Hub vẫn chỉ là vai trò `lead` (tầng 1).
