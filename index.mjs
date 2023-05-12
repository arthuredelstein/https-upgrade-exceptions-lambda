import puppeteer from 'puppeteer-core';
import crypto from 'crypto';
import chromium from '@sparticuz/chromium';
import { SQSClient, AddPermissionCommand } from "@aws-sdk/client-sqs";

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
  return { insecure, secure };
};

const client = new SQSClient({ region: "us-west-1" });

export const handler = async (event, context) => {
  console.log("EVENT", event);
  const browser = await createBrowser();
  const results = await domainTest(browser, event.domain);
  try {
    await client.send(JSON.stringify(results));
    console.log("send succeeded");
  } catch (e) {
    console.log(e);
  }
  return results;
};
