# Kuaishou Media Downloader & Multi-Platform Poster (No Watermark)

## Slideshow phong cảnh — đăng riêng TikTok

Chạy `npm run ui:tiktok`, mở `http://localhost:3003`. Phiên này chỉ cho phép đăng TikTok, có trạng thái hàng đợi riêng và chặn các API đăng Instagram/Facebook/Threads. Hàng đợi chỉ chạy khi bạn bật Bắt đầu; phiên đa nền tảng đang chạy ở cổng khác vẫn hoạt động độc lập.

Bộ dựng TikTok dùng Node.js + FFmpeg hiện có: H.264 1080×1920, SAR 1:1, 30 fps; mặc định 14 giây, khoảng 6 ảnh khi đủ nguồn, dissolve 0,3 giây. Ảnh chính được fit trọn vẹn lên nền mờ; zoom 3,5% nằm trong khoảng đệm, giữ chủ thể ở mép ảnh. Chữ được chèn sau chuyển cảnh để không bị zoom hay chồng hai câu. TikTok không còn đi qua bước đổi cao độ âm thanh.

Chỉnh `tiktok-slideshow.config.json` rồi chạy lượt mới (không cần khởi động lại để đọc cấu hình dựng):

| Thuộc tính | Cách dùng |
| --- | --- |
| `durationSeconds` | Tổng thời lượng, gồm cả phần chồng chuyển cảnh; mặc định 14 giây |
| `secondsPerImage` | Nhịp mục tiêu 2,6 giây để chọn số ảnh; ít ảnh thì thời lượng mỗi cảnh dài hơn |
| `sceneCount` | Tuỳ chọn ép số cảnh; không lặp ảnh khi thiếu nguồn |
| `heroImageIndex` | Chọn ảnh nổi bật đưa lên đầu, đếm từ 0 theo thứ tự ảnh nguồn; bỏ qua thì ưu tiên ảnh nhiều pixel nhất, chỉ là lựa chọn sơ bộ |
| `imageOrder` | Tuỳ chọn chọn và sắp thứ tự ảnh bằng mảng chỉ số, không trùng; nếu không chỉ định hero thì ảnh đầu mảng là ảnh mở đầu |
| `sceneTexts` | Mảng câu theo thứ tự xuất hiện sau khi đổi ảnh mở đầu; cùng số cảnh thì một câu mỗi cảnh. Ít câu hơn cảnh thì giữ câu qua các cảnh liền nhau, không vẽ lại trên mỗi ảnh. `[]` để bỏ chữ |
| `transitionSeconds`, `zoomAmount` | Chuyển cảnh 0,1–0,8 giây; zoom 0–0,04 để giữ trọn ảnh |
| `text.fontSize`, `text.fontPath` | Mặc định 44px và Segoe UI Semibold hỗ trợ tiếng Việt. Hai dòng được cân độ dài và căn giữa màn hình, chữ trắng có viền mảnh/bóng nhẹ, không dùng khung đen. Đo chiều rộng theo font thực, giảm tối thiểu 30px; báo lỗi nếu vẫn quá dài, không cắt bỏ chữ |
| `text.positionY` | Vị trí 0–1 trong vùng an toàn, mặc định 0,68 |
| `text.marginLeft/Right/Top/Bottom` | Lề theo pixel; mặc định 200/200/180/420. Chữ căn giữa video, chiều rộng tuân theo lề ngang lớn hơn để luôn cân và chừa nút TikTok |
| `audio.volume`, `audio.fadeSeconds` | Mặc định âm lượng 0,3 và fade đầu/cuối 0,5 giây. Nhạc ngắn được lặp đủ thời lượng; thiếu nhạc dùng âm thanh im lặng |
| `caption` | Tuỳ chọn caption TikTok; trong phiên TikTok riêng, caption nhập thủ công được ưu tiên |

API `/api/tiktok/post` và `/api/run-pipeline` nhận thêm `slideshowConfig` để ghi đè cấu hình cho từng lượt. Trên giao diện, nhập mỗi dòng một câu cho link chạy thủ công/đăng lại TikTok; để trống dùng cấu hình mặc định. Hàng đợi đọc câu chuyện từ file cấu hình. Công tắc chèn chữ tắt sẽ xuất không chữ; câu tâm trạng đơn cũ không còn lặp trên slideshow TikTok. Phần dựng Instagram/Facebook vẫn dùng bộ dựng riêng trước đó.

