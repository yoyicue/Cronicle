const fs = require('node:fs');
const path = require('node:path');
const { start, stop } = require('./lab.cjs');
const startSMTP = require('./smtp.cjs');
module.exports = async function() {
  const labs = [];
  const smtp = await startSMTP();
  let stopGateway;
  try {
    for (const [locale, port, name] of [['official', 4511, 'A'], ['en', 4512, 'B'], ['zh-CN', 4513, 'C']]) labs.push(await start(locale, port, name, labs[0] && path.join(labs[0].destination, 'htdocs')));
    stopGateway = await require('./gateway.cjs')(labs);
    fs.writeFileSync(path.join(__dirname, '.work/test-labs.json'), JSON.stringify(labs.map(({ child, ...value }) => value), null, 2));
    return async () => { await stopGateway(); await Promise.all(labs.map(stop)); await smtp.close(); };
  }
  catch (error) { if (stopGateway) await stopGateway(); await Promise.all(labs.map(stop)); await smtp.close(); throw error; }
};
