const path = require("path");
const fs = require('fs');
const os = require('os');
const { runtime } = require("../utils/paths");

function getChromiumPath() {
    const platform = os.platform();

    // 1. LINUX (Server) Logic
    if (platform === 'linux') {
        const possibleLinuxPaths = [
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
            '/snap/bin/chromium'
        ];

        for (const p of possibleLinuxPaths) {
            if (fs.existsSync(p)) return p;
        }
        
        // If checking paths fails on Linux, return undefined. 
        // This lets Puppeteer try its own bundled version as a fallback.
        // But usually, the first path above will work after your recent install.
        return '/usr/bin/google-chrome'; 
    }

    // 2. WINDOWS (Local Dev / PKG) Logic
    if (platform === 'win32') {
        // Check for portable chromium next to the .exe (or project root in dev)
        const localChromium = runtime('chromium', 'chrome.exe');
        if (fs.existsSync(localChromium)) return localChromium;

        const programFiles = process.env.PROGRAMFILES || 'C:\\Program Files';
        const programFilesx86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';

        const possibleWindowsPaths = [
            path.join(programFiles, 'Google\\Chrome\\Application\\chrome.exe'),
            path.join(programFilesx86, 'Google\\Chrome\\Application\\chrome.exe'),
            path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
            path.join(programFiles, 'Microsoft\\Edge\\Application\\msedge.exe'),
            path.join(programFilesx86, 'Microsoft\\Edge\\Application\\msedge.exe'),
        ];

        for (const p of possibleWindowsPaths) {
            if (fs.existsSync(p)) return p;
        }
    }

    // 3. MAC OS Logic (Just in case)
    if (platform === 'darwin') {
        return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    }

    throw new Error("Chromium/Chrome not found. Please install Google Chrome.");
}

module.exports = { getChromiumPath };