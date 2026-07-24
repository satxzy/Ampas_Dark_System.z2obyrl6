// flood.js - FLOOD GITHUB BY RYUICHI
// Upload isi folder ke banyak repo GitHub sekaligus
// Pakai: node flood.js --token <ghp_xxx> [opsi...]

const https = require('https');
const fs = require('fs');
const path = require('path');

// =============== HELP ===============
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  const c = {
    r: '\x1b[0m', b: '\x1b[1m',
    cyan: '\x1b[36m', yellow: '\x1b[33m', green: '\x1b[32m', red: '\x1b[31m', gray: '\x1b[90m',
  };
  console.log(`
${c.cyan}${c.b}FLOOD GITHUB BY RYUICHI${c.r}

${c.yellow}${c.b}📌  Cara pakai:${c.r}
   node flood.js --token <ghp_xxx> [opsi]

${c.yellow}${c.b}🔑  Wajib:${c.r}
   ${c.green}--token${c.r} <string>    Token GitHub (ghp_... atau github_pat_...)

${c.yellow}${c.b}📦  Opsi utama:${c.r}
   ${c.green}--name${c.r} <string>     Nama dasar repo (default: repo)
   ${c.green}--count${c.r} <angka>     Jumlah repo (default: 1)
   ${c.green}--folder${c.r} <path>     Folder sumber (default: folder saat ini)

${c.yellow}${c.b}⚡  Kecepatan:${c.r}
   ${c.green}--concurrency${c.r} <n>   Paralel repo (default: 5)
   ${c.green}--delay${c.r} <ms>        Jeda antar repo (default: 1000ms)
   ${c.green}--filedelay${c.r} <ms>    Jeda antar file di safe mode (default: 200ms)
   ${c.green}--brutal${c.r}            Mode gaspol (concurrency 10, delay 0)

${c.yellow}${c.b}🛡️  Keamanan:${c.r}
   ${c.green}--safe${c.r}              Upload file satu per satu (hindari error 409)
   ${c.green}--private${c.r}           Repo private

${c.yellow}${c.b}🧹  Abaikan file:${c.r}
   ${c.green}--ignore${c.r} <path>     Abaikan file/folder (bisa diulang)
                       Otomatis skip: flood.js, .git, node_modules

${c.yellow}${c.b}📝  Contoh:${c.r}
   node flood.js --token ghp_abc --name proyek --count 5
   node flood.js --token ghp_abc --name spam --count 20 --brutal
   node flood.js --token ghp_abc --name backup --count 10 --safe --filedelay 300
   node flood.js --token ghp_abc --name rahasia --count 3 --folder ./data --private --ignore token.txt
`);
  process.exit(0);
}

// =============== KONFIGURASI ===============
const config = {
  token: '',
  baseName: 'repo',
  count: 1,
  concurrency: 5,
  delay: 1000,
  folder: '.',
  private: false,
  safeMode: false,
  fileDelay: 200,
  ignoreList: [],
  brutal: false,
};

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  const v = args[i + 1];
  if (a === '--token' && v) { config.token = v; i++; }
  else if (a === '--name' && v) { config.baseName = v; i++; }
  else if (a === '--count' && v) { config.count = Math.max(1, parseInt(v) || 1); i++; }
  else if (a === '--concurrency' && v) { config.concurrency = parseInt(v) || 5; i++; }
  else if (a === '--delay' && v) { config.delay = parseInt(v) || 1000; i++; }
  else if (a === '--folder' && v) { config.folder = v; i++; }
  else if (a === '--private') { config.private = true; }
  else if (a === '--safe') { config.safeMode = true; }
  else if (a === '--filedelay' && v) { config.fileDelay = parseInt(v) || 200; i++; }
  else if (a === '--ignore' && v) { config.ignoreList.push(v); i++; }
  else if (a === '--brutal') { config.brutal = true; }
}

if (config.brutal) {
  config.concurrency = 10;
  config.delay = 0;
  config.safeMode = false;
  config.fileDelay = 0;
}

if (!config.token) {
  console.log('❌  Token wajib diisi.');
  console.log('Ketik "node flood.js --help" buat liat panduan.');
  process.exit(1);
}

// =============== WARNA ===============
const c = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

// =============== API GITHUB (retry + rate limit) ===============
async function gh(method, endpoint, body = null) {
  let attempt = 0;
  while (true) {
    try {
      const result = await new Promise((resolve, reject) => {
        const opts = {
          hostname: 'api.github.com',
          path: endpoint,
          method,
          headers: {
            'Authorization': `token ${config.token}`,
            'User-Agent': 'flood-uploader',
            'Content-Type': 'application/json',
          },
        };
        const req = https.request(opts, res => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              try { resolve(JSON.parse(data)); } catch { resolve(data); }
            } else {
              const retryAfter = parseInt(res.headers['retry-after'] || '10', 10) * 1000;
              reject({ code: res.statusCode, msg: data, retryAfter });
            }
          });
        });
        req.on('error', e => reject({ code: 0, msg: e.message, retryAfter: 10000 }));
        if (body) req.write(JSON.stringify(body));
        req.end();
      });
      return result;
    } catch (err) {
      attempt++;
      if ((err.code === 403 || err.code === 429 || err.code >= 500) && attempt <= 5) {
        const wait = err.retryAfter || (5000 * attempt);
        console.log(`⏳  Rate limit, nunggu ${wait/1000}s... (coba ke-${attempt})`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      throw new Error(err.msg || 'Gagal request');
    }
  }
}

