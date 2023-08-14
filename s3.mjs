import { S3 } from '@aws-sdk/client-s3';
import pMap from 'p-map';
import fsPromise from 'node:fs/promises';
import path from 'node:path';
import { get as getDomains } from './brave/tranco.js'
import _ from 'lodash';
import moize from 'moize';

const client = new S3({});

const httpsUpgradeExceptionsBucket = 'https-upgrade-exceptions';

export const getJSON_raw = async (path) => {
  const result = await client.getObject({
    Bucket: httpsUpgradeExceptionsBucket,
    Key: path
  });
//  console.log(i, path);
  const raw = await result.Body.transformToString();
  return JSON.parse(raw);
};

const getJSON = moize(getJSON_raw);

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
    .replace(/^www\./, '')
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


const useRemote = true;

const selectObjects = async (names, filter) => {
  const yes = [];
  const no = [];
  let i = 0;
  const checkName = async (name) => {
    let object;
    try {
      object = useRemote ? await getJSON(name)
                         : JSON.parse(await fsPromise.readFile(name));
      if (filter(object)) {
        yes.push(name);
      } else {
        no.push(name);
      }
    } catch (e) {
      console.log(name, object, e);
    }
    ++i;
    if (i % 1000 === 0) {
      console.log(i, ':', yes.length, no.length);
    }
  }
  await pMap(names, checkName, { concurrency: 50 });
  console.log(i, ':', yes.length, no.length);
  return { yes, no };
};

const funnel = async (names, filters) => {
  const results = [names];
  let suspects = names;
  for (const [filterName, filter] of Object.entries(filters)) {
    const { yes, no } = await selectObjects(suspects, filter);
    suspects = no;
    results.push([filterName, suspects]);
  }
  return Object.fromEntries(results);
};

const countObjects = async (names) => {
  const secureStatusCodes = {};
  const secureErrors = {};
  const neither = [];
  let i = 0;
  const checkItem = async (name) => {
    ++i;
    if (i % 1000 === 0) {
      console.log(i);
    }
    let object;
    try {
      object = useRemote ? await getJSON(name)
                         : JSON.parse(await fsPromise.readFile(name));
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

const finalUrlsMatch = item => {
  return item.insecure.finalUrl === item.secure.finalUrl;
};

const secureSecurityError = item => item.secure.err !== null;

const secureHttpError = item => item.secure.finalStatus >= 400;

const insecureSecurityError = item => item.insecure.err !== null;

const insecureHttpError = item => item.insecure.finalStatus >= 400;

const initialScreenshotsSimilar = item => item.mssim >= 0.90;

const cdnpark = item => 
  item.insecure.responses.filter(r => r.url.includes("i.cdnpark.com/registrar/v3/loader.js")).length > 0;

const sedoparking = item => 
  item.insecure.responses.filter(r => r.url.includes("img.sedoparking.com")).length > 0;

const parkingLander = item => 
  item.insecure.responses.filter(r => r.url.includes("img1.wsimg.com/parking-lander/static/js")).length > 0;

const insecureParking = item => cdnpark(item) || sedoparking(item) || parkingLander(item);

const runStandardFunnel = async (path) => {
  const names = await getAllNames("raw/" + path);
  const results = await funnel(names,
    {
      finalUrlsMatch,
      secureSecurityError,
      secureHttpError,
      initialScreenshotsSimilar,
      insecureSecurityError,
      insecureHttpError,
      insecureParking
    });
  return results;
};
