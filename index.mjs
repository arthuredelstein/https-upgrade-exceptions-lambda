import puppeteer from 'puppeteer-extra';
import chromium from '@sparticuz/chromium';
import { putJSON } from './util.mjs';
import { ssim } from 'ssim.js';
import crx from 'crx-util';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import Jimp from 'jimp';
import { analyzeResult } from './analysis.mjs'
import { shouldBeOnList } from './produce.mjs';

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

export const pageTest = async (browser, url, numScreenshots) => {
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
  try {
    await page.goto(url, { waitUntil: 'load' });
    const imgType = url.startsWith("http://") ? "insecure" : "secure";
    for (let i = 0; i < numScreenshots; ++i) {
      await sleep(1000);
      await page.screenshot({
        type: 'png',
        path: `/tmp/img-${imgType}-${i}.png`,
        clip: { x: 0, y: 0, width: 800, height: 600 }
      });
    }
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
  return { responses, finalStatus, finalUrl, err: errorMessage, numScreenshots };
};

const findBestMssim = async (numScreenshots) => {
  let bestMssim = 0;
  for (let i = 0; i < numScreenshots; ++i) {
    for (let j = 0; j < numScreenshots; ++j) {
      const img1 = await Jimp.read(`/tmp/img-insecure-${i}.png`);
      const img2 = await Jimp.read(`/tmp/img-secure-${j}.png`);
      try {
        const mssim = ssim(img1.bitmap, img2.bitmap).mssim;
        if (mssim > bestMssim) {
          bestMssim = mssim;
          if (bestMssim > 0.99) {
            return bestMssim;
          }
        }
      } catch (e) {
        // console.log(e);
      }
    }
  }
  return bestMssim;
}

export const domainTest = async (browser, domain, numScreenshots) => {
  const insecure = await pageTest(browser, `http://${domain}`, numScreenshots);
  const secure = await pageTest(browser, `https://${domain}`, numScreenshots);
  const finalUrlMatch = insecure.finalUrl === secure.finalUrl;
  const mssim = await findBestMssim(numScreenshots);
  return { domain, insecure, secure, finalUrlMatch, mssim };
};

const allFailed = (x) => {
  for (const [name, result] of Object.entries(x)) {
    if (result !== false) {
      return false;
    }
  }
  return true;
};

const checkIfUpgradable = (data) => {
  for (const [/* name */, passed] of Object.entries(data.analysis)) {
    if (passed) {
      return true;
    }
  }
  return false;
};

const runTestAndPost = async (timeStamp, browser, domain, numScreenshots = 1) => {
  let results = await domainTest(browser, domain, 1);
  results["analysis"] = analyzeResult(results);
  console.log(results);
  if (allFailed(results.analysis)) {
    // Try again but with more screenshots
    results = await domainTest(browser, domain, 5);
    results["analysis"] = analyzeResult(results);
    console.log(results);
  }
  const response = await putJSON(`raw/${timeStamp}/${domain}`, results);

  let response2;
  if (!checkIfUpgradable(results)) {
    response2 = await putJSON(`exceptions/${timeStamp}/${domain}`, results);
  }

  return { results, response, response2 };
};

let gBrowser;

export const handler = async (event, context) => {
  try {
    if (gBrowser === undefined || !gBrowser.isConnected()) {
      gBrowser = await createBrowser();
    }
    console.log({ event: JSON.stringify(event, null, '  '), context: JSON.stringify(context, null, '  ') });
    const messages = event.data ?? event.Records.map(record => JSON.parse(record.body));
    for (const { domain, timeStamp, numScreenshots } of messages) {
      try {
        const { results, response } = await runTestAndPost(timeStamp, gBrowser, domain, numScreenshots);
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
