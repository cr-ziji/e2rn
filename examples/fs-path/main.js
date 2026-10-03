const fs = require('fs');
const path = require('path');

function run() {
  const p = path.join(__dirname, 'test.txt');
  try {
    fs.existsSync(p);
  } catch (e) {
    // ignore
  }
}
run();
