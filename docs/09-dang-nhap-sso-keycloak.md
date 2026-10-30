# 9. Đăng nhập SSO (OIDC) với Keycloak

> Trạng thái: **ĐÃ LÀM và đã chạy thật** — Keycloak 26.4 local (2 realm), Control Plane kiểm token bằng JWKS, liên kết người dùng, tự tạo tài khoản (JIT), đồng bộ nhóm → phòng ban, ép SSO khi tenant có IdP. 35 test (29 với IdP giả tự dựng, 6 với Keycloak thật) và một lần chạy đầy đủ bằng trình duyệt thật. **Chưa làm:** Hub chưa có `IdentityService` (script mẫu `npm run hub:login` mô phỏng đúng luồng); Admin Console vẫn đăng nhập bằng mật khẩu cục bộ.

## 9.1 Ai làm việc gì

| Việc | Ai làm | Ở đâu |
|---|---|---|
| **Xác thực**: người này là ai, mật khẩu đúng không, MFA | **IdP** (Keycloak / Entra / Google) | Ngoài Control Plane |
| **Phân quyền**: người này được dùng app nào, mức nào | **Control Plane** | Danh mục, phòng ban, ma trận |
| **Cưỡng chế** trên máy người dùng | **Hub** | Main process |

Control Plane **không giữ mật khẩu** của người dùng SSO (tài khoản tạo qua SSO có mật khẩu "không dùng được"). Nhờ vậy đổi / thêm IdP của khách không đụng luật quyền, và chính sách mật khẩu, MFA, khoá tài khoản của công ty khách áp dụng nguyên vẹn.

## 9.2 Luồng đăng nhập của Hub

```
Hub (Main)                    Trình duyệt hệ thống          Keycloak (IdP)            Control Plane
  │ POST /v1/discover {email} ─────────────────────────────────────────────────────────►│
  │ ◄──────────────── {tenant, auth:{method:"oidc", issuer, clientId, scopes}} ─────────┤
  │ GET {issuer}/.well-known/openid-configuration ─────────────────►│                    │
  │ mở trình duyệt: authorize?client_id&redirect_uri=http://127.0.0.1:<cổng ngẫu nhiên>/callback
  │                              &code_challenge=<S256>&state ─────►│ người dùng nhập mật khẩu (+MFA)
  │ ◄───────────── redirect 127.0.0.1:<cổng>/callback?code&state ───┤                    │
  │ POST token_endpoint {code, code_verifier} ──────────────────────►│ → access_token (5 phút)
  │ GET /v1/entitlements   Authorization: Bearer <access_token>   X-Device-Id: <deviceId> ─►│
  │                                                                  kiểm token, liên kết người dùng,
  │                                                                  đồng bộ nhóm, ký gói quyền
  │ ◄──────────────────────────────────────────────── {payload, signature Ed25519} ────┤
  │ verifyEntitlement(...) → áp quyền
```

Điểm bảo mật của phía Hub (theo RFC 8252 / OAuth cho ứng dụng cài trên máy):
- **Trình duyệt hệ thống**, không dùng cửa sổ nhúng (Hub không thấy mật khẩu).
- **Authorization Code + PKCE (S256)**; client **công khai**, không có client secret trong bản cài.
- **Redirect loopback `127.0.0.1` cổng ngẫu nhiên**; kiểm `state`; server callback chỉ bind `127.0.0.1`, dùng một lần rồi đóng.
- Đã **thử thật**: Keycloak chấp nhận cổng loopback bất kỳ và **từ chối** redirect tới địa chỉ lạ (`evil.example.com` → 400).

Script mẫu chạy đúng chuỗi trên: `npm run hub:login -- --email nv.nhansu@nexlab.tech` (thêm `--no-open` để chỉ in địa chỉ đăng nhập). Nó dùng `verifyEntitlement` từ `src/lib/entitlement.ts` — chính file Hub sẽ nhập.

## 9.3 Chạy Keycloak local

```bash
docker compose up -d keycloak     # http://localhost:8081  (đợi ~40 giây lần đầu)
npm run db:reset                  # seed Control Plane có sẵn cấu hình IdP trỏ tới 2 realm
```

