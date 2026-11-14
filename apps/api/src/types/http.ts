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
};

export type CommandResponse = {
  message: MessageRecord;
};

export type ErrorResponse = {
  error: string;
};
