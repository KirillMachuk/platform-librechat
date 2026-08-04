import { useMemo, useCallback, useState, useEffect, useLayoutEffect, useRef } from 'react';
import { EModelEndpoint } from 'librechat-data-provider';
import {
  getIconEndpoint,
  getEntity,
  getModelSpec,
  createConfigHtmlSanitizer,
  CONFIG_HTML_MEDIA_TAGS,
  CONFIG_HTML_MEDIA_ATTR,
} from '~/utils';
import { useChatContext, useAgentsMapContext, useAssistantsMapContext } from '~/Providers';
import { useGetEndpointsQuery, useGetStartupConfig } from '~/data-provider';
import { useLocalize, useAuthContext } from '~/hooks';

/** Canon §3: the empty-chat greeting is 22/500 on a phone and 21/500 on the
 *  desktop scale. Long agent names still step down rather than wrap into a
 *  wall of text. */
function getTextSizeClass(text: string | undefined | null) {
  if (!text) {
    return 'text-[19px] sm:text-[17px]';
  }

  if (text.length < 40) {
    return 'text-[22px] sm:text-[21px]';
  }

  if (text.length < 70) {
    return 'text-[19px] sm:text-[17px]';
  }

  return 'text-[17px] sm:text-[15px]';
}

export default function Landing({ centerFormOnLanding }: { centerFormOnLanding: boolean }) {
  const { conversation } = useChatContext();
  const agentsMap = useAgentsMapContext();
  const assistantMap = useAssistantsMapContext();
  const { data: startupConfig } = useGetStartupConfig();
  const { data: endpointsConfig } = useGetEndpointsQuery();
  const { user } = useAuthContext();
  const localize = useLocalize();

  const [textHasMultipleLines, setTextHasMultipleLines] = useState(false);
  const [lineCount, setLineCount] = useState(1);
  const [contentHeight, setContentHeight] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const greetingRef = useRef<HTMLSpanElement>(null);

  const endpointType = useMemo(() => {
    let ep = conversation?.endpoint ?? '';
    if (ep === EModelEndpoint.azureOpenAI) {
      ep = EModelEndpoint.openAI;
    }
    return getIconEndpoint({
      endpointsConfig,
      iconURL: conversation?.iconURL,
      endpoint: ep,
    });
  }, [conversation?.endpoint, conversation?.iconURL, endpointsConfig]);

  const { entity, isAgent, isAssistant } = getEntity({
    endpoint: endpointType,
    agentsMap,
    assistantMap,
    agent_id: conversation?.agent_id,
    assistant_id: conversation?.assistant_id,
  });

  const modelSpec = useMemo(
    () => getModelSpec({ specName: conversation?.spec, startupConfig }),
    [conversation?.spec, startupConfig],
  );

  const brandedSpecLabel = modelSpec?.showOnLanding ? modelSpec.label : '';
  const brandedSpecDescription = (modelSpec?.showOnLanding && modelSpec.description) || '';
  const name = entity?.name ?? brandedSpecLabel;
  const description =
    (entity?.description || brandedSpecDescription || conversation?.greeting) ?? '';
  const descriptionIsHTML = description.trim().startsWith('<');

  const sanitizeDescription = useMemo(
    () =>
      createConfigHtmlSanitizer({
        allowedTags: CONFIG_HTML_MEDIA_TAGS,
        allowedAttr: CONFIG_HTML_MEDIA_ATTR,
      }),
    [],
  );

  /** Owner's decision 04.08: everyone gets the same greeting. The time-of-day
   *  variants and the appended name are gone — the line is a product string,
   *  and `customWelcome` in the config still overrides it if the client ever
   *  wants a different one. */
  const greetingText = useMemo(() => {
    const customWelcome = startupConfig?.interface?.customWelcome;
    if (typeof customWelcome === 'string' && customWelcome.trim() !== '') {
      return user?.name != null && customWelcome.includes('{{user.name}}')
        ? customWelcome.replace(/{{user.name}}/g, user.name)
        : customWelcome;
    }
    return localize('com_ui_landing_greeting');
  }, [localize, startupConfig?.interface?.customWelcome, user?.name]);

  const handleLineCountChange = useCallback((count: number) => {
    setTextHasMultipleLines(count > 1);
    setLineCount(count);
  }, []);

  useEffect(() => {
    if (contentRef.current) {
      setContentHeight(contentRef.current.offsetHeight);
    }
  }, [lineCount, description]);

  const getDynamicMargin = useMemo(() => {
    let margin = 'mb-0';

    if (lineCount > 2 || (description && description.length > 100)) {
      margin = 'mb-10';
    } else if (lineCount > 1 || (description && description.length > 0)) {
      margin = 'mb-6';
    } else if (textHasMultipleLines) {
      margin = 'mb-4';
    }

    if (contentHeight > 200) {
      margin = 'mb-16';
    } else if (contentHeight > 150) {
      margin = 'mb-12';
    }

    return margin;
  }, [lineCount, description, textHasMultipleLines, contentHeight]);

  /** Measure wrapped line count before paint (useLayoutEffect) so the dynamic
   *  bottom margin settles without a visible post-paint recenter on narrow
   *  screens. Observe the block-level container (reliable ResizeObserver target
   *  across devices) while measuring the inline greeting's line boxes. */
  useLayoutEffect(() => {
    const element = greetingRef.current;
    const container = contentRef.current;
    if (!element || !container) {
      return;
    }
    const measure = () => handleLineCountChange(element.getClientRects().length || 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [name, greetingText, handleLineCountChange]);

  return (
    <div
      className={`flex h-full transform-gpu flex-col items-center justify-center pb-16 transition-all duration-200 ${centerFormOnLanding ? 'max-h-full sm:max-h-0' : 'max-h-full'} ${getDynamicMargin}`}
    >
      <div ref={contentRef} className="flex flex-col items-center gap-0 p-2">
        {((isAgent || isAssistant) && name) || name ? (
          <div className="flex flex-col items-center gap-0 p-2">
            <h1
              className={`${getTextSizeClass(name)} text-center font-medium tracking-[-0.02em] text-text-primary`}
            >
              <span ref={greetingRef}>{name}</span>
            </h1>
          </div>
        ) : (
          <h1
            className={`${getTextSizeClass(greetingText)} text-center font-medium tracking-[-0.02em] text-text-primary`}
          >
            <span ref={greetingRef}>{greetingText}</span>
          </h1>
        )}
        {description &&
          (descriptionIsHTML ? (
            <div
              className="mt-1.5 flex max-w-md items-center justify-center gap-2 text-center text-[15px] font-normal text-text-tertiary sm:mt-2 [&_img]:inline-block [&_img]:h-4 [&_img]:w-4"
              dangerouslySetInnerHTML={{ __html: sanitizeDescription(description) }}
            />
          ) : (
            <div className="mt-1.5 max-w-md text-center text-[15px] font-normal text-text-tertiary sm:mt-2">
              {description}
            </div>
          ))}
      </div>
    </div>
  );
}
