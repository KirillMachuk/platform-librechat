import { randomUUID } from 'crypto';
import type { Model } from 'mongoose';
import type { IProject } from '~/types';
import logger from '~/config/winston';

interface CreateProjectInput {
  name: string;
  description?: string;
  instructions?: string;
  icon?: string;
  color?: string;
}

interface UpdateProjectInput {
  name?: string;
  description?: string;
  instructions?: string;
  icon?: string;
  color?: string;
}

interface ProjectListItem {
  projectId: string;
  name: string;
  description: string;
  instructions: string;
  icon: string;
  color: string;
  createdAt?: Date;
  updatedAt?: Date;
  conversationCount: number;
  fileCount: number;
}

export interface ProjectMethods {
  createProject(user: string, data: CreateProjectInput): Promise<IProject>;
  getProjectById(user: string, projectId: string): Promise<IProject | null>;
  getProjects(user: string): Promise<ProjectListItem[]>;
  updateProject(
    user: string,
    projectId: string,
    data: UpdateProjectInput,
  ): Promise<IProject | null>;
  deleteProject(user: string, projectId: string): Promise<boolean>;
}

export function createProjectMethods(mongoose: typeof import('mongoose')): ProjectMethods {
  function getProjectModel(): Model<IProject> {
    return mongoose.models.Project as Model<IProject>;
  }

  async function createProject(user: string, data: CreateProjectInput): Promise<IProject> {
    const Project = getProjectModel();
    const projectId = randomUUID();
    const project = await Project.create({
      projectId,
      user,
      name: data.name,
      description: data.description ?? '',
      instructions: data.instructions ?? '',
      icon: data.icon ?? 'Palette',
      color: data.color ?? 'pink',
    });
    return project.toObject() as IProject;
  }

  async function getProjectById(
    user: string,
    projectId: string,
  ): Promise<IProject | null> {
    const Project = getProjectModel();
    return Project.findOne({ user, projectId }).lean<IProject>();
  }

  async function getProjects(user: string): Promise<ProjectListItem[]> {
    const Project = getProjectModel();
    const Conversation = mongoose.models.Conversation;
    const File = mongoose.models.File;

    const projects = await Project.find({ user }).sort({ updatedAt: -1 }).lean<IProject[]>();
    if (projects.length === 0) {
      return [];
    }

    const projectIds = projects.map((p) => p.projectId);

    const [conversationCounts, fileCounts] = await Promise.all([
      Conversation.aggregate([
        { $match: { user, project_id: { $in: projectIds } } },
        { $group: { _id: '$project_id', count: { $sum: 1 } } },
      ]),
      File.aggregate([
        { $match: { user, project_id: { $in: projectIds } } },
        { $group: { _id: '$project_id', count: { $sum: 1 } } },
      ]),
    ]);

    const convoCountMap = new Map<string, number>(
      conversationCounts.map((c: { _id: string; count: number }) => [c._id, c.count]),
    );
    const fileCountMap = new Map<string, number>(
      fileCounts.map((c: { _id: string; count: number }) => [c._id, c.count]),
    );

    return projects.map((p) => ({
      projectId: p.projectId,
      name: p.name,
      description: p.description ?? '',
      instructions: p.instructions ?? '',
      icon: p.icon ?? 'Palette',
      color: p.color ?? 'pink',
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      conversationCount: convoCountMap.get(p.projectId) ?? 0,
      fileCount: fileCountMap.get(p.projectId) ?? 0,
    }));
  }

  async function updateProject(
    user: string,
    projectId: string,
    data: UpdateProjectInput,
  ): Promise<IProject | null> {
    const Project = getProjectModel();
    const update: Record<string, unknown> = {};
    if (data.name !== undefined) update.name = data.name;
    if (data.description !== undefined) update.description = data.description;
    if (data.instructions !== undefined) update.instructions = data.instructions;
    if (data.icon !== undefined) update.icon = data.icon;
    if (data.color !== undefined) update.color = data.color;
    if (Object.keys(update).length === 0) {
      return Project.findOne({ user, projectId }).lean<IProject>();
    }
    return Project.findOneAndUpdate({ user, projectId }, update, {
      new: true,
      lean: true,
    }).lean<IProject>();
  }

  async function deleteProject(user: string, projectId: string): Promise<boolean> {
    const Project = getProjectModel();
    const Conversation = mongoose.models.Conversation;
    const result = await Project.deleteOne({ user, projectId });
    if (result.deletedCount === 0) {
      return false;
    }
    try {
      await Conversation.updateMany(
        { user, project_id: projectId },
        { $unset: { project_id: '' } },
      );
    } catch (error) {
      logger.error('[deleteProject] failed to detach conversations', error);
    }
    return true;
  }

  return {
    createProject,
    getProjectById,
    getProjects,
    updateProject,
    deleteProject,
  };
}
