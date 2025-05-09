const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const path = require('path');
const fs = require('fs');

// Use the stealth plugin
puppeteerExtra.use(StealthPlugin());

async function testPuppeteer() {
  console.log('Testing Puppeteer browser launch...');
  
  // Find a suitable Chrome executable
  const chromePaths = [
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/snap/bin/chromium',
    '/usr/bin/google-chrome-stable'
  ];
  
  let executablePath = null;
  for (const chromePath of chromePaths) {
    if (fs.existsSync(chromePath)) {
      executablePath = chromePath;
      console.log(`Found Chrome at: ${chromePath}`);
      break;
    }
  }
  
  const launchOptions = {
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-webgl',
      '--mute-audio',
      '--single-process',
      '--disable-features=site-per-process',
      '--ignore-certificate-errors',
      '--use-gl=disabled',
      '--disable-software-rasterizer',
      '--disable-infobars',
      '--window-position=0,0',
      '--disk-cache-size=33554432',
      '--disable-notifications',
      '--deterministic-fetch',
      '--disable-sync'
    ],
    headless: 'new',
    timeout: 30000,
    userDataDir: path.join(process.cwd(), '.cache', 'puppeteer')
  };
  
  // Set executable path if found
  if (executablePath) {
    launchOptions.executablePath = executablePath;
  }
  
  try {
    console.log('Launching browser...');
    const browser = await puppeteerExtra.launch(launchOptions);
    
    console.log('Browser launched successfully!');
    console.log('Browser version:', await browser.version());
    
    const page = await browser.newPage();
    console.log('New page created');
    
    console.log('Navigating to example.com...');
    await page.goto('https://example.com');
    
    const title = await page.title();
    console.log('Page title:', title);
    
    await browser.close();
    console.log('Browser closed successfully');
    console.log('Test completed successfully!');
  } catch (error) {
    console.error('Error during Puppeteer test:', error);
  }
}

testPuppeteer(); 