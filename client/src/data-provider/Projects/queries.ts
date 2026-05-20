import { useQuery } from '@tanstack/react-query';
import { QueryKeys, dataService } from 'librechat-data-provider';
import type { UseQueryOptions, QueryObserverResult } from '@tanstack/react-query';
import type { TProject, TFile, ConversationListResponse } from 'librechat-data-provider';

export const useListProjectsQuery = (
  config?: UseQueryOptions<TProject[]>,
): QueryObserverResult<TProject[]> =>
  useQuery<TProject[]>([QueryKeys.projects], () => dataService.listProjects(), {
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    ...config,
  });

export const useGetProjectQuery = (
  projectId: string,
  config?: UseQueryOptions<TProject>,
): QueryObserverResult<TProject> =>
  useQuery<TProject>(
    [QueryKeys.project, projectId],
    () => dataService.getProject(projectId),
    {
      enabled: !!projectId,
      refetchOnWindowFocus: false,
      ...config,
    },
  );

export const useProjectConversationsQuery = (
  projectId: string,
  config?: UseQueryOptions<ConversationListResponse>,
): QueryObserverResult<ConversationListResponse> =>
  useQuery<ConversationListResponse>(
    [QueryKeys.projectConversations, projectId],
    () => dataService.listProjectConversations(projectId),
    {
      enabled: !!projectId,
      refetchOnWindowFocus: false,
      ...config,
    },
  );

export const useProjectFilesQuery = (
  projectId: string,
  config?: UseQueryOptions<TFile[]>,
): QueryObserverResult<TFile[]> =>
  useQuery<TFile[]>(
    [QueryKeys.projectFiles, projectId],
    () => dataService.listProjectFiles(projectId),
    {
      enabled: !!projectId,
      refetchOnWindowFocus: false,
      ...config,
    },
  );