| Thứ | Giá trị |
|---|---|
| Console quản trị Keycloak | http://localhost:8081 — tài khoản `admin` (mật khẩu trong `docker-compose.yml`, chỉ dev) |
| Realm = tenant | `nexlab` (tenant Nexlab), `benhvien-b` (tenant Bệnh viện Demo B) |
| Client của Hub | `nexlab-hub` — công khai, PKCE S256, redirect `http://127.0.0.1:*` và `http://localhost:*` |
| Nhóm (= phòng ban) | `nhan-su`, `ke-toan`, `kinh-doanh`, `cntt` (nexlab); `khoa-noi` (benhvien-b) |
| Người dùng | giống tài khoản mẫu của Control Plane (cùng email, cùng mật khẩu dev) + `nguoimoi@nexlab.tech` **chỉ có ở Keycloak** để thử luồng nhân viên mới |
| Dữ liệu | **Không gắn volume**: xoá container = về trạng thái mẫu, import lại từ `keycloak/realms/*.json` |

File realm **sinh từ `src/server/seed-data.ts`** bằng `npm run keycloak:gen` để tài khoản Keycloak và Control Plane không lệch nhau. Sửa dữ liệu mẫu → chạy lại lệnh sinh → `docker compose rm -sfv keycloak && docker compose up -d keycloak`.

> **Cảnh báo:** file realm chứa mật khẩu mẫu và bật **Direct Access Grants** (đăng nhập bằng mật khẩu qua API, chỉ để chạy test tự động). Không dùng cấu hình này ở production.

Token Keycloak dev: `iss = http://localhost:8081/realms/<realm>`, `azp = nexlab-hub`, `email`, `email_verified`, `name`, `groups` (tên nhóm không có `/`), sống 5 phút.

## 9.4 Cấu hình trong Control Plane

**Quản trị nền tảng** (Tổ chức → biểu tượng vân tay) khai báo SSO cho từng tenant:

| Trường | Ý nghĩa |
|---|---|
| **Issuer** | Địa chỉ gốc của IdP (Keycloak: `…/realms/<tên>`). Phải HTTPS (http chỉ `localhost` ở chế độ lab). Hệ thống **kiểm tra kết nối** `.well-known/openid-configuration` trước khi lưu; sai thì báo lỗi ngay ở ô Issuer |
| **Client ID của Hub** | Client công khai đã tạo cho Hub ở IdP |
| **Claim chứa nhóm** | Mặc định `groups` |
| **Đồng bộ phòng ban từ nhóm IdP** | Bật: mỗi lần đăng nhập, thành viên phòng được thêm / bớt theo nhóm (9.6) |
| **Tự tạo tài khoản lần đầu (JIT)** | Bật: người có email đúng tên miền nhưng chưa có tài khoản được tạo tự động (9.5) |

Vì sao **chỉ quản trị nền tảng** được khai báo: tin một issuer nghĩa là mọi token nó ký cho client này được coi là người của tenant, và server sẽ tải khoá từ địa chỉ đó — đây là quyết định bảo mật, không phải cài đặt tiện ích. Quản trị tổ chức xem được cấu hình ở **Cài đặt tổ chức** (chỉ đọc).

**Quản trị tổ chức** gắn **Nhóm IdP** cho từng phòng (Phòng ban → Sửa → "Nhóm trên IdP", ví dụ `kinh-doanh`). Một nhóm chỉ gắn được cho **một** phòng trong một tenant. Phòng không gắn nhóm thì chỉ do quản trị thêm tay.

**Mỗi tenant tối đa một IdP**, và một issuer chỉ thuộc **một** tenant.

## 9.5 Liên kết người dùng

Khi token hợp lệ tới, Control Plane tìm tài khoản theo thứ tự:

| Bước | Điều kiện | Kết quả |
|---|---|---|
| 1 | Đã có tài khoản với **(issuer, sub)** này | Dùng luôn. Đổi email ở IdP **không** làm mất tài khoản |
| 2 | Chưa, nhưng **email đã được IdP xác minh** (`email_verified=true`) và khớp tài khoản trong **cùng tenant**, tài khoản đó **chưa liên kết** danh tính nào | **Liên kết** (lần đầu), ghi nhật ký `user.sso_link` |
| 3 | Email khớp tài khoản đã liên kết với `sub` **khác** | **403** — chống chiếm tài khoản bằng email trùng |
| 4 | Email khớp tài khoản của tenant khác | **403** |
| 5 | Không có tài khoản, **JIT bật**, email đúng tên miền tenant | **Tạo mới**: vai trò nhân viên, **không** quyền quản trị, mật khẩu không dùng được; ghi `user.sso_create`; tăng `policy_version` |
| 6 | Không có tài khoản, JIT tắt (hoặc sai tên miền) | **403** "Tài khoản chưa được cấp" |
| — | Email chưa xác minh mà chưa liên kết | **401** |

Hai điều cần biết: (a) quyền **quản trị** không bao giờ được cấp qua SSO — người tạo qua JIT luôn là nhân viên; (b) tài khoản đã **vô hiệu hoá** ở Control Plane thì token IdP còn hạn cũng bị từ chối **ngay**.

