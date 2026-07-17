import { useMemo, useCallback, useState, useEffect, useRef } from 'react';
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

function getTextSizeClass(text: string | undefined | null) {
  if (!text) {
    return 'text-xl sm:text-2xl';
  }

  if (text.length < 40) {
    return 'text-2xl sm:text-4xl';
  }

  if (text.length < 70) {
    return 'text-xl sm:text-2xl';
  }

  return 'text-lg sm:text-md';
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

  const getGreeting = useCallback(() => {
    if (typeof startupConfig?.interface?.customWelcome === 'string') {
      const customWelcome = startupConfig.interface.customWelcome;
      // Replace {{user.name}} with actual user name if available
      if (user?.name && customWelcome.includes('{{user.name}}')) {
        return customWelcome.replace(/{{user.name}}/g, user.name);
      }
      return customWelcome;
    }

    const now = new Date();
    const hours = now.getHours();

    const dayOfWeek = now.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    // Early morning (midnight to 4:59 AM)
    if (hours >= 0 && hours < 5) {
      return localize('com_ui_late_night');
    }
    // Morning (6 AM to 11:59 AM)
    else if (hours < 12) {
      if (isWeekend) {
        return localize('com_ui_weekend_morning');
      }
      return localize('com_ui_good_morning');
    }
    // Afternoon (12 PM to 4:59 PM)
    else if (hours < 17) {
      return localize('com_ui_good_afternoon');
    }
    // Evening (5 PM to 8:59 PM)
    else {
      return localize('com_ui_good_evening');
    }
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

  const greetingText =
    typeof startupConfig?.interface?.customWelcome === 'string'
      ? getGreeting()
      : getGreeting() + (user?.name ? ', ' + user.name : '');

  useEffect(() => {
    const element = greetingRef.current;
    if (!element) {
      return;
    }
    const measure = () => handleLineCountChange(element.getClientRects().length || 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [name, greetingText, handleLineCountChange]);

  return (
    <div
      className={`flex h-full transform-gpu flex-col items-center justify-center pb-16 transition-all duration-200 ${centerFormOnLanding ? 'max-h-full sm:max-h-0' : 'max-h-full'} ${getDynamicMargin}`}
    >
      <div ref={contentRef} className="flex flex-col items-center gap-0 p-2">
        {((isAgent || isAssistant) && name) || name ? (
          <div className="flex flex-col items-center gap-0 p-2">
            <h1 className={`${getTextSizeClass(name)} text-center font-medium text-text-primary`}>
              <span ref={greetingRef}>{name}</span>
            </h1>
          </div>
        ) : (
          <h1
            className={`${getTextSizeClass(greetingText)} text-center font-medium text-text-primary`}
          >
            <span ref={greetingRef}>{greetingText}</span>
          </h1>
        )}
        {description &&
          (descriptionIsHTML ? (
            <div
              className="animate-fadeIn mt-4 flex max-w-md items-center justify-center gap-2 text-center text-sm font-normal text-text-primary [&_img]:inline-block [&_img]:h-4 [&_img]:w-4"
              dangerouslySetInnerHTML={{ __html: sanitizeDescription(description) }}
            />
          ) : (
            <div className="animate-fadeIn mt-4 max-w-md text-center text-sm font-normal text-text-primary">
              {description}
            </div>
          ))}
      </div>
    </div>
  );
}
