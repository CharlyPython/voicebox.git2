import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { createInstance } from 'i18next';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { SpeechPlayer, type SpeechPlayerProps } from '../src/components/DictateWindow/SpeechPlayer';
import en from '../src/i18n/locales/en/translation.json';

function renderPlayer(props: Partial<SpeechPlayerProps> = {}) {
  const i18n = createInstance();
  i18n.init({
    lng: 'en',
    resources: { en: { translation: en } },
    interpolation: { escapeValue: false },
    initImmediate: false,
  });
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <SpeechPlayer
        title="Agent report"
        status="playing"
        position={65}
        duration={120}
        bufferedDuration={120}
        canSeek
        playbackRate={1.5}
        canChangeRate
        onToggle={() => {}}
        onSeek={() => {}}
        onStop={() => {}}
        onRateChange={() => {}}
        {...props}
      />
    </I18nextProvider>,
  );
}

test('player exposes named controls and a readable playback position', () => {
  const markup = renderPlayer();
  expect(markup).toContain('aria-label="Voicebox speech player"');
  expect(markup).toContain('aria-label="Pause speech"');
  expect(markup).toContain('aria-label="Stop speech"');
  expect(markup).toContain('aria-label="Speech playback position"');
  expect(markup).toContain('aria-valuetext="1:05 of 2:00"');
  expect(markup).toContain('aria-label="Decrease speech speed"');
  expect(markup).toContain('aria-label="Increase speech speed"');
  expect(markup).toContain('1.5×');
});

test('paused and completed playback describe the available action', () => {
  expect(renderPlayer({ status: 'paused' })).toContain('aria-label="Resume speech"');
  const ended = renderPlayer({ status: 'ended' });
  expect(ended).toContain('aria-label="Replay speech"');
  expect(ended).toContain('aria-label="Dismiss speech player"');
});

test('unready audio and unsupported speed remain visible with disabled controls', () => {
  const markup = renderPlayer({
    status: 'generating',
    duration: null,
    bufferedDuration: 0,
    canSeek: false,
    canChangeRate: false,
  });
  expect(markup).toContain('Preparing speech…');
  expect(markup).toContain('Speed unavailable for this output');
  expect(markup.match(/disabled=""/g)).toHaveLength(4);
});

test('buffering and invalid media metadata never render non-finite values', () => {
  const buffering = renderPlayer({ duration: null, bufferedDuration: 90 });
  expect(buffering).toContain('aria-valuetext="1:05 of 1:30 buffered"');
  expect(buffering).toContain('Playing · generating more audio');
  const invalid = renderPlayer({
    position: Number.NaN,
    duration: Number.POSITIVE_INFINITY,
    bufferedDuration: Number.NaN,
    playbackRate: Number.NaN,
  });
  expect(invalid).not.toMatch(/NaN|Infinity/);
  expect(invalid).toContain('aria-valuetext="0:00 of 0:00 buffered"');
  expect(invalid).toContain('1×');
});

test('every shipped locale translates the player with matching interpolation placeholders', () => {
  const localesPath = new URL('../src/i18n/locales/', import.meta.url);
  const expected = en.speechPlayer;
  for (const locale of readdirSync(localesPath)) {
    const resource = JSON.parse(
      readFileSync(new URL(`${locale}/translation.json`, localesPath), 'utf8'),
    ).speechPlayer;
    expect(Object.keys(resource).sort()).toEqual(Object.keys(expected).sort());
    for (const [key, value] of Object.entries(expected)) {
      expect(resource[key].trim().length).toBeGreaterThan(0);
      expect((resource[key].match(/{{\w+}}/g) ?? []).sort()).toEqual(
        (value.match(/{{\w+}}/g) ?? []).sort(),
      );
    }
  }
});
