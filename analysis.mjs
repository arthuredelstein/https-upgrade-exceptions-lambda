import pMap from 'p-map';

import pFilter from 'p-filter';
import fsPromise from 'node:fs/promises';
import { stringify } from 'csv-stringify/sync';
import { getJSON, getAllNames, putText } from './util.mjs';

const useRemote = true;

const selectObjects = async (names, filter) => {
  const yes = [];
  const no = [];
  let i = 0;
  const checkName = async (name) => {
    let object;
    try {
      object = useRemote
        ? await getJSON(name)
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
  };
  await pMap(names, checkName, { concurrency: 50 });
  console.log(i, ':', yes.length, no.length);
  return { yes, no };
};

const funnel = async (names, filters) => {
  const results = [['base', names]];
  let suspects = names;
  for (const [filterName, filter] of Object.entries(filters)) {
    const { no } = await selectObjects(suspects, filter);
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
      console.log(name, i, JSON.stringify(results));
    }
    ++i;
    allResults[name] = results;
  };
  await pMap(names, analyzeName, { concurrency: 50 });
  return allResults;
};

export const countObjects = async (names) => {
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
      object = useRemote
        ? await getJSON(name)
        : JSON.parse(await fsPromise.readFile(name));
      const finalStatus = object.secure.finalStatus;
      let err = object.secure.err;
      if (err !== undefined && err !== null) {
        err = object.secure.err.split(' at ')[0];
      }
      if (finalStatus < 400 && object.secure.err === null) {
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
  await pMap(names, checkItem, { concurrency: 50 });
  return { secureErrors, secureStatusCodes, neither };
};

const finalUrlsMatch = item => {
  return item.insecure.finalUrl === item.secure.finalUrl;
};

const secureSecurityError = item => item.secure.err !== null;

const secureHttpError = item => item.secure.finalStatus >= 400;

const insecureSecurityError = item => item.insecure.err !== null;

const insecureHttpError = item => item.insecure.finalStatus >= 400;

const initialScreenshotsSimilar = item => item.mssim >= 0.90;

const cdnpark = item =>
  item.insecure.responses.filter(r => r.url.includes('i.cdnpark.com/registrar/v3/loader.js')).length > 0;

const sedoparking = item =>
  item.insecure.responses.filter(r => r.url.includes('img.sedoparking.com')).length > 0;

const parkingLander = item =>
  item.insecure.responses.filter(r => r.url.includes('img1.wsimg.com/parking-lander/static/js')).length > 0;

const insecureParking = item => cdnpark(item) || sedoparking(item) || parkingLander(item);

const testsObject = {
  finalUrlsMatch,
  secureSecurityError,
  secureHttpError,
  initialScreenshotsSimilar,
  insecureSecurityError,
  insecureHttpError,
  insecureParking
};

export const analyzeResult = (rawDataObject) => {
  const result = {};
  for (const [name, testFn] of Object.entries(testsObject)) {
    result[name] = testFn(rawDataObject);
  }
  return result;
};

export const runStandardFunnel = async (path) => {
  const names = await getAllNames('raw/' + path);
  const results = await funnel(names, testsObject);
  return results;
};

export const runStandardAnalysis = async (path) => {
  const names = await getAllNames('raw/' + path);
  const results = await analyzeObjects(names, testsObject);
  return results;
};

const sortMap = (m) => {
  const newMap = {};
  const keys = Object.keys(m);
  keys.sort();
  for (const k of keys) {
    newMap[k] = m[k];
  }
  return newMap;
};

const analysisCounts = async (data) => {
  const entries = Object.entries(data);
  const counts = {};
  for (const [/* name */, result] of entries) {
    for (const [key, val] of Object.entries(result)) {
      if (val) {
        counts[key] = 1 + (counts[key] ?? 0);
      }
    }
  }
  return sortMap(counts);
};

export const analyzeAll = async (data) => {
  return Promise.all(data.map(analysisCounts));
};

export const printStuff = async (results) => {
  for (const [, domains] of Object.entries(results)) {
    console.log(domains.length);
  }
};

export const runFollowupFunnel = async (path) => {
  const names = await getAllNames('raw/' + path);
  const results = await selectObjects(names, initialScreenshotsSimilar);
  return results;
};

const countResources = (item, URL) =>
  item.responses.filter(
    r => r.url.includes(URL)).length > 0;

const parkingResourceURLs = [
  'i.cdnpark.com/registrar/v3/loader.js',
  'img.sedoparking.com',
  'img1.wsimg.com/parking-lander/static/js'
];

const analyzeFailures = (item) => {
  if (item.err && item.err.startsWith('Navigation timeout')) {
    return 'navigationTimeout';
  }
  if (item.err && item.err.startsWith('net::')) {
    return 'networkError';
  }
  if (item.err) {
    console.log('unexpected error:', item.err);
  }
  if (item.finalStatus && item.finalStatus >= 400) {
    return 'httpError';
  }
  const parkingCounts = parkingResourceURLs.map(url => countResources(item, url));
  if (parkingCounts.filter(x => x > 0).length > 0) {
    return 'parking';
  }
  return 'success';
};

export const secondAnalysis = async (names) => {
  let i = 0;
  const statusDyads = {};
  const navigationSuccesses = { match: 0, similarImages: 0, different: 0 };
  const checkItem = async (name) => {
    try {
      const obj = await getJSON(name);
      const insecureStatus = analyzeFailures(obj.insecure);
      const secureStatus = analyzeFailures(obj.secure);
      statusDyads[insecureStatus] ??= {};
      statusDyads[insecureStatus][secureStatus] ??= 0;
      ++statusDyads[insecureStatus][secureStatus];
      if (insecureStatus === 'success' && secureStatus === 'success') {
        if (obj.insecure.finalUrl === obj.secure.finalUrl) {
          ++navigationSuccesses.match;
        } else if (obj.mssim > 0.9) {
          ++navigationSuccesses.similarImages;
        } else {
          ++navigationSuccesses.different;
        }
      }
      ++i;
      if (i % 1000 === 0) {
        console.log(i, name);
      }
    } catch (e) {
      console.log(name, 'failed', e);
    }
  };
  await pMap(names, checkItem, { concurrency: 50 });
  return { statusDyads, navigationSuccesses };
};

const statusValues = [
  'navigationTimeout',
  'networkError',
  'httpError',
  'parking',
  'success'
];

const statusDyadsToCsv = (data) => {
  const headerRow = ['insecure\\secure', ...statusValues];
  const table = [headerRow];
  for (const rowName of statusValues) {
    const rowData = [rowName];
    for (const colName of statusValues) {
      rowData.push(data[rowName][colName]);
    }
    table.push(rowData);
  }
  return stringify(table);
};

const navigationSuccessesToCSV = (data) => {
  const table = [];
  for (const [key, value] of Object.entries(data)) {
    table.push([key, value]);
  }
  return stringify(table);
};

export const writeAnalysisFile = async (filename, results) => {
  const dyads = statusDyadsToCsv(results.statusDyads);
  const successes = navigationSuccessesToCSV(results.navigationSuccesses);
  await fsPromise.writeFile(filename, dyads + '\n\n\n' + successes);
};

const shouldBeOnList = async (name) => {
  const data = await getJSON(name);
  for (const [/* name */, passed] of Object.entries(data.analysis)) {
    if (passed) {
      return false;
    }
  }
  return true;
};

const getExceptionsList = async (names) => {
  let i = 0;
  return await pFilter(names, async (name) => {
    ++i;
    if (i % 1000 === 0) {
      console.log(i);
    }
    try {
      return await shouldBeOnList(name);
    } catch (e) {
      console.log(name, ':', e);
      return false;
    }
  }, { concurrency: 50 });
};

const writeExceptionsList = async (list) => {
  const domains = list.map(x => x.split('/')[2]);
  const fileContents = domains.join('\n');
  await putText('current_list.txt', fileContents);
  return fileContents;
};

export const produceExceptionsList = async () => {
  const names = await getAllNames();
  const list = await getExceptionsList(names);
  await writeExceptionsList(list);
};
