import puppeteer from 'puppeteer-core';
import crypto from 'crypto';
import chromium from '@sparticuz/chromium';
import { sendToSQS } from './util.mjs';

const sleep = (t) => new Promise(resolve => setTimeout(resolve, t));

const getScreenshotHash = async (page) => {
  const image = await page.screenshot({ type: "png" });
  const hash = crypto.createHash('sha256').update(image).digest('hex');
  return hash.substring(0, 16);
};

export const createBrowser = async () => {
  return puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });
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
    responses.push(responseToJson(interceptedResponse));
  });
  let err = null;
  let img_hash = null;
  try {
    await Promise.all(
      [await page.goto(url, { waitUntil: 'load' }),
      await sleep(5000)]);
    img_hash = await getScreenshotHash(page);
  } catch (e) {
    err = e;
  }
  return { responses, final_url: page.url(), error: err, img_hash };
};

export const domainTest = async (browser, domain) => {
  const [insecure, secure] = await Promise.all([
    pageTest(browser, `http://${domain}`),
    pageTest(browser, `https://${domain}`)
  ]);
  const img_hash_match = insecure.img_hash === secure.img_hash;
  return { domain, insecure, secure, img_hash_match };
};

const resultQueueUrl = "https://sqs.us-west-1.amazonaws.com/275005321946/result-queue";

export const handler = async (event, context) => {
  try {
    console.log({"event": JSON.stringify(event, null, '  '), "context": JSON.stringify(event, null, '  ')});
    const browser = await createBrowser();
    const domains = event.domains ?? event.Records.map(record => JSON.parse(record.body).domain);
    for (let domain of domains) {
      const results = await domainTest(browser, domain);
      try {
        const sent = await sendToSQS(resultQueueUrl, results);
        console.log("send succeeded", JSON.stringify(results), JSON.stringify(sent));
      } catch (e) {
        console.log("send failed", JSON.stringify(results), e);
      }
    }
    return null;
  } catch (e) {
    console.log(e);
    return null;
  }
};