## 9.6 Đồng bộ nhóm → phòng ban

Chạy mỗi lần Hub lấy gói quyền (nếu tenant bật):

| Tình huống | Hành vi |
|---|---|
| Nhóm trong token trùng "Nhóm IdP" của một phòng | Thêm người vào phòng, nguồn `idp` |
| Người đã bị bỏ khỏi nhóm ở IdP | Gỡ khỏi phòng (chỉ các dòng nguồn `idp`); nếu họ đang là **trưởng phòng** phòng đó thì mất chức; ghi `membership.sso_sync` |
| Thành viên do quản trị **thêm tay** (nguồn `manual`) | **Không bị đụng tới** — hai nguồn cùng tồn tại, người dùng ở phòng nếu có ít nhất một |
| Nhóm lạ (không gắn phòng nào) | Bỏ qua |
| Token **thiếu hẳn** claim nhóm | Coi như không thuộc nhóm nào → gỡ các thành viên nguồn `idp` (thu hẹp, không mở rộng). Nếu mất phòng hàng loạt, kiểm tra mapper `groups` ở IdP |
| So khớp tên | Không phân biệt hoa thường; chấp nhận tiền tố `/` của Keycloak |

Thành viên nguồn `idp` hiện nhãn **"Đồng bộ từ IdP"** ở trang chi tiết phòng và **không** gỡ tay được trong Admin Console — phải đổi ở IdP. Mọi thay đổi tăng `policy_version`, nên Hub thấy gói mới ở lần làm mới kế tiếp.

## 9.7 Kiểm token — các lớp bảo vệ

| Lớp | Chống |
|---|---|
| Issuer đọc từ token chỉ để **tìm cấu hình**; chỉ nhận issuer **đã khai báo trong DB**. JWKS luôn tải từ địa chỉ **trong cấu hình**, không từ token | Giả issuer, SSRF qua token |
| Tài liệu discovery phải tự khai **đúng issuer** và `jwks_uri` **cùng origin** | Discovery bị đánh tráo |
| Chỉ nhận thuật toán bất đối xứng (RS/PS/ES/EdDSA); từ chối `none`, HS* | Tấn công đổi thuật toán |
| Token phải cấp **cho client của Hub** (`azp` hoặc `aud`) | Dùng token của app khác trong cùng realm |
| Kiểm `exp` (lệch đồng hồ cho phép 30 giây) | Token hết hạn |
| Khoá của tenant A **không** xác thực được token mang issuer tenant B | Chéo tenant |
| Header `X-Device-Id` bắt buộc; thiết bị thu hồi → 403 | Dùng token trên máy lạ |

Lỗi trả về: `401` token sai / hết hạn / người bị vô hiệu hoá; `403` chưa có tài khoản, email thuộc tenant khác, thiết bị bị thu hồi; `400` thiếu / sai `X-Device-Id`; `503` không kết nối được IdP (không đoán, không bỏ qua kiểm tra).

## 9.8 Ép SSO

- Tenant **đã có IdP**: `POST /v1/auth/token` (mật khẩu cục bộ) trả **403**, và token cục bộ phát hành trước đó **mất hiệu lực** — để không ai vòng qua MFA / chính sách của IdP.
- `discover` chỉ trả `auth.method = "oidc"` cho tenant có IdP.
- **Production** mặc định **tắt hẳn** token mật khẩu cục bộ (`CP_LOCAL_HUB_TOKENS=1` mới bật lại; dev tự bật). Tenant chưa có IdP ở production thì Hub chưa đăng nhập được — đúng chủ ý.

## 9.9 Vòng đời người dùng khi có SSO

| Tình huống | Làm ở đâu | Hiệu lực |
|---|---|---|
| **Nhân viên mới** | IdP: tạo tài khoản + cho vào nhóm phòng | Lần đăng nhập Hub đầu tiên: tự tạo (nếu JIT bật) hoặc quản trị tạo trước; vào phòng theo nhóm |
| **Chuyển phòng** | IdP: đổi nhóm | Lần làm mới gói kế tiếp (tối đa 15 phút theo thiết kế Hub): mất app phòng cũ, có app phòng mới |
| **Nghỉ việc** | IdP: vô hiệu hoá / xoá tài khoản **và** Control Plane: Vô hiệu hoá | IdP ngừng cấp token (token hiện có sống tối đa 5 phút); Control Plane chặn ngay cả token còn hạn |
| **Mất máy** | Control Plane: thu hồi thiết bị (hiện bằng DB — chưa có màn hình) | Máy đó bị 403 |

