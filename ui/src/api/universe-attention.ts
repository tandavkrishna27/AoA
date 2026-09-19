import { universeAttentionResponseSchema, type UniverseAttentionResponse } from "@armyofagents/shared";
import { api } from "./client";

export const universeAttentionApi = {
  async get(companyId: string, cursor?: string, signal?: AbortSignal): Promise<UniverseAttentionResponse> {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    const response = await api.get<UniverseAttentionResponse>(
      `/companies/${companyId}/universe/attention${query}`,
      { signal },
    );
    return universeAttentionResponseSchema.parse(response);
  },
};
