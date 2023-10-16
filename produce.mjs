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

const writeCombinedExceptionsList = async () => {
  const manualListResponse = await fetch('https://raw.githubusercontent.com/brave/adblock-lists/master/brave-lists/https-upgrade-exceptions-list.txt');
  const manualListText = await manualListResponse.text();
  const manualList = manualListText.split('\n');
  const automatedListText = await getText('current_list.txt');
  const automatedList = automatedListText.split('\n');
  const combinedList = [...manualList, ...automatedList];
  const combinedListText = combinedList.filter(x => x.trim().length > 0).join('\n');
  await putText('https-upgrade-exceptions-list.txt', combinedListText);
}

export const produceExceptionsList = async (path) => {
  const names = await getAllNames('raw/' + path);
  const list = await getExceptionsList(names);
  await writeExceptionsList(list);
  await writeCombinedExceptionsList();
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