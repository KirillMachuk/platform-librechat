import { useEffect, useRef } from 'react';
import { useSetRecoilState } from 'recoil';
import { useGetCustomConfigSpeechQuery } from 'librechat-data-provider/react-query';
import { logger } from '~/utils';
import store from '~/store';

/**
 * Initializes speech-related Recoil values from the server-side custom
 * configuration on first load (only when the user is authenticated)
 */
export default function useSpeechSettingsInit(isAuthenticated: boolean) {
  const { data } = useGetCustomConfigSpeechQuery({ enabled: isAuthenticated });

  const setters = useRef({
    conversationMode: useSetRecoilState(store.conversationMode),
    advancedMode: useSetRecoilState(store.advancedMode),
    speechToText: useSetRecoilState(store.speechToText),
    textToSpeech: useSetRecoilState(store.textToSpeech),
    cacheTTS: useSetRecoilState(store.cacheTTS),
    engineSTT: useSetRecoilState(store.engineSTT),
    languageSTT: useSetRecoilState(store.languageSTT),
    autoTranscribeAudio: useSetRecoilState(store.autoTranscribeAudio),
    decibelValue: useSetRecoilState(store.decibelValue),
    autoSendText: useSetRecoilState(store.autoSendText),
    engineTTS: useSetRecoilState(store.engineTTS),
    voice: useSetRecoilState(store.voice),
    cloudBrowserVoices: useSetRecoilState(store.cloudBrowserVoices),
    languageTTS: useSetRecoilState(store.languageTTS),
    automaticPlayback: useSetRecoilState(store.automaticPlayback),
    playbackRate: useSetRecoilState(store.playbackRate),
  }).current;

  useEffect(() => {
    if (!isAuthenticated || !data || data.message === 'not_found') return;

    logger.log('Initializing speech settings from config:', data);

    Object.entries(data).forEach(([key, value]) => {
      if (key === 'sttExternal' || key === 'ttsExternal') return;

      if (localStorage.getItem(key) !== null) return;

      const setter = setters[key as keyof typeof setters];
      if (setter) {
        logger.log(`Setting default speech setting: ${key} = ${value}`);
        setter(value as any);
      }
    });

    /**
     * When the server has a sovereign STT provider configured, pin the engine to the
     * server ('external') instead of the browser's Web Speech API, which streams audio
     * to Google. A user's own choice is persisted in localStorage and is never
     * overridden here.
     *
     * The mic itself stays off until asked for (Settings → Speech): dictation is slow
     * enough that most people never reach for it, so it does not earn a permanent seat
     * in the composer.
     */
    if (data.sttExternal && localStorage.getItem('engineSTT') === null) {
      setters.engineSTT('external');
    }
  }, [isAuthenticated, data, setters]);
}
