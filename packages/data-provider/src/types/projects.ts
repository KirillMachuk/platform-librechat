export type TProject = {
  projectId: string;
  name: string;
  description: string;
  instructions: string;
  conversationCount?: number;
  fileCount?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type TProjectCreate = {
  name: string;
  description?: string;
  instructions?: string;
};

export type TProjectUpdate = Partial<TProjectCreate>;

export type TProjectConversationsParams = {
  cursor?: string | null;
  limit?: number;
  sortBy?: 'updatedAt' | 'createdAt';
  sortDirection?: 'asc' | 'desc';
};
