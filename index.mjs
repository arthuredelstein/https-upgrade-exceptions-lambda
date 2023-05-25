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
    const responseJson = responseToJson(interceptedResponse);
    if (responseJson.url.startsWith("http")) {
      responses.push(responseToJson(interceptedResponse));
    }
  });
  let errorMessage = null;
  let img_hash = null;
  try {
    await Promise.all(
      [await page.goto(url, { waitUntil: 'load' }),
      await sleep(5000)]);
    img_hash = await getScreenshotHash(page);
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
  return { responses, final_status, final_url, err: errorMessage, img_hash };
};

export const domainTest = async (browser, domain) => {
  const [insecure, secure] = await Promise.all([
    pageTest(browser, `http://${domain}`),
    pageTest(browser, `https://${domain}`)
  ]);
  const img_hash_match = insecure.img_hash === secure.img_hash;
  const final_url_match = insecure.final_url === secure.final_url;
  return { domain, insecure, secure, img_hash_match, final_url_match };
};

const resultQueueUrl = "https://sqs.us-west-1.amazonaws.com/275005321946/result-queue";

const gBrowser = await createBrowser();

export const handler = async (event, context) => {
  try {
    console.log({"event": JSON.stringify(event, null, '  '), "context": JSON.stringify(event, null, '  ')});
    const domains = event.domains ?? event.Records.map(record => JSON.parse(record.body).domain);
    for (let domain of domains) {
      const results = await domainTest(gBrowser, domain);
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
