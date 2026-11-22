'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { loadBossFormButtonsWindow } = require('./helpers/load-globals.js');

let win;
before(() => { win = loadBossFormButtonsWindow(); });

function openForm(bossIndex, type = 'boss-form:opened') {
  const modal = win.document.getElementById('modal-content');
  modal.innerHTML = '<button class="btn btn-primary">Browse Boss Library</button><div id="bf-battle-tools"></div><button class="btn btn-primary">Save</button>';
  win.AppStore.emit({ type, payload: { bossIndex } });
  return modal.querySelector('#bf-battle-tools');
}

test('saved raids expose skills, phases and rage together in Battle settings', () => {
  const tools = openForm(0);
  win.AppStore.emit({ type: 'boss-form:opened', payload: { bossIndex: 0 } });
  assert.deepEqual([...tools.children].map(button => button.textContent).sort(), ['Phases', 'Rage settings', 'Skills']);
});

test('new drafts and unrelated events do not mount saved-raid tools', () => {
  assert.equal(openForm(null).children.length, 0);
  assert.equal(openForm(0, 'world-boss:damage-applied').children.length, 0);
});

test('opening a combat tool respects the editor dismissal guard and keeps the raid index', () => {
  const calls = [];
  const button = openForm(5).querySelector('#wbrage-form-btn');
  win.wbrageOpenConfig = index => calls.push(index);
  win.CreatorWorkspace = { dismiss: () => false };
  button.click();
  assert.deepEqual(calls, []);
  win.CreatorWorkspace.dismiss = () => true;
  button.click();
  assert.deepEqual(calls, [5]);
});
