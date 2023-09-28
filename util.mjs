import { SQSClient, SendMessageCommand, SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import { S3 } from '@aws-sdk/client-s3';
import moize from 'moize';

const httpsUpgradeExceptionsBucket = 'https-upgrade-exceptions';

const sqs_client = new SQSClient({ region: 'us-west-1' });

export const sendToSQS = (url, messageObject) => {
  const params = {
    DelaySeconds: 0,
    MessageBody: JSON.stringify(messageObject),
    QueueUrl: url
  };
  const command = new SendMessageCommand(params);
  return sqs_client.send(command);
};

export const sendBatchToSQS = (url, messageObjectArray) => {
  const params = {
    Entries: messageObjectArray.map(messageObject => ({
      Id: Math.random().toString().slice(2),
      MessageBody: JSON.stringify(messageObject)
    })),
    QueueUrl: url
  };
  const command = new SendMessageBatchCommand(params);
  return sqs_client.send(command);
};

const s3_client = new S3({});

export const getJSON_raw = async (path) => {
  const result = await s3_client.getObject({
    Bucket: httpsUpgradeExceptionsBucket,
    Key: path
  });
//  console.log(i, path);
  const raw = await result.Body.transformToString();
  return JSON.parse(raw);
};

export const getJSON = moize(getJSON_raw);

export const putJSON = (path, jsonObject) =>
  s3_client.putObject({
    Bucket: httpsUpgradeExceptionsBucket,
    Key: path,
    Body: JSON.stringify(jsonObject),
    ContentType: 'application/json'
  });


export const putText = (path, text) => 
s3_client.putObject({
  Bucket: httpsUpgradeExceptionsBucket,
  Key: path,
  Body: text,
  ContentType: 'text/plain'
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

export const readObject = async fileName => {
  return JSON.parse(await fsPromise.readFile(fileName));
};