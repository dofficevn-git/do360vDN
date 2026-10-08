// Bo goi TypeORM CLI.
// Truoc day script tro thang vao "node_modules/typeorm/cli.js"; voi npm workspaces
// typeorm bi hoist len node_modules o root nen duong dan cung do khong ton tai.
// Dung require.resolve de Node tu tim -> chay duoc ca khi cai bang npm lan pnpm.
// (typeorm khong export "package.json" trong exports map nen phai resolve entry chinh.)
const path = require('path');
const fs = require('fs');

const cli = path.join(path.dirname(require.resolve('typeorm')), 'cli.js');
if (!fs.existsSync(cli)) {
  console.error(`Khong tim thay TypeORM CLI tai: ${cli}. Chay "npm install" truoc.`);
  process.exit(1);
}
require(cli);
