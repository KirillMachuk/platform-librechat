import { useRecoilValue } from 'recoil';
import { Permissions, PermissionTypes } from 'librechat-data-provider';
import useHasAccess from '~/hooks/Roles/useHasAccess';
import store from '~/store';

/**
 * Bookmarks are one feature wearing three faces: the menu in the chat header that files a chat,
 * the filter in the sidebar that browses by bookmark, and the panel that manages the bookmarks
 * themselves. They answer to a single switch so a client who turns bookmarks on gets all three
 * and a client who leaves them off sees none of them. The switch ships off by design; the
 * permission is the administrator's side of the same gate.
 */
export default function useBookmarksEnabled(): boolean {
  const hasAccessToBookmarks = useHasAccess({
    permissionType: PermissionTypes.BOOKMARKS,
    permission: Permissions.USE,
  });
  const showBookmarksMenu = useRecoilValue(store.showBookmarksMenu);

  return hasAccessToBookmarks === true && showBookmarksMenu === true;
}
