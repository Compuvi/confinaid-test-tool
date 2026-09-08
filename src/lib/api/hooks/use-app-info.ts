import { useQuery } from "@tanstack/react-query";

import { commands } from "../tauri-client";
import { queryKeys } from "../query-client";

/** Host and build metadata. Static for the process lifetime. */
export function useRuntimeInfo() {
  return useQuery({
    queryKey: queryKeys.app.runtimeInfo(),
    queryFn: commands.app.getRuntimeInfo,
    staleTime: Infinity,
  });
}
