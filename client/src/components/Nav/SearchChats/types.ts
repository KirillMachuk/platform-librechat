export interface SearchItem {
  id: string;
  conversationId: string;
  /** Chats inside a project live at a different URL; without this the link loses the project. */
  projectId?: string;
  messageId?: string;
  title: string;
  snippet?: string;
}
