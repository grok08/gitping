export type Message = {
  id: string;
  author: string;
  avatar: string;
  text: string;
  command: string;
  time: string;
  mine?: boolean;
};

export type ApiMessage = {
  id: string;
  author: string;
  text: string;
  command: string;
  created_at: string;
};

export type CreatedMessage = {
  id: string;
  author: string;
  text: string;
  command: string;
  createdAt: string;
};
