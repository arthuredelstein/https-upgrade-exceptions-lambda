import pFilter from 'p-filter';
import { getJSON, getText, getAllNames, putText } from './util.mjs';

const getDomainListSnapshot = async (path) => {
  const text = await getText(`domainListSnapshots/${path}`);
  return text.split("\n");
};

export const shouldBeOnList = async (name) => {
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
  }, { concurrency: 500 });
};

const writeExceptionsList = async (list) => {
  const domains = list.map(x => x.split('/')[2]);
  const fileContents = domains.join('\n');
  await putText('current_list.txt', fileContents);
  return fileContents;
};

export const produceExceptionsList = async (path) => {
  const names = await getAllNames('raw/' + path);
  const list = await getExceptionsList(names);
  await writeExceptionsList(list);
};

export const handler = async (event, context) => {
  try {
    await produceExceptionsList(event.name);
    return null;
  } catch (e) {
    console.log(e);
    return null;
  }
};