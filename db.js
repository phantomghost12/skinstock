// db.js
// A tiny file-based database. No native bindings, no setup — just a JSON
// file on disk. Perfectly fine for one person's personal product list.

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data.json');

function load() {
  if (!fs.existsSync(DB_PATH)) {
    const fresh = { products: [], listings: [], history: [], nextId: 1 };
    fs.writeFileSync(DB_PATH, JSON.stringify(fresh, null, 2));
    return fresh;
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
}

function save(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function nextId(data) {
  const id = data.nextId;
  data.nextId += 1;
  return id;
}

module.exports = { load, save, nextId };
