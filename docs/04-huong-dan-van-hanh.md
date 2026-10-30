# 4. Hướng dẫn vận hành theo vai trò

Tên mục dưới đây là tên menu bên trái trong Admin Console. Menu hiện theo vai trò của bạn nên có thể không thấy hết.

---

## 4.1 Quản trị nền tảng (Nexlab)

Đăng nhập tài khoản `platform@nexlab.tech` (mẫu). Menu: **Tổng quan · Tổ chức (tenant) · Nhật ký nền tảng · Tài khoản của tôi**.

### Tạo tổ chức mới (tenant) cùng quản trị đầu tiên
1. **Tổ chức (tenant) → Tạo tổ chức**.
2. Điền: *Tên tổ chức*, *Mã (slug)* (chữ thường, số, gạch ngang; **không sửa được sau khi tạo**, và là chuỗi phải gõ lại khi xoá tổ chức), *Tên miền email* (ví dụ `congty.vn`), *Tên* và *Email quản trị viên* (**phải kết thúc bằng `@tên-miền`**).
3. Mật khẩu: nhập, hoặc **để trống** để hệ thống sinh **mật khẩu tạm** — hộp thoại sẽ hiện **một lần**, bấm **Chép** rồi gửi cho quản trị viên qua kênh an toàn.
4. Bạn có thể tạo **nhiều tổ chức**; mỗi tổ chức có quản trị riêng, dữ liệu tách biệt hoàn toàn.

### Cấu hình đăng nhập SSO cho một tổ chức
1. **Tổ chức → biểu tượng vân tay** ở hàng của tổ chức.
2. Điền *Issuer* của IdP (Keycloak: `…/realms/<tên>`) và *Client ID của Hub*. Bấm **Kiểm tra & lưu** — hệ thống kiểm tra kết nối IdP trước khi lưu, sai thì báo ngay ở ô Issuer.
3. Chọn *Đồng bộ phòng ban từ nhóm IdP* và *Tự tạo tài khoản lần đầu (JIT)* theo nhu cầu của khách ([09 · 9.4](09-dang-nhap-sso-keycloak.md)).
4. Từ lúc lưu, tổ chức **chỉ đăng nhập Hub qua IdP**; token mật khẩu cục bộ ngừng hoạt động. Gỡ cấu hình bằng biểu tượng ShieldOff.

### Tạm ngưng / kích hoạt lại một tổ chức
**Tổ chức → ✏️ Sửa → Trạng thái.** *Tạm ngưng* sẽ **đăng xuất tất cả mọi người** của tổ chức và chặn đăng nhập cho tới khi kích hoạt lại. Dữ liệu được giữ nguyên.

### Xoá tổ chức
**Tổ chức → 🗑 Xoá**, gõ lại **mã (slug)** để xác nhận. Xoá **vĩnh viễn** người dùng, phòng ban, danh mục, cấp quyền của tổ chức đó. Nhật ký sự kiện xoá vẫn được giữ ở nhật ký nền tảng.

> **Giới hạn đã biết:** quản trị nền tảng hiện **không** đặt lại mật khẩu hay tạo thêm quản trị cho tổ chức đã tạo. Nếu quản trị viên duy nhất của một tenant mất mật khẩu thì phải xử lý trực tiếp ở DB. Cách khắc phục đã dự kiến: tài khoản khẩn cấp (break-glass) có nhật ký riêng — xem [07](07-lo-trinh-va-gioi-han.md).

---

## 4.2 Quản trị tổ chức (tenant admin)

Menu: **Tổng quan · Người dùng · Phòng ban · Danh mục app · Phân quyền app · Xem trước quyền · Nhật ký · Cài đặt tổ chức · Tài khoản của tôi**.

### Thứ tự thiết lập một tổ chức mới (làm đúng thứ tự cho nhanh)
1. **Danh mục app** — khai báo mọi app mà tổ chức dùng.
2. **Phòng ban** — tạo phòng (chưa cần trưởng phòng).
3. **Người dùng** — tạo tài khoản, gán vào phòng ban.
4. **Phòng ban → ✏️ Sửa** — chọn **trưởng phòng** cho từng phòng.
5. **Phân quyền app** — cấp app cho từng phòng (hoặc để trưởng phòng tự làm).
6. **Xem trước quyền** — chọn vài người để kiểm tra họ thấy đúng app chưa.

