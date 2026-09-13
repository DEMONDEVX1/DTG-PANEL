const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const unzipper = require('unzipper');

// Map of active download jobs
// jobId -> { id, serverId, url, filename, status, progress, downloadedBytes, totalBytes, speed, error, startTime, destPath }
const activeJobs = new Map();

/**
 * Resolve direct download URL for common file hosting services (MediaFire, Google Drive, Dropbox, etc.)
 */
async function resolveDirectUrl(inputUrl) {
  let targetUrl = inputUrl.trim();

  // 1. Dropbox
  if (targetUrl.includes('dropbox.com')) {
    targetUrl = targetUrl.replace('dl=0', 'dl=1');
    if (!targetUrl.includes('dl=1')) {
      targetUrl += (targetUrl.includes('?') ? '&dl=1' : '?dl=1');
    }
    return targetUrl;
  }

  // 2. Google Drive
  if (targetUrl.includes('drive.google.com')) {
    const fileIdMatch = targetUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || targetUrl.match(/id=([a-zA-Z0-9_-]+)/);
    if (fileIdMatch && fileIdMatch[1]) {
      return `https://drive.google.com/uc?export=download&confirm=t&id=${fileIdMatch[1]}`;
    }
  }

  // 3. MediaFire
  if (targetUrl.includes('mediafire.com')) {
    try {
      const htmlText = await fetchTextWithRedirects(targetUrl);
      // Look for download button href attribute
      const hrefMatch = htmlText.match(/href="(https?:\/\/download\d+[^"]+mediafire\.com\/[^"]+)"/i) ||
                        htmlText.match(/aria-label="Download file"\s+href="([^"]+)"/i) ||
                        htmlText.match(/id="downloadButton"\s+href="([^"]+)"/i);
      if (hrefMatch && hrefMatch[1]) {
        return hrefMatch[1];
      }
    } catch (err) {
      console.warn('[Remote Downloader] Failed to scrape MediaFire direct link, trying original URL:', err.message);
    }
  }

  return targetUrl;
}

function fetchTextWithRedirects(urlStr, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error('Too many redirects'));

    const parsedUrl = new URL(urlStr);
    const client = parsedUrl.protocol === 'https:' ? https : http;

    const req = client.get(urlStr, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        const nextUrl = new URL(res.headers.location, urlStr).toString();
        return resolve(fetchTextWithRedirects(nextUrl, maxRedirects - 1));
      }

      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    });

    req.on('error', reject);
  });
}

/**
 * Start downloading a remote file asynchronously
 */
async function startRemoteDownload({ jobId, serverId, inputUrl, targetDirectory, customFilename = null, autoExtract = false, onProgress = null }) {
  const directUrl = await resolveDirectUrl(inputUrl);
  
  // Extract or generate filename
  let filename = customFilename ? customFilename.trim() : null;
  if (!filename) {
    try {
      const parsed = new URL(directUrl);
      filename = path.basename(parsed.pathname);
      if (!filename || filename === '/' || filename.includes('?') || !filename.includes('.')) {
        filename = `remote-backup-${Date.now()}.zip`;
      }
    } catch (e) {
      filename = `remote-backup-${Date.now()}.zip`;
    }
  }

  // Ensure filename has safe characters
  filename = filename.replace(/[^a-zA-Z0-9_.-]/g, '_');

  const destPath = path.join(targetDirectory, filename);

  const job = {
    id: jobId,
    serverId: parseInt(serverId, 10),
    url: inputUrl,
    directUrl,
    filename,
    destPath,
    status: 'downloading', // 'downloading' | 'extracting' | 'completed' | 'error'
    progress: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    speed: '0 MB/s',
    error: null,
    startTime: Date.now(),
    autoExtract
  };

  activeJobs.set(jobId, job);

  // Execute download in background stream
  downloadFileStream(job, onProgress).catch(err => {
    job.status = 'error';
    job.error = err.message || 'Download failed';
    if (onProgress) onProgress(job);
  });

  return job;
}

function downloadFileStream(job, onProgress, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 8) {
      return reject(new Error('Too many HTTP redirects'));
    }

    const parsedUrl = new URL(job.directUrl);
    const client = parsedUrl.protocol === 'https:' ? https : http;

    const requestOptions = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*'
      }
    };

    const req = client.get(job.directUrl, requestOptions, async (res) => {
      // Handle redirects
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        job.directUrl = new URL(res.headers.location, job.directUrl).toString();
        return resolve(downloadFileStream(job, onProgress, redirectCount + 1));
      }

      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`HTTP Server Error ${res.statusCode}: ${res.statusMessage}`));
      }

      // Try to determine filename from Content-Disposition header if present
      const cd = res.headers['content-disposition'];
      if (cd && cd.includes('filename=')) {
        const match = cd.match(/filename="?([^";]+)"?/);
        if (match && match[1]) {
          const headerName = match[1].trim().replace(/[^a-zA-Z0-9_.-]/g, '_');
          if (headerName && headerName.includes('.')) {
            job.filename = headerName;
            job.destPath = path.join(path.dirname(job.destPath), headerName);
          }
        }
      }

      const totalContentLength = parseInt(res.headers['content-length'] || '0', 10);
      job.totalBytes = totalContentLength;

      const fileStream = fs.createWriteStream(job.destPath);
      let lastTime = Date.now();
      let lastBytes = 0;

      res.on('data', (chunk) => {
        job.downloadedBytes += chunk.length;

        if (job.totalBytes > 0) {
          job.progress = Math.min(100, Math.round((job.downloadedBytes / job.totalBytes) * 100));
        }

        // Calculate speed every 500ms
        const now = Date.now();
        const elapsed = (now - lastTime) / 1000;
        if (elapsed >= 0.5) {
          const bytesDiff = job.downloadedBytes - lastBytes;
          const speedBytesPerSec = bytesDiff / elapsed;
          job.speed = (speedBytesPerSec / (1024 * 1024)).toFixed(2) + ' MB/s';
          lastTime = now;
          lastBytes = job.downloadedBytes;
        }

        if (onProgress) onProgress(job);
      });

      res.pipe(fileStream);

      fileStream.on('finish', async () => {
        fileStream.close();
        job.progress = 100;
        job.speed = 'Completed';

        // Auto Extract if requested and is zip file
        if (job.autoExtract && (job.filename.endsWith('.zip') || job.filename.endsWith('.jar'))) {
          job.status = 'extracting';
          if (onProgress) onProgress(job);

          try {
            const extractDir = path.dirname(job.destPath);
            await fs.createReadStream(job.destPath)
              .pipe(unzipper.Extract({ path: extractDir }))
              .promise();
            
            console.log(`[Remote Downloader] Extracted ${job.filename} into ${extractDir}`);
          } catch (extErr) {
            console.error('[Remote Downloader] Extraction warning:', extErr.message);
          }
        }

        job.status = 'completed';
        if (onProgress) onProgress(job);
        resolve(job);
      });

      fileStream.on('error', (err) => {
        fs.unlink(job.destPath, () => {});
        reject(err);
      });
    });

    req.on('error', (err) => reject(err));
  });
}

function getJobStatus(jobId) {
  return activeJobs.get(jobId) || null;
}

function getServerJobs(serverId) {
  const jobs = [];
  for (const job of activeJobs.values()) {
    if (job.serverId == serverId) {
      jobs.push(job);
    }
  }
  return jobs;
}

module.exports = {
  resolveDirectUrl,
  startRemoteDownload,
  getJobStatus,
  getServerJobs,
  activeJobs
};
