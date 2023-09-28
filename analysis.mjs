import pMap from 'p-map';
import fsPromise from 'node:fs/promises';
import path from 'node:path';
import _ from 'lodash';
import { stringify } from 'csv-stringify/sync';
import { getJSON } from './util.mjs';

const httpsUpgradeExceptionsBucket = 'https-upgrade-exceptions';

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

export const readObject = async fileName => {
  return JSON.parse(await fsPromise.readFile(fileName));
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
  const results = [['base', names]];
  let suspects = names;
  for (const [filterName, filter] of Object.entries(filters)) {
    const { yes, no } = await selectObjects(suspects, filter);
    suspects = no;
    results.push([filterName, suspects]);
  }
  return Object.fromEntries(results);
};

const analyzeObjects = async (names, filters) => {
  let i = 0;
  const allResults = {};
  const analyzeName = async (name) => {
    const results = {};
    try {
      const rawData = await getJSON(name);
      for (const [filterName, filter] of Object.entries(filters)) {
        results[filterName] = filter(rawData);
      }
    } catch (e) {
      console.log(name, e);
    }
    if (i % 1000 === 0) {
      console.log(name, i, JSON.stringify(results))
    }
    ++i;
    allResults[name] = results;
  }
  await pMap(names, analyzeName, { concurrency: 50 });
  return allResults;
}

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

const runStandardAnalysis = async (path) => {
  const names = await getAllNames("raw/" + path);
  const results = await analyzeObjects(names, {
    finalUrlsMatch,
    secureSecurityError,
    secureHttpError,
    initialScreenshotsSimilar,
    insecureSecurityError,
    insecureHttpError,
    insecureParking
  }); 
  return results;
}

const sortMap = (m) => {
  const newMap = {};
  const keys = Object.keys(m);
  keys.sort();
  for (const k of keys) {
    newMap[k] = m[k];
  }
  return newMap;
}

const analysisCounts = async(data) => {
  const entries = Object.entries(data);
  const counts = {};
  for (const [name, result] of entries) {
    for (const [key, val] of Object.entries(result)) {
      if (val) {
        counts[key] = 1 + (counts[key] ?? 0);
      }
    }
  }
  return sortMap(counts);
};

const analyzeAll = async(data) => {
  return Promise.all(data.map(analysisCounts));
}

const printStuff = async (results) => {
  for (const [category, domains] of Object.entries(results)) {
    console.log(domains.length);
  }
}

const runFollowupFunnel = async (path) => {
  const names = await getAllNames("raw/" + path);
  const results = await selectObjects(names, initialScreenshotsSimilar);
  return results;
}

const countResources = (item, URL) =>
  item.responses.filter(
    r => r.url.includes(URL)).length > 0;

const parkingResourceURLs = [
  "i.cdnpark.com/registrar/v3/loader.js",
  "img.sedoparking.com",
  "img1.wsimg.com/parking-lander/static/js"
];

const analyzeFailures = (item) => {
  if (item.err && item.err.startsWith("Navigation timeout")) {
    return "navigationTimeout";
  }
  if (item.err && item.err.startsWith("net::")) {
    return "networkError";
  }
  if (item.err) {
    console.log("unexpected error:", item.err);
  }
  if (item.finalStatus && item.finalStatus >= 400) {
    return "httpError";
  }
  const parkingCounts = parkingResourceURLs.map(url => countResources(item, url));
  if (parkingCounts.filter(x => x > 0).length > 0) {
    return "parking";
  }
  return "success";
};

export const secondAnalysis = async (names) => {
  let i = 0;
  const statusDyads = {};
  const navigationSuccesses = { "match": 0, "similarImages": 0, "different": 0};
  const checkItem = async (name) => {
    try {
      const obj = await getJSON(name);
      const insecureStatus = analyzeFailures(obj.insecure);
      const secureStatus = analyzeFailures(obj.secure);
      statusDyads[insecureStatus] ??= {};
      statusDyads[insecureStatus][secureStatus] ??= 0;
      ++statusDyads[insecureStatus][secureStatus];
      if (insecureStatus === "success" && secureStatus === "success") {
        if (obj.insecure.finalUrl === obj.secure.finalUrl) {
          ++navigationSuccesses["match"];
        } else if (obj.mssim > 0.9) {
          ++navigationSuccesses["similarImages"];
        } else {
          ++navigationSuccesses["different"];
        }
      }
      ++i;
      if (i % 1000 === 0) {
        console.log(i, name);
      }
    } catch (e) {
      console.log(name, "failed", e);
    }
  }
  await pMap(names, checkItem, { concurrency: 50});
  return { statusDyads, navigationSuccesses };
}

const statusValues = [
  "navigationTimeout",
  "networkError",
  "httpError",
  "parking",
  "success"
];


const statusDyadsToCsv = (data) => {
  const headerRow = ["insecure\\secure", ...statusValues];
  const table = [headerRow];
  for (const rowName of statusValues) {
    const rowData = [rowName];
    for (const colName of statusValues) {
      rowData.push(data[rowName][colName]);
    }
    table.push(rowData)
  }
  return stringify(table);
}

const navigationSuccessesToCSV = (data) => {
  const table = [];
  for (const [key, value] of Object.entries(data)) {
    table.push([key, value]);
  }
  return stringify(table);
}

const writeAnalysisFile = async (filename, results) => {
  const dyads = statusDyadsToCsv(results.statusDyads);
  const successes = navigationSuccessesToCSV(results.navigationSuccesses);
  await fsPromise.writeFile(filename, dyads + "\n\n\n" + successes);
}

const analyzeBothFailures = (obj) => {

  return { secureStatus, insecureStatus };
}