Trang **Tổng quan → Việc cần chú ý** nhắc các thiếu sót: phòng chưa có trưởng phòng, app chưa phòng nào dùng, tài khoản chưa đăng nhập, người chưa thuộc phòng nào.

### Danh mục app
- **Thêm app:** *Tên*, *Địa chỉ (origin)*, biểu tượng, màu, *Mức tối đa cho phép* (trần), thẻ.
  - Địa chỉ chỉ nhận **HTTPS**; path / query bị bỏ; không IP, không `.local`. Hub so khớp địa chỉ này **chính xác**, nên `https://crm.vn` và `https://app.crm.vn` là **hai app khác nhau**.
  - **Trần** là mức cao nhất bất kỳ phòng nào được cấp cho app này. Chọn thấp nếu app nhạy cảm (vd. nhân sự: trần `M1`).
- **Sửa app:** hạ trần sẽ **tự hạ** mức đã cấp của các phòng xuống bằng trần mới (hệ thống báo số phòng bị ảnh hưởng và ghi nhật ký).
- **Tắt app** (trạng thái *Tắt*): không phòng nào thấy, **cấu hình cấp quyền được giữ** — bật lại là có lại. Dùng khi tạm ngưng.
- **Xoá app:** gỡ khỏi mọi phòng, **không hoàn tác**.

### Phòng ban
- Tạo / sửa / xoá phòng; **chọn trưởng phòng** từ người dùng đang hoạt động (người đó tự thành thành viên của phòng).
- **Nhóm trên IdP (SSO):** nếu tổ chức dùng SSO, điền tên nhóm ở IdP tương ứng với phòng (ví dụ `kinh-doanh`). Người đăng nhập thuộc nhóm đó tự vào phòng; thành viên đồng bộ từ IdP hiện nhãn **"Đồng bộ từ IdP"** và chỉ đổi được ở IdP ([09 · 9.6](09-dang-nhap-sso-keycloak.md)).
- **Chi tiết phòng** → thêm / bỏ thành viên (chỉ bạn làm được, trưởng phòng **không**). Bỏ một trưởng phòng khỏi phòng thì chức trưởng phòng cũng bị gỡ.
- Xoá phòng thu hồi toàn bộ quyền app của phòng đó; tài khoản người dùng vẫn còn.

### Người dùng
- **Thêm:** họ tên, email (đúng tên miền tổ chức), vai trò Hub, quyền quản trị, phòng ban. Mật khẩu để trống = hệ thống sinh mật khẩu tạm (hiện một lần).
- **Sửa:** đổi tên, vai trò Hub, phòng ban, **Vô hiệu hoá** (đăng xuất khỏi mọi thiết bị, không đăng nhập được, quyền hiệu lực rỗng).
- **Đặt lại mật khẩu (🔑):** nhập mật khẩu mới hoặc để trống để sinh tạm; người đó bị đăng xuất khỏi mọi thiết bị.
- Người đã đăng nhập qua SSO có nhãn **SSO**. Khi tổ chức bật JIT, nhân viên mới đăng nhập lần đầu sẽ tự xuất hiện ở đây (vai trò nhân viên, chưa có quyền quản trị).
- **Xoá (🗑):** vĩnh viễn. Nếu chỉ tạm thời không cho dùng, hãy **Vô hiệu hoá**.
- Bạn **không** tự đổi vai trò / trạng thái / xoá chính mình, và luôn phải còn ít nhất một quản trị đang hoạt động. Để người khác quản trị: tạo hoặc sửa người đó với *Quyền quản trị = Quản trị tổ chức*.

### Phân quyền app (ma trận phòng × app)
Mỗi ô là mức quyền của một phòng với một app; đổi là **lưu ngay** và ghi nhật ký. Các lựa chọn vượt trần của app bị khoá ("vượt trần").

### Cài đặt tổ chức
- *Tên hiển thị trong Hub* và *màu chủ đạo* (dùng cho Hub sau này).
- *Thời hạn gói quyền* (1–168 giờ, mặc định 24): Hub phải làm mới gói quyền trong thời hạn này; ngắn hơn = thu hồi quyền nhanh hơn nhưng Hub cần kết nối thường xuyên.

