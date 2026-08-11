import { useMemo } from 'react';
import { useRecoilValue } from 'recoil';
import { MCPIcon, OpenAIMinimalIcon } from '@librechat/client';
import {
  Permissions,
  EModelEndpoint,
  PermissionTypes,
  isParamEndpoint,
  isAgentsEndpoint,
  isAssistantsEndpoint,
} from 'librechat-data-provider';
import type { TInterfaceConfig, TEndpointsConfig } from 'librechat-data-provider';
import type { NavLink } from '~/common';
import {
  useAgentCapabilities,
  useMCPServerManager,
  useGetAgentsConfig,
  useBookmarksEnabled,
  useHasAccess,
} from '~/hooks';
import {
  Bot,
  Folder,
  Bookmark,
  Paperclip,
  NotebookPen,
  ScrollText,
  SlidersHorizontal,
} from '~/components/icons';
import MCPBuilderPanel from '~/components/SidePanel/MCPBuilder/MCPBuilderPanel';
import BookmarkPanel from '~/components/SidePanel/Bookmarks/BookmarkPanel';
import PanelSwitch from '~/components/SidePanel/Builder/PanelSwitch';
import Parameters from '~/components/SidePanel/Parameters/Panel';
import FilesPanel from '~/components/SidePanel/Files/Panel';
import AgentsPanel from '~/components/Agents/AgentsPanel';
import { PromptsAccordion } from '~/components/Prompts';
import { ProjectsPanel } from '~/components/Projects';
import { SkillsAccordion } from '~/components/Skills';
import store from '~/store';

export default function useSideNavLinks({
  keyProvided,
  endpoint,
  endpointType,
  interfaceConfig,
  endpointsConfig,
}: {
  hidePanel?: () => void;
  keyProvided: boolean;
  endpoint?: EModelEndpoint | null;
  endpointType?: EModelEndpoint | null;
  interfaceConfig: Partial<TInterfaceConfig>;
  endpointsConfig: TEndpointsConfig;
  includeHidePanel?: boolean;
}) {
  const hasAccessToPrompts = useHasAccess({
    permissionType: PermissionTypes.PROMPTS,
    permission: Permissions.USE,
  });
  const hasAccessToSkills = useHasAccess({
    permissionType: PermissionTypes.SKILLS,
    permission: Permissions.USE,
  });
  const hasAccessToAgents = useHasAccess({
    permissionType: PermissionTypes.AGENTS,
    permission: Permissions.USE,
  });
  const hasAccessToUseMCPSettings = useHasAccess({
    permissionType: PermissionTypes.MCP_SERVERS,
    permission: Permissions.USE,
  });
  const hasAccessToCreateMCP = useHasAccess({
    permissionType: PermissionTypes.MCP_SERVERS,
    permission: Permissions.CREATE,
  });
  const { availableMCPServers } = useMCPServerManager();
  const bookmarksEnabled = useBookmarksEnabled();
  const showParametersPanel = useRecoilValue(store.showParametersPanel);

  const { agentsConfig } = useGetAgentsConfig({ endpointsConfig });
  const { skillsEnabled } = useAgentCapabilities(agentsConfig?.capabilities);

  const Links = useMemo(() => {
    const links: NavLink[] = [];

    links.push({
      title: 'com_projects_section',
      label: '',
      icon: Folder,
      id: 'projects',
      Component: ProjectsPanel,
    });

    if (
      endpointsConfig?.[EModelEndpoint.agents] &&
      hasAccessToAgents &&
      endpointsConfig[EModelEndpoint.agents].disableBuilder !== true
    ) {
      links.push({
        title: 'com_ui_agents',
        label: '',
        icon: Bot,
        id: 'agents',
        Component: AgentsPanel,
      });
    }

    if (
      isAssistantsEndpoint(endpoint) &&
      ((endpoint === EModelEndpoint.assistants &&
        endpointsConfig?.[EModelEndpoint.assistants] &&
        endpointsConfig[EModelEndpoint.assistants].disableBuilder !== true) ||
        (endpoint === EModelEndpoint.azureAssistants &&
          endpointsConfig?.[EModelEndpoint.azureAssistants] &&
          endpointsConfig[EModelEndpoint.azureAssistants].disableBuilder !== true)) &&
      keyProvided
    ) {
      links.push({
        title: 'com_sidepanel_assistant_builder',
        label: '',
        icon: OpenAIMinimalIcon,
        id: EModelEndpoint.assistants,
        Component: PanelSwitch,
      });
    }

    if (hasAccessToSkills && skillsEnabled) {
      links.push({
        title: 'com_ui_skills',
        label: '',
        icon: ScrollText,
        id: 'skills',
        Component: SkillsAccordion,
      });
    }

    if (hasAccessToPrompts) {
      links.push({
        title: 'com_ui_prompts',
        label: '',
        icon: NotebookPen,
        id: 'prompts',
        Component: PromptsAccordion,
      });
    }

    links.push({
      title: 'com_sidepanel_attach_files',
      label: '',
      icon: Paperclip,
      id: 'files',
      Component: FilesPanel,
    });

    if (bookmarksEnabled) {
      links.push({
        title: 'com_sidepanel_conversation_tags',
        label: '',
        icon: Bookmark,
        id: 'bookmarks',
        Component: BookmarkPanel,
      });
    }

    if (
      interfaceConfig.parameters === true &&
      showParametersPanel &&
      isParamEndpoint(endpoint ?? '', endpointType ?? '') === true &&
      !isAgentsEndpoint(endpoint) &&
      keyProvided
    ) {
      links.push({
        title: 'com_sidepanel_parameters',
        label: '',
        icon: SlidersHorizontal,
        id: 'parameters',
        Component: Parameters,
      });
    }

    if (
      (hasAccessToUseMCPSettings && availableMCPServers && availableMCPServers.length > 0) ||
      hasAccessToCreateMCP
    ) {
      links.push({
        title: 'com_nav_setting_mcp',
        label: '',
        icon: MCPIcon,
        id: 'mcp-builder',
        Component: MCPBuilderPanel,
      });
    }

    return links;
  }, [
    endpoint,
    endpointsConfig,
    keyProvided,
    hasAccessToAgents,
    hasAccessToPrompts,
    hasAccessToSkills,
    bookmarksEnabled,
    skillsEnabled,
    interfaceConfig.parameters,
    showParametersPanel,
    endpointType,
    availableMCPServers,
    hasAccessToUseMCPSettings,
    hasAccessToCreateMCP,
  ]);

  return Links;
}
