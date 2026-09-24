import type { NormalizedRunActivity } from "./types";
import { AgentMessageEvent } from "./events/agent-message-event";
import { CommandEvent } from "./events/command-event";
import { ErrorEvent } from "./events/error-event";
import { FallbackEvent } from "./events/fallback-event";
import { FileChangeEvent } from "./events/file-change-event";
import { LifecycleEvent } from "./events/lifecycle-event";
import { ReasoningEvent } from "./events/reasoning-event";
import { SubagentEvent } from "./events/subagent-event";
import { TodoEvent } from "./events/todo-event";
import { ToolEvent } from "./events/tool-event";

export function EventRenderer({ activity, last }: { activity: NormalizedRunActivity; last?: boolean }) {
  switch (activity.kind) {
    case "agent-message": return <AgentMessageEvent activity={activity} last={last} />;
    case "reasoning": return <ReasoningEvent activity={activity} last={last} />;
    case "command": return <CommandEvent activity={activity} last={last} />;
    case "file-change": return <FileChangeEvent activity={activity} last={last} />;
    case "tool": return <ToolEvent activity={activity} last={last} />;
    case "subagent": return <SubagentEvent activity={activity} last={last} />;
    case "todo": return <TodoEvent activity={activity} last={last} />;
    case "error": return <ErrorEvent activity={activity} last={last} />;
    case "fallback": return <FallbackEvent activity={activity} last={last} />;
    case "lifecycle": return <LifecycleEvent activity={activity} last={last} />;
  }
}

