import type { Conversation } from "../types/conversation";
import type { Message } from "../types/message";
import type { WorkspaceMember } from "../types/workspace";

export const initialConversations: Conversation[] = [
  {
    id: "general",
    name: "general",
    type: "channel",
    members: 24,
    preview: "Welcome to GitPing",
  },
  {
    id: "engineering",
    name: "engineering",
    type: "channel",
    members: 18,
    unread: 3,
    preview: "Let's ship this",
  },
  {
    id: "random",
    name: "random",
    type: "channel",
    members: 31,
    preview: "Weekend plans?",
  },
  {
    id: "weekend",
    name: "weekend",
    type: "channel",
    preview: "git switch weekend",
  },
  {
    id: "rahul",
    name: "rahul",
    type: "direct",
    unread: 1,
    preview: "are you free?",
  },
  {
    id: "alice",
    name: "alice",
    type: "direct",
    preview: "see you tomorrow",
  },
];

export const seedMessages: Message[] = [
  {
    id: "a81f2c",
    author: "rahul",
    avatar: "R",
    text: "what are you doing?",
    command: 'git commit -m "what are you doing?"',
    time: "8:42 PM",
  },
  {
    id: "b71f92",
    author: "grok08",
    avatar: "G",
    text: "working on GitPing",
    command: 'git commit -m "working on GitPing"',
    time: "8:43 PM",
  },
  {
    id: "c44ab1",
    author: "rahul",
    avatar: "R",
    text: "this is actually a fun idea",
    command: 'git commit -m "this is actually a fun idea"',
    time: "8:44 PM",
  },
  {
    id: "d51e73",
    author: "grok08",
    avatar: "G",
    text: "let's see where it goes",
    command: 'git commit -m "let\'s see where it goes"',
    time: "8:45 PM",
    mine: true,
  },
];

export const branches = ["main", "weekend", "feature-ui"];

export const workspaceMembers: WorkspaceMember[] = [
  { name: "grok08", role: "You", avatar: "G", online: true },
  { name: "rahul", role: "Developer", avatar: "R", online: true },
  { name: "alice", role: "Developer", avatar: "A", online: true },
  { name: "maria", role: "Developer", avatar: "M", online: false },
];
