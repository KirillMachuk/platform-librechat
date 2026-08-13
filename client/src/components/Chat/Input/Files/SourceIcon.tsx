import { EModelEndpoint, FileSources } from 'librechat-data-provider';
import { Terminal, Type, Database } from '~/components/icons';
import { MinimalIcon } from '~/components/Endpoints';
import { cn } from '~/utils';

const sourceToEndpoint = {
  [FileSources.openai]: EModelEndpoint.openAI,
  [FileSources.azure]: EModelEndpoint.azureOpenAI,
};

/* 12.08-3 (ревью): бейдж источника — чернильная плашка канона для ВСЕХ
   источников; сырые синий/жёлтый/чёрный слои остались от LibreChat и
   спорили с объединённой карточкой файла. Какой источник — говорит
   ИКОНКА (терминал/текст/база), а не цвет. */
const sourceToClassname = {
  [FileSources.openai]: 'bg-[var(--c-ink)] text-[var(--c-ink-label)] opacity-85',
  [FileSources.azure]: 'bg-[var(--c-ink)] text-[var(--c-ink-label)] opacity-85',
  [FileSources.azure_blob]: 'bg-[var(--c-ink)] text-[var(--c-ink-label)] opacity-85',
  [FileSources.execute_code]: 'bg-[var(--c-ink)] text-[var(--c-ink-label)] opacity-85',
  [FileSources.text]: 'bg-[var(--c-ink)] text-[var(--c-ink-label)] opacity-85',
  [FileSources.vectordb]: 'bg-[var(--c-ink)] text-[var(--c-ink-label)] opacity-85',
};

const defaultClassName = 'absolute right-0 bottom-0 rounded-full p-[0.15rem] transition-colors';

export default function SourceIcon({
  source,
  isCodeFile,
  className = defaultClassName,
}: {
  source?: FileSources;
  isCodeFile?: boolean;
  className?: string;
}) {
  if (isCodeFile === true) {
    return (
      <div className={cn(className, sourceToClassname[FileSources.execute_code] ?? '')}>
        <span className="flex items-center justify-center">
          <Terminal className="h-3 w-3" aria-hidden="true" />
        </span>
      </div>
    );
  }

  if (source === FileSources.text) {
    return (
      <div className={cn(className, sourceToClassname[source] ?? '')}>
        <span className="flex items-center justify-center">
          <Type className="h-3 w-3" aria-hidden="true" />
        </span>
      </div>
    );
  }

  if (source === FileSources.vectordb) {
    return (
      <div className={cn(className, sourceToClassname[source] ?? '')}>
        <span className="flex items-center justify-center">
          <Database className="h-3 w-3" aria-hidden="true" />
        </span>
      </div>
    );
  }

  const endpoint = sourceToEndpoint[source ?? ''];

  if (!endpoint) {
    return null;
  }
  return (
    <div className={cn(className, sourceToClassname[source ?? ''] ?? '')}>
      <span className="flex items-center justify-center">
        <MinimalIcon
          endpoint={endpoint}
          size={14}
          isCreatedByUser={false}
          iconClassName="h-3 w-3"
        />
      </span>
    </div>
  );
}
