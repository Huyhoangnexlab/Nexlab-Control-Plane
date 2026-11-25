# 10. Cấu hình chung và khoá / token của tổ chức

> Trạng thái: **ĐÃ LÀM** (31/10/2026) — Control Plane (trang **Cấu hình chung**, **Khoá & token**, `GET /v1/secrets`), Hub (ghép ba tầng, khoá chỉ trong RAM). 21 test ở Control Plane, 10 ở Hub, đã chạy thật Hub ↔ Control Plane ↔ Keycloak.

## 10.1 Ý chính

| | Cấu hình thường (model, cờ, hạn giữ lịch sử) | Bí mật (khoá API, token) |
|---|---|---|
| Ai đặt | **Quản trị tổ chức** trên web Control Plane. Trưởng phòng và nhân viên không đặt được | **Quản trị tổ chức** trên web; **chỉ ghi**, không ai xem lại được giá trị |
| Lưu ở đâu | Bảng `tenant_config` (theo tổ chức hoặc theo phòng) | Bảng `tenant_secrets`, **mã hoá AES-256-GCM** (`CP_SECRETS_KEY`); AAD = `tenant|khoá` |
| Đến Hub bằng | Nằm trong **gói quyền đã ký** (`payload.config`) — kiểm chữ ký như mọi thứ khác | **Không** nằm trong gói quyền (gói chỉ ký, không mã hoá). Hub gọi riêng `GET /v1/secrets` sau khi nhận gói |
| Hub giữ thế nào | Áp vào cấu hình lúc chạy, không ghi đè file của người dùng | **Chỉ trong RAM** của tiến trình chính (env của Main): không ghi đĩa, không gửi cho giao diện, không xuất `.env`, không vào audit |
| Người dùng thường | Chỉ chỉnh được **khoá cá nhân** (xem 10.3) | **Không thấy, không đổi, không xoá**; chỉ dùng qua agent |

**Chiều đi một hướng:** quản trị chỉnh trên web, Hub chỉ **kéo về**. Hub không đẩy cấu hình lên Control Plane (Hub chạy trên máy không đáng tin; nguồn sự thật phải có kiểm soát vai trò, nhật ký, phiên bản và chữ ký).

## 10.2 Ba tầng

1. **Tổ chức** — quản trị đặt, có thể **KHOÁ**.
2. **Phòng ban** — quản trị đặt mặc định riêng cho một phòng, có thể khoá. Người thuộc nhiều phòng: phòng có **tên xếp trước** thắng (ổn định, đoán trước được). Giá trị tổ chức đã khoá thì phòng không ghi đè được.
3. **Cá nhân** — người dùng tự chỉnh, **chỉ** các khoá trong danh sách cá nhân và chỉ khi chưa bị khoá.

Thứ tự hiệu lực ở Hub: **khoá của tổ chức/phòng** > **giá trị cá nhân (trong trần)** > **mặc định của tổ chức/phòng** > `.env` của máy. Tầng dưới chỉ được **thu hẹp**.

## 10.3 Khoá cá nhân và chiều thu hẹp

| Khoá | Người dùng thường được | Giới hạn |
|---|---|---|
| `NEXLAB_MEMORY_RETENTION_DAYS` (giữ lịch sử) | chọn số ngày | **bằng hoặc ít hơn** giá trị tổ chức (tổ chức đặt 90 → chọn được 7 / 30 / 90) |
| `NEXLAB_MEMORY_PERSIST` (lưu lịch sử trên máy) | tắt (0) bất kỳ lúc nào | tổ chức đặt 0 thì **không bật lại** thành 1 |

Mọi khoá khác (nhà cung cấp, model, địa chỉ, chế độ tự học, tự chủ…) cần quyền `settings.config` (quản trị Hub) — Hub từ chối ở Main chứ không chỉ ẩn nút. Khoá mà tổ chức **khoá** thì ngay cả quản trị Hub cũng không đổi được trong Hub (đổi ở web). Ghi đè riêng từng app (tab «Riêng») cũng không vượt được khoá.

Giao diện Hub: mục bị khoá hiện «Do tổ chức đặt · khoá», mục người dùng không có quyền hiện «Chỉ quản trị đổi»; khoá cá nhân chỉ còn các lựa chọn hợp lệ. Đó chỉ là hiển thị — hàng rào thật nằm ở Main (`CHANNEL_ACCESS` + `ConfigStore`).

## 10.4 Khoá API và token

- Trang **Khoá & token**: 7 loại (Gemini, OpenRouter, TypeSafe, Anthropic, OpenAI, Notion, và JSON service account Google Cloud cho Vertex AI — xem 10.7). Nhập giá trị → mã hoá → chỉ còn «Đã đặt · ••••4 ký tự cuối». Chọn **vai Hub được nhận** (mặc định nhân viên, người soạn SOP, trưởng nhóm, quản trị; **viewer không bao giờ nhận**).
- Hub đăng nhập xong → nhận gói quyền → gọi `GET /v1/secrets` (Bearer + `X-Device-Id`, giới hạn 30 lần/phút/IP) → Control Plane chỉ trả khoá có **vai của người gọi** trong danh sách nhận. Chủ thể lấy từ token, không từ yêu cầu.
- Hub làm mới mỗi chu kỳ (15 phút / khi focus): khoá bị **xoá hoặc thu hồi vai** ở web → biến mất khỏi Hub ở lần làm mới kế; lỗi mạng tạm thời giữ khoá đang có; 401/403 thu hồi ngay; đăng xuất / bị vô hiệu hoá / gói hết hạn → thu hồi hết, khoá nhập tay trước đó (nếu có) hiện lại.
- Khi cấu hình hoặc khoá đổi, Hub **khởi động lại agent đang rảnh** để agent nhận (agent Python chỉ đọc env lúc khởi động); agent bận thì giữ nguyên.
- Nhật ký: `secret.set` / `secret.clear` ghi tên khoá, vai nhận, 4 ký tự cuối — **không bao giờ giá trị**; `secret.deliver` ghi tên khoá giao cho (người, thiết bị), tối đa một dòng mỗi giờ.

