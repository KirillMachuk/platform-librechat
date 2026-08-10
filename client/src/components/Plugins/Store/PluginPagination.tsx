import React from 'react';
import { ChevronLeft, ChevronRight } from '~/components/icons';
import { useLocalize } from '~/hooks';

type TPluginPaginationProps = {
  currentPage: number;
  maxPage: number;
  onChangePage: (page: number) => void;
};

const PluginPagination: React.FC<TPluginPaginationProps> = ({
  currentPage,
  maxPage,
  onChangePage,
}) => {
  const localize = useLocalize();
  const pages = [...Array(maxPage).keys()].map((i) => i + 1);

  const handlePageChange = (page: number) => {
    if (page < 1 || page > maxPage) {
      return;
    }
    onChangePage(page);
  };

  return (
    <div className="flex gap-2 text-sm text-black/60 dark:text-white/70">
      <div
        role="button"
        tabIndex={0}
        aria-label={localize('com_ui_page_prev')}
        onClick={() => handlePageChange(currentPage - 1)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            onChangePage(currentPage - 1);
          }
        }}
        className={`flex cursor-default items-center text-sm ${
          currentPage === 1
            ? 'text-black/70 opacity-50 dark:text-white/70'
            : 'text-black/70 hover:text-black/50 dark:text-white/70 dark:hover:text-white/50'
        }`}
        style={{ userSelect: 'none' }}
      >
        <ChevronLeft className="icon-sm" />
        {localize('com_ui_prev')}
      </div>
      {pages.map((page) => (
        <div
          role="button"
          key={page}
          tabIndex={0}
          className={`flex h-5 w-5 items-center justify-center text-sm ${
            currentPage === page
              ? 'text-blue-600 hover:text-blue-600 dark:text-blue-600 dark:hover:text-blue-600'
              : 'text-black/70 hover:text-black/50 dark:text-white/70 dark:hover:text-white/50'
          }`}
          style={{ userSelect: 'none' }}
          onClick={() => onChangePage(page)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              onChangePage(page);
            }
          }}
        >
          {page}
        </div>
      ))}
      <div
        role="button"
        aria-label={localize('com_ui_page_next')}
        tabIndex={0}
        onClick={() => handlePageChange(currentPage + 1)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            onChangePage(currentPage + 1);
          }
        }}
        className={`flex cursor-default items-center text-sm ${
          currentPage === maxPage
            ? 'text-black/70 opacity-50 dark:text-white/70'
            : 'text-black/70 hover:text-black/50 dark:text-white/70 dark:hover:text-white/50'
        }`}
        style={{ userSelect: 'none' }}
      >
        {localize('com_ui_next')}
        <ChevronRight className="icon-sm" />
      </div>
    </div>
  );
};

export default PluginPagination;