Ví dụ bốn câu và caption bạn cung cấp nằm trong `tiktok-slideshow.norway.example.json`. Đây là mẫu cấu hình; chỉ dùng tên Na Uy khi ảnh thực tế đúng địa điểm. Render kiểm tra bằng `npm run render:tiktok` hoặc:

```powershell
node render-tiktok-sample.mjs "downloads/thu-muc-anh" "tiktok-slideshow.norway.example.json" "artifacts/tiktok-landscape-sample.mp4"
node verify-tiktok-slideshow.mjs "artifacts/tiktok-landscape-sample.mp4"
```

Lệnh render không đăng bài. Video mẫu và caption nằm trong `artifacts/`; khung đầu/giữa/cuối và mọi điểm chuyển cảnh nằm trong `artifacts/slideshow-qa/`. Bộ dựng lưu `.story.json` để đối chiếu thứ tự ảnh, thời gian và chữ. Thay cấu hình/ảnh/font làm cache mất hiệu lực. Các thay đổi nhằm cải thiện khả năng đọc và trải nghiệm xem, không bảo đảm lượt xem hoặc khắc phục hạn chế phân phối.

Tool tải video và ảnh chất lượng gốc từ link chia sẻ Kuaishou (QuickWorker / 快手), hoàn toàn không dính logo watermark, tự động đăng lên Instagram, TikTok, Facebook.

---

## Các tính năng chính
- Tuỳ chọn tải Video gốc hoặc Bộ ảnh: Tự động phát hiện nếu bài đăng là Video ngắn (MP4) hoặc Bộ sưu tập ảnh (Atlas Slide).
- Tải không dính logo watermark: Lấy trực tiếp từ server CDN với chất lượng gốc cao nhất.
- Hỗ trợ cả video ngắn, ảnh đơn và album nhiều ảnh.
- Tự động tải kèm nhạc nền (audio.m4a) nếu bài đăng có nhạc riêng.
- Bộ tạo Video điện ảnh 30fps (Ken Burns Zoom & Slideshow): Tự động ghép album ảnh thành video dọc 9:16 chuẩn Reels/TikTok/Shorts, có chuyển động và màu sắc được xử lý cho dễ xem.
- Lưu thông tin tiêu đề, tác giả vào file info.txt.

## Khi video có rất ít lượt xem

- Xem TikTok Studio → Analytics của từng video để biết video có đủ điều kiện xuất hiện trên For You hay không. Kiểm tra Account Status trên Instagram để xem tài khoản và bài đăng có được đề xuất không.
- Video tải từ Kuaishou vẫn là nội dung đăng lại dù không có watermark. Chỉ đăng nội dung bạn có quyền sử dụng; ưu tiên video tự tạo hoặc có phần đóng góp sáng tạo đáng kể. Công cụ không thể bảo đảm lượt xem.
- Caption mặc định hiện chỉ thêm tối đa 4 hashtag khi tiêu đề cho thấy chủ đề rõ ràng. Hãy sửa caption theo từng video, nói rõ điều người xem sẽ thấy hoặc nhận được; không dùng một bộ hashtag chung cho toàn bộ hàng đợi.
- TikTok có thể hiển thị cảnh báo bản quyền hoặc điều kiện đăng. Công cụ sẽ dừng ở cảnh báo và giữ file đã tải để bạn kiểm tra. Nếu không có xác nhận đăng thành công, công cụ báo lỗi để tránh đăng lại trùng.
- Để chẩn đoán nguyên nhân, so sánh vài video tự tạo với vài video đăng lại cùng chủ đề trong 1–2 tuần. Ghi lại lượt tiếp cận người chưa theo dõi, thời gian xem, tỷ lệ xem hết, chia sẻ và trạng thái đủ điều kiện đề xuất; số view riêng lẻ chưa đủ để kết luận tài khoản bị hạn chế.

---

## Cách sử dụng

Trước khi chạy, cài dependencies bằng `npm install`, sao chép `.setting.example` thành `.setting`, rồi điền `sheetId` và đặt khóa service account Google vào tệp `google-service-account.json`. Các tệp `.setting`, khóa Google và phiên đăng nhập mạng xã hội chỉ lưu trên máy, không đưa lên GitHub.

