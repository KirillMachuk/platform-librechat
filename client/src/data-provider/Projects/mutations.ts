import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MutationKeys, QueryKeys, dataService } from 'librechat-data-provider';
import type { UseMutationOptions } from '@tanstack/react-query';
import type {
  TFile,
  TProject,
  TProjectCreate,
  TProjectUpdate,
} from 'librechat-data-provider';

export const useCreateProjectMutation = (
  options?: UseMutationOptions<TProject, Error, TProjectCreate>,
) => {
  const queryClient = useQueryClient();
  return useMutation((payload: TProjectCreate) => dataService.createProject(payload), {
    mutationKey: [MutationKeys.createProject],
    ...options,
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries([QueryKeys.projects]);
      options?.onSuccess?.(data, variables, context);
    },
  });
};

export const useUpdateProjectMutation = (
  projectId: string,
  options?: UseMutationOptions<TProject, Error, TProjectUpdate>,
) => {
  const queryClient = useQueryClient();
  return useMutation(
    (payload: TProjectUpdate) => dataService.updateProject(projectId, payload),
    {
      mutationKey: [MutationKeys.updateProject, projectId],
      ...options,
      onSuccess: (data, variables, context) => {
        queryClient.invalidateQueries([QueryKeys.projects]);
        queryClient.invalidateQueries([QueryKeys.project, projectId]);
        options?.onSuccess?.(data, variables, context);
      },
    },
  );
};

export const useDeleteProjectMutation = (
  options?: UseMutationOptions<void, Error, string>,
) => {
  const queryClient = useQueryClient();
  return useMutation((projectId: string) => dataService.deleteProject(projectId), {
    mutationKey: [MutationKeys.deleteProject],
    ...options,
    onSuccess: (data, projectId, context) => {
      queryClient.invalidateQueries([QueryKeys.projects]);
      queryClient.removeQueries([QueryKeys.project, projectId]);
      queryClient.invalidateQueries([QueryKeys.allConversations]);
      options?.onSuccess?.(data, projectId, context);
    },
  });
};

export type UploadProjectFileArgs = { projectId: string; file: File };

export const useUploadProjectFileMutation = (
  options?: UseMutationOptions<TFile, Error, UploadProjectFileArgs>,
) => {
  const queryClient = useQueryClient();
  return useMutation(
    ({ projectId, file }: UploadProjectFileArgs) => {
      const formData = new FormData();
      formData.append('file', file);
      return dataService.uploadProjectFile(projectId, formData);
    },
    {
      mutationKey: [MutationKeys.uploadProjectFile],
      ...options,
      onSuccess: (data, variables, context) => {
        queryClient.invalidateQueries([QueryKeys.projectFiles, variables.projectId]);
        queryClient.invalidateQueries([QueryKeys.project, variables.projectId]);
        queryClient.invalidateQueries([QueryKeys.projects]);
        options?.onSuccess?.(data, variables, context);
      },
    },
  );
};

export type DeleteProjectFileArgs = { projectId: string; fileId: string };

export const useDeleteProjectFileMutation = (
  options?: UseMutationOptions<void, Error, DeleteProjectFileArgs>,
) => {
  const queryClient = useQueryClient();
  return useMutation(
    ({ projectId, fileId }: DeleteProjectFileArgs) =>
      dataService.deleteProjectFile(projectId, fileId),
    {
      mutationKey: [MutationKeys.deleteProjectFile],
      ...options,
      onSuccess: (data, variables, context) => {
        queryClient.invalidateQueries([QueryKeys.projectFiles, variables.projectId]);
        queryClient.invalidateQueries([QueryKeys.project, variables.projectId]);
        queryClient.invalidateQueries([QueryKeys.projects]);
        options?.onSuccess?.(data, variables, context);
      },
    },
  );
};
