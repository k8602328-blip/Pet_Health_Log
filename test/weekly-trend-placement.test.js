'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const method = (name, next) => html.slice(html.indexOf(`${name}(){`), html.indexOf(`${next}(){`));

test('今週のようすは記録ページから外してグラフ上部だけに表示する', () => {
  assert.doesNotMatch(method('renderDaily', 'syncQuickDockSpacing'), /weeklyTrendCardHtml/);
  assert.doesNotMatch(method('renderHome', 'renderMealProfiles'), /weeklyTrendCardHtml/);
  assert.doesNotMatch(method('renderList', 'renderMedsTab'), /weeklyTrendCardHtml/);
  const chart = method('renderChartTab', 'setActiveGraph');
  assert.match(chart, /main\.innerHTML = `\s*\$\{this\.weeklyTrendCardHtml\(\)\}\s*<div class="card">/);
});

test('未加入者向け案内は控えめな1行表示にする', () => {
  const weekly = method('weeklyTrendCardHtml', 'renderDaily');
  assert.match(weekly, /class="weekly-trend-upsell"/);
  assert.match(weekly, /「今週のようす」は\$\{planLabel\(\)\}で表示されます/);
  assert.doesNotMatch(weekly, /class="card"[^>]*アップグレード/);
});
