const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { test } = require('node:test')

test('history cards use the themed foreground color in dark mode', () => {
  const source = readFileSync(require.resolve('../admin/Versions.tsx'), 'utf8')
  assert.match(source, /color:\s*\$\{\(\{ theme \}\) => theme\.colors\.neutral800\}/)
})
