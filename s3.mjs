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
  return bigList;
}

const saveAllObjects = async (path) => {
  const objects = await listAllObjects();
  const keys = objects.map(item => item.Key);
  await pMap(keys, fetchAndSave, { concurrency: 100});
}

const selectObjects = async function (path, filter) {
  let i = 0;
  const items = objectListIterator(path);
  for await (const item of items) {
    const object = await getJSON(item.Key);
    ++i;
    //if (filter(object)) {
    //  yield object;
    //}
    if (i >= 1000) {
      break;
    }
  }
  return i;
};