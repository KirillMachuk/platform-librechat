import { AccessRoleIds } from 'librechat-data-provider';
import translation from '~/locales/en/translation.json';
import { getRoleLocalizationKeys } from '../roles';

/**
 * The share dialog is generic — one component serves agents, prompts, skills,
 * MCP servers and remote agents — and takes the wording for each role from this
 * map. The generic `com_ui_role_*_desc` keys spell out "the agent", so any
 * resource type left pointing at them tells the reader they are sharing an
 * agent when they are not. That is what a prompt's dialog said until this test
 * existed: "Can view and use the agent but cannot modify it".
 */
const RESOURCES: Record<string, AccessRoleIds[]> = {
  promptGroup: [
    AccessRoleIds.PROMPTGROUP_VIEWER,
    AccessRoleIds.PROMPTGROUP_EDITOR,
    AccessRoleIds.PROMPTGROUP_OWNER,
  ],
  skill: [AccessRoleIds.SKILL_VIEWER, AccessRoleIds.SKILL_EDITOR, AccessRoleIds.SKILL_OWNER],
  mcpServer: [
    AccessRoleIds.MCPSERVER_VIEWER,
    AccessRoleIds.MCPSERVER_EDITOR,
    AccessRoleIds.MCPSERVER_OWNER,
  ],
};

const strings = translation as unknown as Record<string, string>;

const describedAs = (roleId: AccessRoleIds) =>
  strings[getRoleLocalizationKeys(roleId).description] ?? '';

describe('role localizations', () => {
  it.each(Object.entries(RESOURCES))(
    'a %s role never describes itself as an agent',
    (_resource, roleIds) => {
      /* Asserted as a list so a failure names the role and the wording it
       * carries, rather than only saying that something matched. */
      const mentioningAgent = roleIds
        .map((roleId) => ({ roleId, description: describedAs(roleId) }))
        .filter(({ description }) => description.toLowerCase().includes('agent'));
      expect(mentioningAgent).toEqual([]);
    },
  );

  /* The control. Agent roles SHOULD say agent, so the assertion above is about
   * the wrong noun rather than about a word being banned everywhere. */
  it('an agent role does describe an agent', () => {
    expect(describedAs(AccessRoleIds.AGENT_VIEWER).toLowerCase()).toContain('agent');
  });

  /* Every mapped role must resolve to a string that exists. A missing key
   * renders as the key itself, which is how "com_ui_search_table" once reached
   * a screen. */
  it('every mapped role resolves to real strings', () => {
    const missing = Object.values(RESOURCES)
      .flat()
      .flatMap((roleId) => {
        const { name, description } = getRoleLocalizationKeys(roleId);
        return [
          strings[name] ? [] : [{ roleId, key: name }],
          strings[description] ? [] : [{ roleId, key: description }],
        ].flat();
      });
    expect(missing).toEqual([]);
  });
});
