import assert from 'node:assert/strict';
import { test } from 'node:test';
import { engineSupportsInstruct } from '../app/src/lib/constants/engines';
import { getLanguageOptionsForEngine } from '../app/src/lib/constants/languages';

test('instruction controls preserve upstream engines alongside VoxCPM2', () => {
  for (const engine of ['qwen_custom_voice', 'qwen_voice_design', 'omnivoice', 'voxcpm2']) {
    assert.equal(engineSupportsInstruct(engine), true, engine);
  }
  for (const engine of ['qwen', 'kokoro', undefined]) {
    assert.equal(engineSupportsInstruct(engine), false, engine);
  }
});

test('language menus retain separate engine capabilities', () => {
  const voxcpm = getLanguageOptionsForEngine('voxcpm2');
  const omni = getLanguageOptionsForEngine('omnivoice');
  const design = getLanguageOptionsForEngine('qwen_voice_design');

  assert.equal(voxcpm.length, 30);
  assert.equal(new Set(voxcpm.map(({ value }) => value)).size, 30);
  assert.ok(voxcpm.every(({ label }) => label));
  assert.ok(voxcpm.some(({ value }) => value === 'th'));
  assert.equal(omni.length, 23);
  assert.equal(
    omni.some(({ value }) => value === 'th'),
    false,
  );
  assert.equal(design.length, 10);
});
