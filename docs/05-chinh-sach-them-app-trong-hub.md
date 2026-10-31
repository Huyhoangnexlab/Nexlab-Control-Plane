# 5. Chính sách thêm app trực tiếp trong Hub

> Trạng thái: **QUYẾT ĐỊNH (30/10/2026): mặc định CẤM, mở theo quyền; quản trị Hub của tổ chức (`admin`) được cấp `app.add` / `app.remove`.** Hub đã cưỡng chế; cờ cấu hình theo tenant (bật/tắt quyền cho từng vai) **chưa làm**.

## 5.1 Vấn đề

Hôm nay Hub cho **bất kỳ ai** ngồi trước Shell tự thêm app (`AppsAdd` chỉ kiểm lệnh đến từ Shell), và app tự thêm mặc định cho phép agent tự động hoá (`automationScope = outside-privacy-gate`). Nếu để nguyên thì danh mục và ma trận quyền của Control Plane bị vòng qua dễ dàng.

## 5.2 Hai loại app trong Hub

| | **App được cấp** (từ danh mục) | **App tự thêm** trong Hub |
|---|---|---|
| Nguồn | Quản trị tổ chức khai báo trên Control Plane; gói quyền đưa xuống máy | Người dùng nhập URL trong Hub |
| Gỡ khỏi Hub | **Không** (app khoá, `removable:false`) | Được |
| Quyền agent | Theo mức phòng được cấp, ≤ trần | Mặc định **không đụng**: tab luôn riêng tư, ngoài cổng agent |
| Kiểm địa chỉ | HTTPS, origin chính xác (đã kiểm khi thêm vào danh mục) | Như cũ: HTTPS, không IP nội bộ, không `.local` |
| Có ở máy người khác | Có (theo phòng) | **Không** — chỉ máy đó |
| Có trong nhật ký quản trị | Có | Không |

## 5.3 Ba chế độ

| Chế độ | Tên | Hành vi | Dành cho | Trạng thái |
|---|---|---|---|---|
| **1** | **Cấm theo quyền** *(mặc định)* | Chỉ app trong danh mục mở được. Nút "Thêm app" ẩn với ai không có `app.add`. Mặc định chỉ **Quản trị Hub (`admin`)** có `app.add` / `app.remove`; mọi vai khác không | Mọi tenant; tenant y tế / dữ liệu nhạy cảm nên bỏ quyền này khỏi `admin` | **Đã làm** (30/10) |
| 2 | Cho phép thêm cho vai khác | Cấp `app.add` cho thêm một vai | Công ty thường, khi muốn linh hoạt | Dự kiến — cần màn bật/tắt quyền theo vai (chưa làm) |
| 3 | Đề xuất → duyệt | Người dùng bấm "Đề xuất app" → quản trị tổ chức duyệt → vào danh mục → cấp cho phòng | Khi cần quản lý chặt nhưng vẫn linh hoạt | Dự kiến (M8, luồng xin quyền) |

**"Cấm theo quyền"** nghĩa là: không có cờ riêng nào ngoài hệ thống quyền. Ai có `app.add` thì thêm được; mặc định đó là `admin`. **App do `admin` thêm tay:** chỉ có trên máy + tài khoản đó (lưu trong thư mục dữ liệu của chính người đó), **không** vào danh mục tổ chức, **không** tới máy người khác, mức tối đa **`M0`** (agent đề xuất, người duyệt từng bước — không bao giờ tự ghi), HTTPS và không địa chỉ nội bộ như cũ. Mất quyền `app.add` (đổi vai, gói hết hạn) thì app thêm tay bị **ẩn** (không xoá dữ liệu); có lại quyền thì hiện lại. Muốn app cho nhiều người thì thêm vào danh mục (mục 5.4). Một cờ phụ `allowUnlistedApps` trong gói quyền luôn là `false` ở chế độ managed; Hub dùng nó để biết có cho phép origin ngoài danh mục hay không.

## 5.4 Nếu người dùng cần một app chưa có

```
Nhân viên / trưởng phòng ──(báo)──► Quản trị tổ chức ──► Danh mục app → Thêm
                                                      └─► Phân quyền app → cấp cho phòng
```

Hôm nay "báo" là làm ngoài hệ thống (chat, email). Chế độ 3 sẽ biến bước này thành nút "Đề xuất app" có lý do, người duyệt và hạn.

## 5.5 Hub sẽ cưỡng chế thế nào (THIẾT KẾ)

| Điểm trong Hub | Hành vi ở chế độ 1 |
|---|---|
| `AppsAdd` | Từ chối nếu người dùng không có `app.add`; ghi audit `access.denied` (**Hub đã cưỡng chế**) |
| `AppsRemove`, `AppsRename` | Từ chối với app khoá; cần `app.remove` với app cá nhân |
| `CustomAppStore` khi nạp `apps.json` | Bỏ qua app không nằm trong gói quyền (chống sửa tay `apps.json`); ghi audit |
| `ListApps`, `ViewCreate` | Chỉ trả / mở app có trong gói quyền, kể cả nhánh dựng app từ `AgentSpec` |
| `PolicyService` (allow-list điều hướng) | Allow-list = hợp origin được cấp. Điều hướng sang origin khác → `origin-not-allowed` |

Test âm cần có: người thường gọi `AppsAdd` → từ chối và `apps.json` không đổi; sửa tay `apps.json` thêm app → bị bỏ qua khi nạp lại; `appId` lạ có sẵn `AgentSpec` vẫn không mở được.

## 5.6 Lưu ý khi chuyển một máy đang chạy sang chế độ 1

App cá nhân đã thêm từ trước sẽ bị **ẩn** (không xoá dữ liệu) khi gói quyền đầu tiên được áp; báo trước cho người dùng. Cookie / dữ liệu của app đó vẫn nằm ở máy cho tới khi người dùng yêu cầu xoá.