> **Giới hạn đáng nói:** vô hiệu hoá ở **IdP** không tự thông báo cho Control Plane; trong cửa sổ sống của token (5 phút với Keycloak dev) và tới khi Hub đăng nhập lại, người đó vẫn dùng được. Khép lại bằng SCIM / sự kiện thu hồi (CAEP) — mốc M8. Cho tới khi đó, nghỉ việc nên làm **cả hai phía**.

## 9.10 Việc Hub cần làm (checklist cho `IdentityService`)

1. Sinh `deviceId` (UUID) một lần, lưu trong kho an toàn; gửi ở header `X-Device-Id` mọi lần gọi `/v1/entitlements`.
2. `discover` → nếu `auth.method === "oidc"` thì làm PKCE như 9.2 (mẫu: `scripts/hub-login.ts`).
3. Giữ **refresh token** bằng `safeStorage` (dùng API **async**: `encryptStringAsync`) và làm mới access token với IdP; **không** gửi refresh token cho tiến trình Python.
4. Mỗi 15 phút / khi cửa sổ được focus: lấy gói quyền mới, `verifyEntitlement` với **khoá nhúng trong bản build**, `lastSeenPolicyVersion` lưu lại.
5. Gói bị từ chối hoặc hết hạn → **thu hẹp** (chỉ mở app, tắt agent), không mở rộng.
6. `401` ở `/v1/entitlements` → đăng nhập lại; `403` thiết bị bị thu hồi → khoá Hub và báo người dùng.

## 9.11 Entra ID, Google và các IdP khác (chưa kiểm chứng)

Phần OIDC dùng chuẩn nên về nguyên tắc đổi issuer là đủ, nhưng **chưa thử thật** với IdP khác Keycloak. Điểm cần xem khi nối:
- **Microsoft Entra ID:** claim nhóm trong token thường là **Object ID** của nhóm (và bị cắt khi người dùng thuộc quá nhiều nhóm) → "Nhóm IdP" của phòng nên điền Object ID; cần cấu hình token gửi claim nhóm. `azp` / `aud` khác Keycloak — kiểm `aud` = client ID.
- **Google Workspace:** token không có claim nhóm → tắt đồng bộ nhóm, quản trị thêm thành viên tay (hoặc làm SCIM).
- Mọi IdP: phải trả `email` + `email_verified`, và Control Plane phải tải được `.well-known/openid-configuration`.

## 9.12 Đưa lên production

| Việc | Lý do |
|---|---|
| IdP dùng HTTPS với tên miền thật; đặt `KC_HOSTNAME` cho Keycloak | `iss` trong token phải khớp **chính xác** issuer đã khai báo; chạy Control Plane trong Docker thì `localhost` không còn đúng |
| Tắt Direct Access Grants; bỏ file realm chứa mật khẩu mẫu | Chỉ dùng cho test |
| Tắt `CP_ALLOW_DEV_ORIGINS`, `CP_SEED_IDP`, `CP_AUTO_SEED`, `CP_DEV_LOGIN` | Không có http / seed / đăng nhập nhanh ở production |
| Không bật `CP_LOCAL_HUB_TOKENS` | Ép SSO |
| Rút ngắn / điều chỉnh vòng đời token theo chính sách khách | Cửa sổ thu hồi (9.9) |
| Bộ nhớ đệm discovery / JWKS hiện theo từng tiến trình (10 phút) | Khi xoay khoá ở IdP, tối đa 10 phút để thấy khoá mới (JWKS tự làm mới khi gặp `kid` lạ) |

## 9.13 Test

- `test/sso.test.ts` (29 test, IdP giả tự dựng bằng `jose` + máy chủ HTTP): chữ ký khoá lạ / khoá tenant khác, issuer lạ, hết hạn, sai `azp`, HS256 giả mạo, rác; `aud` thay `azp`; discovery sai; liên kết (email chưa xác minh, đã liên kết sub khác, tenant khác); JIT (thành công, tắt, sai tên miền, mật khẩu không đoán được); đồng bộ nhóm (gỡ nhóm, thiếu claim, giữ thành viên `manual`, mất chức trưởng phòng, hoa thường / tiền tố `/`); vô hiệu hoá, tạm ngưng, thiết bị thu hồi; ép SSO; production tắt token cục bộ; cấu hình IdP (chỉ nền tảng, issuer http, không kết nối, trùng issuer, audit).
- `test/keycloak.integration.test.ts` (6 test, **Keycloak thật**, tự bỏ qua nếu không chạy): discover, đăng nhập thật → gói ký, người hai nhóm, JIT, tenant thứ hai, quản trị không phòng.
