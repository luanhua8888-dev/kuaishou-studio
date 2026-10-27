#!/bin/bash
set -e

echo "=========================================================="
echo "  CÀI ĐẶT KUAISHOU TOOL TRÊN TABLET ANDROID (TERMUX)"
echo "=========================================================="

echo "[1/4] Cập nhật Ubuntu và cài đặt các công cụ nền tảng..."
apt update -y
apt install -y curl ffmpeg nodejs npm fonts-dejavu fonts-noto-color-emoji

# Kiểm tra Node.js, nếu dưới v18 thì cài Node.js 20
NODE_VER=$(node -v 2>/dev/null | cut -d'v' -f2 | cut -d'.' -f1 || echo "0")
if [ "$NODE_VER" -lt 18 ]; then
  echo "Cài đặt Node.js v20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt install -y nodejs
fi

echo "[2/4] Cài đặt pnpm và các thư viện Node.js..."
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"
npm install -g pnpm 2>/dev/null || true
pnpm install --prod

echo "[3/4] Tự động tải trình duyệt Chromium ARM64 chuẩn Playwright..."
pnpm exec playwright install --with-deps chromium

echo ""
echo "=========================================================="
echo "  HOÀN TẤT CÀI ĐẶT THÀNH CÔNG 100%!"
echo "=========================================================="
echo "Để chạy tool:"
echo "   cd $PROJECT_DIR"
echo "   pnpm ui"
echo ""
echo "Sau đó mở Chrome trên tablet vào: http://localhost:3000"
echo "=========================================================="
