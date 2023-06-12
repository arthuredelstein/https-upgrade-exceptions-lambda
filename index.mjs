import puppeteer from 'puppeteer-extra';
import crypto from 'crypto';
import chromium from '@sparticuz/chromium';
import { putJSON } from './s3.mjs';
import { ssim } from 'ssim.js';
import crx from 'crx-util';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

Error.stackTraceLimit = Infinity;

puppeteer.use(StealthPlugin());

const sleep = (t) => new Promise(resolve => setTimeout(resolve, t));

const hashString = (content) => {
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  return hash.substring(0, 16);
};

const puppeteerDefaultParameters = (extensionPath) => ({
  args: [
    `--disable-extensions-except=${extensionPath}`,
    '--enable-automation'
  ]
});

const puppeteerPlatformParameters = {
  linux: {
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless
  },
  darwin: {
    channel: 'chrome',
    headless: true
  }
};

const uboURL = 'https://chrome.google.com/webstore/detail/ublock-origin/cjpalhdlnbpafiamejdnhcphjbkeiagm';

const downloadUBO = async () => {
  return (await crx.downloadByURL(uboURL, "/tmp")).output;
};

export const createBrowser = async () => {
  const uboPath = await downloadUBO();
  const parameters = {
    ...puppeteerDefaultParameters(uboPath),
    ...puppeteerPlatformParameters[process.platform]
  };
  console.log(parameters);
  return puppeteer.launch(parameters);
};

const callsToJson = (object, callNames) => {
  const result = {};
  for (const callName of callNames) {
    result[callName] = object[callName]();
  }
  return result;
};

const responseToJson = (responseObject) =>
  callsToJson(responseObject, ['status', 'statusText', 'url']);

export const pageTest = async (browser, url) => {
  const responses = [];
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(20000);
  page.on('response', interceptedResponse => {
    const responseJson = responseToJson(interceptedResponse);
    if (responseJson.url.startsWith('http')) {
      responses.push(responseToJson(interceptedResponse));
    }
  });
  let errorMessage = null;
  let imgHash = null;
  let image = null;
  try {
    await page.goto(url, { waitUntil: 'load' });
    image = await page.screenshot({ type: 'png' });
    imgHash = hashString(image);
  } catch (e) {
    errorMessage = e.message;
  }
  const finalUrl = page.url();
  await page.close();
  let finalStatus = null;
  for (const response of responses) {
    if (response.url === finalUrl) {
      finalStatus = response.status;
    }
  }
  return { responses, finalStatus, finalUrl, err: errorMessage, imgHash, image };
};

export const domainTest = async (browser, domain) => {
  const insecure = await pageTest(browser, `http://${domain}`);
  const secure = await pageTest(browser, `https://${domain}`);
  const imgHashMatch = insecure.imgHash === secure.imgHash;
  const finalUrlMatch = insecure.finalUrl === secure.finalUrl;
  // console.log("captured ", domain);
  let mssim;
  try {
    if (!imgHashMatch) {
      mssim = ssim(
        { data: insecure.image, width: 800, height: 600 },
        { data: secure.image, width: 800, height: 600 }
      ).mssim;
    }
  } catch (e) {
    // console.log(e);
  }
  delete secure.image;
  delete insecure.image;
  return { domain, insecure, secure, imgHashMatch, finalUrlMatch, mssim };
};

const runTestAndPost = async (timeStamp, browser, domain) => {
  const results = await domainTest(browser, domain);
  const response = await putJSON(`raw/${timeStamp}/${domain}`, results);
  return { results, response };
};

let gBrowser;

export const handler = async (event, context) => {
  try {
    if (gBrowser === undefined || !gBrowser.isConnected()) {
      gBrowser = await createBrowser();
    }
    console.log({ event: JSON.stringify(event, null, '  '), context: JSON.stringify(context, null, '  ') });
    const messages = event.data ?? event.Records.map(record => JSON.parse(record.body));
    for (const { domain, timeStamp } of messages) {
      try {
        const { results, response } = await runTestAndPost(timeStamp, gBrowser, domain);
        console.log('send succeeded:', JSON.stringify(results), JSON.stringify(response));
      } catch (e) {
        console.log('send failed:', domain, e);
      }
    }
    return null;
  } catch (e) {
    console.log(e);
    return null;
  }
};