### 1. Sử dụng Giao diện Web (UI Trực Quan - Khuyên dùng)
Chạy lệnh:
```bash
npm run ui
# hoặc: node server.js
```
- Trình duyệt sẽ tự động mở địa chỉ: `http://localhost:3000`
- Giao diện có sẵn ô nhập link -> bấm "Bấm Chạy".
- Xem trước video gốc trực tiếp trên giao diện hoặc xem danh sách ảnh/nghe nhạc.
- Nút "Tải Video (.mp4)" hoặc "Tải lại vào máy" và "Mở thư mục lưu" chỉ với 1 click.

---

### 2. Sử dụng dòng lệnh Terminal (CLI)
```bash
npm start
# hoặc: node download_kuaishou.js
```
Tool sẽ hiện nhắc:
```text
--- TOOL TẢI KUAISHOU (NO WATERMARK) ---
Nhập link Kuaishou (hoặc gõ exit để thoát):

Nhập link:
```
Bạn chỉ cần dán link vào và bấm `Enter`, tải xong có thể dán tiếp link khác.

### 3. Tải nhanh bằng cách truyền link trực tiếp qua dòng lệnh
```bash
node download_kuaishou.js "https://v.kuaishou.com/KzRiYcFY"
```

Bạn cũng có thể tải cùng lúc nhiều link:
```bash
node download_kuaishou.js "link_1" "link_2" "link_3"
```

---

## Tính năng Tự Động Đăng Đa Nền Tảng (Instagram, TikTok, Facebook)
Threads được đăng trực tiếp bằng phiên đăng nhập riêng, không dùng công tắc chia sẻ của Instagram. Bấm **Threads: Bấm để đăng nhập** trên giao diện, hoàn tất đăng nhập trong cửa sổ mở ra, rồi bật công tắc **Threads**. Tùy chọn này cũng áp dụng cho hàng đợi Google Sheets. Nút **Đăng riêng lên Threads** cho phép đăng hoặc thử lại Threads mà không đăng lại Instagram/TikTok. Mô tả Threads không có tài khoản `@` và tối đa 500 ký tự; nếu vượt giới hạn, công cụ báo lỗi để bạn rút gọn. Chỉ báo Threads thành công khi nhận được xác nhận từ Threads; nếu lỗi, giữ lại file và hiển thị cảnh báo riêng.

Nếu server đang chạy bản cũ, dừng bằng `Ctrl+C` ở terminal đang chạy rồi chạy lại `npm run ui`. Có thể mở đăng nhập Threads độc lập bằng `npm run threads:login`; sau khi đăng nhập thành công, trạng thái trên giao diện tự cập nhật.

Để dùng Threads trong khi ứng dụng chính còn chạy bản cũ, chạy `npm run ui:threads` và mở `http://localhost:3001`. Phiên này chỉ đăng Threads bằng link bạn nhập, không chạy hoặc sửa hàng đợi Google Sheets của ứng dụng chính. Chạy `npm run test:threads-api` để kiểm tra API, phiên đăng nhập và giao diện của phiên này; lệnh kiểm tra không đăng bài thật.

Hàng đợi đầy đủ có thể chạy bằng `npm run ui:all` tại `http://localhost:3002`. Tạm dừng hàng đợi ở server cũ trước khi dùng server này. Bật cả Instagram, Facebook, TikTok và Threads để mỗi link trong cột A được gửi tới cả bốn nền tảng. Nếu Instagram không tìm thấy ô tải tệp sau 20 giây, công cụ tự động bỏ qua Instagram/Facebook, tiếp tục các nền tảng khác rồi xóa link đã xử lý khỏi cột A và chuyển sang dòng tiếp theo. Giao diện ghi rõ đã bỏ qua, không đánh dấu Instagram/Facebook đăng thành công; file tải về vẫn được giữ lại. Với lỗi nền tảng khác, công cụ giữ link và dừng hàng đợi, lưu những nền tảng đã đăng thành công. Khi bấm Bắt đầu lại, công cụ chỉ thử các nền tảng chưa thành công và chưa bị bỏ qua. Facebook được chia sẻ qua Instagram; chỉ đánh dấu Facebook thành công khi xác nhận công tắc chia sẻ đã bật.

TikTok đợi kiểm tra bản quyền nhạc và nội dung tối đa 3 phút, cập nhật thời gian chờ trên giao diện mỗi 30 giây. Nếu kiểm tra vẫn đang chạy sau 3 phút, công cụ tự động bấm Đăng một lần rồi chờ xác nhận thành công. Nếu TikTok báo lỗi/cảnh báo cụ thể, công cụ dừng và giữ link/video. Mô tả và hashtag được nhập, kiểm tra lại sau khi video xử lý xong để tránh bị TikTok xóa khi thay trình soạn thảo.

