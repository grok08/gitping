export type MessageRow = {
  id: string;
  author: string;
  text: string;
  command: string;
  created_at: string;
};

export type MessageRecord = {
  id: string;
  author: string;
  text: string;
  command: string;
  createdAt: string;
};

export type CommandRequest = {
  input?: string;
  author?: string;
  conversation?: string;
  branch?: string;
};

export type CommandResponse = {
  message: MessageRecord;
};

export type ErrorResponse = {
  error: string;
};
