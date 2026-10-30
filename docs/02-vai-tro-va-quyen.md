# 2. Vai trò & danh mục quyền

Có **hai tầng** quyền độc lập (xem [1.6](01-tong-quan.md#16-hai-tầng-quyền--đừng-nhầm)):

- **Tầng 2** — quyền quản trị trên Control Plane: **ĐÃ LÀM**, có test.
- **Tầng 1** — quyền dùng Hub: **20 quyền**, THIẾT KẾ (làm khi đưa RBAC vào Hub).

---

## Phần A — Tầng 2: quyền quản trị Control Plane (ĐÃ LÀM)

### A.1 Bốn nhóm người

| Nhóm | Cách nhận biết trong dữ liệu | Phạm vi |
|---|---|---|
| **Quản trị nền tảng** | `users.admin_role = 'platform_admin'`, `tenant_id` rỗng | Toàn nền tảng, **nhưng không đọc được dữ liệu nghiệp vụ trong tenant** |
| **Quản trị tổ chức** | `admin_role = 'tenant_admin'`, có `tenant_id` | Đúng **một** tenant của mình |
| **Trưởng phòng** | `departments.manager_user_id = người này` | Đúng các phòng mình quản lý |
| **Nhân viên** | Còn lại | Chỉ chính mình |

Một người có thể thuộc nhiều nhóm (ví dụ vừa quản trị tổ chức vừa là trưởng phòng); giao diện hiện **hợp** các mục của các nhóm đó.

**Nhiều tenant, mỗi tenant có quản trị riêng:** quản trị nền tảng tạo được **nhiều** tenant; mỗi lần tạo, hệ thống tạo luôn **tài khoản quản trị tổ chức đầu tiên** của tenant đó (email phải thuộc tên miền tenant). Quản trị của tenant A **không** thấy, không sửa được gì của tenant B. Một tenant có thể có **nhiều quản trị viên**; quản trị tổ chức tạo thêm quản trị khác được, nhưng luôn phải còn ít nhất một.

### A.2 Ma trận quyền chi tiết

Ký hiệu: ✓ được · ✗ không · ◐ có giới hạn (ghi rõ).

| Hành động | Nền tảng | Quản trị tổ chức | Trưởng phòng | Nhân viên |
|---|---|---|---|---|
| **Tổ chức (tenant)** | | | | |
| Xem danh sách tổ chức | ✓ | ✗ | ✗ | ✗ |
| Tạo tổ chức (+ quản trị đầu tiên) | ✓ | ✗ | ✗ | ✗ |
| Đổi tên / tạm ngưng / kích hoạt tổ chức | ✓ | ✗ | ✗ | ✗ |
| Xoá tổ chức (gõ lại mã để xác nhận) | ✓ | ✗ | ✗ | ✗ |
| Sửa cài đặt tổ chức (tên hiển thị, màu, thời hạn gói quyền) | ✗ | ✓ (tenant mình) | ✗ | ✗ |
| Khai báo / sửa / gỡ cấu hình **SSO (IdP)** của tổ chức | **✓** | ◐ chỉ **xem** (Cài đặt tổ chức) | ✗ | ✗ |
| **Người dùng** | | | | |
| Xem danh sách người dùng | ✗ | ✓ | ✗ | ✗ |
| Tạo / sửa / vô hiệu hoá / xoá người dùng | ✗ | ✓ ◐ không tự đổi mình | ✗ | ✗ |
| Đặt lại mật khẩu người khác | ✗ | ✓ | ✗ | ✗ |
| Gán quyền quản trị tổ chức cho người khác | ✗ | ✓ | ✗ | ✗ |
| Đổi mật khẩu của chính mình | ✓ | ✓ | ✓ | ✓ |
| **Phòng ban** | | | | |
| Xem danh sách phòng | ✗ | ✓ tất cả | ◐ chỉ phòng mình quản lý | ◐ chỉ phòng mình thuộc |
| Tạo / sửa / xoá phòng, đổi trưởng phòng, gắn **Nhóm IdP** cho phòng | ✗ | ✓ | ✗ | ✗ |
| Xem danh sách thành viên phòng | ✗ | ✓ | ◐ chỉ phòng mình quản lý | ✗ |
| Thêm / bỏ thành viên | ✗ | ✓ | **✗** | ✗ |
| **Danh mục app** | | | | |
| Xem danh mục | ✗ | ✓ | ✓ (để chọn cho phòng) | ✗ |
| Thêm / sửa / tắt / xoá app, đặt trần | ✗ | ✓ | **✗** | ✗ |
| **Cấp app cho phòng (ma trận)** | | | | |
| Xem ma trận | ✗ | ✓ mọi phòng | ◐ chỉ phòng mình | ✗ |
| Cấp / đổi / thu hồi mức app cho phòng | ✗ | ✓ mọi phòng | ◐ **chỉ phòng mình**, chỉ app trong danh mục, mức ≤ trần | ✗ |
| **Xem trước & nhật ký** | | | | |
| Xem trước quyền hiệu lực của một người | ✗ | ✓ mọi người trong tenant | ◐ người thuộc phòng mình | ◐ chỉ mình |
| Xem nhật ký | ◐ chỉ vòng đời tenant | ✓ cả tenant | ◐ chỉ sự kiện của phòng mình | ✗ |

Các dòng in đậm là **ranh giới chống "lấy bừa"**: trưởng phòng chọn app nhưng không thêm app mới, không kéo người vào phòng.

### A.3 Tài khoản nền tảng không đọc được gì trong tenant

Quản trị nền tảng chỉ có: danh sách tenant (kèm số lượng người/phòng/app), tạo/sửa/xoá tenant, nhật ký vòng đời tenant, đổi mật khẩu mình. Gọi các API danh sách người dùng, ma trận… đều bị từ chối (test `Nền tảng & nhật ký`). Lý do: nhà cung cấp nền tảng không nên mặc định thấy dữ liệu khách.

### A.4 Ánh xạ sang mã

| Việc | Hàm dịch vụ (`src/server/services/`) | Kiểm quyền |
|---|---|---|
| Quản lý tenant | `tenants.ts`: `createTenant`, `updateTenant`, `deleteTenant` | `requirePlatform` |
| Cài đặt tenant | `tenants.ts`: `updateOwnTenantSettings` | `requireTenantAdmin` |
| Người dùng | `users.ts`: `listUsers`, `createUser`, `updateUser`, `resetPassword`, `deleteUser` | `requireTenantAdmin` + ràng `tenant_id` |
| Phòng ban | `departments.ts`: `createDepartment`, `updateDepartment`, `deleteDepartment`, `addMember`, `removeMember` | `requireTenantAdmin` |
| Phòng ban (đọc) | `departments.ts`: `listDepartments`, `getDepartment` | theo nhóm người (A.2) |
| Danh mục app | `apps.ts`: `createApp`, `updateApp`, `deleteApp` (`listApps`: admin + trưởng phòng) | `requireTenantAdmin` |
| Cấp app cho phòng | `access.ts`: `setDepartmentAppLevel`, `getAccessMatrix` | `canManageDept` (admin hoặc đúng trưởng phòng) |
| Xem trước | `access.ts`: `previewUser` | admin / trưởng phòng phòng đó / chính mình |
| Nhật ký | `audit-read.ts`: `listAudit` | theo phạm vi từng nhóm |

---

## Phần B — Tầng 1: 20 quyền dùng Hub (THIẾT KẾ)

> Trạng thái: **đã chốt thiết kế, chưa cưỡng chế trong Hub**. Hub hôm nay có đúng một vai ("người ngồi trước Shell") và vai đó là admin. Hub sẽ nhận bộ quyền này trong gói quyền từ Control Plane. Chi tiết engine: `docs/rbac/rbac-easy-customization-design-2026-10-30.md` ở repo Hub.

**Cách đếm:** 4 quyền suy ra từ mức app + 15 quyền riêng lẻ + 1 quyền luôn mở (`policy.view`) = **20 quyền**; thêm 1 **trần số** (`autonomyMax`).

### B.1 Bốn quyền suy ra từ mức app (không bật tắt riêng)

Do ô trong ma trận phòng × app quyết định (xem [1.4](01-tong-quan.md#14-thang-mức-quyền-áp-cho-mỗi-cặp-phòng--app)).

| Quyền | Mức tối thiểu | Điều khiển trong Hub |
|---|---|---|
| `app.use` | `open` | Thấy app ở App Rail (`ListApps`), mở được (`ViewCreate`) |
| `tab.share` | `ask` | Chuyển tab từ `private` sang `shared` (`SharingSetState`). Chiều `shared → private` **luôn được** |
| `agent.ask` | `ask` | Hỏi agent (`AgentQuery`). Vẫn cần tab đang `shared` — hai cổng độc lập |
| `agent.act` | `M0` | Agent thao tác trên trang. Mức M0 chỉ đọc; M1/M2 cho ghi (theo bảng ở 1.4) |

### B.2 Mười lăm quyền riêng lẻ

Cột "Rủi ro" là đánh giá của người viết: **Cao** = đụng bí mật / dữ liệu / mở rộng bề mặt tấn công.

| # | Nhóm | Quyền | Gồm những thao tác (kênh IPC trong Hub) | Rủi ro | Ghi chú |
|---|---|---|---|---|---|
| 1 | Ứng dụng | `app.add` | Thêm app tự do (`AppsAdd`) | **Cao** | **Mặc định TẮT cho mọi vai** (chế độ 1, xem [05](05-chinh-sach-them-app-trong-hub.md)) |
| 2 | | `app.remove` | Gỡ app, đổi tên app (`AppsRemove`, `AppsRename`) — xoá luôn cookie, cấu hình, hội thoại, consent của app | **Cao** | **Mặc định TẮT cho mọi vai.** App từ danh mục là app khoá, không gỡ được |
| 3 | Agent | `mcp.consent` | Cho phép agent kết nối MCP của một app (`McpSetConsent`) — chỉ chiều **cấp**; thu hồi luôn được | TB | Cần mức app ≥ `ask` |
| 4 | | `agent.config` | Sửa cấu hình agent, phạm vi SOP, nguồn dữ liệu (`AgentRegistryUpsert/Remove/Discover`, `AgentSetConfig`, `Sop*`) | **Cao** | Quy tắc "admin chỉ nâng Risk Tier, không hạ" vẫn giữ |
| 5 | Cài đặt | `settings.config` | Sửa cấu hình triển khai chung và riêng từng app (`SettingsConfigSet/Clear`) | TB | Danh sách trắng biến vẫn là rào thứ hai: quyền này không mở thêm biến nào |
| 6 | | `settings.apikeys` | Lưu/xoá khoá API, **xuất khoá ra `.env`** (`SettingsApiKeySet/Clear`, `SettingsEnvExport`) | **Cao** | Đòi xác thực mạnh hơn (PIN) |
| 7 | Kỹ năng | `skill.edit` | Tạo, sửa, nhập, xuất, xoá skill (`UserSkillCreate/Update/Remove/Import/Export`) | TB | Skill nhập vào luôn ở trạng thái nháp; lint vẫn chạy |
| 8 | | `skill.enable` | Bật skill đã qua lint (`UserSkillSetStatus`) | TB | Trần 5 skill bật mỗi app; M3 chỉ dùng skill đã chứng nhận |
| 9 | | `skill.publish` | Bật skill **dùng chung** cho nhiều người | TB | Chưa có điểm cưỡng chế — cần chủ sở hữu skill + danh tính thật |
| 10 | Bộ nhớ | `memory.view` | Xem bài học, quy trình nháp, thống kê bộ nhớ (`MemoryList`, `MemorySkillList/Get`, `MemoryAnalytics`, `MemoryPendingWrites`) | Thấp | |
| 11 | | `memory.approve` | Duyệt thẻ ghi nhớ của agent (nhánh bài học trong `AgentResolveAction`) | TB | Đề xuất phải thuộc tab hiện tại |
| 12 | | `memory.wipe` | Xoá bộ nhớ agent của chính mình (`MemoryWipe`) | Thấp | Mặc định **mọi vai** có — là quyền riêng tư của người dùng |
| 13 | | `learn.run` | Bật chế độ tự học trên tab (`LearnStart/Stop`) | TB | Cần mức app ≥ `M0`; tự học **không bao giờ ghi thật** |
| 14 | Quản trị | `audit.view` | Xem nhật ký trong Hub | Thấp | Chưa có kênh đọc audit; làm cùng giai đoạn giao diện |
| 15 | | `policy.edit` | Sửa / nhập / xuất chính sách (`policy:*`) | **Cao** | Cần xác thực mạnh; luật chống tự nâng quyền áp dụng |

### B.3 Quyền luôn mở (không cổng nào chặn)

`policy.view` (xem "vì sao tôi bị chặn"), nút **Ngắt** (`AutomationCancel`), chuyển tab về riêng tư, đóng tab, đổi tab / bố cục. Nguyên tắc: **hành động thu hẹp bề mặt không bao giờ bị khoá.**

### B.4 Mặc định theo bốn vai trò Hub (đã áp chế độ 1)

| Quyền | Chỉ đọc (`viewer`) | Nhân viên (`member`) | Trưởng nhóm (`lead`) | Quản trị Hub (`admin`) |
|---|---|---|---|---|
| `app.add`, `app.remove` | ✗ | ✗ | ✗ | **✗** |
| `mcp.consent` | ✗ | ✗ | ✓ | ✓ |
| `agent.config` | ✗ | ✗ | ✗ | ✓ |
| `settings.config` | ✗ | ✗ | ✗ | ✓ |
| `settings.apikeys` | ✗ | ✗ | ✗ | ✓ (cần PIN) |
| `skill.edit`, `skill.enable` | ✗ | ✓ | ✓ | ✓ |
| `skill.publish` | ✗ | ✗ | ✗ | ✓ (khi có danh tính thật) |
| `memory.view`, `memory.approve` | ✗ | ✓ | ✓ | ✓ |
| `memory.wipe` | ✓ | ✓ | ✓ | ✓ |
| `learn.run` | ✗ | ✗ | ✓ | ✓ |
| `audit.view` | ✗ | ✗ | ✓ | ✓ |
| `policy.edit` | ✗ | ✗ | ✗ | ✓ (cần PIN) |
| **Trần tự chủ mặc định** | M0 | M1 | M2 | M2 |

Đây là đề xuất khởi điểm; vai trò khác của khách tạo bằng cách nhân bản vai trò có sẵn rồi bớt/thêm quyền (**không** có kế thừa vai trò).

### B.5 Một người = một vai trò Hub

Trường `users.hub_role` (đã có trong Control Plane, hiện **chưa có tác dụng** vì Hub chưa nhận). Người thuộc nhiều phòng vẫn chỉ có **một** vai trò Hub; còn **app** thì hợp các phòng.

---

## Phần C — Quyền không nằm trong hai tầng trên

| Thứ | Ai quyết định | Ở đâu |
|---|---|---|
| Người dùng có đăng nhập được vào **app nghiệp vụ** (EspoCRM, HR…) hay không | IdP / chính app đó ("assignment required") | Ngoài Hub. Đây là **bức tường thật**: ngay cả khi ai đó lách Hub, app vẫn từ chối |
| Cổng ghi, bảng cấm (xoá, thanh toán, đổi quyền…) | Mã của Hub | RBAC **không** mở được các cổng này, chỉ đặt trần |
| Dữ liệu ở hệ thống nguồn (vd. trang Notion của phòng nào) | Hệ thống nguồn | Dự kiến dùng OAuth theo từng người để quyền tự thừa kế |
