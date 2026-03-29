const express = require('express');
const cors = require('cors');
const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ CORS 설정 - 프론트엔드 도메인 허용
app.use(cors({
  origin: '*', // 배포 후 Netlify 주소로 변경 권장
  methods: ['GET', 'POST'],
}));

app.use(express.json());

// ✅ 헬스 체크 (Railway/Render 서버 상태 확인용)
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'YT Downloader Backend Running!' });
});

// ✅ 영상 정보 가져오기 (썸네일, 제목 미리보기)
app.post('/api/info', async (req, res) => {
  const { url } = req.body;

  if (!url || !isValidYouTubeUrl(url)) {
    return res.status(400).json({ error: '올바른 YouTube URL이 아닙니다.' });
  }

  exec(
    `yt-dlp --dump-json --no-playlist "${url}"`,
    { timeout: 30000 },
    (err, stdout, stderr) => {
      if (err) {
        console.error('yt-dlp info error:', stderr);
        return res.status(500).json({ error: '영상 정보를 불러올 수 없습니다.' });
      }
      try {
        const info = JSON.parse(stdout);
        res.json({
          title: info.title,
          thumbnail: info.thumbnail,
          duration: info.duration_string,
          channel: info.channel,
        });
      } catch (e) {
        res.status(500).json({ error: '응답 파싱 오류' });
      }
    }
  );
});

// ✅ 다운로드 핵심 엔드포인트
app.post('/api/download', (req, res) => {
  const { url, format = 'mp4', quality = '1080' } = req.body;

  if (!url || !isValidYouTubeUrl(url)) {
    return res.status(400).json({ error: '올바른 YouTube URL이 아닙니다.' });
  }

  // 임시 파일 경로
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `yt_${Date.now()}`);

  let ytdlpArgs;

  if (format === 'mp3') {
    // MP3 변환: 오디오만 추출 후 ffmpeg으로 변환
    ytdlpArgs = [
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', getAudioQuality(quality),
      '--ffmpeg-location', '/usr/bin/ffmpeg',
      '-o', `${tmpFile}.%(ext)s`,
      '--no-playlist',
      url,
    ];
  } else {
    // MP4 다운로드: 화질 선택 (오디오 포함 보장)
    const formatStr = getVideoFormat(quality);
    ytdlpArgs = [
      '-f', formatStr,
      '--merge-output-format', 'mp4',
      '--ffmpeg-location', '/usr/bin/ffmpeg',
      '--postprocessor-args', 'ffmpeg:-c:v copy -c:a aac -strict experimental',
      '-o', `${tmpFile}.%(ext)s`,
      '--no-playlist',
      url,
    ];
  }

  console.log(`[다운로드 시작] format=${format}, quality=${quality}, url=${url}`);

  const ytdlp = spawn('yt-dlp', ytdlpArgs);
  let errorOutput = '';

  ytdlp.stderr.on('data', (data) => {
    errorOutput += data.toString();
    console.log('[yt-dlp]', data.toString());
  });

  ytdlp.on('close', (code) => {
    if (code !== 0) {
      console.error('yt-dlp 실패:', errorOutput);
      return res.status(500).json({ error: '다운로드 실패. URL을 확인하거나 잠시 후 다시 시도하세요.' });
    }

    // 완성된 파일 찾기
    const ext = format === 'mp3' ? 'mp3' : 'mp4';
    const outputFile = `${tmpFile}.${ext}`;

    if (!fs.existsSync(outputFile)) {
      // 다른 확장자로 생성됐을 경우 탐색
      const files = fs.readdirSync(tmpDir).filter(f => f.startsWith(path.basename(tmpFile)));
      if (files.length === 0) {
        return res.status(500).json({ error: '파일 생성 실패' });
      }
      const actualFile = path.join(tmpDir, files[0]);
      return sendFileAndCleanup(res, actualFile, format);
    }

    sendFileAndCleanup(res, outputFile, format);
  });
});

// ✅ 파일 전송 후 임시 파일 삭제
function sendFileAndCleanup(res, filePath, format) {
  const filename = `download_${Date.now()}.${format === 'mp3' ? 'mp3' : 'mp4'}`;
  const contentType = format === 'mp3' ? 'audio/mpeg' : 'video/mp4';

  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', contentType);

  const fileStream = fs.createReadStream(filePath);
  fileStream.pipe(res);

  fileStream.on('end', () => {
    fs.unlink(filePath, (err) => {
      if (err) console.error('임시파일 삭제 실패:', err);
      else console.log('[임시파일 삭제 완료]', filePath);
    });
  });

  fileStream.on('error', (err) => {
    console.error('파일 스트림 오류:', err);
    res.status(500).end();
  });
}

// ✅ YouTube URL 유효성 검사
function isValidYouTubeUrl(url) {
  return /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/.test(url);
}

// ✅ 화질에 따른 yt-dlp 포맷 문자열 (오디오 포함 보장)
function getVideoFormat(quality) {
  switch (quality) {
    case '360':  return 'bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=360]+bestaudio/best[height<=360]/best';
    case '720':  return 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=720]+bestaudio/best[height<=720]/best';
    case '1080': return 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]/best';
    default:     return 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best';
  }
}

// ✅ 음질에 따른 yt-dlp 오디오 품질 (0=최고, 9=최저)
function getAudioQuality(quality) {
  switch (quality) {
    case '128': return '5';
    case '192': return '3';
    case '320': return '0';
    default:    return '0';
  }
}

app.listen(PORT, () => {
  console.log(`✅ YT Downloader 백엔드 실행 중 - 포트 ${PORT}`);
});
