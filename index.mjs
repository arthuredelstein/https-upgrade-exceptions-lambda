import puppeteer from 'puppeteer-core';
import crypto from 'crypto';
import chromium from '@sparticuz/chromium';
import { sendToSQS } from './util.mjs';
import { putJSON } from './s3.mjs';
import { ssim } from "ssim.js";
import pMap from 'p-map';
import { fstat } from 'fs';

const sleep = (t) => new Promise(resolve => setTimeout(resolve, t));

const hashString = (content) => {
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  return hash.substring(0, 16);
};

const puppeteerParameters = {
  linux: {
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  },
  darwin: {
    channel:"chrome",
    headless: true
  }
}

export const createBrowser = async () => {
  return puppeteer.launch(puppeteerParameters[process.platform]);
}

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
    if (responseJson.url.startsWith("http")) {
      responses.push(responseToJson(interceptedResponse));
    }
  });
  let errorMessage = null;
  let img_hash = null;
  let img_file = null;
  let image = null;
  try {
    await Promise.all(
      [await page.goto(url, { waitUntil: 'load' }),
      await sleep(5000)]);
    image = await page.screenshot({ type: "png" });
    img_hash = hashString(image);
  } catch (e) {
    errorMessage = e.message;
  }
  await page.close();
  const final_url = page.url();
  let final_status = null;
  for (const response of responses) {
    if (response.url === final_url) {
      final_status = response.status;
    }
  }
  return { responses, final_status, final_url, err: errorMessage, img_hash, image };
};

export const domainTest = async (browser, domain) => {
  const [insecure, secure] = await Promise.all([
    pageTest(browser, `http://${domain}`),
    pageTest(browser, `https://${domain}`)
  ]);
  const img_hash_match = insecure.img_hash === secure.img_hash;
  const final_url_match = insecure.final_url === secure.final_url;
  //console.log("captured ", domain);
  let mssim;
  try {
    if (!img_hash_match && secure.img_file !== null && insecure.img_file !== null) {
      mssim = ssim(
        {data: insecure.image, width: 800, height: 600},
        {data: secure.image, width: 800, height: 600}
      ).mssim;
    }
  } catch (e) {
    //console.log(e);
  }
  delete secure.image;
  delete insecure.image;
  return { domain, insecure, secure, img_hash_match, final_url_match, mssim };
};

const compareImages = async (browser, domain) => {
  const result = await domainTest(browser, domain);
  console.log(domain, result.mssim);
};

const resultQueueUrl = "https://sqs.us-west-1.amazonaws.com/275005321946/result-queue";

const runTestAndPost = async (timeStamp, browser, domain) => {
  const results = await domainTest(browser, domain);
  const response = await putJSON(`raw/${timeStamp}/${domain}`, results);
  return { results, response };
}

const gBrowser = await createBrowser();

export const handler = async (event, context) => {
  try {
    console.log({"event": JSON.stringify(event, null, '  '), "context": JSON.stringify(event, null, '  ')});
    const messages = event.data ?? event.Records.map(record => JSON.parse(record.body));
    for (let { domain, timeStamp } of messages) {
      try {
        const { results, response } = await runTestAndPost(timeStamp, gBrowser, domain);
        console.log("send succeeded:", JSON.stringify(results), JSON.stringify(response));
      } catch (e) {
        console.log("send failed:", domain, e);
      }
    }
    return null;
  } catch (e) {
    console.log(e);
    return null;
  }
};
