import { describe, expect, test } from 'bun:test';
import { ENGINE_LANGUAGES, getLanguageOptionsForEngine } from '../app/src/lib/constants/languages';

describe('Urdu generation language', () => {
  test('OmniVoice offers Urdu', () => {
    expect(getLanguageOptionsForEngine('omnivoice')).toContainEqual({
      value: 'ur',
      label: 'Urdu',
    });
  });

  test('other engines do not advertise Urdu', () => {
    for (const [engine, languages] of Object.entries(ENGINE_LANGUAGES)) {
      if (engine !== 'omnivoice') expect(languages).not.toContain('ur');
    }
    expect(getLanguageOptionsForEngine('unknown').some((option) => option.value === 'ur')).toBe(false);
  });
});
