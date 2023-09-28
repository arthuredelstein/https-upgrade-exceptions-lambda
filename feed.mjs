import { get as getTrancoData } from './brave/tranco.js';
import { sendBatchToSQS, putText } from './util.mjs';
import fsPromise from 'node:fs/promises';

const domainQueue = 'https://sqs.us-west-1.amazonaws.com/275005321946/domain-queue';

const chunk = (array, n) => {
  const chunks = [];
  let chunk = [];
  for (let i = 0; i < array.length; ++i) {
    chunk.push(array[i]);
    if ((i + 1) % n === 0) {
      chunks.push(chunk);
      chunk = [];
    }
  }
  if (chunk.length > 0) {
    chunks.push(chunk);
  }
  return chunks;
};

const sendDomainsToSQS = async (domains, timeStamp, numScreenshots = 1) => {
  const resultPromises = [];
  for (const batch of domains) {
    const resultPromise = sendBatchToSQS(domainQueue, batch.map(domain => ({ domain, timeStamp, numScreenshots })));
    resultPromises.push(resultPromise);
  }
  const results = await Promise.allSettled(resultPromises);
  console.log({ timeStamp }, 'batches sent: ', results.filter(r => r.status === 'fulfilled').length);
};

const saveDomainListToBucket = async (domains, timestamp) => {
  await putText(`domainListSnapshots/${timestamp}`, domains.join('\n'));
};

const createTimeStamp = () => new Date().toISOString().slice(0, 19).replace(/[-:]/g, '');

export const handler = async (event, context) => {
  const { domains } = await getTrancoData(event.count);
  const timestamp = createTimeStamp();
  await saveDomainListToBucket(domains, timestamp);
  const chunkedDomains = chunk(domains, 10);
  await sendDomainsToSQS(chunkedDomains, timestamp);
};

export const followUpRun = async (filename) => {
  const raw = JSON.parse(await fsPromise.readFile(filename));
  const finalDomainList = raw.insecureParking.map(x => x.split('/').slice(-1)[0]);
  console.log(finalDomainList.slice(0, 3), '...');
  const chunkedFinalDomainList = chunk(finalDomainList, 10);
  await sendDomainsToSQS(chunkedFinalDomainList, createTimeStamp(), 5);
};