1. **Công tắc độc lập từng nền tảng**:
   - Giao diện có 3 công tắc gạt riêng biệt:
     - **Instagram**: Đăng Reel video (video gốc hoặc reel tạo từ ảnh).
     - **TikTok**: Đăng trực tiếp video lên TikTok Studio.
     - **Facebook**: Tự động chia sẻ đồng thời sang tài khoản Facebook liên kết trong Meta Accounts Center.
   - Bạn chỉ cần bật công tắc nền tảng bạn muốn đăng (cần cái nào thì bật cái đó). Nếu tắt hết, tool sẽ chỉ tải video/ảnh/nhạc về máy tính mà không đăng bài.
2. **Đăng nhập lần đầu**:
   - Bấm vào các nút trạng thái ở góc trên (Instagram / TikTok) để mở cửa sổ trình duyệt đăng nhập 1 lần duy nhất. Phiên đăng nhập sẽ được lưu tự động cho các lần sau.

---

## Tự động chạy từ Google Sheets

Chạy `npm run ui` và giữ ứng dụng mở. Bảng được kết nối sẵn:
https://docs.google.com/spreadsheets/d/1UFeWWg3cOwbOEwhZDftC_qUWOE_8UwX49sincJgJl2g/edit?usp=sharing

- Dán mỗi link Kuaishou vào một dòng của **cột A**, bắt đầu từ **A1** trên trang tính đầu tiên.
- Để trống ô nhập link trên giao diện rồi bấm **Bắt đầu**: ứng dụng quét từ A1 và xử lý ngay link đầu tiên tìm thấy. Sau khi xử lý xong, đồng hồ trên giao diện đếm ngược phút và giây tới lượt kế tiếp.
- Chỉnh `intervalSeconds` trong file `.setting` để đặt thời gian chờ giữa hai lượt (đơn vị giây, tối thiểu 5; 1800 giây = 30 phút). Đây là khoảng nghỉ sau khi xử lý xong, không phải thời gian xử lý một bài. Mỗi lượt chỉ xử lý một link. Xử lý thành công sẽ xóa **ô ở cột A** của dòng đó.
- Dòng trống được bỏ qua trong cùng lượt quét. Khi hết link trong cột A, ứng dụng tự dừng. Bấm **Bắt đầu** để quét lại từ A1 nếu đã thêm link mới.
- Để có quyền xóa ô, bật Google Sheets API cho project của service account và chia sẻ bảng cho `lun-83@loginwithjavascript.iam.gserviceaccount.com` với quyền **Người chỉnh sửa**. Khóa JSON hiện được chỉ định trong `.setting`.
- Các lựa chọn Instagram, TikTok, Facebook và ngôn ngữ caption trong giao diện cũng áp dụng cho hàng đợi. Lỗi tải mạng hoặc lỗi đăng từng nền tảng sẽ giữ nguyên ô và dừng để bạn kiểm tra trước khi bấm **Bắt đầu** thử lại; nền tảng đã xác nhận thành công được bỏ qua. Link không hợp lệ và các lỗi xử lý khác được ghi lại rồi xóa ô để tiếp tục hàng đợi. Nếu Google Sheets chưa xóa được ô sau khi xử lý thành công, ứng dụng sẽ thử xóa lại mà không chạy lại link.
- Khi xử lý, giao diện hiển thị bước hiện tại và thời gian của bước đó. Ảnh được tải tối đa 3 ảnh cùng lúc; video đã tạo được dùng lại khi thử lại nếu ảnh, nhạc và nội dung chữ không đổi. Phần tải từ mạng có giới hạn thời gian và thử lại tối đa 2 lần; thao tác đăng bài không được tự động phát lại.

---

## Thư mục lưu file

Toàn bộ video/ảnh sẽ được tải vào thư mục:
```text
D:\code\kuaishou\downloads\<TênTácGiả>_<PhotoID>\
├── video.mp4 (nếu là bài đăng video gốc)
├── image_01.jpg
├── image_02.jpg
├── audio.m4a (nếu có nhạc nền riêng)
└── info.txt (tiêu đề, link gốc, tác giả, loại nội dung)
```
