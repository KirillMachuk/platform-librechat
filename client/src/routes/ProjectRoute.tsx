import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Palette, MoreHorizontal, Upload, FileText, Trash2 } from 'lucide-react';
import {
  Button,
  Spinner,
  TooltipAnchor,
  useToastContext,
} from '@librechat/client';
import {
  useGetProjectQuery,
  useProjectConversationsQuery,
  useProjectFilesQuery,
  useUploadProjectFileMutation,
  useDeleteProjectFileMutation,
} from '~/data-provider';
import { ProjectEditDialog } from '~/components/Projects';
import { useLocalize } from '~/hooks';
import { NotificationSeverity } from '~/common';
import { cn } from '~/utils';

type Tab = 'chats' | 'sources';

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export default function ProjectRoute() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { showToast } = useToastContext();
  const { projectId = '' } = useParams<{ projectId: string }>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState<Tab>('chats');
  const [editOpen, setEditOpen] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const { data: project, isLoading: projectLoading } = useGetProjectQuery(projectId);
  const { data: convoList } = useProjectConversationsQuery(projectId);
  const { data: files = [] } = useProjectFilesQuery(projectId);

  const uploadMutation = useUploadProjectFileMutation({
    onSuccess: () => {
      showToast({
        message: localize('com_projects_upload_success'),
        severity: NotificationSeverity.SUCCESS,
        showIcon: true,
      });
    },
    onError: () => {
      showToast({
        message: localize('com_projects_upload_error'),
        severity: NotificationSeverity.ERROR,
        showIcon: true,
      });
    },
  });

  const deleteFileMutation = useDeleteProjectFileMutation({
    onError: () => {
      showToast({
        message: localize('com_projects_upload_error'),
        severity: NotificationSeverity.ERROR,
        showIcon: true,
      });
    },
  });

  const conversations = useMemo(() => convoList?.conversations ?? [], [convoList]);

  const handleNewChat = useCallback(() => {
    navigate(`/c/new?project=${encodeURIComponent(projectId)}`);
  }, [navigate, projectId]);

  const handleUploadList = useCallback(
    (filesToUpload: FileList | File[] | null) => {
      if (!filesToUpload || !projectId) return;
      const arr = Array.from(filesToUpload);
      for (const f of arr) {
        uploadMutation.mutate({ projectId, file: f });
      }
    },
    [projectId, uploadMutation],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragOver(false);
      if (e.dataTransfer?.files?.length) {
        handleUploadList(e.dataTransfer.files);
      }
    },
    [handleUploadList],
  );

  const handleDeleteFile = useCallback(
    (fileId: string, filename: string) => {
      if (!window.confirm(localize('com_projects_remove_source_confirm', { name: filename }))) {
        return;
      }
      deleteFileMutation.mutate({ projectId, fileId });
    },
    [deleteFileMutation, localize, projectId],
  );

  if (projectLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex h-full w-full items-center justify-center text-text-secondary">
        {localize('com_projects_create_error')}
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col overflow-y-auto px-6 py-8">
      <div className="flex items-center justify-between gap-3 pb-4">
        <div className="flex items-center gap-3">
          <Palette className="h-7 w-7 text-pink-500" aria-hidden="true" />
          <h1 className="text-2xl font-semibold text-text-primary">{project.name}</h1>
        </div>
        <TooltipAnchor
          side="bottom"
          description={localize('com_projects_edit_title')}
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label={localize('com_projects_edit_title')}
              onClick={() => setEditOpen(true)}
              className="h-9 w-9 rounded-lg"
            >
              <MoreHorizontal className="h-5 w-5" />
            </Button>
          }
        />
      </div>

      {project.description ? (
        <p className="pb-4 text-sm text-text-secondary">{project.description}</p>
      ) : null}

      <button
        type="button"
        onClick={handleNewChat}
        className="mb-6 flex h-12 w-full items-center gap-3 rounded-2xl border border-border-light bg-surface-primary px-4 text-left text-sm text-text-secondary hover:bg-surface-hover"
      >
        <span className="text-xl text-text-secondary">+</span>
        <span>{localize('com_projects_new_chat', { name: project.name })}</span>
      </button>

      <div className="flex gap-2 border-b border-border-light">
        <TabButton active={tab === 'chats'} onClick={() => setTab('chats')}>
          {localize('com_projects_tab_chats')}
        </TabButton>
        <TabButton active={tab === 'sources'} onClick={() => setTab('sources')}>
          {localize('com_projects_tab_sources')}
        </TabButton>
      </div>

      <div className="pt-4">
        {tab === 'chats' && (
          <div className="flex flex-col gap-1">
            {conversations.length === 0 ? (
              <p className="py-8 text-center text-sm text-text-secondary">
                {localize('com_projects_no_chats')}
              </p>
            ) : (
              conversations.map((c) => (
                <a
                  key={c.conversationId}
                  href={`/c/${c.conversationId}`}
                  onClick={(e) => {
                    if (e.button === 0 && !e.ctrlKey && !e.metaKey) {
                      e.preventDefault();
                      navigate(`/c/${c.conversationId}`);
                    }
                  }}
                  className="flex flex-col gap-0.5 rounded-lg px-3 py-2 hover:bg-surface-hover"
                >
                  <span className="truncate text-sm text-text-primary">{c.title}</span>
                  <span className="truncate text-xs text-text-secondary">
                    {new Date(c.updatedAt ?? c.createdAt ?? Date.now()).toLocaleDateString()}
                  </span>
                </a>
              ))
            )}
          </div>
        )}

        {tab === 'sources' && (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
            className={cn(
              'flex flex-col gap-2 rounded-2xl border-2 border-dashed border-border-light p-4 transition-colors',
              isDragOver && 'border-pink-400 bg-surface-hover',
            )}
          >
            <div className="flex items-center justify-between pb-2">
              <span className="text-sm text-text-secondary">
                {isDragOver
                  ? localize('com_projects_drop_files')
                  : localize('com_projects_add_source')}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadMutation.isLoading}
                className="gap-2"
              >
                <Upload className="h-4 w-4" aria-hidden="true" />
                {uploadMutation.isLoading
                  ? localize('com_projects_uploading')
                  : localize('com_projects_add_source')}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  handleUploadList(e.target.files);
                  e.target.value = '';
                }}
              />
            </div>
            {files.length === 0 ? (
              <p className="py-6 text-center text-sm text-text-secondary">
                {localize('com_projects_no_sources')}
              </p>
            ) : (
              files.map((file) => (
                <div
                  key={file.file_id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border-light bg-surface-primary px-3 py-2"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <FileText className="h-5 w-5 flex-shrink-0 text-text-secondary" aria-hidden="true" />
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-sm text-text-primary">{file.filename}</span>
                      <span className="text-xs text-text-secondary">{formatBytes(file.bytes)}</span>
                    </div>
                  </div>
                  <TooltipAnchor
                    side="left"
                    description={localize('com_projects_remove_source')}
                    render={
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleDeleteFile(file.file_id, file.filename)}
                        aria-label={localize('com_projects_remove_source')}
                        disabled={deleteFileMutation.isLoading}
                      >
                        <Trash2 className="h-4 w-4 text-text-secondary" aria-hidden="true" />
                      </Button>
                    }
                  />
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <ProjectEditDialog project={project} open={editOpen} onOpenChange={setEditOpen} />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'border-b-2 px-3 py-2 text-sm transition-colors',
        active
          ? 'border-text-primary font-semibold text-text-primary'
          : 'border-transparent text-text-secondary hover:text-text-primary',
      )}
    >
      {children}
    </button>
  );
}
