import { useMemo, useState, useEffect, useRef } from 'react';
import { Constants } from 'librechat-data-provider';
import { useRecoilState, useRecoilValue, useResetRecoilState } from 'recoil';
import { isFilePreviewArtifact, isCodeOnlyArtifact } from '~/utils/artifacts';
import { useArtifactsContext } from '~/Providers';
import { logger } from '~/utils';
import store from '~/store';

export default function useArtifacts() {
  const [activeTab, setActiveTab] = useState('preview');
  const { isSubmitting, latestMessageId, latestMessageText, conversationId } =
    useArtifactsContext();

  const artifacts = useRecoilValue(store.artifactsState);
  const resetArtifacts = useResetRecoilState(store.artifactsState);
  const resetCurrentArtifactId = useResetRecoilState(store.currentArtifactId);
  const [currentArtifactId, setCurrentArtifactId] = useRecoilState(store.currentArtifactId);

  const { orderedArtifactIds, latestAutoOpenArtifactId } = useMemo(() => {
    const ids = Object.keys(artifacts ?? {}).sort(
      (a, b) => (artifacts?.[a]?.lastUpdateTime ?? 0) - (artifacts?.[b]?.lastUpdateTime ?? 0),
    );
    for (let i = ids.length - 1; i >= 0; i--) {
      const id = ids[i];
      if (!isCodeOnlyArtifact(artifacts?.[id]?.type)) {
        return { orderedArtifactIds: ids, latestAutoOpenArtifactId: id };
      }
    }
    return { orderedArtifactIds: ids, latestAutoOpenArtifactId: null };
  }, [artifacts]);

  const prevIsSubmittingRef = useRef<boolean>(false);
  const lastContentRef = useRef<string | null>(null);
  const hasEnclosedArtifactRef = useRef<boolean>(false);
  const hasAutoSwitchedToCodeRef = useRef<boolean>(false);
  const lastRunMessageIdRef = useRef<string | null>(null);
  const prevConversationIdRef = useRef<string | null>(null);

  useEffect(() => {
    const resetState = () => {
      resetArtifacts();
      resetCurrentArtifactId();
      prevConversationIdRef.current = conversationId;
      lastRunMessageIdRef.current = null;
      lastContentRef.current = null;
      hasEnclosedArtifactRef.current = false;
      hasAutoSwitchedToCodeRef.current = false;
    };
    /* Сброс — про СМЕНУ разговора, а не про монтирование панели. Хук живёт
       ВНУТРИ панели, а панель монтируется только когда что-то уже выбрано;
       ветка «новый чат» срабатывала на каждом её монтировании (реф здесь
       умирает вместе с панелью, так что prev всегда null) и стирала ровно то
       состояние, которое панель и открыло. На пустом чате предпросмотр файла
       из библиотеки закрывался в тот же кадр (15.08-3, поймано e2e; проба
       этого не видела — она открывала файл в существующем диалоге).
       Наследовать чужие артефакты неоткуда: атом не переживает перезагрузку,
       а переход из разговора в «новый чат» закрывает первая ветка. */
    /* «new» -> реальный uuid — это ТОТ ЖЕ разговор, получивший id при первой
       отправке (17.08, ревью; прецедент — cleanup.ts для субагентов). Без
       гейта документ, открытый из библиотеки на пустом чате, закрывался ровно
       в момент отправки первого сообщения. Сброс при размонтировании живёт в
       ОТДЕЛЬНОМ эффекте без зависимостей: cleanup здесь бежит и на смене
       conversationId — со старым замыканием он стирал бы состояние на том же
       переходе, который этот гейт существует пропустить. */
    const isNewToReal =
      prevConversationIdRef.current === Constants.NEW_CONVO &&
      conversationId != null &&
      conversationId !== Constants.NEW_CONVO;
    if (
      conversationId !== prevConversationIdRef.current &&
      prevConversationIdRef.current != null &&
      !isNewToReal
    ) {
      resetState();
    }
    prevConversationIdRef.current = conversationId;
  }, [conversationId, resetArtifacts, resetCurrentArtifactId]);

  /** Resets artifacts when the PANEL unmounts (close, navigation away). */
  useEffect(() => {
    return () => {
      logger.log('artifacts_visibility', 'Unmounting artifacts');
      resetArtifacts();
      resetCurrentArtifactId();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Read currentArtifactId in effects without subscribing as a dependency.
   * Adding it to effect deps fires auto-select on every reset, breaking toggle-close.
   */
  const currentArtifactIdRef = useRef(currentArtifactId);
  currentArtifactIdRef.current = currentArtifactId;

  useEffect(() => {
    if (orderedArtifactIds.length === 0) return;
    const currentId = currentArtifactIdRef.current;
    if (currentId != null && orderedArtifactIds.includes(currentId)) return;
    if (latestAutoOpenArtifactId == null) {
      if (currentId != null) {
        resetCurrentArtifactId();
      }
      return;
    }
    setCurrentArtifactId(latestAutoOpenArtifactId);
  }, [latestAutoOpenArtifactId, orderedArtifactIds, resetCurrentArtifactId, setCurrentArtifactId]);

  /**
   * Manage artifact selection and code tab switching for non-enclosed artifacts
   * Runs when artifact content changes
   */
  useEffect(() => {
    // Check if we just finished submitting (transition from true to false)
    const justFinishedSubmitting = prevIsSubmittingRef.current && !isSubmitting;
    prevIsSubmittingRef.current = isSubmitting;

    // Only process during submission OR when just finished
    if (!isSubmitting && !justFinishedSubmitting) {
      return;
    }
    if (orderedArtifactIds.length === 0) {
      return;
    }
    if (latestMessageId == null) {
      return;
    }
    const latestArtifactId = orderedArtifactIds[orderedArtifactIds.length - 1];
    const latestArtifact = artifacts?.[latestArtifactId];
    if (latestArtifact?.content === lastContentRef.current && !justFinishedSubmitting) {
      return;
    }
    lastContentRef.current = latestArtifact?.content ?? null;
    if (isCodeOnlyArtifact(latestArtifact?.type)) {
      return;
    }
    /* Открытый ПРЕДПРОСМОТР ФАЙЛА пользователь выбрал сам — стриминговый
       артефакт не должен вырывать его из-под чтения (17.08, ревью): человек
       открывает источник из цитаты именно ВО ВРЕМЯ генерации ответа по нему. */
    const selectedId = currentArtifactIdRef.current;
    if (selectedId != null && isFilePreviewArtifact(artifacts?.[selectedId]?.type)) {
      return;
    }

    setCurrentArtifactId(latestArtifactId);

    // Only switch to code tab if we haven't detected an enclosed artifact yet
    if (!hasEnclosedArtifactRef.current && !hasAutoSwitchedToCodeRef.current) {
      const artifactStartContent = latestArtifact?.content?.slice(0, 50) ?? '';
      if (artifactStartContent.length > 0 && latestMessageText.includes(artifactStartContent)) {
        setActiveTab('code');
        hasAutoSwitchedToCodeRef.current = true;
      }
    }
  }, [
    artifacts,
    isSubmitting,
    latestMessageId,
    latestMessageText,
    orderedArtifactIds,
    setCurrentArtifactId,
  ]);

  /**
   * Watch for enclosed artifact pattern during message generation
   * Optimized: Exits early if already detected, only checks during streaming
   */
  useEffect(() => {
    if (!isSubmitting || hasEnclosedArtifactRef.current) {
      return;
    }

    const hasEnclosedArtifact =
      /:::artifact(?:\{[^}]*\})?(?:\s|\n)*(?:```[\s\S]*?```(?:\s|\n)*)?:::/m.test(
        latestMessageText.trim(),
      );

    if (hasEnclosedArtifact) {
      logger.log('artifacts', 'Enclosed artifact detected during generation, switching to preview');
      setActiveTab('preview');
      hasEnclosedArtifactRef.current = true;
      hasAutoSwitchedToCodeRef.current = false;
    }
  }, [isSubmitting, latestMessageText]);

  useEffect(() => {
    if (latestMessageId !== lastRunMessageIdRef.current) {
      lastRunMessageIdRef.current = latestMessageId;
      hasEnclosedArtifactRef.current = false;
      hasAutoSwitchedToCodeRef.current = false;
    }
  }, [latestMessageId]);

  const currentArtifact = currentArtifactId != null ? artifacts?.[currentArtifactId] : null;

  const currentIndex = orderedArtifactIds.indexOf(currentArtifactId ?? '');

  return {
    activeTab,
    setActiveTab,
    currentIndex,
    currentArtifact,
    orderedArtifactIds,
    setCurrentArtifactId,
  };
}
