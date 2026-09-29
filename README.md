# Kuaishou Media Downloader & Multi-Platform Poster (No Watermark)

Tool tải video và ảnh chất lượng gốc từ link chia sẻ Kuaishou (QuickWorker / 快手), hoàn toàn không dính logo watermark, tự động đăng lên Instagram, TikTok, Facebook.

---

## Các tính năng chính
- Tuỳ chọn tải Video gốc hoặc Bộ ảnh: Tự động phát hiện nếu bài đăng là Video ngắn (MP4) hoặc Bộ sưu tập ảnh (Atlas Slide).
- Tải không dính logo watermark: Lấy trực tiếp từ server CDN với chất lượng gốc cao nhất.
- Hỗ trợ cả video ngắn, ảnh đơn và album nhiều ảnh.
- Tự động tải kèm nhạc nền (audio.m4a) nếu bài đăng có nhạc riêng.
- Bộ tạo Video điện ảnh 30fps (Ken Burns Zoom & Slideshow): Tự động ghép album ảnh thành video dọc 9:16 chuẩn Reels/TikTok/Shorts, có chuyển động mượt mà và màu sắc tối ưu thuật toán lên xu hướng.
- Lưu thông tin tiêu đề, tác giả vào file info.txt.

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
- Chỉnh `intervalSeconds` trong file `.setting` để đặt thời gian chờ giữa hai lượt (đơn vị giây, tối thiểu 5; hiện là 3600 giây = 60 phút). Mỗi lượt chỉ xử lý một link. Xử lý thành công sẽ xóa **ô ở cột A** của dòng đó.
- Dòng trống được bỏ qua trong cùng lượt quét. Khi hết link trong cột A, ứng dụng tự dừng. Bấm **Bắt đầu** để quét lại từ A1 nếu đã thêm link mới.
- Để có quyền xóa ô, bật Google Sheets API cho project của service account và chia sẻ bảng cho `lun-83@loginwithjavascript.iam.gserviceaccount.com` với quyền **Người chỉnh sửa**. Khóa JSON hiện được chỉ định trong `.setting`.
- Các lựa chọn Instagram, TikTok, Facebook và ngôn ngữ caption trong giao diện cũng áp dụng cho hàng đợi. Nếu một link không hợp lệ hoặc xử lý lỗi, ứng dụng ghi lại lỗi, giữ nguyên ô và dừng tại dòng đó để bạn kiểm tra. Sau khi sửa link hoặc xử lý nguyên nhân, bấm **Bắt đầu** để thử lại. Nếu Google Sheets chưa xóa được ô sau khi xử lý thành công, ứng dụng sẽ thử xóa lại mà không chạy lại link.

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
