export type RunDebugDetails = Record<string, string | number | boolean | null | undefined>;
export type RunDebugLogger = (event: string, details: RunDebugDetails) => void;

export const logRunDebug: RunDebugLogger = (event, details) => {
  console.info(`[AgentTasker][runner:debug] ${event} ${JSON.stringify(details)}`);
};
