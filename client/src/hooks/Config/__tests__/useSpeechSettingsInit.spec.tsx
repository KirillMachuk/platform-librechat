import React from 'react';
import { render, screen } from '@testing-library/react';
import { RecoilRoot, useRecoilValue } from 'recoil';
import useSpeechSettingsInit from '../useSpeechSettingsInit';
import store from '~/store';

let mockSpeechConfig: { sttExternal?: boolean; ttsExternal?: boolean } | undefined;

jest.mock('librechat-data-provider/react-query', () => ({
  useGetCustomConfigSpeechQuery: () => ({ data: mockSpeechConfig }),
}));

function Probe() {
  useSpeechSettingsInit(true);
  const speechToText = useRecoilValue(store.speechToText);
  const engineSTT = useRecoilValue(store.engineSTT);
  return (
    <>
      <span data-testid="mic">{String(speechToText)}</span>
      <span data-testid="engine">{engineSTT}</span>
    </>
  );
}

const renderProbe = () =>
  render(
    <RecoilRoot>
      <Probe />
    </RecoilRoot>,
  );

describe('useSpeechSettingsInit with a sovereign STT provider', () => {
  beforeEach(() => {
    localStorage.clear();
    mockSpeechConfig = { sttExternal: true, ttsExternal: false };
  });

  it('leaves the mic off for a fresh user', () => {
    renderProbe();

    expect(screen.getByTestId('mic')).toHaveTextContent('false');
  });

  it('still routes dictation to our own service rather than the browser engine', () => {
    renderProbe();

    expect(screen.getByTestId('engine')).toHaveTextContent('external');
  });

  it('respects a user who already switched the engine', () => {
    localStorage.setItem('engineSTT', JSON.stringify('browser'));

    renderProbe();

    expect(screen.getByTestId('engine')).toHaveTextContent('browser');
  });

  it('respects a user who already turned the mic on', () => {
    localStorage.setItem('speechToText', JSON.stringify(true));

    renderProbe();

    expect(screen.getByTestId('mic')).toHaveTextContent('true');
  });
});
