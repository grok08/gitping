import { Avatar } from "../../components/ui/Avatar";
import { PresenceDot } from "../../components/ui/PresenceDot";
import type { WorkspaceMember } from "../../types/workspace";

type MemberListProps = {
  members: WorkspaceMember[];
  variant: "workspace" | "conversation";
};

export function MemberList({ members, variant }: MemberListProps) {
  return (
    <>
      {members.map((member) => {
        const isCurrentUser = member.name === "grok08";

        return (
          <div className="member-row" key={member.name}>
            <Avatar label={member.avatar} mine={isCurrentUser} />

            <div>
              <strong>{member.name}</strong>

              <span>
                {variant === "workspace"
                  ? member.role
                  : isCurrentUser
                    ? "You"
                    : "Member"}
              </span>
            </div>

            {member.online === undefined ? null : (
              <PresenceDot online={member.online} />
            )}
          </div>
        );
      })}
    </>
  );
}
