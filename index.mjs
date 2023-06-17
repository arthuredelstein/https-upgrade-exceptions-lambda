import puppeteer from 'puppeteer-extra';
import chromium from '@sparticuz/chromium';
import { putJSON } from './s3.mjs';
import { ssim } from 'ssim.js';
import crx from 'crx-util';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import Jimp from 'jimp';

Error.stackTraceLimit = Infinity;

puppeteer.use(StealthPlugin());

export const sleep = (t) => new Promise(resolve => setTimeout(resolve, t));

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

const responseToJson = (responseObject) => {
  const result = callsToJson(responseObject, ['status', 'url']);
  result['contentType'] = responseObject.headers()["content-type"];
  return result;
}

export const pageTest = async (browser, url) => {
  const responses = [];
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(20000);
  page.on('response', interceptedResponse => {
    const responseJson = responseToJson(interceptedResponse);
    if (responseJson.url.startsWith('http')) {
      responses.push(responseJson);
    }
  });
  let errorMessage = null;
  let image = null;
  try {
    await page.goto(url, { waitUntil: 'load' });
    const imgIndex = url.startsWith("http://") ? "1" : "2";
    image = await page.screenshot({
      type: 'png',
      path: `/tmp/img${imgIndex}.png`,
      clip: { x: 0, y: 0, width: 800, height: 600 }
    });
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
  return { responses, finalStatus, finalUrl, err: errorMessage };
};

export const domainTest = async (browser, domain) => {
  const insecure = await pageTest(browser, `http://${domain}`);
  const secure = await pageTest(browser, `https://${domain}`);
  const finalUrlMatch = insecure.finalUrl === secure.finalUrl;
  let mssim;
  const img1 = await Jimp.read("/tmp/img1.png");
  const img2 = await Jimp.read("/tmp/img2.png");
  try {
    mssim = ssim(img1.bitmap, img2.bitmap).mssim;
  } catch (e) {
    // console.log(e);
  }
  return { domain, insecure, secure, finalUrlMatch, mssim };
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