// =============== BACA FILE ===============
function getAllFiles(dir, ignorePaths) {
  const ignore = new Set(ignorePaths);
  const results = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, item.name);
    if (ignore.has(fp)) continue;
    if (item.isDirectory()) {
      if (item.name === '.git' || item.name === 'node_modules') continue;
      results.push(...getAllFiles(fp, ignorePaths));
    } else {
      results.push(fp);
    }
  }
  return results;
}

function randomSuffix() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789.-~';
  let s = '';
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return '.' + s;
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
  return (bytes / 1073741824).toFixed(2) + ' GB';
}

function drawProgress(current, total, startTime) {
  const pct = Math.round((current / total) * 100);
  const barLen = 25;
  const filled = Math.round((current / total) * barLen);
  const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  process.stdout.write(`\r   [${bar}] ${pct}% (${current}/${total}) ⏱ ${elapsed}s`);
}

// =============== UPLOAD FILE ===============
async function uploadFiles(owner, repo, branch, files, baseDir) {
  if (config.safeMode) {
    for (const absPath of files) {
      const rel = path.relative(baseDir, absPath).replace(/\\/g, '/');
      const content = await fs.promises.readFile(absPath);
      const b64 = content.toString('base64');
      await gh('PUT', `/repos/${owner}/${repo}/contents/${rel}`, {
        message: `Add ${rel}`,
        content: b64,
        branch,
      });
      if (config.fileDelay > 0) await new Promise(r => setTimeout(r, config.fileDelay));
    }
  } else {
    const tasks = files.map(async absPath => {
      const rel = path.relative(baseDir, absPath).replace(/\\/g, '/');
      const content = await fs.promises.readFile(absPath);
      const b64 = content.toString('base64');
      return gh('PUT', `/repos/${owner}/${repo}/contents/${rel}`, {
        message: `Add ${rel}`,
        content: b64,
        branch,
      });
    });
    await Promise.all(tasks);
  }
}

// =============== BUAT REPO ===============
async function createAndUpload(owner, files, baseDir) {
  let repoName = config.baseName + randomSuffix();
  let repo;
  try {
    repo = await gh('POST', '/user/repos', {
      name: repoName,
      private: config.private,
      auto_init: true,
    });
  } catch (e) {
    if (e.message.includes('422') || e.message.includes('already exists')) {
      repoName = config.baseName + randomSuffix();
      repo = await gh('POST', '/user/repos', {
        name: repoName,
        private: config.private,
        auto_init: true,
      });
    } else throw e;
  }
  if (files.length > 0) {
    await uploadFiles(owner, repo.name, repo.default_branch, files, baseDir);
  }
  return repo.html_url;
}

// =============== MAIN ===============
(async () => {
  console.log(`🚀 FLOOD GITHUB BY RYUICHI`);
  console.log(`🔐  Login ke GitHub...`);
  const user = await gh('GET', '/user');
  const owner = user.login;
  console.log(`✅  Akun: ${owner}`);

  const scriptPath = __filename;
  const ignorePaths = [scriptPath];
  for (const f of config.ignoreList) ignorePaths.push(path.resolve(f));

  const allFiles = getAllFiles(config.folder, ignorePaths);
  const totalSize = allFiles.reduce((sum, p) => sum + fs.statSync(p).size, 0);

  console.log(`📁  Folder: ${path.resolve(config.folder)} (${allFiles.length} file, ${formatSize(totalSize)})`);
  if (ignorePaths.length > 1) {
    const skipped = ignorePaths.map(p => path.basename(p)).filter(name => name !== path.basename(scriptPath));
    if (skipped.length) console.log(`🧹  Skip: ${skipped.join(', ')}`);
  }
  console.log(`🎯  Target: ${config.count} repo (${config.private ? '🔒 Private' : '🌍 Public'})${config.safeMode ? ' 🛡️ Safe' : ''}`);
  console.log(`⚡  Mode: ${config.concurrency} concurrent, delay ${config.delay}ms`);
  console.log('');

  const startTotal = Date.now();
  let done = 0, success = 0, failed = 0;
  const repoUrls = [];
  const queue = Array.from({ length: config.count }, (_, i) => i + 1);

  const runWorker = async () => {
    while (queue.length) {
      queue.shift();
      try {
        const url = await createAndUpload(owner, allFiles, config.folder);
        done++; success++;
        drawProgress(done, config.count, startTotal);
        repoUrls.push(url);
      } catch (e) {
        done++; failed++;
        drawProgress(done, config.count, startTotal);
        console.log(`\n❌  Gagal: ${e.message}`);
      }
      if (config.delay > 0 && done < config.count) await new Promise(r => setTimeout(r, config.delay));
    }
  };

  const workers = [];
  for (let i = 0; i < Math.min(config.concurrency, config.count); i++) workers.push(runWorker());
  await Promise.all(workers);

  process.stdout.write('\r' + ' '.repeat(60) + '\r');
  const totalTime = ((Date.now() - startTotal) / 1000).toFixed(1);
  console.log(`\n🎉  Selesai dalam ${totalTime} detik`);
  console.log(`✅  Berhasil: ${success} repo`);
  if (failed) console.log(`❌  Gagal: ${failed} repo`);
  if (repoUrls.length) {
    console.log('📋  Daftar repo:');
    repoUrls.forEach((url, i) => console.log(`   ${i + 1}. ${url}`));
  }
})();