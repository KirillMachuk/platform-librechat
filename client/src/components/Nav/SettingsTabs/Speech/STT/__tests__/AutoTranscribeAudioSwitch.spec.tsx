import React from 'react';
import '@testing-library/jest-dom/extend-expect';
import { RecoilRoot } from 'recoil';
import type { MutableSnapshot } from 'recoil';
import { render, fireEvent } from 'test/layout-test-utils';
import AutoTranscribeAudioSwitch from '../AutoTranscribeAudioSwitch';
import store from '~/store';

describe('AutoTranscribeAudioSwitch', () => {
  /**
   * Mock function to set the auto-transcribe-audio state.
   */
  let mockSetAutoTranscribeAudio:
    | jest.Mock<void, [boolean]>
    | ((value: boolean) => void)
    | undefined;

  beforeEach(() => {
    mockSetAutoTranscribeAudio = jest.fn();
  });

  it('renders correctly', () => {
    const { getByTestId } = render(
      <RecoilRoot>
        <AutoTranscribeAudioSwitch />
      </RecoilRoot>,
    );

    expect(getByTestId('AutoTranscribeAudio')).toBeInTheDocument();
  });

  it('is disabled by default because speech-to-text is off', () => {
    // Stage-1 speech defaults ship with the microphone (speechToText) OFF, so this
    // dependent switch is disabled and toggling it is a no-op.
    const { getByTestId } = render(
      <RecoilRoot>
        <AutoTranscribeAudioSwitch onCheckedChange={mockSetAutoTranscribeAudio} />
      </RecoilRoot>,
    );
    const switchElement = getByTestId('AutoTranscribeAudio');

    expect(switchElement).toBeDisabled();

    fireEvent.click(switchElement);
    expect(mockSetAutoTranscribeAudio).not.toHaveBeenCalled();
  });

  it('calls onCheckedChange when toggled and speech-to-text is enabled', () => {
    const initializeState = (snapshot: MutableSnapshot) => {
      snapshot.set(store.speechToText, true);
    };
    const { getByTestId } = render(
      <RecoilRoot initializeState={initializeState}>
        <AutoTranscribeAudioSwitch onCheckedChange={mockSetAutoTranscribeAudio} />
      </RecoilRoot>,
    );
    const switchElement = getByTestId('AutoTranscribeAudio');

    expect(switchElement).not.toBeDisabled();

    fireEvent.click(switchElement);
    // autoTranscribeAudio defaults to false, so the first toggle turns it on.
    expect(mockSetAutoTranscribeAudio).toHaveBeenCalledWith(true);
  });
});
