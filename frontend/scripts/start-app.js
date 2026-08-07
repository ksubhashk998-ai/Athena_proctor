const net = require('net');
const { spawn, exec } = require('child_process');
const path = require('path');

const PORT = process.env.PORT || 3000;
const URL = `http://localhost:${PORT}`;

function isPortInUse(port) {
  return new Promise((resolve) => {
    const client = new net.Socket();
    client.setTimeout(800);
    client.once('connect', () => {
      client.destroy();
      resolve(true);
    });
    client.once('timeout', () => {
      client.destroy();
      resolve(false);
    });
    client.once('error', () => {
      client.destroy();
      resolve(false);
    });
    client.connect(port, '127.0.0.1');
  });
}

function forceOpenBrowser(url) {
  console.log(`\n🌐 Opening ${url} in default browser...\n`);
  try {
    if (process.platform === 'win32') {
      exec(`start "" "${url}"`);
    } else if (process.platform === 'darwin') {
      exec(`open "${url}"`);
    } else {
      exec(`xdg-open "${url}"`);
    }
  } catch (err) {
    console.error('Browser launch error:', err);
  }
}

async function waitForPort(port, maxAttempts = 60) {
  for (let i = 0; i < maxAttempts; i++) {
    const inUse = await isPortInUse(port);
    if (inUse) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function main() {
  const inUse = await isPortInUse(PORT);

  if (inUse) {
    console.log(`✅ React dev server is already running at ${URL}`);
    forceOpenBrowser(URL);
    process.exit(0);
  } else {
    console.log(`🚀 Launching React development server on ${URL}...`);
    
    const env = { ...process.env, BROWSER: 'none' };

    const child = spawn('npx', ['react-app-rewired', 'start'], {
      stdio: 'inherit',
      shell: true,
      env: env,
      cwd: path.resolve(__dirname, '..')
    });

    let launched = false;
    waitForPort(PORT).then((ready) => {
      if (ready && !launched) {
        launched = true;
        setTimeout(() => {
          forceOpenBrowser(URL);
        }, 1000);
      }
    });

    child.on('exit', (code) => {
      process.exit(code || 0);
    });
  }
}

main();
