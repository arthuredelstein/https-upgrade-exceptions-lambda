import pFilter from 'p-filter';
import { getJSON, getAllNames, putText } from './util.mjs';

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