## 10.5 Giới hạn trung thực

1. **Khoá mô hình không còn rời server (từ 25/11).** Gemini, service account Vertex, TypeSafe, OpenRouter đi qua **cổng LLM** (`POST /v1/llm/…`, xem [08 · 8.6b2](08-api-cho-hub.md)): Hub chỉ nhận tên nhà cung cấp, máy chủ gắn khoá, áp hạn mức và ghi lượng dùng. Còn lại:
   - **Token Notion vẫn giao bản rõ** và nằm trong RAM của Hub (Notion MCP chạy trên máy người dùng). Người có quyền quản trị hệ điều hành vẫn lấy ra được.
   - Khoá **Anthropic / OpenAI** không được giao và chưa có đường qua cổng — tạm không dùng được ở chế độ này.
   - Nhân viên vẫn tự gọi được cổng bằng token đăng nhập của mình, nhưng chỉ đúng các đường đã khai, trong hạn mức, có dấu vết ở `llm_usage`, và mất ngay khi bị thu hồi.
   - `CP_SECRET_DELIVERY=legacy` quay về giao khoá bản rõ (chỉ để chạy bản Hub cũ).
2. Khởi động **ngoại tuyến** không có khoá tổ chức (khoá không lưu đĩa); agent dùng khoá của máy (nếu có) cho tới khi online.
3. `CP_SECRETS_KEY` (32 byte base64) **bắt buộc ở production**, tách khỏi khoá ký gói quyền. Mất khoá này = không giải mã được các khoá đã lưu (phải nhập lại); đổi khoá = nhập lại. Chưa có xoay khoá tự động.
4. Cấu hình theo phòng chỉ **quản trị tổ chức** đặt (trưởng phòng chưa được).
5. Hub lọc lại mọi giá trị bằng danh sách trắng của chính nó — Control Plane không thể đặt biến môi trường tuỳ ý trên máy người dùng.

## 10.7 Gemini qua Vertex AI dùng chung (01/11/2026)

Khoá thứ 7 trong **Khoá & token**: «Google Cloud (Vertex AI) — service account chung» (`GOOGLE_SERVICE_ACCOUNT_JSON`). Dán **nguyên file JSON** của một service account Google Cloud (quyền `roles/aiplatform.user`). Control Plane kiểm hình dạng (`type: service_account`, `project_id`, `client_email`, `private_key`, ≤ 4096 ký tự), lưu dạng JSON gọn, mã hoá như mọi khoá khác, chỉ còn «Đã đặt · ••••4 ký tự cuối `private_key_id`». **Từ chối** JSON `authorized_user` (ADC của một người — mang refresh token và mọi quyền của người đó).

Bật cho cả công ty gồm ba việc: (1) dán JSON ở **Khoá & token** và chọn vai nhận; (2) ở **Cấu hình chung** đặt `GOOGLE_GENAI_USE_VERTEXAI=true`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`; (3) nhân viên đăng nhập lại Hub. Hub nhận khoá chỉ vào RAM (không hiện trong danh sách khoá, không xuất `.env`), agent Python nạp thẳng từ JSON và **thắng ADC có sẵn trên máy**.

**Giới hạn của giai đoạn này:** khoá dài hạn nằm trong RAM máy nhân viên (dùng được ngoài Hub tới khi thu hồi); xoay khoá làm thủ công; chung quota/hoá đơn. Lộ trình nâng lên **token ngắn hạn do server cấp** (khoá không rời Control Plane) nằm trong `docs/superpowers/plans/2026-11-01-vertex-chung-service-account.md` ở repo Hub (giai đoạn B).

## 10.6 Dành cho lập trình viên

- Danh mục khoá dùng chung: `src/lib/config-keys.ts` (Hub giữ **bản sao nguyên văn** ở `src/shared/control-plane/config-keys.ts`, test chống lệch).
- Ghép tầng: `resolveConfig()` (hàm thuần, có test) → `resolveConfigForUser()` → `buildEntitlementPayload()` (`payload.config`).
- Dịch vụ: `src/server/services/config.ts`; mã hoá: `src/server/secrets-crypto.ts`; route: `src/app/v1/secrets/route.ts`; trang: `src/app/(console)/config`, `secrets`.
- Hub: `ConfigStore.setProvisioned()`, `ApiKeyStore.setProvisioned()`, `EntitlementManager.onSecrets`, quy tắc `permOrPersonalConfig` trong `CHANNEL_ACCESS`; cài đặt và khoá của người dùng nằm trong **thư mục dữ liệu riêng của người đó** (`users/<key>/nexlab/`).
