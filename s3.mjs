import { S3 } from "@aws-sdk/client-s3"
import pMap from 'p-map';
import fsPromise from 'node:fs/promises';

const client = new S3({});

const httpsUpgradeExceptionsBucket = "https-upgrade-exceptions";
const i = 0;

export const getJSON = async (path) => {
  const result = await client.getObject({
    Bucket: httpsUpgradeExceptionsBucket,
    Key: path
  })
  ++i;
  console.log(i, path);
  const raw = await result.Body.transformToString()
  return JSON.parse(raw);
}

export const putJSON = (path, jsonObject) =>
  client.putObject({
    Bucket: httpsUpgradeExceptionsBucket,
    Key: path,
    Body: JSON.stringify(jsonObject),
    ContentType: "application/json"
  });

export const listObjects = (path, ContinuationToken) =>
  client.listObjectsV2({
    Bucket: httpsUpgradeExceptionsBucket,
    Prefix: path,
    ContinuationToken
  })

export const listAllObjects = async (path) => {
  let fullContents = [];
  while (true) {
    const results = await listObjects(path);
    fullContents = fullContents.concat(results.Contents);
    if (!results.NextContinuationToken) {
      break;
    }
  }
  return fullContents;
}

const fetchAndSave = async (path) => {
  const data = await getJSON(path);
  await fsPromise.writeFile(path, JSON.stringify(data));
}

export const objectListIterator = async function * (path) {
  let n = 0;
  while (true) {
    const results = await listObjects(path);
    for (const item of results.Contents) {
      yield item;
    }
    if (results.NextContinuationToken === undefined) {
      break;
    }
  }
}

export const getAllNames = async function (path) {
  const bigList = [];
  let ContinuationToken = undefined;
  while (true) {
    const results = await listObjects(path, ContinuationToken);
    for (const item of results.Contents) {
      bigList.push(item);
    }
    ContinuationToken = results.NextContinuationToken;
    console.log(bigList.length, bigList[bigList.length - 1], ContinuationToken);
    if (ContinuationToken === undefined) {
      break;
    }
  }
  const keyList = bigList.map(item => item.Key);
  await fsPromise.mkdir(path, { recursive: true });
  await fsPromise.writeFile(path + "-names.txt", keyList.join("\n"));
  return keyList;
}

const fetchAndSaveAllObjects = async (keys) => {
  await pMap(keys, fetchAndSave, { concurrency: 50});
}

const urlEssence = (urlString) => {
  const url = new URL(urlString);
  url.search = "";
  const newURL = url.href
    .replace(/^https:\/\//, "")
    .replace(/^http:\/\//, "")
    .replace(/^www\./, "")
    .replace(/^m\./, "")
    .replace(/\/en\/$/, "/")
    .replace(/index\.html$/, "")
    .replace(/index\.htm$/, "")
    .replace(/index\.php$/, "")
    .replace(/\/+$/, "")
    .replace(/ww[0-9][0-9]\./, "www.")
    .replace(/subid1=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/, "");
  return newURL;
};

const readObject = async fileName => {
  return JSON.parse(await fsPromise.readFile(fileName));
}

const justRedirects = value => {
  if (value.secure.responses.length > 10 &&
    value.insecure.responses.length > 10 &&
    value.secure.responses.length + 1 === value.insecure.responses.length &&
    value.insecure.responses[0].status >= 300 &&
    value.insecure.responses[0].status < 400) {
    return true;
  }
  return false;
}

const selectObjects = async (path, names, filter) => {
  const filteredObjects = [];
  let i = 0;
  for (const name of names) {
    const fileName = `${path}/${name}`;
    let object;
    try {
      object = JSON.parse(await fsPromise.readFile(fileName));
      if (filter(object)) {
        filteredObjects.push(name);
      }
    } catch (e) {
      console.log(name, object, e);
    } 
    ++i;
    if (i % 1000 === 0) {
      console.log(i, ":", filteredObjects.length);
    }
  }
  return filteredObjects;
}

const step1Filter = item => {
  return item.insecure.final_url !== item.secure.final_url;
};

const step2Filter = item => item.secure.err === null;

// Are we not seeing an http error?
const step3Filter = item => item.secure.final_status < 400;

// Do the images match exactly?
const step4Filter = item => item.insecure.img_hash !== item.secure.img_hash;

// Is it just a redirect?
const step5Filter = item => !justRedirects(item);

const step6Filter = item => urlEssence(item.insecure.final_url) !== urlEssence(item.secure.final_url);

const runFilters = async (path, names) => {
  const stepFilters = [step1Filter, step2Filter, step3Filter];
  const i = 0;
  for await (const stepFilter of stepFilters) {
    const step = await selectObjects(path, names, stepFilter);
    console.log(`step ${i}: ${step.length}`);
    await fsPromise.writeFile(`step${i}`, JSON.stringify(step));
  }
};