---

## 4.3 Trưởng phòng

Menu: **Tổng quan · Phòng của tôi · Phân quyền app · Xem trước quyền · Nhật ký phòng · Tài khoản của tôi**.

- **Chọn app cho phòng mình:** *Phân quyền app* chỉ hiện **cột phòng của bạn**. Chọn mức cho từng app trong danh mục; mức không được vượt trần.
- **Muốn thêm app mới vào tổ chức?** Bạn **không** tự thêm được — nhờ quản trị tổ chức thêm vào danh mục (luồng "đề xuất & duyệt" dự kiến ở giai đoạn sau).
- **Muốn thêm / bỏ người khỏi phòng?** Nhờ quản trị tổ chức. Bạn chỉ **xem** danh sách thành viên.
- **Xem trước quyền:** chọn một thành viên để xem họ thấy app nào, mức nào và vì sao.
- **Nhật ký phòng:** các thay đổi liên quan đến phòng của bạn.

---

## 4.4 Nhân viên

Menu: **Tài khoản của tôi**. Xem phòng ban và các app bạn được cấp (kèm mức quyền và phòng nào cấp). Thiếu app? Báo trưởng phòng — họ bật app cho phòng nếu app đó có trong danh mục; nếu chưa có thì nhờ quản trị tổ chức thêm. Đổi mật khẩu ngay ở trang này.

---

## 4.5 Quy trình người mới · chuyển phòng · nghỉ việc (làm tay hôm nay)

| Tình huống | Làm gì (quản trị tổ chức) | Kết quả |
|---|---|---|
| **Nhân viên mới** | *Người dùng → Thêm* → chọn phòng → gửi mật khẩu tạm | Người đó thấy ngay các app của phòng |
| **Chuyển phòng** | *Người dùng → Sửa* → **bỏ** phòng cũ, **thêm** phòng mới (làm cùng lúc) | Mất app phòng cũ, có app phòng mới. **Không** cộng dồn quyền. *(Chưa có thời gian ân hạn — xem 07)* |
| **Kiêm nhiệm** | Gán vào **hai** phòng | Quyền = mức cao nhất của các phòng (vẫn ≤ trần app) |
| **Đổi trưởng phòng** | *Phòng ban → Sửa → Trưởng phòng* | Trưởng phòng cũ mất quyền sửa app của phòng ngay |
| **Nghỉ việc** | *Người dùng → Sửa → Vô hiệu hoá* | Đăng xuất mọi thiết bị, không đăng nhập được, quyền rỗng, **nhật ký vẫn còn**. Xoá hẳn chỉ khi chắc chắn |
| **Quên mật khẩu** | *Người dùng → 🔑* | Mật khẩu mới/tạm; người đó bị đăng xuất khỏi mọi thiết bị |
| **Thêm app mới cho cả phòng** | *Danh mục app → Thêm* → *Phân quyền app* chọn mức cho phòng | Người trong phòng thấy app khi Hub nối vào |

Mỗi bước đều hiện trong **Nhật ký** (ai làm, lúc nào, trước/sau).

---

## 4.6 Xử lý sự cố thường gặp

| Hiện tượng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Trang đăng nhập báo "Không kết nối được cơ sở dữ liệu" | Postgres chưa chạy | `docker compose up -d` rồi tải lại |
| "Đăng nhập sai quá nhiều lần" | Khoá tạm 15 phút theo email | Chờ, hoặc quản trị đặt lại mật khẩu (khoá theo tiến trình, khởi động lại server cũng xoá) |
| Người dùng không thấy app nào | Chưa thuộc phòng nào / phòng chưa được cấp app / app đang Tắt | Dùng *Xem trước quyền* để thấy lý do |
| "Email phải thuộc @…" | Email khác tên miền tenant | Dùng đúng tên miền của tổ chức |
| "Mức … vượt trần của app" | Chọn mức cao hơn trần | Quản trị nâng trần ở *Danh mục app* nếu thật sự cần |
| Bị đưa về Tổng quan với thông báo "không có quyền xem trang đó" | Mở trang ngoài vai trò | Dùng các mục có ở menu trái |
