import { S3 } from '@aws-sdk/client-s3';
import pMap from 'p-map';
import fsPromise from 'node:fs/promises';
import path from 'node:path';
import { get as getDomains } from './brave/tranco.js'


const client = new S3({});

const httpsUpgradeExceptionsBucket = 'https-upgrade-exceptions';

export const getJSON = async (path) => {
  const result = await client.getObject({
    Bucket: httpsUpgradeExceptionsBucket,
    Key: path
  });
//  console.log(i, path);
  const raw = await result.Body.transformToString();
  return JSON.parse(raw);
};

export const putJSON = (path, jsonObject) =>
  client.putObject({
    Bucket: httpsUpgradeExceptionsBucket,
    Key: path,
    Body: JSON.stringify(jsonObject),
    ContentType: 'application/json'
  });

export const listObjects = (path, ContinuationToken) =>
  client.listObjectsV2({
    Bucket: httpsUpgradeExceptionsBucket,
    Prefix: path,
    ContinuationToken
  });

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
};

const fetchAndSave = async (path) => {
  const data = await getJSON(path);
  await fsPromise.writeFile(path, JSON.stringify(data));
};

export const objectListIterator = async function * (path) {
  while (true) {
    const results = await listObjects(path);
    for (const item of results.Contents) {
      yield item;
    }
    if (results.NextContinuationToken === undefined) {
      break;
    }
  }
};

export const getAllNames = async function (path) {
  const bigList = [];
  let ContinuationToken;
  let i = 0;
  while (true) {
    ++i;
    const results = await listObjects(path, ContinuationToken);
    for (const item of results.Contents) {
      bigList.push(item);
    }
    ContinuationToken = results.NextContinuationToken;
    if (i % 10 === 0) {
      console.log(bigList.length, bigList[bigList.length - 1], ContinuationToken);
    }
    if (ContinuationToken === undefined) {
      break;
    }
  }
  const keyList = bigList.map(item => item.Key);
  await fsPromise.mkdir(path, { recursive: true });
  await fsPromise.writeFile(path + '-names.txt', keyList.join('\n'));
  return keyList;
};

export const fetchAndSaveAllObjects = async (keys) => {
  const dir = path.dirname(keys[0]);
  fsPromise.mkdir(dir, { recursive: true} );
  let i = 0;
  const fetchAndSaveMonitored = (path) => {
    if (i % 1000 === 0) {
      console.log(i);
    }
    ++i;
    return fetchAndSave(path);
  }
  await pMap(keys, fetchAndSaveMonitored, { concurrency: 100 } );
};

const urlEssence = (urlString) => {
  const url = new URL(urlString);
  url.search = '';
  const newURL = url.href
    .replace(/^https:\/\//, '')
    .replace(/^http:\/\//, '')
    .replace(/^www\./, '')
    .replace(/^m\./, '')
    .replace(/\/en\/$/, '/')
    .replace(/index\.html$/, '')
    .replace(/index\.htm$/, '')
    .replace(/index\.php$/, '')
    .replace(/\/+$/, '')
    .replace(/ww[0-9][0-9]\./, 'www.')
    .replace(/subid1=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/, '');
  return newURL;
};

export const readObject = async fileName => {
  return JSON.parse(await fsPromise.readFile(fileName));
};

const justRedirects = value => {
  if (value.secure.responses.length > 10 &&
    value.insecure.responses.length > 10 &&
    value.secure.responses.length + 1 === value.insecure.responses.length &&
    value.insecure.responses[0].status >= 300 &&
    value.insecure.responses[0].status < 400) {
    return true;
  }
  return false;
};

const selectObjects = async (path, names, filter) => {
  const filteredObjects = [];
  let i = 0;
  const checkName = async (name) => {
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
      console.log(i, ':', filteredObjects.length);
    }
  }
  await pMap(names, checkName, { concurrency: 50 });
  return filteredObjects;
};

const countObjects = async (path, names) => {
  const secureStatusCodes = {};
  const secureErrors = {};
  const neither = [];
  let i = 0;
  const checkItem = async (name) => {
    ++i;
    if (i % 1000 === 0) {
      console.log(i);
    }
    const fileName = `${path}/${name}`;
    let object;
    try {
      object = JSON.parse(await fsPromise.readFile(fileName));
      finalStatus = object.secure.finalStatus;
      let err = object.secure.err;
      if (err !== undefined && err !== null) {
        err = object.secure.err.split(" at ")[0];
      }
      if (object.secure.finalStatus < 400 && object.secure.err === null) {
        neither.push(name);
      }
      if (err !== null) {
        secureErrors[err] = secureErrors[err] ? 1 + secureErrors[err] : 1;
      }
      if (finalStatus !== null) {
        secureStatusCodes[finalStatus] = secureStatusCodes[finalStatus] ? 1 + secureStatusCodes[finalStatus] : 1;
      }
    } catch (e) {
      console.log(name, object, e);
    }
  };
  await pMap(names, checkItem, { concurrency: 50});
  return { secureErrors, secureStatusCodes, neither }
}

const step1Filter = item => {
  return item.insecure.finalUrl !== item.secure.finalUrl;
};

const step2Filter = item => item.secure.err === null;

// Are we not seeing an http error?
const step3Filter = item => item.secure.finalStatus < 400;

// Do the images match exactly?
const step4Filter = item => item.insecure.imgHash !== item.secure.imgHash;

// Is it just a redirect?
const step5Filter = item => !justRedirects(item);

const step6Filter = item => urlEssence(item.insecure.finalUrl) !== urlEssence(item.secure.finalUrl);

const step7Filter = item => item.mssim > 0.9;

export const runFilters = async (path, names) => {
  const stepFilters = [step1Filter, step2Filter, step3Filter, step4Filter, step5Filter, step6Filter];
  const i = 0;
  for await (const stepFilter of stepFilters) {
    const step = await selectObjects(path, names, stepFilter);
    console.log(`step ${i}: ${step.length}`);
    await fsPromise.writeFile(`step${i}`, JSON.stringify(step));
  }
};
