# ✅ Node.js 18 기반
FROM node:18-slim

# ✅ yt-dlp + ffmpeg 설치 (핵심!)
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    curl \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# ✅ 작업 디렉토리 설정
WORKDIR /app

# ✅ 의존성 설치
COPY package*.json ./
RUN npm install --production

# ✅ 서버 코드 복사
COPY server.js ./

# ✅ 포트 노출
EXPOSE 3000

# ✅ 서버 시작
CMD ["node", "server.js"]
