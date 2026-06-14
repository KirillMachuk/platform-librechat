import useSpeechToTextBrowser from './useSpeechToTextBrowser';
import useSpeechToTextExternal from './useSpeechToTextExternal';
import useGetAudioSettings from './useGetAudioSettings';

const useSpeechToText = (
  setText: (text: string) => void,
  onTranscriptionComplete: (text: string) => void,
): {
  isLoading?: boolean;
  isListening?: boolean;
  stopRecording: () => void | (() => Promise<void>);
  startRecording: () => void | (() => Promise<void>);
} => {
  const { speechToTextEndpoint } = useGetAudioSettings();
  /** `openai`/`azureOpenAI` — провайдеры серверного STT из конфига (схема допускает только их),
   * поэтому они тоже означают «внешний» (сервер), а не браузерный. */
  const externalSpeechToText =
    speechToTextEndpoint === 'external' ||
    speechToTextEndpoint === 'openai' ||
    speechToTextEndpoint === 'azureOpenAI';

  const {
    isListening: speechIsListeningBrowser,
    isLoading: speechIsLoadingBrowser,
    startRecording: startSpeechRecordingBrowser,
    stopRecording: stopSpeechRecordingBrowser,
  } = useSpeechToTextBrowser(setText, onTranscriptionComplete);

  const {
    isListening: speechIsListeningExternal,
    isLoading: speechIsLoadingExternal,
    externalStartRecording: startSpeechRecordingExternal,
    externalStopRecording: stopSpeechRecordingExternal,
  } = useSpeechToTextExternal(setText, onTranscriptionComplete);

  const isListening = externalSpeechToText ? speechIsListeningExternal : speechIsListeningBrowser;
  const isLoading = externalSpeechToText ? speechIsLoadingExternal : speechIsLoadingBrowser;

  const startRecording = externalSpeechToText
    ? startSpeechRecordingExternal
    : startSpeechRecordingBrowser;
  const stopRecording = externalSpeechToText
    ? stopSpeechRecordingExternal
    : stopSpeechRecordingBrowser;

  return {
    isLoading,
    isListening,
    stopRecording,
    startRecording,
  };
};

export default useSpeechToText;
